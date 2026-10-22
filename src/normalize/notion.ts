// Notion DOM adapter output (RawPage) → normalized ExportPage.

import { makeAssetRef } from '../assets/asset-key';
import { shortHash } from '../shared/hash';
import { canonicalNotionUrl, normalizeNotionId, parseNotionUrl } from '../shared/ids';
import type { AssetRef, Block, DatabaseEntry, ExportPage, RichText } from '../shared/model';
import type { RawBlock, RawPage, RawTableCollection } from '../shared/raw';
import { safeLinkHref } from '../shared/url-safety';
import { youTubeThumbnailUrl, youTubeVideoId, youTubeWatchUrl } from '../shared/youtube';
import { addReference, classifyLink, normalizeRichText, plainText, type NormalizeContext } from './common';

interface Ctx extends NormalizeContext {
  assets: AssetRef[];
  partial: boolean;
  origin: string;
  collapsedToggles: string[];
}

const EMBED_TYPES = new Set(['embed', 'drive', 'figma', 'tweet', 'maps', 'codepen', 'gist', 'link_preview']);
const FILE_TYPES: Record<string, AssetRef['kind']> = { file: 'file', pdf: 'pdf', video: 'video', audio: 'audio' };
const DROP_TYPES = new Set(['breadcrumb', 'table_row']);

function blockId(raw: RawBlock): string {
  return normalizeNotionId(raw.id) ?? (raw.id || `b-${shortHash(JSON.stringify(raw).slice(0, 500), 10)}`);
}

function addAsset(ctx: Ctx, url: string | undefined, kind: AssetRef['kind'], name?: string): AssetRef | undefined {
  if (!url) return undefined;
  if (!/^https?:/i.test(url)) {
    ctx.warnings.push(`Asset with unsupported URL scheme not downloaded: ${url.slice(0, 60)}`);
    return undefined;
  }
  const ref = makeAssetRef(url, kind, name);
  if (!ctx.assets.some((a) => a.assetId === ref.assetId)) ctx.assets.push(ref);
  return ref;
}

/** Embed block; YouTube videos get a canonical watch link and a thumbnail asset. */
function embedBlock(id: string, url: string, caption: RichText[] | undefined, ctx: Ctx, label?: string): Block {
  const videoId = youTubeVideoId(url);
  if (!videoId) {
    classifyLink(url, ctx, 'link', id, label);
    return { id, type: 'embed', url, caption };
  }
  const watch = youTubeWatchUrl(videoId);
  classifyLink(watch, ctx, 'link', id, label);
  const thumbnail = addAsset(ctx, youTubeThumbnailUrl(videoId), 'image', `youtube-${videoId}`);
  return { id, type: 'embed', url: watch, caption, provider: 'youtube', thumbnail };
}

function collectionEntries(col: RawTableCollection, ctx: Ctx, parentBlockId: string): DatabaseEntry[] {
  const entries: DatabaseEntry[] = [];
  for (const row of col.rows) {
    const pageId = normalizeNotionId(row.id) ?? (row.href ? parseNotionUrl(row.href).pageId : undefined);
    const href = row.href ? safeLinkHref(row.href) : undefined;
    const url = href && (!pageId || parseNotionUrl(href).pageId === pageId) ? href : pageId ? canonicalNotionUrl(pageId, ctx.origin) : undefined;
    if (!url) continue;
    const properties = col.columns.map((name, i) => ({ name, value: row.cells[i] ?? '' })).filter((p) => p.name);
    entries.push({ pageId, url, title: row.title, properties });
    addReference(ctx, { kind: 'database_entry', pageId, url, blockId: parentBlockId, title: row.title });
  }
  if (col.maybeIncomplete) {
    ctx.partial = true;
    ctx.warnings.push(`Database "${col.title}" may have more rows than were loaded in its view.`);
  }
  return entries;
}

