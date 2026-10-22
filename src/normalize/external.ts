// External website adapter output (RawPage) → normalized ExportPage.

import { makeAssetRef } from '../assets/asset-key';
import { externalKey } from '../crawler/crawler';
import type { AssetRef, Block } from '../shared/model';
import type { ExportPage } from '../shared/model';
import type { RawBlock, RawPage } from '../shared/raw';
import { normalizeRichText, type NormalizeContext } from './common';

interface Ctx extends NormalizeContext {
  assets: AssetRef[];
}

function normalizeBlock(raw: RawBlock, ctx: Ctx): Block | undefined {
  const id = raw.id;
  const kids = () => {
    const c = raw.children.map((r) => normalizeBlock(r, ctx)).filter((b): b is Block => !!b);
    return c.length ? c : undefined;
  };
  const rt = () => normalizeRichText(raw.text, ctx, id);
  switch (raw.type) {
    case 'html:h': {
      const level = Math.min(3, Math.max(1, (raw.level ?? 2) - 1)) as 1 | 2 | 3;
      return { id, type: 'heading', level, text: rt(), toggleable: false };
    }
    case 'html:p':
      return { id, type: 'paragraph', text: rt(), children: kids() };
    case 'html:li':
      return { id, type: raw.ordered ? 'numbered_list_item' : 'bulleted_list_item', text: rt(), children: kids() };
    case 'html:pre':
      return { id, type: 'code', code: raw.code ?? '', language: raw.language };
    case 'html:blockquote':
      return { id, type: 'quote', text: rt(), children: kids() };
    case 'html:hr':
      return { id, type: 'divider' };
    case 'html:table':
      return { id, type: 'table', rows: (raw.tableRows ?? []).map((r) => r.map((c) => normalizeRichText(c, ctx, id))), hasHeaderRow: !!raw.tableHeader };
    case 'html:img': {
      if (!raw.src) return undefined;
      const asset = makeAssetRef(raw.src, 'image', raw.alt);
      if (!ctx.assets.some((a) => a.assetId === asset.assetId)) ctx.assets.push(asset);
      return { id, type: 'image', url: raw.src, alt: raw.alt, asset, caption: raw.caption ? normalizeRichText(raw.caption, ctx, id) : undefined };
    }
    case 'html:details':
    case 'html:accordion':
    case 'html:dl':
    case 'html:faq':
      return { id, type: 'toggle', text: rt(), children: kids() };
    default:
      ctx.warnings.push(`Unsupported external block "${raw.type}".`);
      return { id, type: 'unsupported', sourceType: raw.type, text: rt(), children: kids() };
  }
}

export function normalizeExternalPage(raw: RawPage, requestedUrl: string, extractedAt = new Date().toISOString()): ExportPage {
  const ctx: Ctx = { references: [], warnings: [], notionAware: true, assets: [] };
  const blocks = raw.blocks.map((b) => normalizeBlock(b, ctx)).filter((b): b is Block => !!b);
  const d = raw.diagnostics;
  for (const n of d.notes) ctx.warnings.push(n);
  if (!blocks.length) ctx.warnings.push('No readable content found (page may require login, use heavy client-side rendering, or block automated access).');
  return {
    // Keyed by the requested URL so links to it resolve to this capture.
    key: externalKey(requestedUrl),
    source: 'external',
    title: raw.title,
    url: raw.finalUrl || requestedUrl,
    blocks,
    properties: [],
    references: ctx.references,
    assets: ctx.assets,
    warnings: [...new Set(ctx.warnings)],
    status: d.collapsedRemaining > 0 || !blocks.length ? 'partial' : 'complete',
    extractedAt,
  };
}
