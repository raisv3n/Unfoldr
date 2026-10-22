import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildArchive, redactUrl, type ArchiveInput } from '../src/archive/archive';
import { createZip } from '../src/archive/zip';
import type { AssetRecord } from '../src/assets/asset-manager';
import type { CrawlEdge, CrawlNode } from '../src/crawler/crawler';
import type { ExportPage, RichText } from '../src/shared/model';
import { DEFAULT_SETTINGS, type ExportSettings } from '../src/shared/settings';

const ROOT = '1'.repeat(32);
const CHILD = '2'.repeat(32);
const TWIN = '3'.repeat(32);
const FAILED = '4'.repeat(32);
const t = (text: string, pageId?: string): RichText =>
  pageId ? { type: 'text', text, annotations: {}, link: { kind: 'page', pageId, url: `https://www.notion.so/${pageId}` } } : { type: 'text', text, annotations: {} };

function page(key: string, title: string, extra: Partial<ExportPage> = {}): ExportPage {
  return { key, source: 'notion', pageId: key, title, url: `https://www.notion.so/${key}`, blocks: [], properties: [], references: [], assets: [], warnings: [], status: 'complete', extractedAt: '2026-01-01T00:00:00Z', ...extra };
}

function node(key: string, extra: Partial<CrawlNode> = {}): CrawlNode {
  return { key, url: `https://www.notion.so/${key}`, kind: 'notion', pageId: key, depth: 1, status: 'completed', attempts: 1, seq: 0, ...extra };
}

function input(settings: Partial<ExportSettings> = {}): ArchiveInput {
  const asset: AssetRecord = { assetId: 'abcdabcdabcdabcd', kind: 'image', originalUrl: 'https://s3.example.com/pic.png?X-Amz-Signature=secret', fetchUrl: 'x', status: 'downloaded', path: 'assets/pic--abcdabcdabcdabcd.png', mime: 'image/png', size: 3, attempts: 1, pages: [ROOT] };
  const pages = [
    page(ROOT, 'Root', {
      blocks: [
        { id: 'b1', type: 'paragraph', text: [t('see '), t('twin', TWIN), t(' and '), t('broken', FAILED)] },
        { id: 'b2', type: 'child_page', pageId: CHILD, url: `https://www.notion.so/${CHILD}`, title: 'Notes' },
        { id: 'b3', type: 'image', url: asset.originalUrl, asset: { assetId: asset.assetId, fetchUrl: 'x', originalUrl: asset.originalUrl, kind: 'image' } },
        { id: 'b4', type: 'toggle', text: [t('Q')], children: [{ id: 'b5', type: 'paragraph', text: [t('Hidden A')] }] },
      ],
    }),
    page(CHILD, 'Notes'),
    page(TWIN, 'Notes', { status: 'partial', warnings: ['1 collapsed toggle(s) could not be opened'] }),
  ];
  const edges: CrawlEdge[] = [
    { from: ROOT, to: CHILD, kind: 'child_page', url: `https://www.notion.so/${CHILD}` },
    { from: ROOT, to: TWIN, kind: 'link', url: `https://www.notion.so/${TWIN}` },
    { from: ROOT, to: FAILED, kind: 'link', url: `https://www.notion.so/${FAILED}` },
    { from: CHILD, to: ROOT, kind: 'mention', url: `https://www.notion.so/${ROOT}` },
    { from: ROOT, to: 'ext:abc', kind: 'external', url: 'https://example.com/faq' },
  ];
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    rootUrl: `https://www.notion.so/${ROOT}`,
    rootKey: ROOT,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:05:00.000Z',
    pages,
    nodes: [node(ROOT, { depth: 0 }), node(CHILD), node(TWIN, { status: 'partial' }), node(FAILED, { status: 'failed', error: 'No access to this page', errorCode: 'inaccessible' })],
    edges,
    resolveKey: (k) => k,
    limitsHit: [],
    assets: [asset],
    cancelled: false,
    getAssetBlob: async () => new Blob(['PNG'], { type: 'image/png' }),
  };
}