function normalizeBlock(raw: RawBlock, ctx: Ctx): Block | undefined {
  const id = blockId(raw);
  const rt = (): RichText[] => normalizeRichText(raw.text, ctx, id);
  const kids = (): Block[] | undefined => {
    const c = normalizeBlocks(raw.children, ctx);
    return c.length ? c : undefined;
  };
  const caption = raw.caption ? normalizeRichText(raw.caption, ctx, id) : undefined;

  if (raw.toggleable && raw.expanded === false) {
    ctx.partial = true;
    ctx.collapsedToggles.push(plainText(rt()).slice(0, 60));
  }

  switch (raw.type) {
    case 'text': {
      const text = rt();
      const children = kids();
      if (!text.length && !children) return undefined;
      return { id, type: 'paragraph', text, children };
    }
    case 'header':
    case 'sub_header':
    case 'sub_sub_header':
      return { id, type: 'heading', level: raw.type === 'header' ? 1 : raw.type === 'sub_header' ? 2 : 3, text: rt(), toggleable: !!raw.toggleable, children: kids() };
    case 'bulleted_list':
      return { id, type: 'bulleted_list_item', text: rt(), children: kids() };
    case 'numbered_list':
      return { id, type: 'numbered_list_item', text: rt(), children: kids() };
    case 'to_do':
      return { id, type: 'to_do', text: rt(), checked: !!raw.checked, children: kids() };
    case 'toggle':
      return { id, type: 'toggle', text: rt(), children: kids() };
    case 'quote':
      return { id, type: 'quote', text: rt(), children: kids() };
    case 'callout':
      return { id, type: 'callout', text: rt(), icon: raw.icon, children: kids() };
    case 'code':
      return { id, type: 'code', code: raw.code ?? '', language: raw.language, caption };
    case 'divider':
      return { id, type: 'divider' };
    case 'equation':
      return { id, type: 'equation', expression: raw.equation ?? '' };
    case 'table': {
      const rows = (raw.tableRows ?? []).map((r) => r.map((cell) => normalizeRichText(cell, ctx, id)));
      return { id, type: 'table', rows, hasHeaderRow: !!raw.tableHeader };
    }
    case 'image': {
      if (!raw.src) {
        ctx.partial = true;
        ctx.warnings.push('An image had not loaded when the page was read (lazy loading); it is missing from the archive.');
        return { id, type: 'image', url: '', alt: raw.alt, caption };
      }
      const asset = addAsset(ctx, raw.src, 'image', raw.alt);
      return { id, type: 'image', asset, url: asset?.originalUrl ?? raw.src, alt: raw.alt, caption };
    }
    case 'page': {
      const pageId = normalizeNotionId(raw.id) ?? (raw.href ? parseNotionUrl(raw.href).pageId : undefined);
      const url = (raw.href && safeLinkHref(raw.href)) ?? (pageId ? canonicalNotionUrl(pageId, ctx.origin) : '');
      if (url) addReference(ctx, { kind: 'child_page', pageId, url, blockId: id, title: raw.title });
      return { id, type: 'child_page', pageId, url, title: raw.title ?? 'Untitled', icon: raw.icon };
    }
    case 'alias': {
      const pageId = raw.href ? parseNotionUrl(raw.href).pageId : undefined;
      const url = (raw.href && safeLinkHref(raw.href)) ?? '';
      if (url) addReference(ctx, { kind: 'link_to_page', pageId, url, blockId: id, title: raw.title });
      return { id, type: 'link_to_page', pageId, url, title: raw.title ?? 'Untitled' };
    }
    case 'collection_view':
    case 'collection_view_page': {
      const col = raw.collection ?? { title: raw.title ?? 'Untitled database', columns: [], rows: [], maybeIncomplete: true };
      let pageId: string | undefined;
      let url: string | undefined;
      if (raw.type === 'collection_view_page') {
        pageId = normalizeNotionId(raw.id) ?? (raw.href ? parseNotionUrl(raw.href).pageId : undefined);
        url = (raw.href && safeLinkHref(raw.href)) ?? (pageId ? canonicalNotionUrl(pageId, ctx.origin) : undefined);
        if (url) addReference(ctx, { kind: 'child_database', pageId, url, blockId: id, title: raw.title });
      }
      const entries = collectionEntries(col, ctx, id);
      return { id, type: 'child_database', title: raw.title ?? col.title, pageId, url, columns: col.columns, entries, complete: !col.maybeIncomplete };
    }
    case 'transclusion_container':
      return { id, type: 'synced_block', role: 'original', children: kids() };
    case 'transclusion_reference': {
      const children = kids();
      const sourceBlockId = raw.children[0] ? blockId(raw.children[0]) : undefined;
      addReference(ctx, { kind: 'synced_block', url: '', blockId: id, title: sourceBlockId });
      return { id, type: 'synced_block', role: 'reference', sourceBlockId, children };
    }
    case 'column_list':
      return { id, type: 'column_list', children: kids() };
    case 'column':
      return { id, type: 'column', children: kids() };
    case 'table_of_contents':
      return { id, type: 'table_of_contents' };
    case 'bookmark': {
      const url = raw.href ? safeLinkHref(raw.href) : undefined;
      if (!url) return undefined;
      classifyLink(url, ctx, 'link', id, raw.title);
      return { id, type: 'bookmark', url, title: raw.title, description: raw.description };
    }
    default:
      break;
  }

  const fileKind = FILE_TYPES[raw.type];
  if (fileKind) {
    const url = raw.href ? safeLinkHref(raw.href) : undefined;
    if (!url) {
      ctx.partial = true;
      ctx.warnings.push(`${raw.type} block without an accessible link.`);
      return { id, type: 'file', url: '', name: raw.name ?? raw.type, caption };
    }
    const isHostedFile = /notion\.so|amazonaws\.com|notion\.site|notion\.com|notion-static\.com/i.test(new URL(url).hostname);
    // Third-party media (YouTube, etc.) is linked, not downloaded.
    if (!isHostedFile) return embedBlock(id, url, caption, ctx, raw.name);
    const asset = addAsset(ctx, url, fileKind, raw.name);
    return { id, type: 'file', asset, url, name: raw.name ?? raw.type, caption };
  }
  if (EMBED_TYPES.has(raw.type)) {
    const url = raw.href ? safeLinkHref(raw.href) : undefined;
    if (!url) return { id, type: 'unsupported', sourceType: raw.type, text: [] };
    return embedBlock(id, url, caption, ctx, raw.name);
  }
  if (DROP_TYPES.has(raw.type)) return undefined;

  const text = rt();
  const children = kids();
  // Unclassified wrappers without content are layout artifacts, not lost content.
  if (raw.type === 'unknown' && !plainText(text).trim() && !children) return undefined;
  const sourceType = raw.type === 'unknown' ? `unknown (${raw.title ?? 'no type'})` : raw.type;
  ctx.warnings.push(`Unsupported block type "${sourceType}" exported as plain text.`);
  return { id, type: 'unsupported', sourceType, text, children };
}

