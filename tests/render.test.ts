import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import type { Site, SiteEntry } from '../src/render/context';
import { escapeHtml, renderHtmlPage } from '../src/render/html';
import { escapeMd, renderMarkdownPage } from '../src/render/markdown';
import type { Block, ExportPage, RichText } from '../src/shared/model';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);
const t = (text: string, extra: Partial<Extract<RichText, { type: 'text' }>> = {}): RichText => ({ type: 'text', text, annotations: {}, ...extra });

function mkPage(key: string, title: string, blocks: Block[]): ExportPage {
  return { key, source: 'notion', pageId: key, title, url: `https://www.notion.so/${key}`, blocks, properties: [], references: [], assets: [], warnings: [], status: 'complete', extractedAt: '2026-01-01T00:00:00Z' };
}

function mkSite(pages: ExportPage[], ext: 'html' | 'md', assets: Record<string, string> = {}): Site {
  const entries = new Map<string, SiteEntry>(
    pages.map((p) => [p.key, { key: p.key, title: p.title, path: `pages/${p.title.toLowerCase().replace(/\W+/g, '-')}--${p.key}.${ext}`, url: p.url, source: 'notion', status: 'complete', children: [] }]),
  );
  return {
    rootKey: pages[0]?.key,
    entries,
    resolve: ({ pageId }) => (pageId && entries.has(pageId) ? pageId : undefined),
    assetPath: (id) => assets[id],
    backlinks: () => [],
    reportPath: `export-report.${ext}`,
    indexPath: `index.${ext}`,
    stylesheetPath: ext === 'html' ? 'style.css' : undefined,
  };
}

const blocks: Block[] = [
  { id: 'p1', type: 'paragraph', text: [t('<script>alert("x")</script> & '), t('bold', { annotations: { bold: true } }), t(' '), t('to B', { link: { kind: 'page', pageId: B, url: `https://www.notion.so/${B}` } }), t(' '), t('to C', { link: { kind: 'page', pageId: C, url: `https://www.notion.so/${C}` } }), t(' '), t('evil', { link: { kind: 'external', url: 'javascript:alert(1)' } })] },
  { id: 'h1', type: 'heading', level: 1, text: [t('Heading')], toggleable: false },
  { id: 't1', type: 'toggle', text: [t('Question?')], children: [{ id: 't1a', type: 'paragraph', text: [t('Hidden answer')] }, { id: 't1b', type: 'toggle', text: [t('Nested?')], children: [{ id: 't1c', type: 'paragraph', text: [t('Deep answer')] }] }] },
  { id: 'l1', type: 'bulleted_list_item', text: [t('One')], children: [{ id: 'l1a', type: 'bulleted_list_item', text: [t('Child')] }] },
  { id: 'l2', type: 'bulleted_list_item', text: [t('Two')] },
  { id: 'n1', type: 'numbered_list_item', text: [t('First')] },
  { id: 'n2', type: 'numbered_list_item', text: [t('Second')] },
  { id: 'td', type: 'to_do', text: [t('Task')], checked: true },
  { id: 'c1', type: 'code', code: 'a < b && "```"', language: 'typescript' },
  { id: 'tb', type: 'table', hasHeaderRow: true, rows: [[[t('H|1')], [t('H2')]], [[t('a\nb')], [t('c')]]] },
  { id: 'img', type: 'image', url: 'https://x.test/a.png', alt: 'Alt "text"', asset: { assetId: 'asset1', fetchUrl: '', originalUrl: 'https://x.test/a.png', kind: 'image' } },
  { id: 'img2', type: 'image', url: 'https://x.test/missing.png', alt: 'Missing' },
  { id: 'cp', type: 'child_page', pageId: B, url: `https://www.notion.so/${B}`, title: 'Page B' },
  { id: 'q', type: 'quote', text: [t('Quoted')] },
  { id: 'eq', type: 'equation', expression: 'x^2' },
];