describe('archive builder', () => {
  it('produces the expected HTML archive layout', async () => {
    const out = await buildArchive(input());
    const paths = [...out.files.keys()].sort();
    expect(paths).toEqual([
      'notion-export/assets/pic--abcdabcdabcdabcd.png',
      'notion-export/export-report.html',
      'notion-export/export-report.md',
      'notion-export/index.html',
      'notion-export/manifest.json',
      `notion-export/pages/notes--${CHILD}.html`,
      `notion-export/pages/notes--${TWIN}.html`,
      `notion-export/pages/root--${ROOT}.html`,
      'notion-export/style.css',
    ]);
    expect(out.zipBaseName).toBe('notion-export-root-20260101-0005');
  });

  it('links pages with identical titles to distinct local files and includes toggle content', async () => {
    const out = await buildArchive(input());
    const root = out.files.get(`notion-export/pages/root--${ROOT}.html`) as string;
    expect(root).toContain(`href="notes--${TWIN}.html"`);
    expect(root).toContain(`href="notes--${CHILD}.html"`);
    expect(root).toContain(`href="https://www.notion.so/${FAILED}"`);
    expect(root).toContain('src="../assets/pic--abcdabcdabcdabcd.png"');
    expect(root).toContain('Hidden A');
    const child = out.files.get(`notion-export/pages/notes--${CHILD}.html`) as string;
    expect(child).toContain('Linked from');
    const index = out.files.get('notion-export/index.html') as string;
    expect(index).toContain(`pages/root--${ROOT}.html`);
    expect(index).toContain(`pages/notes--${CHILD}.html`);
  });

  it('writes a manifest with relationships, assets, missing pages and redacted URLs', async () => {
    const out = await buildArchive(input());
    const m = JSON.parse(out.files.get('notion-export/manifest.json') as string);
    expect(m.root).toMatchObject({ pageId: ROOT, title: 'Root' });
    expect(m.outcome).toBe('partial');
    expect(m.pages.map((p: { pageId: string }) => p.pageId).sort()).toEqual([ROOT, CHILD, TWIN].sort());
    expect(m.pages.find((p: { pageId: string }) => p.pageId === ROOT).paths).toEqual({ html: `pages/root--${ROOT}.html` });
    expect(m.parentChild).toEqual([{ parent: ROOT, child: CHILD, kind: 'child_page' }]);
    expect(m.relationships.length).toBe(5);
    expect(m.missing).toEqual([expect.objectContaining({ key: FAILED, status: 'failed' })]);
    expect(m.unresolvedReferences.map((r: { to: string }) => r.to)).toEqual([FAILED, 'ext:abc']);
    expect(m.assets[0].originalUrl).toBe('https://s3.example.com/pic.png');
    expect(JSON.stringify(m)).not.toContain('secret');
    expect(m.summary.pages).toEqual({ completed: 2, partial: 1, failed: 1, skipped: 0 });
  });

  it('generates an export report naming failures, partial pages and unresolved links', async () => {
    const out = await buildArchive(input());
    const r = out.reportMarkdown;
    expect(out.outcome).toBe('partial');
    expect(r).toContain('⚠️ Partial');
    expect(r).toMatch(/## Failed pages \(1\)/);
    expect(r).toContain('inaccessible: No access to this page');
    expect(r).toMatch(/## Partially extracted pages \(1\)/);
    expect(r).toMatch(/## Unresolved links \(not exported\) \(2\)/);
    expect(r).toContain('external capture disabled');
  });

  it('reports success only when nothing is missing', async () => {
    const base = input();
    const clean: ArchiveInput = { ...base, pages: [page(ROOT, 'Root')], nodes: [node(ROOT, { depth: 0 })], edges: [], assets: [] };
    expect((await buildArchive(clean)).outcome).toBe('success');
    expect((await buildArchive({ ...clean, limitsHit: ['maxPages'], nodes: [...clean.nodes, node(CHILD, { status: 'skipped', skipReason: 'page-limit' })] })).outcome).toBe('partial');
    expect((await buildArchive({ ...clean, cancelled: true })).outcome).toBe('cancelled');
    expect((await buildArchive({ ...clean, pages: [] })).outcome).toBe('failed');
  });

  it('emits only Markdown files for the markdown format, and both when requested', async () => {
    const md = await buildArchive(input({ format: 'markdown' }));
    const mdPaths = [...md.files.keys()];
    expect(mdPaths.some((p) => p.endsWith('.html'))).toBe(false);
    expect(mdPaths).toContain('notion-export/index.md');
    const root = md.files.get(`notion-export/pages/root--${ROOT}.md`) as string;
    expect(root).toContain(`[twin](notes--${TWIN}.md)`);
    expect(root).toContain('![](../assets/pic--abcdabcdabcdabcd.png)');

    const both = await buildArchive(input({ format: 'both' }));
    const bothPaths = [...both.files.keys()];
    expect(bothPaths).toContain(`notion-export/pages/root--${ROOT}.md`);
    expect(bothPaths).toContain(`notion-export/pages/root--${ROOT}.html`);
  });

  it('redacts signed URL parameters', () => {
    expect(redactUrl('https://file.notion.so/f/a.pdf?expirationTimestamp=1&signature=x&id=2')).toBe('https://file.notion.so/f/a.pdf?id=2');
  });
});

describe('ZIP generation', () => {
  it('round-trips archive files under the root folder', async () => {
    const out = await buildArchive(input());
    const blob = await createZip(out.files);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir).sort();
    expect(names).toEqual([...out.files.keys()].sort());
    expect(names.every((n) => n.startsWith('notion-export/'))).toBe(true);
    expect(await zip.file('notion-export/assets/pic--abcdabcdabcdabcd.png')!.async('string')).toBe('PNG');
  });

  it('refuses traversal paths', async () => {
    await expect(createZip(new Map([['notion-export/../evil.txt', 'x']]))).rejects.toThrow(/Unsafe archive path/);
  });
});
