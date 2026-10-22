// Page fetchers used by the crawler: load a page in a crawler tab, let the content script
// prepare it (scroll, open toggles, load more rows), extract, normalize. The service worker
// drives timing so nothing depends on timers inside a possibly-throttled page.

import { CrawlError, type CrawlNode } from '../crawler/crawler';
import type { FetchedAsset } from '../assets/asset-manager';
import { normalizeExternalPage } from '../normalize/external';
import { normalizeNotionPage } from '../normalize/notion';
import { canonicalNotionUrl, isNotionPageHost, parseNotionUrl, parseUrl } from '../shared/ids';
import type { ContentCommand, ExtractResult, FetchInTabResult, ProbeResult, StepResult } from '../shared/messages';
import type { ExportPage } from '../shared/model';
import type { ExportSettings } from '../shared/settings';
import { checkFetchUrl } from '../shared/url-safety';
import type { Slot, TabPool } from './tab-pool';

export const NOTION_SCRIPT = 'content/notion-content.js';
export const EXTERNAL_SCRIPT = 'content/external-content.js';
export const EXTERNAL_ORIGINS = ['https://*/*'];

export interface FetchDeps {
  pool: TabPool;
  settings: ExportSettings;
  onCurrent?: (url: string) => void;
  onStatus?: (message: string) => void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new CrawlError('Export cancelled', 'cancelled', false);
}

function navigate(tabId: number, url: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let sawLoading = false;
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      signal.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };
    const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id !== tabId) return;
      if (info.status === 'loading') sawLoading = true;
      if (info.status === 'complete' && sawLoading) finish();
    };
    const onAbort = () => finish(new CrawlError('Export cancelled', 'cancelled', false));
    const timer = setTimeout(() => finish(new CrawlError('Page load timed out', 'timeout', true)), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    signal.addEventListener('abort', onAbort, { once: true });
    chrome.tabs.update(tabId, { url }).catch((e: unknown) => finish(new CrawlError(`Navigation failed: ${String(e)}`, 'network', true)));
  });
}

async function inject(tabId: number, file: string): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [file] });
  } catch (e) {
    throw new CrawlError(`Cannot read this page (${e instanceof Error ? e.message : String(e)})`, 'inaccessible', false);
  }
}

async function send<T>(tabId: number, msg: ContentCommand): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 })) as T;
  } catch (e) {
    throw new CrawlError(`Lost contact with the page (${e instanceof Error ? e.message : String(e)})`, 'extract', true);
  }
}

/** Side-peek links (`?p=`) are opened as full pages. */
export function navigableNotionUrl(node: Pick<CrawlNode, 'url' | 'pageId'>): string {
  const u = parseUrl(node.url);
  if (u && node.pageId && u.searchParams.get('p')) return canonicalNotionUrl(node.pageId, node.url);
  return node.url;
}

async function waitReady(tabId: number, target: ContentCommand['target'], deadline: number, signal: AbortSignal): Promise<ProbeResult> {
  for (;;) {
    checkAbort(signal);
    const probe = await send<ProbeResult>(tabId, { target, cmd: 'probe' } as ContentCommand);
    if (probe.state !== 'loading') return probe;
    if (Date.now() > deadline) throw new CrawlError('Page did not finish loading (slow connection, or Notion is rate-limiting requests)', 'timeout', true);
    await sleep(500, signal);
  }
}

function accessError(probe: ProbeResult): CrawlError | undefined {
  switch (probe.state) {
    case 'login_required':
      return new CrawlError('Login required (not signed in to Notion in this browser profile?)', 'login_required', false);
    case 'no_access':
      return new CrawlError('No access to this page (requires additional permission)', 'inaccessible', false);
    case 'not_found':
      return new CrawlError('Page does not exist or was deleted', 'not_found', false);
    case 'challenge':
      return new CrawlError('Blocked by Notion (verification challenge or rate limiting)', 'challenge', true);
    default:
      return undefined;
  }
}

export async function fetchNotionPage(node: Readonly<CrawlNode>, signal: AbortSignal, deps: FetchDeps): Promise<ExportPage> {
  const { pool, settings } = deps;
  const deadline = Date.now() + settings.pageTimeoutSec * 1000;
  const slot = await pool.acquire();
  try {
    checkAbort(signal);
    const url = navigableNotionUrl(node);
    deps.onCurrent?.(url);
    await navigate(slot.tabId, url, Math.max(5000, deadline - Date.now()), signal);
    const tab = await chrome.tabs.get(slot.tabId);
    slot.lastUrl = tab.url;
    const finalHost = parseUrl(tab.url ?? '')?.hostname ?? '';
    if (!isNotionPageHost(finalHost)) {
      throw new CrawlError(`Redirected away from Notion to ${finalHost || 'an unknown page'} (login required?)`, 'login_required', false);
    }
    if (parseNotionUrl(tab.url ?? '').isNonPage) throw new CrawlError('Redirected to a Notion login or non-page route', 'login_required', false);

    await inject(slot.tabId, NOTION_SCRIPT);
    const probe = await waitReady(slot.tabId, 'notion-content', Math.min(deadline, Date.now() + 45000), signal);
    const err = accessError(probe);
    if (err) throw err;

    const settled = await prepare(slot, signal, deadline, settings, deps.onStatus);
    checkAbort(signal);
    const res = await send<ExtractResult>(slot.tabId, { target: 'notion-content', cmd: 'extract', url: node.url });
    if (!res.ok) throw new CrawlError(`Extraction failed: ${res.error}`, 'extract', true);
    if (settings.expandToggles && settings.restoreToggles) {
      await send(slot.tabId, { target: 'notion-content', cmd: 'restore' }).catch(() => undefined);
    }
    const page = normalizeNotionPage(res.page);
    if (!settled) {
      page.status = 'partial';
      page.warnings.push('Page preparation reached the time limit; lazily loaded content may be missing.');
    }
    return page;
  } finally {
    pool.release(slot);
  }
}

