// Notion DOM adapter: reads the rendered page into the RawPage representation.
// Pure DOM functions (no chrome.* APIs) so they can be unit-tested with jsdom fixtures.

import type { AccessState, RawBlock, RawInline, RawPage, RawTableCollection } from '../shared/raw';
import { ACCESS_PHRASES, CODE_LANGUAGES, LOAD_MORE, NOTION, OPAQUE_BLOCKS, TOGGLE_CAPABLE } from './notion-selectors';
import { extractInline, inlineToPlain } from './inline';

const UUIDISH = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i;

export function blockType(el: Element): string {
  for (const cls of Array.from(el.classList)) {
    const m = /^notion-(.+)-block$/.exec(cls);
    if (m?.[1]) return m[1];
  }
  return 'unknown';
}

/** Nearest enclosing block of an element, excluding the element itself. */
export function ownerBlock(el: Element): Element | null {
  return el.parentElement?.closest(NOTION.block) ?? null;
}

function isOwnedBy(el: Element, block: Element): boolean {
  return el.closest(NOTION.block) === block;
}

/** Elements matching `selector` that belong to `block` itself (not to a nested block). */
function owned(block: Element, selector: string): Element[] {
  return Array.from(block.querySelectorAll(selector)).filter((e) => isOwnedBy(e, block));
}

function firstOwned(block: Element, selector: string): Element | undefined {
  return owned(block, selector)[0];
}

/** Direct child blocks: nested `[data-block-id]` whose nearest block ancestor is `block`. */
export function childBlocks(block: Element): Element[] {
  return Array.from(block.querySelectorAll(NOTION.block)).filter(
    (e) => ownerBlock(e) === block && !e.parentElement?.closest(NOTION.leaf),
  );
}

