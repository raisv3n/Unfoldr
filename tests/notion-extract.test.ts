import { describe, expect, it } from 'vitest';
import { collapsedToggleButtons, detectAccessState, extractPage } from '../src/content/notion-dom';
import { normalizeNotionPage } from '../src/normalize/notion';
import type { Block, ExportPage } from '../src/shared/model';
import { domFrom, loadFixture } from './helpers';

const URL0 = 'https://www.notion.so/Fixture-Root-Page-aaaaaaaa000040008000000000000001';

function load(): { page: ExportPage; doc: Document } {
  const doc = loadFixture('notion-page.html', URL0);
  const raw = extractPage(doc, { url: URL0, togglesOpened: 3, maxBlockCountSeen: 0 });
  return { page: normalizeNotionPage(raw, '2026-01-01T00:00:00.000Z'), doc };
}

function flat(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...flat(b.children ?? [])]);
}

describe('Notion DOM extraction + normalization', () => {
  const { page, doc } = load();
  const all = flat(page.blocks);
  const byType = (t: Block['type']) => all.filter((b) => b.type === t);

  it('identifies the page from the title block (ignoring side peek)', () => {
    expect(detectAccessState(doc)).toBe('ready');
    expect(page.pageId).toBe('aaaaaaaa000040008000000000000001');
    expect(page.key).toBe(page.pageId);
    expect(page.title).toBe('Fixture Root Page');
    expect(page.icon).toBe('📘');
    expect(page.url).toBe(URL0);
  });

  it('extracts rich text annotations, links, mentions and equations', () => {
    const p = page.blocks[0];
    expect(p?.type).toBe('paragraph');
    if (p?.type !== 'paragraph') return;
    const bold = p.text.find((r) => r.type === 'text' && r.text === 'bold');
    expect(bold?.annotations.bold).toBe(true);
    expect(p.text.find((r) => r.type === 'text' && r.text === 'italic')?.annotations.italic).toBe(true);
    expect(p.text.find((r) => r.type === 'text' && r.text === 'code')?.annotations.code).toBe(true);
    expect(p.text.find((r) => r.type === 'text' && r.text === 'struck')?.annotations.strikethrough).toBe(true);
    const pageLink = p.text.find((r) => r.type === 'text' && r.text === 'page link');
    expect(pageLink?.type === 'text' && pageLink.link).toMatchObject({ kind: 'page', pageId: 'cccccccc000040008000000000000002' });
    const ext = p.text.find((r) => r.type === 'text' && r.text === 'external link');
    expect(ext?.type === 'text' && ext.link?.kind).toBe('external');
    const bad = p.text.find((r) => r.type === 'text' && r.text === 'bad link');
    expect(bad?.type === 'text' && bad.link).toBeUndefined();
    const mention = p.text.find((r) => r.type === 'mention');
    expect(mention).toMatchObject({ mention: 'page', pageId: 'dddddddd000040008000000000000003', text: 'Mentioned Page' });
    expect(p.text.find((r) => r.type === 'equation')).toMatchObject({ expression: 'E=mc^2' });
    const vanity = p.text.find((r) => r.type === 'text' && r.text === 'vanity link');
    expect(vanity?.type === 'text' && vanity.link?.kind).toBe('unresolved');
  });

  it('captures expanded toggle content including nested toggles', () => {
    const toggles = byType('toggle');
    expect(toggles.length).toBe(3);
    const t = toggles[0]!;
    expect(t.children?.map((c) => c.type)).toEqual(['paragraph', 'toggle']);
    const nested = t.children?.[1];
    expect(nested?.children?.[0]?.type).toBe('bulleted_list_item');
    const heading = byType('heading').find((h) => h.type === 'heading' && h.toggleable);
    expect(heading?.children?.length).toBe(1);
  });

  it('marks the page partial when a toggle stayed collapsed', () => {
    expect(collapsedToggleButtons(doc).length).toBe(1);
    expect(page.status).toBe('partial');
    expect(page.warnings.join('\n')).toMatch(/Still collapsed/);
  });

  it('maps common block types', () => {
    const types = new Set(all.map((b) => b.type));
    for (const t of ['heading', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'callout', 'code', 'divider', 'equation', 'table', 'image', 'file', 'bookmark', 'child_page', 'link_to_page', 'child_database', 'synced_block', 'column_list', 'column', 'embed', 'unsupported'] as const) {
      expect(types.has(t), t).toBe(true);
    }
    const todo = byType('to_do')[0];
    expect(todo?.type === 'to_do' && todo.checked).toBe(true);
    const code = byType('code')[0];
    expect(code?.type === 'code' && code.language).toBe('typescript');
    expect(code?.type === 'code' && code.code).toContain('console.log("```");');
    const callout = byType('callout')[0];
    expect(callout?.type === 'callout' && callout.icon).toBe('💡');
    const table = byType('table')[0];
    expect(table?.type === 'table' && table.hasHeaderRow).toBe(true);
    expect(table?.type === 'table' && table.rows.length).toBe(2);
    const embed = byType('embed')[0];
    expect(embed?.type === 'embed' && embed.url).toContain('youtube.com');
  });

  it('collects relationships of every kind', () => {
    const kinds = (k: string) => page.references.filter((r) => r.kind === k);
    expect(kinds('child_page').map((r) => r.pageId)).toEqual(['cccccccc000040008000000000000004']);
    expect(kinds('link_to_page').map((r) => r.pageId)).toEqual(['cccccccc000040008000000000000002']);
    expect(kinds('mention').map((r) => r.pageId)).toEqual(['dddddddd000040008000000000000003']);
    expect(kinds('database_entry').map((r) => r.pageId)).toEqual(['ffffffff000040008000000000000001', 'ffffffff000040008000000000000002']);
    expect(kinds('synced_block').length).toBe(1);
    expect(kinds('external').some((r) => r.url.startsWith('https://example.com/docs'))).toBe(true);
    // Self-links are not references.
    expect(page.references.some((r) => r.pageId === page.pageId)).toBe(false);
    // Vanity link kept as unresolved reference for the crawler to resolve.
    expect(kinds('link').some((r) => !r.pageId && r.url.endsWith('/team-handbook'))).toBe(true);
  });

  it('extracts database rows with properties', () => {
    const db = byType('child_database')[0];
    expect(db?.type).toBe('child_database');
    if (db?.type !== 'child_database') return;
    expect(db.columns).toEqual(['Name', 'Status']);
    expect(db.entries.map((e) => e.title)).toEqual(['Task A', 'Task B']);
    expect(db.entries[0]?.properties).toEqual([{ name: 'Name', value: 'Task A' }, { name: 'Status', value: 'Done' }]);
  });

  it('deduplicates assets that differ only by volatile params', () => {
    const images = page.assets.filter((a) => a.kind === 'image');
    expect(images.length).toBe(1);
    expect(images[0]?.originalUrl).toBe('https://s3-us-west-2.amazonaws.com/secure.notion-static.com/abc/diagram.png');
    expect(page.assets.some((a) => a.kind === 'file' && a.name === 'report.pdf')).toBe(true);
  });

  it('keeps raw script-looking text as text', () => {
    expect(JSON.stringify(page.blocks[0])).toContain('<script>alert(\\"x\\")</script>');
  });
});

