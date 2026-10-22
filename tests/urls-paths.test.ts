import { describe, expect, it } from 'vitest';
import { assetDedupeKey, makeAssetRef } from '../src/assets/asset-key';
import { sha256Hex } from '../src/shared/hash';
import { canonicalNotionUrl, decodeNotionImageProxy, normalizeNotionId, normalizeUrlForDedupe, parseNotionUrl } from '../src/shared/ids';
import { assertSafeArchivePath, notionPagePath, relativePath, slugify } from '../src/shared/paths';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../src/shared/settings';
import { checkFetchUrl, isPrivateOrLocalHost, safeLinkHref } from '../src/shared/url-safety';

describe('page ID extraction', () => {
  const id = '83715d7703ee4b8699b5e659a4712dd8';
  it.each([
    [`https://www.notion.so/Notion-Official-${id}`, id],
    [`https://www.notion.so/myteam/Notion-Official-${id}?pvs=4`, id],
    [`https://www.notion.so/${id}`, id],
    [`https://app.notion.com/p/notion/Notion-Official-${id}`, id],
    [`https://notion.notion.site/Notion-Official-${id}`, id],
    ['https://www.notion.so/83715d77-03ee-4b86-99b5-e659a4712dd8', id],
    [`https://www.notion.so/db-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?v=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&p=${id}&pm=s`, id],
    [`https://www.notion.so/Page-${id.toUpperCase()}`, id],
  ])('%s', (url, expected) => {
    expect(parseNotionUrl(url).pageId).toBe(expected);
  });

  it('extracts block anchors', () => {
    expect(parseNotionUrl(`https://www.notion.so/Page-${id}#aaaaaaaa000040008000000000000002`).blockId).toBe('aaaaaaaa000040008000000000000002');
  });

  it('flags vanity slugs and non-page routes', () => {
    const vanity = parseNotionUrl('https://notion.notion.site/notion-community');
    expect(vanity).toMatchObject({ isNotion: true, isNonPage: false });
    expect(vanity.pageId).toBeUndefined();
    const image = parseNotionUrl('https://www.notion.so/image/https%3A%2F%2Fexample.com%2Fa.png');
    expect(image.isNonPage).toBe(true);
    expect(image.pageId).toBeUndefined();
    expect(parseNotionUrl('https://www.notion.so/login')).toMatchObject({ isNonPage: true });
    expect(parseNotionUrl(`https://evil.example/${id}`).isNotion).toBe(false);
    expect(parseNotionUrl(`https://notion.so.evil.example/${id}`).isNotion).toBe(false);
  });

  it('normalizes IDs and builds canonical URLs', () => {
    expect(normalizeNotionId('83715D77-03EE-4B86-99B5-E659A4712DD8')).toBe(id);
    expect(normalizeNotionId('not-an-id')).toBeUndefined();
    expect(canonicalNotionUrl(id)).toBe(`https://www.notion.so/${id}`);
    expect(canonicalNotionUrl(id, 'https://acme.notion.site/x')).toBe(`https://acme.notion.site/${id}`);
  });

  it('normalizes URLs for dedupe', () => {
    expect(normalizeUrlForDedupe('HTTPS://Example.com/a/?b=2&a=1&utm_source=x#frag')).toBe('https://example.com/a?a=1&b=2');
    expect(normalizeUrlForDedupe('https://example.com/')).toBe('https://example.com/');
  });

  it('decodes Notion image proxy URLs', () => {
    expect(decodeNotionImageProxy('https://www.notion.so/image/https%3A%2F%2Fs3.amazonaws.com%2Fx%2Fy.png?table=block&id=1')).toBe('https://s3.amazonaws.com/x/y.png');
  });
});

