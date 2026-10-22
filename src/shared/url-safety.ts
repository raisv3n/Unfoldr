// URL validation used at every security-sensitive boundary:
// - rendering (which hrefs may appear in exported files),
// - fetching (assets, external pages) including the final URL after redirects.

import { parseUrl } from './ids';

const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** Returns the URL if it is safe to place in an exported href, otherwise undefined. */
export function safeLinkHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const u = parseUrl(url.trim());
  if (!u || !SAFE_LINK_SCHEMES.has(u.protocol)) return undefined;
  if (u.protocol !== 'mailto:' && (u.username || u.password)) return undefined;
  return u.toString();
}

function ipv4Parts(host: string): number[] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : undefined;
}

function isPrivateIPv4(n: number[]): boolean {
  const [a = 0, b = 0] = n;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast / reserved / broadcast
  );
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true; // fe80::/10 link-local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapped?.[1]) {
    const p = ipv4Parts(mapped[1]);
    return p ? isPrivateIPv4(p) : true;
  }
  // ::ffff:7f00:1 style mapped addresses
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(h)) return true;
  return false;
}

/**
 * True for hosts that must never be fetched: localhost, private/reserved IP literals,
 * single-label intranet names and common internal TLDs. (DNS resolution is not visible to an
 * extension, so a public name resolving to a private address cannot be detected here.)
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h.startsWith('[') || h.includes(':')) return isPrivateIPv6(h);
  const v4 = ipv4Parts(h);
  if (v4) return isPrivateIPv4(v4);
  if (/^[\d.]+$/.test(h)) return true; // odd numeric forms; WHATWG URL normally canonicalizes these
  if (!h.includes('.')) return true; // single-label intranet host
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.intranet') ||
    h.endsWith('.lan') ||
    h.endsWith('.home') ||
    h.endsWith('.corp') ||
    h.endsWith('.home.arpa')
  );
}

export interface FetchPolicy {
  /** Return true when the host is allowed for this request class. */
  allowHost: (hostname: string) => boolean;
  allowHttp?: boolean;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export function checkFetchUrl(raw: string, policy: FetchPolicy): UrlCheck {
  const u = parseUrl(raw);
  if (!u) return { ok: false, reason: 'invalid URL' };
  if (u.protocol !== 'https:' && !(policy.allowHttp && u.protocol === 'http:')) {
    return { ok: false, reason: `scheme not allowed (${u.protocol})` };
  }
  if (u.username || u.password) return { ok: false, reason: 'credentials in URL are not allowed' };
  if (u.port && u.port !== '443' && u.port !== '80') return { ok: false, reason: `non-standard port ${u.port}` };
  if (isPrivateOrLocalHost(u.hostname)) return { ok: false, reason: 'private, local or internal network host' };
  if (!policy.allowHost(u.hostname)) return { ok: false, reason: `host not permitted (${u.hostname})` };
  return { ok: true, url: u };
}
