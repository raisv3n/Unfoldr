// Deterministic asset identity. Assets that are the same resource behind volatile URLs
// (resize params, signed/expiring query strings) share one key so they are downloaded once.

import { decodeNotionImageProxy, normalizeUrlForDedupe, parseUrl } from '../shared/ids';
import { shortHash } from '../shared/hash';
import type { AssetRef } from '../shared/model';

const VOLATILE_PARAMS = /^(width|cache|userid|spaceid|expirationtimestamp|signature|tok|x-amz-.+|downloadname|table|imgbuildsrc|mtd)$/i;

export function assetDedupeKey(fetchUrl: string): string {
  const original = decodeNotionImageProxy(fetchUrl);
  const u = parseUrl(original ?? fetchUrl);
  if (!u) return fetchUrl;
  for (const k of [...u.searchParams.keys()]) if (VOLATILE_PARAMS.test(k)) u.searchParams.delete(k);
  return normalizeUrlForDedupe(u.toString()) ?? u.toString();
}

export function makeAssetRef(fetchUrl: string, kind: AssetRef['kind'], name?: string): AssetRef {
  const originalUrl = decodeNotionImageProxy(fetchUrl) ?? fetchUrl;
  return { assetId: shortHash(assetDedupeKey(fetchUrl), 16), fetchUrl, originalUrl, kind, name };
}

/** Best-effort file name (without extension) from a URL's last path segment. */
export function nameFromUrl(url: string): string {
  const u = parseUrl(decodeNotionImageProxy(url) ?? url);
  const seg = u?.pathname.split('/').filter(Boolean).pop() ?? '';
  let decoded = seg;
  try {
    decoded = decodeURIComponent(seg);
  } catch {
    /* keep raw */
  }
  return decoded.replace(/\.[a-z0-9]{1,8}$/i, '') || 'asset';
}

export function extFromUrl(url: string): string | undefined {
  const u = parseUrl(decodeNotionImageProxy(url) ?? url);
  const m = /\.([a-z0-9]{1,8})$/i.exec(u?.pathname ?? '');
  return m?.[1]?.toLowerCase();
}
