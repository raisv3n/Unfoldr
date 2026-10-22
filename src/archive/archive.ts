// Builds the archive file map (paths → content) from crawl results. Pure apart from reading
// asset blobs through the provided getter, so it is fully unit-testable.

import type { AssetRecord } from '../assets/asset-manager';
import { externalKey, notionKeyFor, type CrawlEdge, type CrawlNode } from '../crawler/crawler';
import type { Site, SiteEntry } from '../render/context';
import { renderHtmlIndex, renderHtmlPage, escapeHtml, CSP } from '../render/html';
import { renderMarkdownIndex, renderMarkdownPage } from '../render/markdown';
import { ARCHIVE_CSS } from '../render/styles';
import type { JobOutcome } from '../shared/messages';
import type { ExportPage, ReferenceKind } from '../shared/model';
import { ARCHIVE_ROOT, assertSafeArchivePath, externalPagePath, notionPagePath, slugify, type OutputExt } from '../shared/paths';
import type { ExportSettings } from '../shared/settings';
import { reportToHtmlBody, reportToMarkdown, type ExportReport, type ReportItem } from './report';

export interface ArchiveInput {
  settings: ExportSettings;
  rootUrl: string;
  rootKey?: string;
  startedAt: string;
  finishedAt: string;
  pages: ExportPage[];
  nodes: CrawlNode[];
  edges: CrawlEdge[];
  resolveKey: (key: string) => string;
  limitsHit: string[];
  assets: AssetRecord[];
  cancelled: boolean;
  generator?: string;
  getAssetBlob: (assetId: string) => Promise<Blob | undefined>;
}

export interface ArchiveOutput {
  files: Map<string, string | Blob>;
  manifest: Record<string, unknown>;
  report: ExportReport;
  reportMarkdown: string;
  outcome: JobOutcome;
  zipBaseName: string;
}

const STRUCTURAL: ReferenceKind[] = ['child_page', 'child_database', 'database_entry'];
const SECRET_PARAMS = /^(signature|expirationtimestamp|x-amz-.+|tok|token|access_token|auth|key|sig|se|sp|sv|sr)$/i;

