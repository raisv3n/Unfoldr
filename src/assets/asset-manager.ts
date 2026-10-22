// Asset manager: validated, deduplicated, size-limited downloads of images and attachments.

import type { AssetRef } from '../shared/model';
import { assetPath } from '../shared/paths';
import { checkFetchUrl, type FetchPolicy } from '../shared/url-safety';
import { extFromUrl, nameFromUrl } from './asset-key';

export type AssetStatus = 'pending' | 'downloaded' | 'failed' | 'skipped';

export interface AssetRecord {
  assetId: string;
  kind: AssetRef['kind'];
  originalUrl: string;
  fetchUrl: string;
  name?: string;
  status: AssetStatus;
  path?: string;
  mime?: string;
  size?: number;
  finalUrl?: string;
  error?: string;
  attempts: number;
  /** Keys of pages that reference this asset. */
  pages: string[];
}

export interface AssetStore {
  put(assetId: string, blob: Blob): Promise<void>;
  get(assetId: string): Promise<Blob | undefined>;
}

export class MemoryAssetStore implements AssetStore {
  private map = new Map<string, Blob>();
  async put(id: string, blob: Blob) {
    this.map.set(id, blob);
  }
  async get(id: string) {
    return this.map.get(id);
  }
}

export interface FetchedAsset {
  blob: Blob;
  contentType: string;
  finalUrl: string;
}