describe('HTML renderer', () => {
  const pageA = mkPage(A, 'Page A', blocks);
  const pageB = mkPage(B, 'Page B', []);
  const site = mkSite([pageA, pageB], 'html', { asset1: 'assets/a--asset1.png' });
  const path = site.entries.get(A)!.path;
  const html = renderHtmlPage(pageA, site, path);
  const doc = new JSDOM(html).window.document;

  it('escapes source text and never emits scripts', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp;');
    expect(doc.querySelectorAll('script').length).toBe(0);
    expect(html).not.toContain('javascript:');
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("script-src 'none'");
  });

  it('rewrites internal links to relative local files and keeps unresolved originals', () => {
    const links = [...doc.querySelectorAll('article a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toContainEqual(['to B', `page-b--${B}.html`]);
    expect(links).toContainEqual(['to C', `https://www.notion.so/${C}`]);
    expect(links).toContainEqual(['Page B', `page-b--${B}.html`]);
  });

  it('renders toggles as details/summary with all hidden content present', () => {
    const details = doc.querySelectorAll('details:not(.warnings)');
    expect(details.length).toBe(2);
    expect(details[0]?.querySelector('summary')?.textContent).toBe('Question?');
    expect(details[0]?.textContent).toContain('Hidden answer');
    expect(details[0]?.textContent).toContain('Deep answer');
    expect(details[0]?.hasAttribute('open')).toBe(false);
  });

  it('renders lists, tables, code and images with relative asset paths', () => {
    expect(doc.querySelectorAll('article ul > li').length).toBe(4);
    expect(doc.querySelectorAll('article ol > li').length).toBe(2);
    expect(doc.querySelector('ul.todo input[checked]')).not.toBeNull();
    expect(doc.querySelector('thead th')?.textContent).toBe('H|1');
    expect(doc.querySelector('pre code.language-typescript')?.textContent).toBe('a < b && "```"');
    expect(doc.querySelector('figure img')?.getAttribute('src')).toBe('../assets/a--asset1.png');
    expect(doc.querySelector('figure img')?.getAttribute('alt')).toBe('Alt "text"');
    expect(html).toContain('Image not included: Missing');
    expect(doc.querySelector('link[rel=stylesheet]')?.getAttribute('href')).toBe('../style.css');
  });

  it('keeps the original Notion URL and page ID', () => {
    expect(html).toContain(`https://www.notion.so/${A}`);
    expect(doc.querySelector('.meta code')?.textContent).toBe(A);
  });

  it('escapes helpers', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('Markdown renderer', () => {
  const pageA = mkPage(A, 'Page A', blocks);
  const pageB = mkPage(B, 'Page B', []);
  const site = mkSite([pageA, pageB], 'md', { asset1: 'assets/a--asset1.png' });
  const path = site.entries.get(A)!.path;
  const interactive = renderMarkdownPage(pageA, site, path, { toggleMode: 'interactive' });
  const portable = renderMarkdownPage(pageA, site, path, { toggleMode: 'portable' });

  it('writes front matter with source URL and ID', () => {
    expect(interactive.startsWith('---\ntitle: "Page A"\n')).toBe(true);
    expect(interactive).toContain(`notion_id: "${A}"`);
    expect(interactive).toContain(`source_url: "https://www.notion.so/${A}"`);
  });

  it('uses relative links between exported pages and keeps unresolved originals', () => {
    expect(interactive).toContain(`[to B](page-b--${B}.md)`);
    expect(interactive).toContain(`[to C](https://www.notion.so/${C})`);
    expect(interactive).not.toContain('javascript:');
    expect(interactive).toContain('![Alt "text"](../assets/a--asset1.png)');
  });

  it('escapes Markdown control characters', () => {
    expect(interactive).toContain('\\<script\\>alert("x")\\</script\\>');
    expect(escapeMd('# not heading')).toBe('\\# not heading');
    expect(escapeMd('1. not list')).toBe('1\\. not list');
    expect(escapeMd('a*b_c[d]')).toBe('a\\*b\\_c\\[d\\]');
  });

  it('interactive mode uses details/summary with hidden content', () => {
    expect(interactive).toContain('<details>\n<summary>Question?</summary>\n\nHidden answer');
    expect(interactive).toContain('Deep answer');
  });

  it('portable mode converts toggles to headings and content', () => {
    expect(portable).not.toContain('<details>');
    expect(portable).toMatch(/^### Question\?$/m);
    expect(portable).toMatch(/^#### Nested\?$/m);
    expect(portable).toContain('Hidden answer');
    expect(portable).toContain('Deep answer');
  });

  it('renders lists, tables and code fences safely', () => {
    expect(interactive).toContain('- One\n\n  - Child\n- Two');
    expect(interactive).toContain('1. First\n2. Second');
    expect(interactive).toContain('- [x] Task');
    expect(interactive).toContain('| H\\|1 | H2 |\n| --- | --- |\n| a<br>b | c |');
    expect(interactive).toContain('````typescript\na < b && "```"\n````');
    expect(interactive).toContain('$$\nx^2\n$$');
    expect(interactive).toContain('> Quoted');
  });
});
