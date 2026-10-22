// HTML renderer: normalized model → standalone offline HTML. Every piece of source text is
// escaped; no source markup is ever passed through, and a CSP forbids scripts in the output.

import type { Block, ExportPage, RichText } from '../shared/model';
import { safeLinkHref } from '../shared/url-safety';
import {
  blockAnchor,
  collectHeadings,
  groupBlocks,
  relativeTo,
  resolveAsset,
  resolveLink,
  resolvePageLink,
  type RenderContext,
  type ResolvedLink,
  type Site,
  type SiteEntry,
} from './context';

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\))$/i;

export const CSP =
  "default-src 'none'; img-src 'self' data: file: blob:; media-src 'self' file:; style-src 'self' 'unsafe-inline' file:; font-src 'self' file:; script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function linkTag(link: ResolvedLink | undefined, inner: string, cls?: string): string {
  if (!link) return inner;
  const classes = [cls, link.local ? undefined : 'external'].filter(Boolean).join(' ');
  const rel = link.local ? '' : ' rel="noopener noreferrer nofollow"';
  return `<a href="${escapeHtml(link.href)}"${classes ? ` class="${classes}"` : ''}${rel}>${inner}</a>`;
}

export function renderRichText(rt: RichText[], ctx: RenderContext): string {
  return rt
    .map((r) => {
      if (r.type === 'equation') return `<code class="equation">${escapeHtml(r.expression)}</code>`;
      let inner = escapeHtml(r.text).replace(/\n/g, '<br>');
      const a = r.annotations;
      if (a.code) inner = `<code>${inner}</code>`;
      if (a.bold) inner = `<strong>${inner}</strong>`;
      if (a.italic) inner = `<em>${inner}</em>`;
      if (a.strikethrough) inner = `<s>${inner}</s>`;
      if (a.underline) inner = `<u>${inner}</u>`;
      if (a.color && SAFE_COLOR.test(a.color)) inner = `<span style="color:${escapeHtml(a.color)}">${inner}</span>`;
      if (r.type === 'mention') {
        if (r.mention === 'page') return linkTag(resolvePageLink(ctx, r.pageId, r.url), inner, 'mention');
        return `<span class="mention">${inner}</span>`;
      }
      return r.link ? linkTag(resolveLink(ctx, r.link), inner) : inner;
    })
    .join('');
}

function renderChildren(blocks: Block[] | undefined, ctx: RenderContext): string {
  return blocks?.length ? renderBlocks(blocks, ctx) : '';
}

function idAttr(b: Block): string {
  return ` id="${blockAnchor(b.id)}"`;
}

function renderListItem(b: Block, ctx: RenderContext): string {
  if (b.type !== 'bulleted_list_item' && b.type !== 'numbered_list_item' && b.type !== 'to_do') return '';
  const box = b.type === 'to_do' ? `<input type="checkbox" disabled${b.checked ? ' checked' : ''}>` : '';
  const text = renderRichText(b.text, ctx);
  return `<li${idAttr(b)}>${box}${b.type === 'to_do' && b.checked ? `<s>${text}</s>` : text}${renderChildren(b.children, ctx)}</li>`;
}

function headingTag(level: 1 | 2 | 3): string {
  return `h${level + 1}`; // page title is h1
}

