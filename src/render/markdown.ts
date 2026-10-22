// Markdown renderer: normalized model → CommonMark/GFM. Same model as the HTML renderer.
// Expandable sections: 'interactive' emits <details>/<summary> HTML (rendered by GitHub and many
// viewers, shown as raw HTML by some), 'portable' converts them into headings + content.

import type { Block, ExportPage, RichText } from '../shared/model';
import type { ToggleMode } from '../shared/settings';
import { safeLinkHref } from '../shared/url-safety';
import { escapeHtml } from './html';
import { collectHeadings, groupBlocks, relativeTo, resolveAsset, resolveLink, resolvePageLink, type RenderContext, type ResolvedLink, type Site } from './context';

export interface MarkdownOptions {
  toggleMode: ToggleMode;
}

interface MdCtx extends RenderContext {
  opts: MarkdownOptions;
  /** Current heading depth for portable toggles. */
  headingBase: number;
}

/**
 * TeX for `$…$` / `$$…$$`. `<` and `>` become `\lt` / `\gt` (same rendering in KaTeX and MathJax) so a
 * viewer without math support can never see them as raw HTML tags.
 */
export function safeTex(expression: string): string {
  return expression.replace(/</g, '\\lt ').replace(/>/g, '\\gt ');
}

/** Escapes Markdown control characters in literal text. */
export function escapeMd(text: string): string {
  return text
    .replace(/([\\`*_[\]<>|~])/g, '\\$1')
    .replace(/&(?=#?[a-zA-Z0-9]+;)/g, '&amp;')
    .replace(/^(\s*)([#+-])(?=\s|$)/gm, '$1\\$2') // heading / bullet markers
    .replace(/^(\s*)(\d+)([.)])(?=\s|$)/gm, '$1$2\\$3') // ordered list markers
    .replace(/^(\s*)(-{3,}|={3,})\s*$/gm, '$1\\$2'); // thematic breaks / setext underlines
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') || text.startsWith(' ') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function mdLink(label: string, link: ResolvedLink | undefined): string {
  if (!link) return label;
  const href = /[\s()<>]/.test(link.href) ? `<${link.href.replace(/[<>]/g, encodeURIComponent)}>` : link.href;
  return `[${label || href}](${href})`;
}

function wrap(inner: string, marker: string): string {
  // Markers must hug non-whitespace: move surrounding spaces outside.
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return m[2] ? `${m[1]}${marker}${m[2]}${marker}${m[3]}` : inner;
}

export function renderRichTextMd(rt: RichText[], ctx: RenderContext): string {
  return rt
    .map((r) => {
      if (r.type === 'equation') return `$${safeTex(r.expression).replace(/\$/g, '\\$')}$`;
      const a = r.annotations;
      let inner = a.code ? codeSpan(r.text) : escapeMd(r.text);
      if (!a.code) inner = inner.replace(/\n/g, '\\\n');
      if (a.bold) inner = wrap(inner, '**');
      if (a.italic) inner = wrap(inner, '*');
      if (a.strikethrough) inner = wrap(inner, '~~');
      if (r.type === 'mention') {
        if (r.mention === 'page') return mdLink(inner, resolvePageLink(ctx, r.pageId, r.url));
        return inner;
      }
      return r.link ? mdLink(inner, resolveLink(ctx, r.link)) : inner;
    })
    .join('');
}

function plain(rt: RichText[]): string {
  return rt.map((r) => (r.type === 'equation' ? r.expression : r.text)).join('');
}

function indent(text: string, n: number): string {
  const pad = ' '.repeat(n);
  return text
    .split('\n')
    .map((l) => (l.length ? pad + l : l))
    .join('\n');
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((l) => (l.length ? `> ${l}` : '>'))
    .join('\n');
}

function fence(code: string, lang?: string): string {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((m) => m.length));
  const f = '`'.repeat(longest + 1);
  return `${f}${(lang ?? '').replace(/[^a-z0-9+#-]/gi, '')}\n${code.replace(/\n$/, '')}\n${f}`;
}

function tableCell(rt: RichText[], ctx: MdCtx): string {
  return renderRichTextMd(rt, ctx).replace(/\\\n|\n/g, '<br>') || ' ';
}

function gfmTable(header: string[], rows: string[][]): string {
  const width = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const pad = (r: string[]) => [...r, ...Array<string>(Math.max(0, width - r.length)).fill(' ')];
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
  return [line(header), `| ${Array<string>(width).fill('---').join(' | ')} |`, ...rows.map(line)].join('\n');
}

function children(b: Block, ctx: MdCtx, deeper = false): string {
  if (!b.children?.length) return '';
  return renderBlocksMd(b.children, deeper ? { ...ctx, headingBase: Math.min(6, ctx.headingBase + 1) } : ctx);
}

function toggleSection(summaryRt: RichText[], body: string, ctx: MdCtx, headingLevel?: number): string {
  if (ctx.opts.toggleMode === 'portable') {
    const level = Math.min(6, headingLevel ?? ctx.headingBase);
    const head = `${'#'.repeat(level)} ${renderRichTextMd(summaryRt, ctx) || '(untitled section)'}`;
    return body ? `${head}\n\n${body}` : head;
  }
  const summary = escapeHtml(plain(summaryRt).replace(/\s+/g, ' ').trim()) || '&nbsp;';
  const sumHtml = headingLevel ? `<strong>${summary}</strong>` : summary;
  return `<details>\n<summary>${sumHtml}</summary>\n\n${body}\n\n</details>`;
}

function renderBlockMd(b: Block, ctx: MdCtx): string {
  switch (b.type) {
    case 'paragraph': {
      const text = renderRichTextMd(b.text, ctx);
      const kids = children(b, ctx);
      return kids ? `${text}\n\n${indent(kids, 4)}` : text;
    }
    case 'heading': {
      const level = Math.min(6, b.level + 1);
      if (b.toggleable) return toggleSection(b.text, children(b, ctx, true), { ...ctx, headingBase: level }, level);
      const h = `${'#'.repeat(level)} ${renderRichTextMd(b.text, ctx)}`;
      const kids = children(b, ctx);
      return kids ? `${h}\n\n${kids}` : h;
    }
    case 'toggle':
      return toggleSection(b.text, children(b, ctx, true), ctx);
    case 'quote': {
      const kids = children(b, ctx);
      return quote([renderRichTextMd(b.text, ctx), kids].filter(Boolean).join('\n\n'));
    }
    case 'callout': {
      const kids = children(b, ctx);
      const head = `${b.icon ? `${escapeMd(b.icon)} ` : ''}${renderRichTextMd(b.text, ctx)}`;
      return quote([head, kids].filter(Boolean).join('\n\n'));
    }
    case 'code': {
      const cap = b.caption?.length ? `\n\n*${renderRichTextMd(b.caption, ctx)}*` : '';
      return fence(b.code, b.language) + cap;
    }
    case 'divider':
      return '---';
    case 'equation':
      return `$$\n${safeTex(b.expression).replace(/^\$\$/gm, '\\$\\$')}\n$$`;
    case 'table': {
      if (!b.rows.length) return '';
      const cells = b.rows.map((r) => r.map((c) => tableCell(c, ctx)));
      return gfmTable(cells[0]!, cells.slice(1));
    }
    case 'image': {
      const cap = b.caption?.length ? `\n\n*${renderRichTextMd(b.caption, ctx)}*` : '';
      const src = resolveAsset(ctx, b.asset?.assetId);
      const alt = escapeMd(b.alt ?? '').replace(/\n/g, ' ');
      if (src) return `![${alt}](${src})${cap}`;
      const orig = safeLinkHref(b.url);
      return `${orig ? mdLink(`Image not included${alt ? `: ${alt}` : ''}`, { href: orig, local: false }) : '*Image not included*'}${cap}`;
    }
    case 'file': {
      const src = resolveAsset(ctx, b.asset?.assetId);
      const name = escapeMd(b.name || 'File');
      const cap = b.caption?.length ? ` — ${renderRichTextMd(b.caption, ctx)}` : '';
      if (src) return `📎 [${name}](${src})${cap}`;
      const orig = safeLinkHref(b.url);
      return `📎 ${orig ? mdLink(name, { href: orig, local: false }) : name} *(not downloaded)*${cap}`;
    }
    case 'embed': {
      const link = resolveLink(ctx, { kind: 'external', url: b.url });
      if (b.provider === 'youtube') {
        const label = (b.caption?.length ? plain(b.caption).replace(/\s+/g, ' ').trim() : '') || 'YouTube video';
        const thumb = resolveAsset(ctx, b.thumbnail?.assetId);
        // A clickable thumbnail: shows offline and in viewers that block embedded players.
        if (thumb && link) return `[![▶ ${escapeMd(label)}](${thumb})](${link.href})\n\n▶ ${mdLink(escapeMd(label), link)}`;
        return `▶ ${mdLink(escapeMd(label), link)}`;
      }
      const cap = b.caption?.length ? ` — ${renderRichTextMd(b.caption, ctx)}` : '';
      return `Embedded content: ${mdLink(escapeMd(b.url), link)}${cap}`;
    }
    case 'bookmark': {
      const t = mdLink(escapeMd(b.title || b.url), resolveLink(ctx, { kind: 'external', url: b.url }));
      return b.description ? `🔖 ${t} — ${escapeMd(b.description)}` : `🔖 ${t}`;
    }
    case 'child_page':
    case 'link_to_page': {
      const link = resolvePageLink(ctx, b.pageId, b.url);
      const icon = b.type === 'child_page' ? (b.icon ?? '📄') : '↗';
      const missing = link && !link.local ? ' *(not exported)*' : '';
      return `${escapeMd(icon)} ${mdLink(escapeMd(b.title), link)}${missing}`;
    }
    case 'child_database': {
      const title = b.url || b.pageId ? mdLink(escapeMd(b.title), resolvePageLink(ctx, b.pageId, b.url)) : escapeMd(b.title);
      const head = `**🗃 ${title}**`;
      const note = b.complete ? '' : '\n\n*This view may not show every row.*';
      if (!b.entries.length) return `${head}\n\n*No rows captured.*${note}`;
      if (!b.columns.length) {
        return `${head}\n\n${b.entries.map((e) => `- ${mdLink(escapeMd(e.title), resolvePageLink(ctx, e.pageId, e.url))}`).join('\n')}${note}`;
      }
      const rows = b.entries.map((e) =>
        b.columns.map((c, i) =>
          i === 0 ? mdLink(escapeMd(e.title), resolvePageLink(ctx, e.pageId, e.url)) : escapeMd(e.properties.find((p) => p.name === c)?.value ?? '') || ' ',
        ),
      );
      return `${head}\n\n${gfmTable(b.columns.map((c) => escapeMd(c)), rows)}${note}`;
    }
    case 'synced_block':
    case 'column_list':
    case 'column':
      return children(b, ctx);
    case 'table_of_contents': {
      const hs = collectHeadings(ctx.page.blocks);
      return hs.map((h) => `${'  '.repeat(h.level - 1)}- ${escapeMd(plain(h.text.text))}`).join('\n');
    }
    case 'unsupported': {
      const kids = children(b, ctx);
      return [renderRichTextMd(b.text, ctx), kids].filter(Boolean).join('\n\n');
    }
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'to_do':
      return renderListMd([b], ctx);
  }
}

function renderListMd(items: Block[], ctx: MdCtx): string {
  return items
    .map((b, i) => {
      if (b.type !== 'bulleted_list_item' && b.type !== 'numbered_list_item' && b.type !== 'to_do') return '';
      const marker = b.type === 'numbered_list_item' ? `${i + 1}.` : b.type === 'to_do' ? `- [${b.checked ? 'x' : ' '}]` : '-';
      const width = b.type === 'numbered_list_item' ? marker.length + 1 : 2;
      const text = renderRichTextMd(b.text, ctx) || ' ';
      const kids = children(b, ctx);
      const first = `${marker} ${text.replace(/\n/g, `\n${' '.repeat(width)}`)}`;
      return kids ? `${first}\n\n${indent(kids, width)}` : first;
    })
    .join('\n');
}

export function renderBlocksMd(blocks: Block[], ctx: MdCtx): string {
  return groupBlocks(blocks)
    .map((g) => (g.kind === 'single' ? renderBlockMd(g.block, ctx) : renderListMd(g.items, ctx)))
    .filter((s) => s.trim().length > 0)
    .join('\n\n');
}

function yamlString(s: string): string {
  return JSON.stringify(s);
}

export function renderMarkdownPage(page: ExportPage, site: Site, currentPath: string, opts: MarkdownOptions): string {
  const ctx: MdCtx = { site, page, currentPath, opts, headingBase: 3 };
  const front = [
    '---',
    `title: ${yamlString(page.title)}`,
    page.pageId ? `notion_id: ${yamlString(page.pageId)}` : undefined,
    `source_url: ${yamlString(page.url)}`,
    `source: ${page.source}`,
    `extracted_at: ${yamlString(page.extractedAt)}`,
    `status: ${page.status}`,
    '---',
  ].filter(Boolean);
  const source = safeLinkHref(page.url);
  const parts: string[] = [
    front.join('\n'),
    `# ${page.icon ? `${escapeMd(page.icon)} ` : ''}${escapeMd(page.title)}`,
    `> Source: ${source ? `<${source}>` : escapeMd(page.url)}  \n> [Index](${relativeTo(ctx, site.indexPath)}) · [Export report](${relativeTo(ctx, site.reportPath)})`,
  ];
  if (page.warnings.length) {
    parts.push(`> **Extraction warnings (${page.status}):**\n${page.warnings.map((w) => `> - ${escapeMd(w)}`).join('\n')}`);
  }
  if (page.properties.length) {
    parts.push(gfmTable(['Property', 'Value'], page.properties.map((p) => [escapeMd(p.name), escapeMd(p.value) || ' '])));
  }
  const body = renderBlocksMd(page.blocks, ctx);
  if (body) parts.push(body);
  const backlinks = site.backlinks(page.key);
  if (backlinks.length) {
    parts.push(`---\n\n**Linked from**\n\n${backlinks.map((b) => `- [${escapeMd(b.title)}](${relativeTo(ctx, b.path)}) (${b.kind.replace(/_/g, ' ')})`).join('\n')}`);
  }
  return `${parts.join('\n\n')}\n`;
}

export function renderMarkdownIndex(site: Site, info: { title: string; exportedAt: string; summary: string }, indexPath: string): string {
  const ctx = { site, currentPath: indexPath } as RenderContext;
  const seen = new Set<string>();
  const lines: string[] = [];
  const walk = (key: string, depth: number) => {
    const e = site.entries.get(key);
    if (!e || seen.has(key)) return;
    seen.add(key);
    lines.push(`${'  '.repeat(depth)}- ${e.icon ? `${escapeMd(e.icon)} ` : ''}[${escapeMd(e.title)}](${relativeTo(ctx, e.path)})${e.status === 'partial' ? ' *(partial)*' : ''}`);
    e.children.forEach((k) => walk(k, depth + 1));
  };
  if (site.rootKey) walk(site.rootKey, 0);
  const others = [...site.entries.values()].filter((e) => !seen.has(e.key)).sort((a, b) => a.title.localeCompare(b.title));
  const notion = others.filter((e) => e.source === 'notion');
  const ext = others.filter((e) => e.source === 'external');
  const list = (items: typeof others) => items.map((e) => `- [${escapeMd(e.title)}](${relativeTo(ctx, e.path)})${e.status === 'partial' ? ' *(partial)*' : ''}`).join('\n');
  return [
    `# ${escapeMd(info.title)}`,
    `Exported ${info.exportedAt} · ${escapeMd(info.summary)} · [Export report](${relativeTo(ctx, site.reportPath)})`,
    '## Page tree',
    lines.join('\n') || '*No pages exported.*',
    notion.length ? `## Other linked pages\n\n${list(notion)}` : '',
    ext.length ? `## External pages\n\n${list(ext)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n');
}
