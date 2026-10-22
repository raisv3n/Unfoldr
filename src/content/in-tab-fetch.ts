// Same-origin fetch from inside a page, used as a fallback when the service worker cannot
// fetch a Notion-hosted asset. Cookies are never read: the browser attaches them to the
// same-origin request as it would for the page itself.

export interface InTabFetchResult {
  ok: boolean;
  status?: number;
  contentType?: string;
  base64?: string;
  size?: number;
  error?: string;
}

export async function fetchSameOrigin(url: string, maxBytes: number): Promise<InTabFetchResult> {
  let target: URL;
  try {
    target = new URL(url, location.href);
  } catch {
    return { ok: false, error: 'invalid URL' };
  }
  if (target.origin !== location.origin) return { ok: false, error: 'cross-origin fetch refused in page context' };
  try {
    const res = await fetch(target.toString(), { credentials: 'same-origin', redirect: 'follow' });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len && len > maxBytes) return { ok: false, status: res.status, error: 'asset exceeds size limit' };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) return { ok: false, status: res.status, error: 'asset exceeds size limit' };
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ok: true, status: res.status, contentType: res.headers.get('content-type') ?? '', base64: btoa(bin), size: bytes.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
