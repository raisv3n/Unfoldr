// Shared normalization helpers: rich text conversion and link/reference classification.

import { normalizeNotionId, parseNotionUrl } from '../shared/ids';
import type { Annotations, LinkTarget, PageReference, ReferenceKind, RichText } from '../shared/model';
import type { RawInline } from '../shared/raw';
import { safeLinkHref } from '../shared/url-safety';

export interface NormalizeContext {
  /** Page ID of the page being normalized (to skip self references). */
  selfId?: string;
  references: PageReference[];
  warnings: string[];
  /** Treat Notion URLs as internal links (false for external pages, where they are just links). */
  notionAware: boolean;
}

export function addReference(ctx: NormalizeContext, ref: PageReference): void {
  if (ref.pageId && ref.pageId === ctx.selfId) return;
  const dup = ctx.references.some(
    (r) => r.kind === ref.kind && r.blockId === ref.blockId && (r.pageId ?? r.url) === (ref.pageId ?? ref.url),
  );
  if (!dup) ctx.references.push(ref);
}

/**
 * Classifies a URL found in content. Notion URLs with an ID become page links; Notion URLs
 * without an ID (vanity slugs) become unresolved links the crawler can visit to resolve.
 */
export function classifyLink(
  href: string,
  ctx: NormalizeContext,
  refKind: Exclude<ReferenceKind, 'external'>,
  blockId?: string,
  title?: string,
): LinkTarget | undefined {
  const safe = safeLinkHref(href);
  if (!safe) {
    ctx.warnings.push(`Dropped link with unsupported or unsafe URL scheme: ${href.slice(0, 80)}`);
    return undefined;
  }
  if (safe.startsWith('mailto:')) return { kind: 'external', url: safe };
  if (ctx.notionAware) {
    const info = parseNotionUrl(safe);
    if (info.isNotion && info.pageId) {
      addReference(ctx, { kind: refKind, pageId: info.pageId, url: safe, blockId, title });
      return { kind: 'page', pageId: info.pageId, url: safe, blockId: info.blockId };
    }
    if (info.isNotion && !info.isNonPage) {
      addReference(ctx, { kind: refKind, url: safe, blockId, title });
      return { kind: 'unresolved', url: safe };
    }
  }
  addReference(ctx, { kind: 'external', url: safe, blockId, title });
  return { kind: 'external', url: safe };
}

function annotationsOf(r: RawInline): Annotations {
  const a: Annotations = {};
  if (r.bold) a.bold = true;
  if (r.italic) a.italic = true;
  if (r.strike) a.strikethrough = true;
  if (r.underline) a.underline = true;
  if (r.code) a.code = true;
  if (r.color) a.color = r.color;
  return a;
}

export function normalizeRichText(runs: RawInline[] | undefined, ctx: NormalizeContext, blockId?: string): RichText[] {
  const out: RichText[] = [];
  for (const r of runs ?? []) {
    const annotations = annotationsOf(r);
    if (r.equation !== undefined && r.equation !== '') {
      out.push({ type: 'equation', expression: r.equation, annotations });
      continue;
    }
    if (r.mention === 'page') {
      const pageId = normalizeNotionId(r.targetId) ?? (r.href ? parseNotionUrl(r.href).pageId : undefined);
      const url = r.href ? safeLinkHref(r.href) : undefined;
      if (pageId && ctx.notionAware) {
        const target = url ?? `https://www.notion.so/${pageId}`;
        addReference(ctx, { kind: 'mention', pageId, url: target, blockId, title: r.text });
        out.push({ type: 'mention', mention: 'page', text: r.text, pageId, url: target, annotations });
      } else if (url) {
        out.push({ type: 'text', text: r.text, annotations, link: classifyLink(url, ctx, 'mention', blockId, r.text) });
      } else {
        out.push({ type: 'mention', mention: 'other', text: r.text, annotations });
      }
      continue;
    }
    if (r.mention) {
      out.push({ type: 'mention', mention: r.mention, text: r.text, annotations });
      continue;
    }
    if (!r.text) continue;
    const link = r.href ? classifyLink(r.href, ctx, 'link', blockId, r.text) : undefined;
    out.push(link ? { type: 'text', text: r.text, annotations, link } : { type: 'text', text: r.text, annotations });
  }
  return out;
}

export function plainText(rt: RichText[]): string {
  return rt.map((r) => (r.type === 'equation' ? r.expression : r.text)).join('');
}