describe('URL safety', () => {
  it('allows only safe link schemes', () => {
    expect(safeLinkHref('https://example.com')).toBe('https://example.com/');
    expect(safeLinkHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(safeLinkHref('javascript:alert(1)')).toBeUndefined();
    expect(safeLinkHref(' JaVaScRiPt:alert(1)')).toBeUndefined();
    expect(safeLinkHref('data:text/html,<script>')).toBeUndefined();
    expect(safeLinkHref('file:///etc/passwd')).toBeUndefined();
    expect(safeLinkHref('https://user:pw@example.com')).toBeUndefined();
  });

  it.each(['localhost', 'foo.localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:127.0.0.1]', 'printer.local', 'intranet', 'svc.internal', '100.64.0.1'])(
    'blocks private host %s',
    (h) => expect(isPrivateOrLocalHost(h)).toBe(true),
  );

  it.each(['example.com', 'www.notion.so', '8.8.8.8', '172.32.0.1'])('allows public host %s', (h) => expect(isPrivateOrLocalHost(h)).toBe(false));

  it('checks fetch URLs against policy, scheme, port and credentials', () => {
    const policy = { allowHost: (h: string) => h.endsWith('notion.so') };
    expect(checkFetchUrl('https://www.notion.so/image/x', policy).ok).toBe(true);
    expect(checkFetchUrl('http://www.notion.so/image/x', policy).ok).toBe(false);
    expect(checkFetchUrl('https://example.com/x', policy).ok).toBe(false);
    expect(checkFetchUrl('https://www.notion.so:8443/x', policy).ok).toBe(false);
    expect(checkFetchUrl('https://a:b@www.notion.so/x', policy).ok).toBe(false);
    expect(checkFetchUrl('https://127.0.0.1/x', { allowHost: () => true }).ok).toBe(false);
    expect(checkFetchUrl('https://2130706433/x', { allowHost: () => true }).ok).toBe(false);
    expect(checkFetchUrl('https://0x7f.1/x', { allowHost: () => true }).ok).toBe(false);
  });
});

describe('archive paths', () => {
  it('slugifies deterministically', () => {
    expect(slugify('Hello, Wörld! 🚀')).toBe('hello-world');
    expect(slugify('')).toBe('untitled');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(60);
  });

  it('avoids collisions between identical titles via page ID', () => {
    const a = notionPagePath('Meeting Notes', '1'.repeat(32), 'html');
    const b = notionPagePath('Meeting Notes', '2'.repeat(32), 'html');
    expect(a).not.toBe(b);
    expect(a).toBe(`pages/meeting-notes--${'1'.repeat(32)}.html`);
  });

  it.each(['../x', '/abs', 'a/../b', 'a\\b', 'C:/x', 'a//b', 'a/./b', 'with space', 'nul\u0000'])('rejects unsafe path %j', (p) => {
    expect(() => assertSafeArchivePath(p)).toThrow();
  });

  it('computes relative paths', () => {
    expect(relativePath('pages/a.html', 'pages/b.html')).toBe('b.html');
    expect(relativePath('pages/a.html', 'assets/x.png')).toBe('../assets/x.png');
    expect(relativePath('index.html', 'pages/a.html')).toBe('pages/a.html');
    expect(relativePath('external/e.md', 'index.md')).toBe('../index.md');
  });
});

describe('hashing and asset keys', () => {
  it('sha256 matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  it('dedupes signed and resized variants of the same asset', () => {
    const a = 'https://file.notion.so/f/f/s/f/doc.pdf?expirationTimestamp=1&signature=aaa&downloadName=doc.pdf';
    const b = 'https://file.notion.so/f/f/s/f/doc.pdf?expirationTimestamp=2&signature=bbb';
    expect(assetDedupeKey(a)).toBe(assetDedupeKey(b));
    expect(makeAssetRef(a, 'file').assetId).toBe(makeAssetRef(b, 'file').assetId);
    expect(makeAssetRef('https://example.com/a.png', 'image').assetId).not.toBe(makeAssetRef('https://example.com/b.png', 'image').assetId);
  });
});

describe('settings', () => {
  it('clamps and validates untrusted input', () => {
    const s = sanitizeSettings({ maxPages: 999999, concurrency: 0, format: 'pdf', followLinks: 'yes', markdownToggleMode: 'portable', maxDepth: '5' });
    expect(s.maxPages).toBe(5000);
    expect(s.concurrency).toBe(1);
    expect(s.format).toBe(DEFAULT_SETTINGS.format);
    expect(s.followLinks).toBe(true);
    expect(s.markdownToggleMode).toBe('portable');
    expect(s.maxDepth).toBe(5);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});
