import { describe, expect, it } from 'vitest';
import { makeAssetRef } from '../src/assets/asset-key';
import { AssetManager, MemoryAssetStore, chooseExtension, type AssetManagerOptions } from '../src/assets/asset-manager';

type Route = { status?: number; type?: string; body?: string | Uint8Array; finalUrl?: string; noLength?: boolean };

function fakeFetch(routes: Record<string, Route>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    if (!r) throw new TypeError('Failed to fetch');
    const body = r.body ?? 'PNGDATA';
    const headers: Record<string, string> = { 'content-type': r.type ?? 'image/png' };
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    if (!r.noLength) headers['content-length'] = String(bytes.byteLength);
    const res = new Response(bytes as BodyInit, { status: r.status ?? 200, headers });
    Object.defineProperty(res, 'url', { value: r.finalUrl ?? url });
    return res;
  }) as typeof fetch;
}

function manager(routes: Record<string, Route>, over: Partial<AssetManagerOptions> = {}, calls: string[] = []) {
  const store = new MemoryAssetStore();
  const m = new AssetManager(
    {
      maxAssets: 100,
      maxAssetBytes: 1000,
      maxTotalBytes: 100000,
      concurrency: 2,
      policy: { allowHost: (h) => h.endsWith('notion.so') || h.endsWith('example.com') },
      withCredentials: (h) => h.endsWith('notion.so'),
      fetchImpl: fakeFetch(routes, calls),
      retryBaseMs: 1,
      ...over,
    },
    store,
  );
  return { m, store };
}

const IMG = 'https://www.notion.so/image/https%3A%2F%2Fs3.example.com%2Fa%2Fpic.png?table=block&id=1&width=100';
const IMG_RESIZED = 'https://www.notion.so/image/https%3A%2F%2Fs3.example.com%2Fa%2Fpic.png?table=block&id=1&width=800';

