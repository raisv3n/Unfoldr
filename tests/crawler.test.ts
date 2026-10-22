import { describe, expect, it } from 'vitest';
import { CrawlError, Crawler, type CrawlOptions, type PageFetcher } from '../src/crawler/crawler';
import type { ExportPage, PageReference } from '../src/shared/model';

const id = (n: number | string) => String(n).padStart(32, '0');
const url = (n: number | string) => `https://www.notion.so/Page-${id(n)}`;

function page(key: string, refs: PageReference[] = [], extra: Partial<ExportPage> = {}): ExportPage {
  return {
    key,
    source: key.startsWith('ext:') ? 'external' : 'notion',
    pageId: key.startsWith('ext:') ? undefined : key,
    title: `Title ${key.slice(-4)}`,
    url: url(key),
    blocks: [],
    properties: [],
    references: refs,
    assets: [],
    warnings: [],
    status: 'complete',
    extractedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

const child = (n: number): PageReference => ({ kind: 'child_page', pageId: id(n), url: url(n) });
const link = (n: number): PageReference => ({ kind: 'link', pageId: id(n), url: url(n) });

/** Graph: page number → references. */
function graphFetcher(graph: Record<number, PageReference[]>, log: string[] = []): PageFetcher {
  return async (node) => {
    log.push(node.key);
    await new Promise((r) => setTimeout(r, 1));
    const n = Number(node.pageId);
    if (!(n in graph)) throw new CrawlError('No access to this page', 'inaccessible', false);
    return page(id(n), graph[n]);
  };
}

const base: CrawlOptions = {
  maxPages: 500,
  maxDepth: 20,
  concurrency: 2,
  maxRetries: 2,
  followLinks: true,
  includeChildPages: true,
  includeDatabaseEntries: true,
  captureExternal: false,
  retryDelayMs: 1,
};

describe('Crawler', () => {
  it('handles circular references and keeps every edge', async () => {
    const log: string[] = [];
    const c = new Crawler(base, graphFetcher({ 1: [child(2)], 2: [link(3)], 3: [link(1), link(2)] }, log));
    c.seed(url(1));
    await c.run();
    expect(log.sort()).toEqual([id(1), id(2), id(3)]);
    expect(c.stats()).toMatchObject({ completed: 3, failed: 0, queued: 0 });
    const edges = c.getEdges().map((e) => `${Number(e.from)}->${Number(e.to)}:${e.kind}`);
    expect(edges).toEqual(expect.arrayContaining(['1->2:child_page', '2->3:link', '3->1:link', '3->2:link']));
  });

  it('deduplicates repeated references to the same page', async () => {
    const log: string[] = [];
    const c = new Crawler(base, graphFetcher({ 1: [child(2), link(2), { kind: 'mention', pageId: id(2), url: url(2) }], 2: [] }, log));
    c.seed(url(1));
    await c.run();
    expect(log.filter((k) => k === id(2)).length).toBe(1);
    expect(c.getEdges().filter((e) => e.to === id(2)).length).toBe(3);
  });

  it('respects the depth limit and reports it', async () => {
    const c = new Crawler({ ...base, maxDepth: 2 }, graphFetcher({ 1: [child(2)], 2: [child(3)], 3: [child(4)], 4: [] }));
    c.seed(url(1));
    await c.run();
    expect(c.getNode(id(4))).toMatchObject({ status: 'skipped', skipReason: 'depth-limit' });
    expect(c.getLimitsHit()).toContain('maxDepth');
  });

  it('respects the page-count limit and reports it', async () => {
    const graph: Record<number, PageReference[]> = { 1: Array.from({ length: 10 }, (_, i) => child(i + 2)) };
    for (let i = 2; i <= 11; i++) graph[i] = [];
    const c = new Crawler({ ...base, maxPages: 5 }, graphFetcher(graph));
    c.seed(url(1));
    await c.run();
    const s = c.stats();
    expect(s.completed).toBe(5);
    expect(c.getNodes().filter((n) => n.skipReason === 'page-limit').length).toBe(6);
    expect(c.getLimitsHit()).toContain('maxPages');
  });

  it('retries transient failures, gives up after maxRetries, and continues the crawl', async () => {
    const attempts: Record<string, number> = {};
    const fetcher: PageFetcher = async (node) => {
      const n = Number(node.pageId);
      attempts[n] = (attempts[n] ?? 0) + 1;
      if (n === 2 && attempts[n] === 1) throw new CrawlError('timeout', 'timeout', true);
      if (n === 3) throw new CrawlError('network down', 'network', true);
      if (n === 4) throw new CrawlError('No access', 'inaccessible', false);
      return page(id(n), n === 1 ? [child(2), child(3), child(4), child(5)] : []);
    };
    const c = new Crawler(base, fetcher);
    c.seed(url(1));
    await c.run();
    expect(c.getNode(id(2))).toMatchObject({ status: 'completed', attempts: 2 });
    expect(c.getNode(id(3))).toMatchObject({ status: 'failed', attempts: 3, errorCode: 'network' });
    expect(c.getNode(id(4))).toMatchObject({ status: 'failed', attempts: 1, errorCode: 'inaccessible' });
    expect(c.getNode(id(5))?.status).toBe('completed');
  });

  it('tracks partial pages separately', async () => {
    const c = new Crawler(base, async (node) => page(node.pageId!, [], { status: 'partial' }));
    c.seed(url(1));
    await c.run();
    expect(c.stats()).toMatchObject({ partial: 1, completed: 0 });
  });

  it('resolves pages whose ID is unknown until visited (vanity URLs) without refetching', async () => {
    const log: string[] = [];
    const vanity = 'https://www.notion.so/team-handbook';
    const fetcher: PageFetcher = async (node) => {
      log.push(node.key);
      if (node.url === vanity) return page(id(9), []);
      if (node.pageId === id(1)) return page(id(1), [{ kind: 'link', url: vanity }, link(9)]);
      return page(node.pageId!, []);
    };
    const c = new Crawler({ ...base, concurrency: 1 }, fetcher);
    c.seed(url(1));
    await c.run();
    expect(log.filter((k) => k === id(9) || k.startsWith('url:')).length).toBe(1);
    expect(c.resolveKey('url:https://www.notion.so/team-handbook')).toBe(id(9));
    expect(c.getEdges().filter((e) => e.to === id(9)).length).toBe(2);
  });

  it('honors relationship toggles and records not-followed links', async () => {
    const c = new Crawler({ ...base, followLinks: false }, graphFetcher({ 1: [child(2), link(3)], 2: [], 3: [] }));
    c.seed(url(1));
    await c.run();
    expect(c.getNode(id(2))?.status).toBe('completed');
    expect(c.getNode(id(3))).toMatchObject({ status: 'skipped', skipReason: 'not-followed' });
  });

  it('bounds concurrency', async () => {
    let active = 0;
    let max = 0;
    const fetcher: PageFetcher = async (node) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      const n = Number(node.pageId);
      return page(id(n), n === 1 ? Array.from({ length: 8 }, (_, i) => child(i + 2)) : []);
    };
    const c = new Crawler({ ...base, concurrency: 2 }, fetcher);
    c.seed(url(1));
    await c.run();
    expect(max).toBe(2);
    expect(c.stats().completed).toBe(9);
  });

  it('cancels, then resumes from a snapshot without refetching completed pages', async () => {
    const graph: Record<number, PageReference[]> = { 1: [child(2), child(3), child(4)], 2: [], 3: [], 4: [] };
    const log: string[] = [];
    let crawler: Crawler | undefined;
    const fetcher: PageFetcher = async (node, signal) => {
      log.push(node.key);
      if (Number(node.pageId) === 2) crawler?.cancel();
      if (signal.aborted) throw new CrawlError('cancelled', 'cancelled', false);
      return page(node.pageId!, graph[Number(node.pageId)]);
    };
    crawler = new Crawler({ ...base, concurrency: 1 }, fetcher);
    crawler.seed(url(1));
    await crawler.run();
    expect(crawler.cancelled).toBe(true);
    expect(crawler.getNode(id(3))).toMatchObject({ status: 'skipped', skipReason: 'cancelled' });

    const snap = JSON.parse(JSON.stringify(crawler.snapshot()));
    log.length = 0;
    const resumed = Crawler.restore(snap, { ...base, concurrency: 1 }, graphFetcher(graph, log));
    await resumed.run();
    expect(log).not.toContain(id(1));
    expect(resumed.stats()).toMatchObject({ completed: 4, skipped: 0 });
  });

  it('captures external pages only when enabled, as leaves', async () => {
    const ext: PageReference = { kind: 'external', url: 'https://example.com/faq' };
    const fetcher: PageFetcher = async (node) =>
      node.kind === 'external' ? page(node.key, [{ kind: 'external', url: 'https://example.com/other' }]) : page(node.pageId!, [ext]);
    const off = new Crawler(base, fetcher);
    off.seed(url(1));
    await off.run();
    expect(off.getNodes().some((n) => n.kind === 'external')).toBe(false);
    expect(off.getEdges().some((e) => e.kind === 'external')).toBe(true);

    const on = new Crawler({ ...base, captureExternal: true }, fetcher);
    on.seed(url(1));
    await on.run();
    const externals = on.getNodes().filter((n) => n.kind === 'external');
    expect(externals.length).toBe(1);
    expect(externals[0]?.status).toBe('completed');
  });
});