function normalizeBlocks(raws: RawBlock[], ctx: Ctx): Block[] {
  const out: Block[] = [];
  for (const r of raws) {
    const b = normalizeBlock(r, ctx);
    if (b) out.push(b);
  }
  return out;
}

export function normalizeNotionPage(raw: RawPage, extractedAt = new Date().toISOString()): ExportPage {
  const pageId = normalizeNotionId(raw.pageId) ?? parseNotionUrl(raw.finalUrl).pageId ?? parseNotionUrl(raw.url).pageId;
  const ctx: Ctx = {
    selfId: pageId,
    references: [],
    warnings: [],
    notionAware: true,
    assets: [],
    partial: false,
    origin: raw.finalUrl || raw.url,
    collapsedToggles: [],
  };
  const blocks = normalizeBlocks(raw.blocks, ctx);

  if (raw.collection) {
    const entries = collectionEntries(raw.collection, ctx, pageId ?? 'page');
    blocks.unshift({
      id: `${pageId ?? 'page'}-database`,
      type: 'child_database',
      title: raw.collection.title || raw.title,
      pageId,
      url: raw.finalUrl,
      columns: raw.collection.columns,
      entries,
      complete: !raw.collection.maybeIncomplete,
    });
  }

  const d = raw.diagnostics;
  const collapsed = Math.max(d.collapsedRemaining, ctx.collapsedToggles.length);
  if (collapsed > 0) {
    ctx.partial = true;
    const sample = ctx.collapsedToggles.slice(0, 5).map((t) => `"${t}"`).join(', ');
    ctx.warnings.push(`${collapsed} collapsed toggle(s) could not be opened; their hidden content is missing${sample ? ` (e.g. ${sample})` : ''}.`);
  }
  if (d.virtualizationSuspected) {
    ctx.partial = true;
    ctx.warnings.push('Some blocks were unloaded while scrolling (virtualized rendering); content may be incomplete.');
  }
  for (const note of d.notes) ctx.warnings.push(note);
  if (!pageId) ctx.warnings.push('Could not determine the Notion page ID; using a URL-derived key.');

  return {
    key: pageId ?? `nurl:${shortHash(raw.finalUrl || raw.url)}`,
    source: 'notion',
    pageId,
    title: raw.title || 'Untitled',
    url: pageId ? (parseNotionUrl(raw.url).pageId === pageId ? raw.url : canonicalNotionUrl(pageId, raw.finalUrl)) : raw.finalUrl || raw.url,
    icon: raw.icon,
    blocks,
    properties: raw.properties,
    references: ctx.references,
    assets: ctx.assets,
    warnings: [...new Set(ctx.warnings)],
    status: ctx.partial ? 'partial' : 'complete',
    extractedAt,
  };
}