describe('AssetManager', () => {
  it('downloads once for duplicate references and records all referencing pages', async () => {
    const calls: string[] = [];
    const { m, store } = manager({ [IMG]: {}, [IMG_RESIZED]: {} }, {}, calls);
    m.enqueue([makeAssetRef(IMG, 'image')], 'pageA');
    m.enqueue([makeAssetRef(IMG_RESIZED, 'image')], 'pageB');
    await m.drain();
    const [rec] = m.getRecords();
    expect(m.getRecords().length).toBe(1);
    expect(calls.length).toBe(1);
    expect(rec).toMatchObject({ status: 'downloaded', mime: 'image/png', pages: ['pageA', 'pageB'] });
    expect(rec?.path).toMatch(/^assets\/pic--[0-9a-f]{16}\.png$/);
    expect(await store.get(rec!.assetId)).toBeInstanceOf(Blob);
  });

  it('reports access failures and uses the in-tab fallback when available', async () => {
    const url = 'https://www.notion.so/image/x.png';
    const noFallback = manager({ [url]: { status: 403 } });
    noFallback.m.enqueue([makeAssetRef(url, 'image')], 'p');
    await noFallback.m.drain();
    expect(noFallback.m.getRecords()[0]).toMatchObject({ status: 'failed' });
    expect(noFallback.m.getRecords()[0]?.error).toMatch(/access denied/);

    const withFallback = manager({ [url]: { status: 403 } }, {
      inTabFallback: async () => ({ blob: new Blob(['x'], { type: 'image/png' }), contentType: 'image/png', finalUrl: url }),
    });
    withFallback.m.enqueue([makeAssetRef(url, 'image')], 'p');
    await withFallback.m.drain();
    expect(withFallback.m.getRecords()[0]?.status).toBe('downloaded');
  });

  it('rejects HTML responses, oversized files, blocked hosts and private redirects', async () => {
    const html = 'https://www.notion.so/f/html';
    const big = 'https://www.notion.so/f/big.pdf';
    const stream = 'https://www.notion.so/f/stream.pdf';
    const other = 'https://evil.test/a.png';
    const redirect = 'https://www.notion.so/f/redirect.png';
    const { m } = manager({
      [html]: { type: 'text/html' },
      [big]: { type: 'application/pdf', body: new Uint8Array(5000) },
      [stream]: { type: 'application/pdf', body: new Uint8Array(5000), noLength: true },
      [redirect]: { finalUrl: 'https://169.254.169.254/latest' },
    });
    m.enqueue([makeAssetRef(html, 'file'), makeAssetRef(big, 'pdf'), makeAssetRef(stream, 'pdf'), makeAssetRef(other, 'image'), makeAssetRef(redirect, 'image')], 'p');
    await m.drain();
    const err = Object.fromEntries(m.getRecords().map((r) => [r.fetchUrl, `${r.status}: ${r.error}`]));
    expect(err[html]).toMatch(/failed: received an HTML page/);
    expect(err[big]).toMatch(/failed: exceeds size limit/);
    expect(err[stream]).toMatch(/failed: exceeds size limit/);
    expect(err[other]).toMatch(/failed: blocked URL: host not permitted/);
    expect(err[redirect]).toMatch(/failed: redirected to a blocked URL/);
  });

  it('refuses SVGs with active content', async () => {
    const svg = 'https://www.notion.so/f/x.svg';
    const { m } = manager({ [svg]: { type: 'image/svg+xml', body: '<svg onload="alert(1)"></svg>' } });
    m.enqueue([makeAssetRef(svg, 'image')], 'p');
    await m.drain();
    expect(m.getRecords()[0]?.error).toMatch(/active content/);
  });

  it('enforces the asset count limit', async () => {
    const urls = ['https://www.notion.so/f/1.png', 'https://www.notion.so/f/2.png', 'https://www.notion.so/f/3.png'];
    const { m } = manager(Object.fromEntries(urls.map((u) => [u, {}])), { maxAssets: 2 });
    m.enqueue(urls.map((u) => makeAssetRef(u, 'image')), 'p');
    await m.drain();
    expect(m.stats()).toMatchObject({ downloaded: 2, skipped: 1 });
    expect(m.getLimitsHit()).toContain('maxAssets');
  });

  it('retries transient network errors', async () => {
    let n = 0;
    const url = 'https://www.notion.so/f/flaky.png';
    const store = new MemoryAssetStore();
    const m = new AssetManager(
      {
        maxAssets: 10, maxAssetBytes: 1000, maxTotalBytes: 10000, concurrency: 1,
        policy: { allowHost: () => true }, withCredentials: () => true, retryBaseMs: 1,
        fetchImpl: (async (u: string) => {
          if (n++ === 0) throw new TypeError('Failed to fetch');
          return fakeFetch({ [url]: {} })(u);
        }) as typeof fetch,
      },
      store,
    );
    m.enqueue([makeAssetRef(url, 'image')], 'p');
    await m.drain();
    expect(m.getRecords()[0]).toMatchObject({ status: 'downloaded', attempts: 2 });
  });

  it('times out stalled requests instead of blocking the export', async () => {
    const url = 'https://www.notion.so/f/stall.png';
    const { m } = manager({}, { timeoutMs: 30, fetchImpl: (() => new Promise(() => undefined)) as typeof fetch, inTabFallback: () => new Promise(() => undefined) });
    m.enqueue([makeAssetRef(url, 'image')], 'p');
    await m.drain();
    expect(m.getRecords()[0]).toMatchObject({ status: 'failed', attempts: 3 });
    expect(m.getRecords()[0]?.error).toMatch(/timed out/);
  });

  it('backs off on HTTP 429 using Retry-After, then succeeds', async () => {
    const url = 'https://www.notion.so/f/limited.png';
    let n = 0;
    const times: number[] = [];
    const ok = fakeFetch({ [url]: {} });
    const { m } = manager({}, {
      fetchImpl: (async (u: string) => {
        times.push(Date.now());
        if (n++ === 0) return new Response('slow down', { status: 429, headers: { 'retry-after': '0.05' } });
        return ok(u);
      }) as typeof fetch,
    });
    m.enqueue([makeAssetRef(url, 'image')], 'p');
    await m.drain();
    expect(m.getRecords()[0]).toMatchObject({ status: 'downloaded', attempts: 2 });
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(40);
  });

  it('chooses extensions from MIME type, falling back to the URL', () => {
    expect(chooseExtension('image/jpeg', 'https://x/a')).toBe('jpg');
    expect(chooseExtension('application/octet-stream', 'https://x/a.pdf')).toBe('pdf');
    expect(chooseExtension('', 'https://x/a.exe')).toBe('bin');
    expect(chooseExtension('application/pdf; charset=binary', 'https://x/a')).toBe('pdf');
  });
});
