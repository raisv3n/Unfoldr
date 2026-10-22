// Optional check against a locally saved DOM snapshot of a real Notion page.
// Run with: NOTION_SNAPSHOT=/path/to/page.html NOTION_SNAPSHOT_URL=https://... npx vitest run tests/live-snapshot.test.ts
// Snapshots are never committed (they may contain private content).
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractPage } from '../src/content/notion-dom';
import { normalizeNotionPage } from '../src/normalize/notion';

const file = process.env.NOTION_SNAPSHOT;
const url = process.env.NOTION_SNAPSHOT_URL ?? 'https://www.notion.so/';

describe.skipIf(!file)('live DOM snapshot', () => {
  it('extracts a page', () => {
    const doc = new JSDOM(readFileSync(file!, 'utf8'), { url }).window.document;
    const raw = extractPage(doc, { url, togglesOpened: 0, maxBlockCountSeen: 0 });
    const page = normalizeNotionPage(raw);
    const counts: Record<string, number> = {};
    const walk = (bs: typeof page.blocks) => bs.forEach((b) => { counts[b.type] = (counts[b.type] ?? 0) + 1; walk(b.children ?? []); });
    walk(page.blocks);
    console.log(JSON.stringify({ id: page.pageId, title: page.title, status: page.status, counts, refs: page.references.slice(0, 8), warnings: page.warnings.slice(0, 5), firstBlock: page.blocks[1] }, null, 1));
    expect(page.blocks.length).toBeGreaterThan(0);
  });
});