describe('access-state detection', () => {
  it('detects challenge, no access and not found pages', () => {
    expect(detectAccessState(domFrom('<title>Just a moment...</title><body></body>'))).toBe('challenge');
    expect(detectAccessState(domFrom('<body><div>No access to this page</div></body>'))).toBe('no_access');
    expect(detectAccessState(domFrom('<body><p>This content does not exist</p></body>'))).toBe('not_found');
    expect(detectAccessState(domFrom('<body><input type="email"></body>', 'https://www.notion.so/login'))).toBe('login_required');
    expect(detectAccessState(domFrom('<body><div id="notion-app"></div></body>'))).toBe('loading');
    expect(detectAccessState(domFrom('<body><div>Too many requests. Please try again later.</div></body>'))).toBe('challenge');
  });
});

describe('full-page database', () => {
  it('extracts rows when the page is a collection view', () => {
    const doc = domFrom(`<main class="notion-frame">
      <div data-block-id="12345678-1234-4123-8123-123456789012" class="notion-collection_view_page-block"><h1>Projects</h1></div>
      <div class="notion-board-view">
        <a href="/Alpha-aaaabbbbccccddddeeeeffff00001111?pvs=4" class="notion-collection-item"><div>Alpha</div></a>
        <a href="/Beta-aaaabbbbccccddddeeeeffff00002222" class="notion-collection-item"><div>Beta</div></a>
        <div role="button">Load more</div>
      </div></main>`, 'https://www.notion.so/12345678123441238123123456789012');
    const page = normalizeNotionPage(extractPage(doc, { url: doc.location.href, togglesOpened: 0, maxBlockCountSeen: 0 }));
    expect(page.pageId).toBe('12345678123441238123123456789012');
    const entries = page.references.filter((r) => r.kind === 'database_entry');
    expect(entries.map((e) => e.pageId)).toEqual(['aaaabbbbccccddddeeeeffff00001111', 'aaaabbbbccccddddeeeeffff00002222']);
    expect(page.status).toBe('partial');
  });
});

describe('lazy images and unknown wrappers', () => {
  it('uses srcset/data-src over data: placeholders and reports unloaded images', () => {
    const doc = domFrom(`<main class="notion-frame"><div data-block-id="12345678-1234-4123-8123-123456789012" class="notion-page-block"><h1>P</h1></div>
      <div class="notion-page-content">
        <div data-block-id="b1000000-0000-4000-8000-000000000001" class="notion-image-block"><img src="data:image/gif;base64,R0lGOD" data-src="/image/https%3A%2F%2Fx.test%2Freal.png?id=1"></div>
        <div data-block-id="b1000000-0000-4000-8000-000000000002" class="notion-image-block"><img src="data:image/gif;base64,R0lGOD"></div>
        <div data-block-id="b1000000-0000-4000-8000-000000000003" class="notion-selectable some-wrapper"></div>
      </div></main>`, 'https://www.notion.so/12345678123441238123123456789012');
    const page = normalizeNotionPage(extractPage(doc, { url: doc.location.href, togglesOpened: 0, maxBlockCountSeen: 0 }));
    expect(page.assets.map((a) => a.originalUrl)).toEqual(['https://x.test/real.png']);
    expect(page.blocks.length).toBe(2);
    expect(page.status).toBe('partial');
    expect(page.warnings.join(' ')).toMatch(/had not loaded/);
    expect(page.warnings.join(' ')).not.toMatch(/unsupported URL scheme|Unsupported block/);
  });
});