export interface AssetManagerOptions {
  maxAssets: number;
  maxAssetBytes: number;
  maxTotalBytes: number;
  concurrency: number;
  policy: FetchPolicy;
  /** Whether to send the browser's cookies for this host (Notion hosts only). */
  withCredentials: (hostname: string) => boolean;
  fetchImpl?: typeof fetch;
  /** Fallback: same-origin fetch from inside a Notion tab (used on 401/403/network errors). */
  inTabFallback?: (url: string, maxBytes: number) => Promise<FetchedAsset | undefined>;
  onProgress?: () => void;
  /** Per-asset time limit (default 90 s) so one stalled request cannot block the export. */
  timeoutMs?: number;
  /** Base delay for exponential retry back-off (default 1000 ms). */
  retryBaseMs?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AssetError(message, true)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class AssetError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly fallbackEligible = false,
    /** Server-requested delay (HTTP 429/503 Retry-After). */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

const MAX_ATTEMPTS = 3;

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.min(60000, Math.max(0, secs * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(60000, Math.max(0, date - Date.now())) : undefined;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/heic': 'heic', 'image/tiff': 'tiff',
  'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'application/zip': 'zip', 'text/plain': 'txt', 'text/csv': 'csv',
  'text/markdown': 'md', 'application/json': 'json', 'application/msword': 'doc', 'application/vnd.ms-excel': 'xls', 'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

const SAFE_URL_EXT = /^(png|jpe?g|gif|webp|svg|avif|bmp|ico|heic|tiff?|pdf|mp4|webm|mov|mp3|m4a|wav|ogg|zip|txt|csv|md|json|docx?|xlsx?|pptx?|key|pages|numbers|rtf|epub|psd|ai|sketch|fig)$/;

/** Content types that must never be stored as downloadable assets. */
const DANGEROUS_MIME = /^(text\/html|application\/xhtml\+xml|text\/javascript|application\/javascript|application\/x-javascript|application\/ecmascript)/i;

export function mimeAllowed(kind: AssetRef['kind'], mime: string): boolean {
  const m = mime.split(';')[0]!.trim().toLowerCase();
  if (DANGEROUS_MIME.test(m)) return false;
  if (kind === 'image') return m.startsWith('image/') || m === 'application/octet-stream' || m === '';
  if (kind === 'video') return m.startsWith('video/') || m === 'application/octet-stream' || m === '';
  if (kind === 'audio') return m.startsWith('audio/') || m === 'application/octet-stream' || m === '';
  return true;
}

export function chooseExtension(mime: string, url: string): string {
  const m = mime.split(';')[0]!.trim().toLowerCase();
  const fromUrl = extFromUrl(url);
  if (fromUrl && SAFE_URL_EXT.test(fromUrl) && (!MIME_EXT[m] || m === 'application/octet-stream')) return fromUrl === 'jpeg' ? 'jpg' : fromUrl;
  if (MIME_EXT[m]) return MIME_EXT[m]!;
  if (fromUrl && SAFE_URL_EXT.test(fromUrl)) return fromUrl;
  return 'bin';
}

/** SVG can carry scripts; files with active content are refused rather than sanitized. */
export async function svgHasActiveContent(blob: Blob): Promise<boolean> {
  const text = (await blob.text()).toLowerCase();
  return /<script|\son[a-z]+\s*=|javascript:|<foreignobject|<iframe|<embed|<object|xlink:href\s*=\s*["']?\s*(?!#|data:image)/.test(text);
}

async function readLimited(res: Response, maxBytes: number, signal?: AbortSignal): Promise<Blob> {
  const type = res.headers.get('content-type') ?? '';
  if (!res.body) {
    const blob = await res.blob();
    if (blob.size > maxBytes) throw new AssetError(`exceeds size limit (${maxBytes} bytes)`);
    return blob;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new AssetError('cancelled');
    }
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AssetError(`exceeds size limit (${maxBytes} bytes)`);
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], { type });
}

export class AssetManager {
  private records = new Map<string, AssetRecord>();
  private totalBytes = 0;
  private limitsHit = new Set<string>();
  private busy = new Set<string>();
  /** Shared back-off after rate limiting: all workers pause until this time. */
  private cooldownUntil = 0;

  constructor(
    private readonly opts: AssetManagerOptions,
    private readonly store: AssetStore,
  ) {}

  enqueue(refs: AssetRef[], pageKey: string): void {
    for (const ref of refs) {
      const existing = this.records.get(ref.assetId);
      if (existing) {
        if (!existing.pages.includes(pageKey)) existing.pages.push(pageKey);
        // A fresher signed URL for a not-yet-downloaded asset replaces an expired one.
        if (existing.status === 'failed' || existing.status === 'pending') existing.fetchUrl = ref.fetchUrl;
        if (existing.status === 'failed' && existing.attempts < 3) existing.status = 'pending';
        continue;
      }
      const countable = [...this.records.values()].filter((r) => r.status !== 'skipped').length;
      const rec: AssetRecord = { assetId: ref.assetId, kind: ref.kind, originalUrl: ref.originalUrl, fetchUrl: ref.fetchUrl, name: ref.name, status: 'pending', attempts: 0, pages: [pageKey] };
      if (countable >= this.opts.maxAssets) {
        rec.status = 'skipped';
        rec.error = 'asset count limit reached';
        this.limitsHit.add('maxAssets');
      }
      this.records.set(ref.assetId, rec);
    }
  }

  getRecords(): AssetRecord[] {
    return [...this.records.values()];
  }

  /** Restores records persisted by an interrupted export (downloaded blobs remain in the store). */
  restore(records: AssetRecord[]): void {
    for (const r of records) {
      this.records.set(r.assetId, { ...r });
      if (r.status === 'downloaded') this.totalBytes += r.size ?? 0;
    }
  }

  /** Marks assets that were never attempted as skipped (e.g. after cancellation). */
  skipPending(reason: string): void {
    for (const r of this.records.values()) {
      if (r.status === 'pending' && !this.busy.has(r.assetId)) {
        r.status = 'skipped';
        r.error = reason;
      }
    }
  }

  getLimitsHit(): string[] {
    return [...this.limitsHit];
  }

  pathFor(assetId: string): string | undefined {
    const r = this.records.get(assetId);
    return r?.status === 'downloaded' ? r.path : undefined;
  }

  stats() {
    const s = { queued: 0, downloaded: 0, failed: 0, skipped: 0, bytes: this.totalBytes };
    for (const r of this.records.values()) {
      if (r.status === 'pending') s.queued++;
      else s[r.status]++;
    }
    return s;
  }

  /** Downloads all pending assets with bounded concurrency. Safe to call repeatedly. */
  async drain(signal?: AbortSignal): Promise<void> {
    const worker = async () => {
      for (;;) {
        if (signal?.aborted) return;
        const next = [...this.records.values()].find((r) => r.status === 'pending' && !this.busy.has(r.assetId));
        if (!next) return;
        this.busy.add(next.assetId);
        try {
          await this.download(next, signal);
        } finally {
          this.busy.delete(next.assetId);
          this.opts.onProgress?.();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, this.opts.concurrency) }, worker));
  }

  private async download(rec: AssetRecord, signal?: AbortSignal): Promise<void> {
    if (this.cooldownUntil > Date.now()) await delay(this.cooldownUntil - Date.now(), signal);
    rec.attempts++;
    if (this.totalBytes >= this.opts.maxTotalBytes) {
      rec.status = 'skipped';
      rec.error = 'total asset size limit reached';
      this.limitsHit.add('maxTotalAssetMB');
      return;
    }
    const remaining = Math.min(this.opts.maxAssetBytes, this.opts.maxTotalBytes - this.totalBytes);
    try {
      let fetched: FetchedAsset;
      try {
        const timeoutMs = this.opts.timeoutMs ?? 90000;
        const attempt = new AbortController();
        const onAbort = () => attempt.abort();
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
          fetched = await withTimeout(this.fetchValidated(rec.fetchUrl, remaining, attempt.signal), timeoutMs, `timed out after ${Math.round(timeoutMs / 1000)} s`);
        } finally {
          attempt.abort();
          signal?.removeEventListener('abort', onAbort);
        }
      } catch (e) {
        const err = e instanceof AssetError ? e : new AssetError(e instanceof Error ? e.message : String(e), true, true);
        const fallback =
          err.fallbackEligible && this.opts.inTabFallback
            ? await withTimeout(this.opts.inTabFallback(rec.fetchUrl, remaining), this.opts.timeoutMs ?? 90000, 'in-page fetch timed out').catch(() => undefined)
            : undefined;
        if (!fallback) {
          if (err.retryable && rec.attempts < MAX_ATTEMPTS && !signal?.aborted) {
            const base = this.opts.retryBaseMs ?? 1000;
            const wait = err.retryAfterMs ?? Math.min(30000, base * 2 ** rec.attempts);
            if (err.retryAfterMs !== undefined) this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + wait);
            else await delay(Math.min(wait, 4 * base), signal);
            return this.download(rec, signal);
          }
          throw err;
        }
        fetched = fallback;
      }
      if (fetched.blob.size > remaining) throw new AssetError('exceeds size limit');
      const mime = fetched.contentType || fetched.blob.type;
      if (!mimeAllowed(rec.kind, mime)) {
        throw new AssetError(/html/i.test(mime) ? 'received an HTML page instead of a file (expired link or login required)' : `unsupported content type ${mime}`);
      }
      const ext = chooseExtension(mime, fetched.finalUrl || rec.originalUrl);
      if (ext === 'svg' && (await svgHasActiveContent(fetched.blob))) throw new AssetError('SVG contains active content (scripts/handlers); not included');
      await this.store.put(rec.assetId, fetched.blob);
      rec.status = 'downloaded';
      rec.mime = mime.split(';')[0]!.trim();
      rec.size = fetched.blob.size;
      rec.finalUrl = fetched.finalUrl;
      rec.path = assetPath(rec.name || nameFromUrl(rec.originalUrl), rec.assetId, ext);
      rec.error = undefined;
      this.totalBytes += fetched.blob.size;
    } catch (e) {
      rec.status = signal?.aborted ? 'skipped' : 'failed';
      rec.error = signal?.aborted ? 'cancelled' : e instanceof Error ? e.message : String(e);
    }
  }

  private async fetchValidated(url: string, maxBytes: number, signal?: AbortSignal): Promise<FetchedAsset> {
    const check = checkFetchUrl(url, this.opts.policy);
    if (!check.ok) throw new AssetError(`blocked URL: ${check.reason}`);
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const res = await fetchImpl(check.url.toString(), {
      credentials: this.opts.withCredentials(check.url.hostname) ? 'include' : 'omit',
      redirect: 'follow',
      signal,
      referrerPolicy: 'no-referrer',
    });
    // Fetch follows redirects internally; validate where we ended up before reading the body.
    const finalUrl = res.url || check.url.toString();
    const finalCheck = checkFetchUrl(finalUrl, this.opts.policy);
    if (!finalCheck.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new AssetError(`redirected to a blocked URL: ${finalCheck.reason}`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      const status = res.status;
      if (status === 401 || status === 403) throw new AssetError(`access denied (HTTP ${status}; expired link or no permission)`, false, true);
      if (status === 404 || status === 410) throw new AssetError(`not found (HTTP ${status})`);
      const retryAfter = status === 429 || status === 503 ? (parseRetryAfter(res.headers.get('retry-after')) ?? 2000) : undefined;
      throw new AssetError(`HTTP ${status}`, status >= 500 || status === 429, false, retryAfter);
    }
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len && len > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new AssetError(`exceeds size limit (${len} > ${maxBytes} bytes)`);
    }
    const blob = await readLimited(res, maxBytes, signal);
    return { blob, contentType: res.headers.get('content-type') ?? blob.type, finalUrl };
  }
}