/** Scroll, open toggles and load more rows until the page stops changing. Returns false on timeout. */
async function prepare(slot: Slot, signal: AbortSignal, deadline: number, settings: ExportSettings, onStatus?: (m: string) => void): Promise<boolean> {
  const minUntil = Date.now() + 1500;
  let prev = -1;
  let stable = 0;
  let opened = 0;
  for (let round = 0; round < 600; round++) {
    checkAbort(signal);
    if (Date.now() > deadline - 3000) return false;
    const st = await send<StepResult>(slot.tabId, {
      target: 'notion-content',
      cmd: 'step',
      expandToggles: settings.expandToggles,
      loadMore: settings.includeDatabaseEntries,
      maxClicks: 40,
    });
    const changed = st.clicked > 0 || st.blockCount !== prev || !st.atBottom;
    prev = st.blockCount;
    opened += st.clicked;
    stable = changed ? 0 : stable + 1;
    if (round % 4 === 0) onStatus?.(`Reading page: ${st.blockCount} blocks${opened ? `, ${opened} toggles/rows opened` : ''}${st.atBottom ? '' : ', scrolling…'}`);
    if (stable >= 3 && Date.now() >= minUntil) return true;
    await sleep(st.clicked > 0 ? 800 : 250, signal);
  }
  return false;
}

const BINARY_EXT = /\.(pdf|zip|png|jpe?g|gif|webp|svg|mp4|mov|mp3|docx?|xlsx?|pptx?|dmg|exe|tar|gz)$/i;

export async function hasExternalPermission(): Promise<boolean> {
  return chrome.permissions.contains({ origins: EXTERNAL_ORIGINS }).catch(() => false);
}

export async function fetchExternalPage(node: Readonly<CrawlNode>, signal: AbortSignal, deps: FetchDeps): Promise<ExportPage> {
  const { pool, settings } = deps;
  if (!(await hasExternalPermission())) throw new CrawlError('Permission for external websites was not granted', 'unsupported', false);
  const pre = checkFetchUrl(node.url, { allowHost: (h) => !isNotionPageHost(h) });
  if (!pre.ok) throw new CrawlError(`External URL refused: ${pre.reason}`, 'unsupported', false);
  if (BINARY_EXT.test(pre.url.pathname)) throw new CrawlError('Link points to a file, not a web page', 'unsupported', false);

  const deadline = Date.now() + Math.min(settings.pageTimeoutSec, 60) * 1000;
  const slot = await pool.acquire();
  try {
    deps.onCurrent?.(node.url);
    await navigate(slot.tabId, pre.url.toString(), Math.max(5000, deadline - Date.now()), signal);
    const tab = await chrome.tabs.get(slot.tabId);
    slot.lastUrl = tab.url;
    const final = checkFetchUrl(tab.url ?? '', { allowHost: () => true });
    if (!final.ok) throw new CrawlError(`Redirected to a refused destination: ${final.reason}`, 'unsupported', false);

    await inject(slot.tabId, EXTERNAL_SCRIPT);
    const probe = await waitReady(slot.tabId, 'external-content', Math.min(deadline, Date.now() + 20000), signal);
    if (probe.state === 'challenge') throw new CrawlError('Blocked by a bot/human verification challenge', 'challenge', false);

    let stable = 0;
    for (let round = 0; round < 12 && stable < 2 && Date.now() < deadline - 2000; round++) {
      checkAbort(signal);
      const st = await send<StepResult>(slot.tabId, { target: 'external-content', cmd: 'step', maxClicks: 20 });
      stable = st.clicked === 0 && st.atBottom ? stable + 1 : 0;
      await sleep(st.clicked ? 700 : 300, signal);
    }
    const res = await send<ExtractResult>(slot.tabId, { target: 'external-content', cmd: 'extract', url: node.url });
    if (!res.ok) throw new CrawlError(`Extraction failed: ${res.error}`, 'extract', true);
    return normalizeExternalPage(res.page, node.url);
  } finally {
    pool.release(slot);
  }
}

/** Same-origin asset fetch inside a crawler tab (fallback for Notion-hosted assets). */
export async function fetchAssetInTab(pool: TabPool, url: string, maxBytes: number): Promise<FetchedAsset | undefined> {
  const origin = parseUrl(url)?.origin;
  if (!origin || !isNotionPageHost(new URL(origin).hostname)) return undefined;
  const slot = pool.findOnOrigin(origin);
  if (!slot) return undefined;
  await chrome.scripting.executeScript({ target: { tabId: slot.tabId, frameIds: [0] }, files: [NOTION_SCRIPT] }).catch(() => undefined);
  const res = (await chrome.tabs
    .sendMessage(slot.tabId, { target: 'notion-content', cmd: 'fetch', url, maxBytes } satisfies ContentCommand, { frameId: 0 })
    .catch(() => undefined)) as FetchInTabResult | undefined;
  if (!res?.ok || !res.base64) return undefined;
  const bin = atob(res.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: res.contentType ?? '' }), contentType: res.contentType ?? '', finalUrl: url };
}
