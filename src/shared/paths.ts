// Deterministic, collision-free, traversal-safe archive paths.

export const ARCHIVE_ROOT = 'notion-export';

const MAX_SLUG = 60;

/** ASCII slug: strips diacritics, keeps [a-z0-9-], collapses dashes, never empty. */
export function slugify(input: string, fallback = 'untitled'): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
  return slug || fallback;
}

export type OutputExt = 'html' | 'md';

/** `pages/<slug>--<pageId>.<ext>` — the page ID makes identical titles collision-free. */
export function notionPagePath(title: string, pageId: string, ext: OutputExt): string {
  return `pages/${slugify(title)}--${pageId}.${ext}`;
}

/** `external/<slug>--<hash>.<ext>` where hash comes from the external page key. */
export function externalPagePath(title: string, key: string, ext: OutputExt): string {
  return `external/${slugify(title, 'external-page')}--${key.replace(/^ext:/, '')}.${ext}`;
}

/** `assets/<slug>--<assetId>.<ext>` */
export function assetPath(name: string, assetId: string, ext: string): string {
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
  return `assets/${slugify(name, 'asset')}--${assetId}.${safeExt}`;
}

/**
 * Validates a relative archive path. Throws if it could escape the archive root
 * (absolute paths, `..`, backslashes, drive letters, control characters, empty segments).
 */
export function assertSafeArchivePath(path: string): string {
  if (
    !path ||
    path.length > 240 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /^[a-zA-Z]:/.test(path) ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') ||
    !/^[A-Za-z0-9._\-/]+$/.test(path)
  ) {
    throw new Error(`Unsafe archive path rejected: ${JSON.stringify(path)}`);
  }
  return path;
}

/** Relative path from one archive file to another (both relative to the archive root). */
export function relativePath(fromFile: string, toFile: string): string {
  const from = fromFile.split('/').slice(0, -1);
  const to = toFile.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = from.length - i;
  return [...Array<string>(up).fill('..'), ...to.slice(i)].join('/') || toFile;
}

/** Percent-encodes a relative path for use in href/src while keeping `/` separators. */
export function encodePathForLink(path: string): string {
  return path.split('/').map((s) => (s === '..' ? s : encodeURIComponent(s))).join('/');
}