function absUrl(href: string | null | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function textWithoutIcons(el: Element | null | undefined): string {
  if (!el) return '';
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(`${NOTION.recordIcon}, img, svg`).forEach((n) => n.remove());
  return text(clone);
}

export function getFrame(doc: Document): Element | null {
  const frames = Array.from(doc.querySelectorAll(NOTION.frame)).filter((f) => !f.closest(NOTION.peek));
  return frames[0] ?? null;
}

/** The block that represents the page itself (title block), outside the page content. */
export function findRootBlock(doc: Document): Element | null {
  const frame = getFrame(doc);
  if (!frame) return null;
  const candidates = Array.from(frame.querySelectorAll('.notion-page-block[data-block-id], .notion-collection_view_page-block[data-block-id]')).filter(
    (el) => !el.closest(NOTION.pageContent) && !el.matches(NOTION.collectionItem) && !el.closest(NOTION.collectionItem) && !ownerBlock(el),
  );
  return candidates.find((el) => el.querySelector('h1')) ?? candidates[0] ?? null;
}

function iconOf(scope: Element | null | undefined): string | undefined {
  const icon = scope?.querySelector(NOTION.recordIcon);
  if (!icon) return undefined;
  const emoji = icon.querySelector('[role="img"]')?.textContent?.trim() || icon.querySelector('span')?.textContent?.trim();
  if (emoji && emoji.length <= 8) return emoji;
  return undefined;
}

export function detectAccessState(doc: Document): AccessState {
  const title = (doc.title || '').toLowerCase();
  const path = doc.location?.pathname ?? '';
  const bodyText = (doc.body?.textContent ?? '').slice(0, 20000).toLowerCase();
  if (ACCESS_PHRASES.challenge.some((p) => title.includes(p)) || doc.querySelector('#challenge-form, #cf-challenge-running')) return 'challenge';
  const frame = getFrame(doc);
  const root = findRootBlock(doc);
  if (root && (frame?.querySelector(NOTION.pageContent) || frame?.querySelector(NOTION.block))) return 'ready';
  if (/^\/(login|signup|onboarding)/.test(path) || (!frame && doc.querySelector('input[type="email"]'))) return 'login_required';
  if (ACCESS_PHRASES.noAccess.some((p) => bodyText.includes(p))) return 'no_access';
  if (ACCESS_PHRASES.notFound.some((p) => bodyText.includes(p))) return 'not_found';
  if (ACCESS_PHRASES.rateLimited.some((p) => bodyText.includes(p))) return 'challenge';
  return 'loading';
}

// ---------------------------------------------------------------------------------------------
// Toggles

/** Collapsed toggle buttons that belong to toggle-capable blocks inside the page content. */
export function collapsedToggleButtons(doc: Document): HTMLElement[] {
  const content = getFrame(doc)?.querySelector(NOTION.pageContent);
  if (!content) return [];
  return Array.from(content.querySelectorAll<HTMLElement>(`${NOTION.toggleButton}[aria-expanded="false"]`)).filter((btn) => {
    const block = btn.closest(NOTION.block);
    return !!block && TOGGLE_CAPABLE.has(blockType(block)) && !btn.closest(NOTION.leaf) && !btn.closest(NOTION.peek);
  });
}

export function toggleButtonOf(block: Element): HTMLElement | undefined {
  return firstOwned(block, NOTION.toggleButton) as HTMLElement | undefined;
}

export function loadMoreButtons(doc: Document): HTMLElement[] {
  const frame = getFrame(doc);
  if (!frame) return [];
  return Array.from(frame.querySelectorAll<HTMLElement>('[role="button"], button')).filter((el) => {
    if (!LOAD_MORE.test(el.textContent ?? '')) return false;
    const block = el.closest(NOTION.block);
    const viewish = el.closest('.notion-collection_view-block, .notion-collection_view_page-block') || (block && /collection/.test(blockType(block)));
    return !!viewish && !el.closest(NOTION.peek);
  });
}

// ---------------------------------------------------------------------------------------------
// Collections (databases)

function extractCollection(scope: Element, baseUrl: string): RawTableCollection {
  const viewClass = NOTION.collectionViewTypes.find((c) => scope.querySelector(`.${c}`));
  const columns = Array.from(scope.querySelectorAll(NOTION.tableViewHeaderCell))
    .map((c) => text(c))
    .filter(Boolean);
  const titleEl = scope.querySelector('h1, [placeholder="Untitled"], .notion-collection-view-title') ?? scope.querySelector(NOTION.leaf);
  const titleLink = scope.querySelector('a[href]');
  const rows: RawTableCollection['rows'] = [];
  const seen = new Set<string>();
  const items = Array.from(scope.querySelectorAll(`${NOTION.collectionItem}, .notion-table-view-row, a[href]`));
  for (const item of items) {
    if (item === scope) continue;
    if (item.tagName === 'A' && !item.closest(`${NOTION.collectionItem}, .notion-table-view-row, .notion-board-view, .notion-gallery-view, .notion-list-view`)) continue;
    const rowEl = item.closest(`${NOTION.collectionItem}, .notion-table-view-row`) ?? item;
    const link = rowEl.matches('a[href]') ? rowEl : rowEl.querySelector('a[href]');
    const href = absUrl(link?.getAttribute('href'), baseUrl);
    const rawId = rowEl.getAttribute('data-block-id') ?? (href ? UUIDISH.exec(new URL(href).pathname + new URL(href).search)?.[0] : undefined);
    const key = rawId ?? href;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const cells = Array.from(rowEl.querySelectorAll(NOTION.tableViewCell)).map((c) => text(c));
    const titleCell = rowEl.querySelector('.notion-collection-item-title, [data-content-editable-leaf]');
    const title = text(titleCell) || cells[0] || text(link) || text(rowEl).slice(0, 200) || 'Untitled';
    rows.push({ id: rawId ?? undefined, href, title, cells });
  }
  const maybeIncomplete = Array.from(scope.querySelectorAll('[role="button"], button')).some((b) => LOAD_MORE.test(b.textContent ?? ''));
  return {
    title: text(titleEl) || 'Untitled database',
    columns,
    rows,
    maybeIncomplete,
    viewType: viewClass?.replace(/^notion-|-view$/g, ''),
    href: absUrl(titleLink?.getAttribute('href'), baseUrl),
  };
}

// ---------------------------------------------------------------------------------------------
// Blocks

function codeLanguage(block: Element): string | undefined {
  const langs = new Set(CODE_LANGUAGES);
  for (const el of owned(block, '[role="button"], div, span')) {
    if (el.closest(NOTION.leaf) || el.children.length > 0) continue;
    const t = text(el).toLowerCase();
    if (t && t.length <= 24 && langs.has(t)) return t;
  }
  return undefined;
}

function mediaHref(block: Element, baseUrl: string): string | undefined {
  const a = owned(block, 'a[href]').find((e) => !e.closest(NOTION.leaf));
  const media = firstOwned(block, 'video[src], audio[src], source[src], iframe[src], embed[src], object[data]');
  const raw = media?.getAttribute('src') ?? media?.getAttribute('data') ?? a?.getAttribute('href');
  return absUrl(raw, baseUrl);
}

function leafInline(leaf: Element | undefined, baseUrl: string): RawInline[] {
  return extractInline(leaf, { baseUrl, notion: true });
}

export function extractBlock(el: Element, baseUrl: string, depth = 0): RawBlock {
  const type = blockType(el);
  const id = el.getAttribute('data-block-id') ?? '';
  const leaves = owned(el, NOTION.leaf);
  const block: RawBlock = { id, type, children: [] };

  switch (type) {
    case 'page':
    case 'alias':
    case 'collection_view_page': {
      const a = firstOwned(el, 'a[href]');
      block.href = absUrl(a?.getAttribute('href'), baseUrl);
      const label = Array.from(el.querySelectorAll('.notranslate')).find((n) => !n.closest(NOTION.recordIcon));
      block.title = text(label) || inlineToPlain(leafInline(leaves[0], baseUrl)) || textWithoutIcons(a) || 'Untitled';
      block.icon = iconOf(el);
      if (type === 'collection_view_page') block.collection = extractCollection(el, baseUrl);
      return block;
    }
    case 'collection_view':
      block.collection = extractCollection(el, baseUrl);
      block.title = block.collection.title;
      return block;
    case 'table': {
      const rows = Array.from(el.querySelectorAll('tr'));
      block.tableHeader = !!el.querySelector('th');
      block.tableRows = rows.map((tr) =>
        Array.from(tr.querySelectorAll('td, th')).map((cell) => {
          const leaf = cell.querySelector(NOTION.leaf) ?? cell;
          return extractInline(leaf, { baseUrl, notion: true });
        }),
      );
      return block;
    }
    case 'code':
      block.code = leaves[0]?.textContent ?? '';
      block.language = codeLanguage(el);
      if (leaves[1]) block.caption = leafInline(leaves[1], baseUrl);
      return block;
    case 'equation':
      block.equation = (el.querySelector(NOTION.texAnnotation)?.textContent ?? text(el)).trim();
      return block;
    case 'image': {
      const img = owned(el, 'img').find((i) => !i.closest(NOTION.recordIcon));
      // Lazy images carry a data: placeholder until they scroll into view.
      const srcset = img?.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
      const real = [img?.getAttribute('src'), srcset, img?.getAttribute('data-src')].find((c) => c && !/^(data|blob):/i.test(c));
      block.src = absUrl(real, baseUrl);
      block.alt = img?.getAttribute('alt') ?? undefined;
      if (leaves[0]) block.caption = leafInline(leaves[0], baseUrl);
      return block;
    }
    case 'file':
    case 'pdf':
    case 'video':
    case 'audio':
    case 'embed':
    case 'bookmark':
    case 'drive':
    case 'figma':
    case 'tweet':
    case 'maps':
    case 'codepen':
    case 'gist':
    case 'link_preview': {
      block.href = mediaHref(el, baseUrl);
      const a = owned(el, 'a[href]').find((e) => !e.closest(NOTION.leaf));
      if (type === 'bookmark' && a) {
        const lines = Array.from(a.querySelectorAll('div, span'))
          .filter((d) => d.children.length === 0)
          .map((d) => text(d))
          .filter(Boolean);
        block.title = lines[0];
        block.description = lines[1];
      } else {
        block.name = text(a) || undefined;
      }
      if (leaves[0]) block.caption = leafInline(leaves[0], baseUrl);
      return block;
    }
    default:
      break;
  }

  if (leaves[0]) block.text = leafInline(leaves[0], baseUrl);
  if (type === 'unknown') {
    block.title = Array.from(el.classList).find((c) => c !== 'notion-selectable') ?? el.getAttribute('role') ?? el.tagName.toLowerCase();
  }
  if (type === 'to_do') {
    const box = firstOwned(el, 'input[type="checkbox"], [role="checkbox"], [aria-checked]');
    block.checked = box ? (box as HTMLInputElement).checked === true || box.getAttribute('aria-checked') === 'true' || box.hasAttribute('checked') : false;
  }
  if (type === 'callout') block.icon = iconOf(el);
  if (TOGGLE_CAPABLE.has(type)) {
    const btn = toggleButtonOf(el);
    if (btn) {
      block.toggleable = true;
      block.expanded = btn.getAttribute('aria-expanded') === 'true';
    }
  }
  if (!OPAQUE_BLOCKS.has(type) && depth < 64) {
    block.children = childBlocks(el).map((c) => extractBlock(c, baseUrl, depth + 1));
  }
  return block;
}

export function countBlocks(doc: Document): number {
  return getFrame(doc)?.querySelectorAll(NOTION.block).length ?? 0;
}

/** Top-level blocks of the page content currently in the DOM, in order. */
export function topLevelBlocks(doc: Document): Element[] {
  const content = getFrame(doc)?.querySelector(NOTION.pageContent);
  if (!content) return [];
  return Array.from(content.querySelectorAll(NOTION.block)).filter((e) => ownerBlock(e) === null || !content.contains(ownerBlock(e)));
}

export function extractTopLevel(doc: Document): RawBlock[] {
  const baseUrl = doc.location?.href ?? '';
  return topLevelBlocks(doc).map((b) => extractBlock(b, baseUrl));
}

export interface ExtractOptions {
  url: string;
  togglesOpened: number;
  maxBlockCountSeen: number;
  /** Blocks accumulated across scroll positions (virtualized pages). Used instead of the current DOM. */
  accumulated?: RawBlock[];
}

export function extractPage(doc: Document, opts: ExtractOptions): RawPage {
  const baseUrl = doc.location?.href ?? opts.url;
  const frame = getFrame(doc);
  const root = findRootBlock(doc);
  const content = frame?.querySelector(NOTION.pageContent);
  const notes: string[] = [];
  const titleFromDoc = (doc.title || '').replace(/\s*[|–-]\s*Notion\s*$/i, '').trim();
  const title = text(root?.querySelector('h1')) || text(root?.querySelector(NOTION.leaf)) || titleFromDoc || 'Untitled';

  const rawBlocks = opts.accumulated?.length ? opts.accumulated : topLevelBlocks(doc).map((b) => extractBlock(b, baseUrl));

  let collection: RawTableCollection | undefined;
  if (!content && frame) {
    // Full-page database: the frame shows a collection view instead of page content.
    collection = extractCollection(frame, baseUrl);
    if (!collection.rows.length) notes.push('Database page rendered no rows (empty, filtered, or not loaded).');
  }

  const blockCount = countBlocks(doc);
  const collapsedRemaining = collapsedToggleButtons(doc).length;
  return {
    adapter: 'notion-dom',
    url: opts.url,
    finalUrl: baseUrl,
    pageId: root?.getAttribute('data-block-id') ?? undefined,
    title,
    icon: iconOf(frame?.querySelector(`${NOTION.recordIcon}`)?.parentElement ?? null),
    blocks: rawBlocks,
    properties: [],
    collection,
    diagnostics: {
      blockCount,
      collapsedRemaining,
      togglesOpened: opts.togglesOpened,
      virtualizationSuspected: !opts.accumulated?.length && opts.maxBlockCountSeen > 0 && blockCount < opts.maxBlockCountSeen * 0.95,
      notes,
    },
  };
}
