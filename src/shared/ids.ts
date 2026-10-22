// Notion URL parsing, page-ID extraction and URL normalization.

import type { PageId } from './model';

const HEX32 = /^[0-9a-f]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRAILING_ID = /(?:^|[-_])([0-9a-f]{32})$/i;

/** Path prefixes on Notion hosts that are never pages. */
const NON_PAGE_SEGMENTS = new Set([
  'image', 'images', 'signed', 'api', 'login', 'logout', 'signup', 'onboarding', 'f', 'front-static',
  'native', 'install-integration', 'my-integrations', 'help', 'templates', 'pricing', 'product', 'desktop',
  'mobile', 'invite', 'oauth2', 'auth', 'loginwithemail', 'unsubscribe', 'settings', 'releases',
]);

/** Accepts a 32-hex or dashed UUID and returns the canonical 32 lowercase hex form. */
export function normalizeNotionId(value: string | null | undefined): PageId | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (HEX32.test(v)) return v.toLowerCase();
  if (UUID.test(v)) return v.replace(/-/g, '').toLowerCase();
  return undefined;
}

export function toUuid(id: PageId): string {
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

export function parseUrl(url: string, base?: string): URL | undefined {
  try {
    return new URL(url, base);
  } catch {
    return undefined;
  }
}

/** Hosts that serve Notion pages (workspace app or public sites). */
export function isNotionPageHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'notion.so' ||
    h === 'www.notion.so' ||
    h === 'notion.com' ||
    h === 'www.notion.com' ||
    h === 'app.notion.com' ||
    h.endsWith('.notion.site')
  );
}

/** Hosts that may receive the browser's Notion session cookies (Notion's own sites only). */
export function isNotionCookieHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return isNotionPageHost(h) || h === 'file.notion.so';
}

/** Hosts the extension may contact as part of a Notion export (pages and Notion-hosted files). */
export function isNotionAssetHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    isNotionPageHost(h) ||
    h === 'file.notion.so' ||
    h.endsWith('.notion.com') ||
    h.endsWith('.notionusercontent.com') ||
    h.endsWith('.notion-static.com') ||
    h === 'prod-files-secure.s3.us-west-2.amazonaws.com' ||
    h === 's3.us-west-2.amazonaws.com'
  );
}

export interface NotionUrlInfo {
  pageId?: PageId;
  blockId?: string;
  /** True when the URL points at a Notion page host (even if no ID was found, e.g. vanity slugs). */
  isNotion: boolean;
  /** True when the path is a known non-page route on a Notion host. */
  isNonPage: boolean;
}

export function parseNotionUrl(url: string, base?: string): NotionUrlInfo {
  const u = parseUrl(url, base);
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:') || !isNotionPageHost(u.hostname)) {
    return { isNotion: false, isNonPage: false };
  }
  const segments = u.pathname.split('/').filter(Boolean).map((s) => safeDecode(s));
  // app.notion.com/p/<workspace>/<slug-id>
  const first = segments[0]?.toLowerCase();
  if (first !== undefined && NON_PAGE_SEGMENTS.has(first)) return { isNotion: true, isNonPage: true };
  const blockId = normalizeNotionId(u.hash.replace(/^#/, ''));

  // A peeked page (`?p=`) is the actual link target (database rows, side peek).
  const peek = normalizeNotionId(u.searchParams.get('p'));
  if (peek) return { pageId: peek, blockId, isNotion: true, isNonPage: false };

  for (let i = segments.length - 1; i >= 0; i--) {
    const m = TRAILING_ID.exec(segments[i] ?? '');
    if (m?.[1]) return { pageId: m[1].toLowerCase(), blockId, isNotion: true, isNonPage: false };
    const uuid = normalizeNotionId(segments[i]);
    if (uuid) return { pageId: uuid, blockId, isNotion: true, isNonPage: false };
  }
  return { blockId, isNotion: true, isNonPage: false };
}

export function extractPageId(url: string, base?: string): PageId | undefined {
  return parseNotionUrl(url, base).pageId;
}

/** A navigable URL for a Notion page, keeping the original origin (workspace app vs public site). */
export function canonicalNotionUrl(pageId: PageId, originHint?: string): string {
  const origin = parseUrl(originHint ?? '');
  if (origin && origin.hostname.toLowerCase().endsWith('.notion.site')) {
    return `${origin.protocol}//${origin.host}/${pageId}`;
  }
  return `https://www.notion.so/${pageId}`;
}

const TRACKING_PARAMS = /^(utm_.+|pvs|pm|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|_hsenc|_hsmi)$/i;

/**
 * Normalizes a URL for deduplication: lowercase scheme/host, no default port, no fragment,
 * no tracking params, sorted query, no trailing slash (except root).
 */
export function normalizeUrlForDedupe(url: string, base?: string): string | undefined {
  const u = parseUrl(url, base);
  if (!u) return undefined;
  u.hash = '';
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  params.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  u.search = '';
  for (const [k, v] of params) u.searchParams.append(k, v);
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Decodes Notion's `/image/<encoded-original>` proxy URLs to the original resource URL. */
export function decodeNotionImageProxy(url: string): string | undefined {
  const u = parseUrl(url);
  if (!u || !isNotionPageHost(u.hostname)) return undefined;
  const m = /^\/image\/(.+)$/.exec(u.pathname);
  if (!m?.[1]) return undefined;
  const inner = safeDecode(m[1]);
  return parseUrl(inner) ? inner : undefined;
}