function renderBlock(b: Block, ctx: RenderContext): string {
  const kids = () => renderChildren(b.children, ctx);
  switch (b.type) {
    case 'paragraph':
      return `<p${idAttr(b)}>${renderRichText(b.text, ctx)}</p>${b.children?.length ? `<div class="indent">${kids()}</div>` : ''}`;
    case 'heading': {
      const tag = headingTag(b.level);
      const h = `<${tag}${idAttr(b)}>${renderRichText(b.text, ctx)}</${tag}>`;
      return b.toggleable ? `<details><summary>${h}</summary><div class="toggle-body">${kids()}</div></details>` : h + kids();
    }
    case 'toggle':
      return `<details${idAttr(b)}><summary>${renderRichText(b.text, ctx) || '&nbsp;'}</summary><div class="toggle-body">${kids()}</div></details>`;
    case 'quote':
      return `<blockquote${idAttr(b)}>${renderRichText(b.text, ctx)}${kids()}</blockquote>`;
    case 'callout':
      return `<aside class="callout"${idAttr(b)}>${b.icon ? `<span class="icon">${escapeHtml(b.icon)}</span>` : ''}<div>${renderRichText(b.text, ctx)}${kids()}</div></aside>`;
    case 'code': {
      const lang = b.language ? ` class="language-${escapeHtml(b.language.replace(/[^a-z0-9+#-]/gi, '-'))}"` : '';
      const cap = b.caption?.length ? `<figcaption>${renderRichText(b.caption, ctx)}</figcaption>` : '';
      return `<figure${idAttr(b)}><pre><code${lang}>${escapeHtml(b.code)}</code></pre>${cap}</figure>`;
    }
    case 'divider':
      return '<hr>';
    case 'equation':
      return `<pre class="equation"${idAttr(b)}><code>${escapeHtml(b.expression)}</code></pre>`;
    case 'table': {
      const rows = b.rows.map((row, i) => {
        const cell = i === 0 && b.hasHeaderRow ? 'th' : 'td';
        return `<tr>${row.map((c) => `<${cell}>${renderRichText(c, ctx)}</${cell}>`).join('')}</tr>`;
      });
      if (b.hasHeaderRow && rows.length) return `<table${idAttr(b)}><thead>${rows[0]}</thead><tbody>${rows.slice(1).join('')}</tbody></table>`;
      return `<table${idAttr(b)}><tbody>${rows.join('')}</tbody></table>`;
    }
    case 'image': {
      const cap = b.caption?.length ? `<figcaption>${renderRichText(b.caption, ctx)}</figcaption>` : '';
      const src = resolveAsset(ctx, b.asset?.assetId);
      if (src) return `<figure${idAttr(b)}><img src="${escapeHtml(src)}" alt="${escapeHtml(b.alt ?? '')}" loading="lazy">${cap}</figure>`;
      const orig = safeLinkHref(b.url);
      const label = `Image not included${b.alt ? `: ${escapeHtml(b.alt)}` : ''}`;
      return `<figure${idAttr(b)}><p class="missing">${orig ? linkTag({ href: orig, local: false }, label) : label}</p>${cap}</figure>`;
    }
    case 'file': {
      const local = resolveAsset(ctx, b.asset?.assetId);
      const cap = b.caption?.length ? ` — ${renderRichText(b.caption, ctx)}` : '';
      const name = escapeHtml(b.name || 'File');
      if (local) return `<p class="file"${idAttr(b)}>📎 <a href="${escapeHtml(local)}">${name}</a>${cap}</p>`;
      const orig = safeLinkHref(b.url);
      return `<p class="file"${idAttr(b)}>📎 ${orig ? linkTag({ href: orig, local: false }, name) : name} <span class="missing">(not downloaded)</span>${cap}</p>`;
    }
    case 'embed': {
      const link = resolveLink(ctx, { kind: 'external', url: b.url });
      if (b.provider === 'youtube') {
        const label = b.caption?.length ? renderRichText(b.caption, ctx) : 'YouTube video';
        const alt = b.caption?.length ? b.caption.map((r) => (r.type === 'equation' ? r.expression : r.text)).join('') : 'YouTube video';
        const thumb = resolveAsset(ctx, b.thumbnail?.assetId);
        // No player iframe: the archive stays offline and script-free; the thumbnail links to the video.
        const img = thumb && link ? `<a href="${escapeHtml(link.href)}" class="video-thumb" rel="noopener noreferrer nofollow"><img src="${escapeHtml(thumb)}" alt="${escapeHtml(`▶ ${alt}`)}" loading="lazy"><span class="play" aria-hidden="true">▶</span></a>` : '';
        return `<figure class="embed video"${idAttr(b)}>${img}<figcaption>▶ ${linkTag(link, label)}</figcaption></figure>`;
      }
      const cap = b.caption?.length ? `<div>${renderRichText(b.caption, ctx)}</div>` : '';
      return `<div class="embed"${idAttr(b)}>Embedded content: ${linkTag(link, escapeHtml(b.url))}${cap}</div>`;
    }
    case 'bookmark': {
      const link = resolveLink(ctx, { kind: 'external', url: b.url });
      const title = escapeHtml(b.title || b.url);
      return `<div class="bookmark"${idAttr(b)}>${linkTag(link, title)}${b.description ? `<div class="desc">${escapeHtml(b.description)}</div>` : ''}</div>`;
    }
    case 'child_page':
    case 'link_to_page': {
      const link = resolvePageLink(ctx, b.pageId, b.url);
      const icon = b.type === 'child_page' ? (b.icon ?? '📄') : '↗';
      const missing = link && !link.local ? ' <span class="missing">(not exported)</span>' : '';
      return `<p class="page-link"${idAttr(b)}><span class="icon">${escapeHtml(icon)}</span>${linkTag(link, escapeHtml(b.title))}${missing}</p>`;
    }
    case 'child_database': {
      const heading = b.url || b.pageId ? linkTag(resolvePageLink(ctx, b.pageId, b.url), escapeHtml(b.title)) : escapeHtml(b.title);
      const note = b.complete ? '' : '<p class="missing">This view may not show every row.</p>';
      if (!b.entries.length) return `<section class="database"${idAttr(b)}><h3>🗃 ${heading}</h3><p class="missing">No rows captured.</p>${note}</section>`;
      const cols = b.columns.length ? b.columns : ['Title'];
      const head = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
      const rows = b.entries.map((e) => {
        const link = linkTag(resolvePageLink(ctx, e.pageId, e.url), escapeHtml(e.title));
        const cells = b.columns.length
          ? cols.map((c, i) => (i === 0 ? link : escapeHtml(e.properties.find((p) => p.name === c)?.value ?? '')))
          : [link];
        return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
      });
      return `<section class="database"${idAttr(b)}><h3>🗃 ${heading}</h3><table><thead>${head}</thead><tbody>${rows.join('')}</tbody></table>${note}</section>`;
    }
    case 'synced_block':
      return `<div class="synced"${idAttr(b)}>${kids()}</div>`;
    case 'column_list':
      return `<div class="columns"${idAttr(b)}>${kids()}</div>`;
    case 'column':
      return `<div class="column">${kids()}</div>`;
    case 'table_of_contents': {
      const items = collectHeadings(ctx.page.blocks).map(
        (h) => `<li style="margin-left:${(h.level - 1) * 1.2}em"><a href="#${blockAnchor(h.id)}">${renderRichText(h.text.text, ctx)}</a></li>`,
      );
      return items.length ? `<nav class="toc"><ul>${items.join('')}</ul></nav>` : '';
    }
    case 'unsupported':
      return `<div class="unsupported" title="Unsupported block: ${escapeHtml(b.sourceType)}"${idAttr(b)}>${renderRichText(b.text, ctx)}${kids()}</div>`;
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'to_do':
      return renderListItem(b, ctx);
  }
}