/** Removes signed-URL credentials from URLs written to the manifest/report. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    let changed = false;
    for (const k of [...u.searchParams.keys()]) {
      if (SECRET_PARAMS.test(k)) {
        u.searchParams.delete(k);
        changed = true;
      }
    }
    return changed ? u.toString() : url;
  } catch {
    return url;
  }
}

function formatsOf(settings: ExportSettings): OutputExt[] {
  return settings.format === 'both' ? ['html', 'md'] : settings.format === 'markdown' ? ['md'] : ['html'];
}

function pagePathFor(page: ExportPage, ext: OutputExt): string {
  if (page.source === 'external') return externalPagePath(page.title, page.key, ext);
  const id = page.pageId ?? page.key.replace(/^nurl:/, 'u');
  return notionPagePath(page.title, id, ext);
}

function buildSite(input: ArchiveInput, ext: OutputExt): Site {
  const byKey = new Map(input.pages.map((p) => [p.key, p]));
  const entries = new Map<string, SiteEntry>();
  for (const p of input.pages) {
    entries.set(p.key, { key: p.key, title: p.title, icon: p.icon, path: pagePathFor(p, ext), url: p.url, source: p.source, status: p.status, children: [] });
  }
  const edges = input.edges.map((e) => ({ ...e, from: input.resolveKey(e.from), to: input.resolveKey(e.to) }));
  for (const e of edges) {
    if (!STRUCTURAL.includes(e.kind) || e.from === e.to) continue;
    const parent = entries.get(e.from);
    if (parent && entries.has(e.to) && !parent.children.includes(e.to)) parent.children.push(e.to);
  }
  const resolve: Site['resolve'] = ({ pageId, url, external }) => {
    const candidates: string[] = [];
    if (external && url) candidates.push(externalKey(url));
    if (pageId) candidates.push(pageId);
    if (url && !external) candidates.push(notionKeyFor(url));
    for (const c of candidates) {
      const k = input.resolveKey(c);
      if (byKey.has(k)) return k;
    }
    return undefined;
  };
  const indexPath = `index.${ext}`;
  return {
    rootKey: input.rootKey ? input.resolveKey(input.rootKey) : undefined,
    entries,
    resolve,
    assetPath: (assetId) => input.assets.find((a) => a.assetId === assetId && a.status === 'downloaded')?.path,
    backlinks: (key) => {
      const seen = new Set<string>();
      const out: { title: string; path: string; kind: ReferenceKind }[] = [];
      for (const e of edges) {
        if (e.to !== key || e.from === key) continue;
        const from = entries.get(e.from);
        const id = `${e.from}|${e.kind}`;
        if (!from || seen.has(id)) continue;
        seen.add(id);
        out.push({ title: from.title, path: from.path, kind: e.kind });
      }
      return out;
    },
    reportPath: ext === 'html' ? 'export-report.html' : 'export-report.md',
    indexPath,
    stylesheetPath: ext === 'html' ? 'style.css' : undefined,
  };
}

function nodeLabel(n: CrawlNode): string {
  return n.title || n.url;
}

const SKIP_TEXT: Record<string, string> = {
  'page-limit': 'not visited: page-count limit reached',
  'depth-limit': 'not visited: depth limit reached',
  cancelled: 'not visited: export cancelled',
  'not-followed': 'not visited: this relationship type is disabled in settings',
};

export function computeOutcome(input: ArchiveInput): { outcome: JobOutcome; reasons: string[] } {
  const reasons: string[] = [];
  if (input.cancelled) reasons.push('Export was cancelled before all pages were processed.');
  if (!input.pages.length) return { outcome: input.cancelled ? 'cancelled' : 'failed', reasons: [...reasons, 'No page content could be retrieved.'] };
  const live = input.nodes.filter((n) => !n.aliasOf);
  const failed = live.filter((n) => n.status === 'failed').length;
  const partial = input.pages.filter((p) => p.status === 'partial').length;
  const limitSkips = live.filter((n) => n.status === 'skipped' && (n.skipReason === 'page-limit' || n.skipReason === 'depth-limit')).length;
  const assetProblems = input.assets.filter((a) => a.status === 'failed' || a.status === 'skipped').length;
  if (failed) reasons.push(`${failed} page(s) could not be retrieved.`);
  if (partial) reasons.push(`${partial} page(s) were only partially extracted.`);
  if (limitSkips) reasons.push(`${limitSkips} discovered page(s) were not visited because a limit was reached.`);
  if (assetProblems) reasons.push(`${assetProblems} asset(s) could not be included.`);
  if (input.cancelled) return { outcome: 'cancelled', reasons };
  return { outcome: reasons.length ? 'partial' : 'success', reasons };
}

function settingsSummary(s: ExportSettings): string[] {
  return [
    `Format: ${s.format}${s.format !== 'html' ? ` (Markdown toggles: ${s.markdownToggleMode})` : ''}`,
    `Follow links & mentions: ${s.followLinks ? 'yes' : 'no'} · Child pages: ${s.includeChildPages ? 'yes' : 'no'} · Database entries: ${s.includeDatabaseEntries ? 'yes' : 'no'}`,
    `Open collapsed toggles: ${s.expandToggles ? 'yes' : 'no'} · Download assets: ${s.downloadAssets ? 'yes' : 'no'} · External websites: ${s.captureExternal ? 'yes' : 'no'}`,
    `Limits: ${s.maxPages} pages, depth ${s.maxDepth}, ${s.concurrency} concurrent, ${s.maxRetries} retries, ${s.maxAssets} assets, ${s.maxAssetMB} MB/asset, ${s.maxTotalAssetMB} MB total`,
  ];
}

export function buildReport(input: ArchiveInput, outcome: JobOutcome, reasons: string[], title: string): ExportReport {
  const live = input.nodes.filter((n) => !n.aliasOf);
  const exported = new Set(input.pages.map((p) => p.key));
  const pageByKey = new Map(input.pages.map((p) => [p.key, p]));
  const failedPages: ReportItem[] = live
    .filter((n) => n.status === 'failed')
    .map((n) => ({ title: nodeLabel(n), url: n.url, detail: `${n.errorCode ?? 'error'}: ${n.error ?? 'unknown error'} (attempts: ${n.attempts})` }));
  const partialPages: ReportItem[] = input.pages
    .filter((p) => p.status === 'partial')
    .map((p) => ({ title: p.title, url: p.url, detail: p.warnings.join(' · ') || 'partial' }));
  const skippedPages: ReportItem[] = live
    .filter((n) => n.status === 'skipped' && n.skipReason !== 'duplicate')
    .map((n) => ({ title: nodeLabel(n), url: n.url, detail: SKIP_TEXT[n.skipReason ?? ''] ?? n.skipReason ?? 'skipped' }));
  const nodeByKey = new Map(live.map((n) => [n.key, n]));
  const unresolved = new Map<string, ReportItem>();
  for (const e of input.edges) {
    if (e.kind === 'synced_block') continue;
    const to = input.resolveKey(e.to);
    if (exported.has(to)) continue;
    const from = pageByKey.get(input.resolveKey(e.from));
    const node = nodeByKey.get(to);
    let reason: string;
    if (e.kind === 'external') reason = input.settings.captureExternal ? (node?.status === 'failed' ? `external capture failed: ${node.error}` : 'external page not captured') : 'external link (external capture disabled)';
    else if (!node) reason = 'not visited';
    else if (node.status === 'failed') reason = `retrieval failed: ${node.error ?? ''}`;
    else reason = SKIP_TEXT[node.skipReason ?? ''] ?? node.status;
    const id = `${to}|${reason}`;
    const existing = unresolved.get(id);
    if (existing) {
      if (from && !existing.detail.includes(from.title)) existing.detail += `, ${from.title}`;
    } else {
      unresolved.set(id, { title: e.title || node?.title || redactUrl(e.url), url: redactUrl(e.url), detail: `${e.kind.replace(/_/g, ' ')} — ${reason}${from ? ` — from: ${from.title}` : ''}` });
    }
  }
  const assetFailures: ReportItem[] = input.assets
    .filter((a) => a.status === 'failed' || a.status === 'skipped')
    .map((a) => ({ title: a.name || a.kind, url: redactUrl(a.originalUrl), detail: a.error ?? a.status }));
  const externalPages: ReportItem[] = live
    .filter((n) => n.kind === 'external')
    .map((n) => ({ title: nodeLabel(n), url: n.url, detail: n.status === 'failed' ? `failed: ${n.error}` : n.status === 'skipped' ? (SKIP_TEXT[n.skipReason ?? ''] ?? 'skipped') : n.status }));

  const pagesNotion = input.pages.filter((p) => p.source === 'notion');
  return {
    title: `Export report — ${title}`,
    outcome,
    outcomeExplanation: reasons,
    rootUrl: input.rootUrl,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    format: input.settings.format,
    settingsSummary: settingsSummary(input.settings),
    counts: [
      { label: 'Notion pages exported', value: pagesNotion.length },
      { label: '…of which partial', value: pagesNotion.filter((p) => p.status === 'partial').length },
      { label: 'External pages exported', value: input.pages.length - pagesNotion.length },
      { label: 'Pages failed', value: failedPages.length },
      { label: 'Pages skipped', value: skippedPages.length },
      { label: 'Relationships recorded', value: input.edges.length },
      { label: 'Unresolved links', value: unresolved.size },
      { label: 'Assets downloaded', value: input.assets.filter((a) => a.status === 'downloaded').length },
      { label: 'Assets not included', value: assetFailures.length },
    ],
    limitsHit: input.limitsHit,
    failedPages,
    partialPages,
    skippedPages,
    unresolvedLinks: [...unresolved.values()],
    assetFailures,
    externalPages,
  };
}

function buildManifest(input: ArchiveInput, outcome: JobOutcome, formats: OutputExt[], rootPage: ExportPage | undefined): Record<string, unknown> {
  const live = input.nodes.filter((n) => !n.aliasOf);
  const nodeByKey = new Map(input.nodes.map((n) => [n.key, n]));
  const edges = input.edges.map((e) => ({ from: input.resolveKey(e.from), to: input.resolveKey(e.to), kind: e.kind, url: redactUrl(e.url), blockId: e.blockId }));
  const exported = new Set(input.pages.map((p) => p.key));
  return {
    format: 'unfoldr-archive',
    version: 1,
    generator: input.generator ?? 'Unfoldr Chrome extension',
    exportedAt: input.finishedAt,
    startedAt: input.startedAt,
    outcome,
    root: { key: input.rootKey ? input.resolveKey(input.rootKey) : undefined, pageId: rootPage?.pageId, url: input.rootUrl, title: rootPage?.title },
    settings: input.settings,
    outputFormats: formats,
    pages: input.pages.map((p) => {
      const node = nodeByKey.get(p.key);
      return {
        key: p.key,
        pageId: p.pageId,
        title: p.title,
        url: p.url,
        source: p.source,
        status: p.status,
        depth: node?.depth,
        discoveredVia: node?.via,
        discoveredFrom: node?.discoveredFrom ? input.resolveKey(node.discoveredFrom) : undefined,
        paths: Object.fromEntries(formats.map((f) => [f, pagePathFor(p, f)])),
        assetIds: p.assets.map((a) => a.assetId),
        warnings: p.warnings,
        extractedAt: p.extractedAt,
      };
    }),
    parentChild: edges.filter((e) => STRUCTURAL.includes(e.kind)).map((e) => ({ parent: e.from, child: e.to, kind: e.kind })),
    relationships: edges,
    assets: input.assets.map((a) => ({
      assetId: a.assetId,
      kind: a.kind,
      status: a.status,
      path: a.path,
      originalUrl: redactUrl(a.originalUrl),
      mime: a.mime,
      size: a.size,
      error: a.error,
      pages: a.pages.map((k) => input.resolveKey(k)),
    })),
    externalPages: live.filter((n) => n.kind === 'external').map((n) => ({ key: n.key, url: n.url, status: n.status, error: n.error, exported: exported.has(n.key) })),
    missing: live
      .filter((n) => (n.status === 'failed' || n.status === 'skipped') && !exported.has(n.key))
      .map((n) => ({ key: n.key, url: n.url, title: n.title, status: n.status, reason: n.status === 'failed' ? `${n.errorCode}: ${n.error}` : n.skipReason })),
    unresolvedReferences: edges.filter((e) => e.kind !== 'synced_block' && !exported.has(e.to)),
    limitsHit: input.limitsHit,
    summary: {
      pages: {
        completed: input.pages.filter((p) => p.status === 'complete').length,
        partial: input.pages.filter((p) => p.status === 'partial').length,
        failed: live.filter((n) => n.status === 'failed').length,
        skipped: live.filter((n) => n.status === 'skipped' && n.skipReason !== 'duplicate').length,
      },
      assets: {
        downloaded: input.assets.filter((a) => a.status === 'downloaded').length,
        failed: input.assets.filter((a) => a.status === 'failed').length,
        skipped: input.assets.filter((a) => a.status === 'skipped').length,
      },
    },
  };
}

function stamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-').slice(0, 13);
}

export async function buildArchive(input: ArchiveInput): Promise<ArchiveOutput> {
  const formats = formatsOf(input.settings);
  const files = new Map<string, string | Blob>();
  const add = (path: string, content: string | Blob) => {
    files.set(assertSafeArchivePath(`${ARCHIVE_ROOT}/${path}`), content);
  };
  const rootKey = input.rootKey ? input.resolveKey(input.rootKey) : undefined;
  const rootPage = input.pages.find((p) => p.key === rootKey) ?? input.pages[0];
  const title = rootPage?.title ?? 'Notion export';
  const { outcome, reasons } = computeOutcome(input);
  const report = buildReport(input, outcome, reasons, title);
  const reportMarkdown = reportToMarkdown(report);
  const summary = `${input.pages.length} page(s), ${input.assets.filter((a) => a.status === 'downloaded').length} asset(s), outcome: ${outcome}`;

  for (const ext of formats) {
    const site = buildSite(input, ext);
    for (const page of input.pages) {
      const path = site.entries.get(page.key)!.path;
      add(path, ext === 'html' ? renderHtmlPage(page, site, path) : renderMarkdownPage(page, site, path, { toggleMode: input.settings.markdownToggleMode }));
    }
    const info = { title, exportedAt: input.finishedAt, summary };
    add(site.indexPath, ext === 'html' ? renderHtmlIndex(site, info, site.indexPath) : renderMarkdownIndex(site, info, site.indexPath));
    if (ext === 'html') {
      add('style.css', ARCHIVE_CSS);
      add(
        'export-report.html',
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>${escapeHtml(report.title)}</title><link rel="stylesheet" href="style.css"></head><body><main>${reportToHtmlBody(report)}</main></body></html>\n`,
      );
    }
  }
  add('export-report.md', reportMarkdown);

  for (const a of input.assets) {
    if (a.status !== 'downloaded' || !a.path) continue;
    const blob = await input.getAssetBlob(a.assetId);
    if (blob) add(a.path, blob);
    else {
      a.status = 'failed';
      a.error = 'downloaded data missing from storage';
    }
  }
  const manifest = buildManifest(input, outcome, formats, rootPage);
  add('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

  return { files, manifest, report, reportMarkdown, outcome, zipBaseName: `unfoldr-${slugify(title, 'page')}-${stamp(input.finishedAt)}` };
}
