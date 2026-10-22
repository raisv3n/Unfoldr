// Link/asset resolution shared by both renderers. Built by the archive builder from crawl results.

import type { Block, ExportPage, LinkTarget, PageReference } from '../shared/model';
import { encodePathForLink, relativePath } from '../shared/paths';
import { safeLinkHref } from '../shared/url-safety';

export interface SiteEntry {
  key: string;
  title: string;
  icon?: string;
  /** Archive path (relative to archive root) of this page in the current format. */
  path: string;
  url: string;
  source: 'notion' | 'external';
  status: 'complete' | 'partial';
  /** Keys of structural children (child pages, child databases, database entries). */
  children: string[];
}

export interface Backlink {
  title: string;
  path: string;
  kind: PageReference['kind'];
}

export interface Site {
  rootKey?: string;
  entries: Map<string, SiteEntry>;
  /** Maps any page ID / URL key / external key to the canonical exported key. */
  resolve: (target: { pageId?: string; url?: string; external?: boolean }) => string | undefined;
  /** Archive path of a downloaded asset. */
  assetPath: (assetId: string) => string | undefined;
  backlinks: (key: string) => Backlink[];
  reportPath: string;
  indexPath: string;
  stylesheetPath?: string;
}

export interface RenderContext {
  site: Site;
  page: ExportPage;
  /** Archive path of the file being rendered. */
  currentPath: string;
}

export interface ResolvedLink {
  href: string;
  local: boolean;
}

function local(ctx: RenderContext, targetPath: string, anchor?: string): ResolvedLink {
  return { href: encodePathForLink(relativePath(ctx.currentPath, targetPath)) + (anchor ? `#${anchor}` : ''), local: true };
}

export function blockAnchor(blockId: string): string {
  return `b-${blockId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** Resolves a link to a local archive path when the destination was exported, else the safe original URL. */
export function resolveLink(ctx: RenderContext, target: LinkTarget): ResolvedLink | undefined {
  if (target.kind === 'page' || target.kind === 'unresolved') {
    const key = ctx.site.resolve({ pageId: target.kind === 'page' ? target.pageId : undefined, url: target.url });
    const entry = key ? ctx.site.entries.get(key) : undefined;
    const anchor = target.kind === 'page' && target.blockId ? blockAnchor(target.blockId) : undefined;
    if (entry) {
      if (entry.key === ctx.page.key && anchor) return { href: `#${anchor}`, local: true };
      return local(ctx, entry.path, anchor);
    }
  } else {
    const key = ctx.site.resolve({ url: target.url, external: true });
    const entry = key ? ctx.site.entries.get(key) : undefined;
    if (entry) return local(ctx, entry.path);
  }
  const safe = safeLinkHref(target.url);
  return safe ? { href: safe, local: false } : undefined;
}

export function resolvePageLink(ctx: RenderContext, pageId: string | undefined, url: string | undefined): ResolvedLink | undefined {
  if (!pageId && !url) return undefined;
  return resolveLink(ctx, pageId ? { kind: 'page', pageId, url: url ?? '' } : { kind: 'unresolved', url: url! });
}

export function resolveAsset(ctx: RenderContext, assetId: string | undefined): string | undefined {
  if (!assetId) return undefined;
  const p = ctx.site.assetPath(assetId);
  return p ? encodePathForLink(relativePath(ctx.currentPath, p)) : undefined;
}

export function relativeTo(ctx: RenderContext, archivePath: string): string {
  return encodePathForLink(relativePath(ctx.currentPath, archivePath));
}

/** Groups consecutive list items so renderers can emit one list container per run. */
export type BlockGroup =
  | { kind: 'list'; listType: 'bulleted_list_item' | 'numbered_list_item' | 'to_do'; items: Block[] }
  | { kind: 'single'; block: Block };

export function groupBlocks(blocks: Block[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  for (const b of blocks) {
    if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item' || b.type === 'to_do') {
      const last = groups[groups.length - 1];
      if (last?.kind === 'list' && last.listType === b.type) last.items.push(b);
      else groups.push({ kind: 'list', listType: b.type, items: [b] });
    } else {
      groups.push({ kind: 'single', block: b });
    }
  }
  return groups;
}

export function collectHeadings(blocks: Block[], out: { id: string; level: number; text: Block & { type: 'heading' } }[] = []) {
  for (const b of blocks) {
    if (b.type === 'heading') out.push({ id: b.id, level: b.level, text: b });
    if (b.children) collectHeadings(b.children, out);
  }
  return out;
}