export function renderBlocks(blocks: Block[], ctx: RenderContext): string {
  return groupBlocks(blocks)
    .map((g) => {
      if (g.kind === 'single') return renderBlock(g.block, ctx);
      const items = g.items.map((b) => renderListItem(b, ctx)).join('');
      if (g.listType === 'numbered_list_item') return `<ol>${items}</ol>`;
      return `<ul${g.listType === 'to_do' ? ' class="todo"' : ''}>${items}</ul>`;
    })
    .join('\n');
}

function shell(title: string, cssHref: string | undefined, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
${cssHref ? `<link rel="stylesheet" href="${escapeHtml(cssHref)}">` : ''}
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

export function renderHtmlPage(page: ExportPage, site: Site, currentPath: string): string {
  const ctx: RenderContext = { site, page, currentPath };
  const css = site.stylesheetPath ? relativeTo(ctx, site.stylesheetPath) : undefined;
  const status = page.status === 'partial' ? '<span class="status partial">partial</span>' : '';
  const source = safeLinkHref(page.url);
  const meta = [
    `<dt>Source</dt><dd>${source ? `<a href="${escapeHtml(source)}" class="external" rel="noopener noreferrer nofollow">${escapeHtml(source)}</a>` : escapeHtml(page.url)}</dd>`,
    page.pageId ? `<dt>Page ID</dt><dd><code>${escapeHtml(page.pageId)}</code></dd>` : '',
    `<dt>Extracted</dt><dd>${escapeHtml(page.extractedAt)}</dd>`,
  ].join('');
  const warnings = page.warnings.length
    ? `<details class="warnings"><summary>${page.warnings.length} extraction warning(s)</summary><ul>${page.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></details>`
    : '';
  const props = page.properties.length
    ? `<table class="properties"><tbody>${page.properties.map((p) => `<tr><th>${escapeHtml(p.name)}</th><td>${escapeHtml(p.value)}</td></tr>`).join('')}</tbody></table>`
    : '';
  const backlinks = site.backlinks(page.key);
  const backlinkHtml = backlinks.length
    ? `<section class="backlinks"><strong>Linked from</strong><ul>${backlinks.map((b) => `<li><a href="${escapeHtml(relativeTo(ctx, b.path))}">${escapeHtml(b.title)}</a> <span class="missing">(${escapeHtml(b.kind.replace(/_/g, ' '))})</span></li>`).join('')}</ul></section>`
    : '';
  const body = `<nav class="crumbs"><a href="${escapeHtml(relativeTo(ctx, site.indexPath))}">← Index</a> · <a href="${escapeHtml(relativeTo(ctx, site.reportPath))}">Export report</a></nav>
<h1>${page.icon ? `${escapeHtml(page.icon)} ` : ''}${escapeHtml(page.title)}${status}</h1>
<dl class="meta">${meta}</dl>
${warnings}${props}
<article>
${renderBlocks(page.blocks, ctx)}
</article>
${backlinkHtml}`;
  return shell(page.title, css, body);
}

function treeHtml(site: Site, key: string, fromPath: string, seen: Set<string>): string {
  const e = site.entries.get(key);
  if (!e || seen.has(key)) return '';
  seen.add(key);
  const kids = e.children.map((k) => treeHtml(site, k, fromPath, seen)).filter(Boolean).join('');
  const ctx = { site, currentPath: fromPath } as RenderContext;
  const status = e.status === 'partial' ? ' <span class="status partial">partial</span>' : '';
  return `<li>${e.icon ? `${escapeHtml(e.icon)} ` : ''}<a href="${escapeHtml(relativeTo(ctx, e.path))}">${escapeHtml(e.title)}</a>${status}${kids ? `<ul>${kids}</ul>` : ''}</li>`;
}

export function renderHtmlIndex(site: Site, info: { title: string; exportedAt: string; summary: string }, indexPath: string): string {
  const seen = new Set<string>();
  const tree = site.rootKey ? treeHtml(site, site.rootKey, indexPath, seen) : '';
  const notion = [...site.entries.values()].filter((e) => e.source === 'notion' && !seen.has(e.key)).sort((a, b) => a.title.localeCompare(b.title));
  const ext = [...site.entries.values()].filter((e) => e.source === 'external').sort((a, b) => a.title.localeCompare(b.title));
  const ctx = { site, currentPath: indexPath } as RenderContext;
  const list = (items: SiteEntry[]) =>
    `<ul>${items.map((e) => `<li><a href="${escapeHtml(relativeTo(ctx, e.path))}">${escapeHtml(e.title)}</a>${e.status === 'partial' ? ' <span class="status partial">partial</span>' : ''}</li>`).join('')}</ul>`;
  const body = `<h1>${escapeHtml(info.title)}</h1>
<p class="meta">Exported ${escapeHtml(info.exportedAt)} · ${escapeHtml(info.summary)} · <a href="${escapeHtml(relativeTo(ctx, site.reportPath))}">Export report</a></p>
<section class="tree"><h2>Page tree</h2><ul>${tree}</ul></section>
${notion.length ? `<section><h2>Other linked pages</h2>${list(notion)}</section>` : ''}
${ext.length ? `<section><h2>External pages</h2>${list(ext)}</section>` : ''}`;
  const css = site.stylesheetPath ? relativeTo(ctx, site.stylesheetPath) : undefined;
  return shell(info.title, css, body);
}
