// Export report: structured summary rendered to Markdown (always) and HTML (for HTML exports).

import { escapeHtml } from '../render/html';
import { escapeMd } from '../render/markdown';
import type { JobOutcome } from '../shared/messages';
import { safeLinkHref } from '../shared/url-safety';

export interface ReportItem {
  title: string;
  url: string;
  detail: string;
  path?: string;
}

export interface ExportReport {
  title: string;
  outcome: JobOutcome;
  outcomeExplanation: string[];
  rootUrl: string;
  startedAt: string;
  finishedAt: string;
  format: string;
  settingsSummary: string[];
  counts: { label: string; value: number }[];
  limitsHit: string[];
  failedPages: ReportItem[];
  partialPages: ReportItem[];
  skippedPages: ReportItem[];
  unresolvedLinks: ReportItem[];
  assetFailures: ReportItem[];
  externalPages: ReportItem[];
}

const OUTCOME_LABEL: Record<JobOutcome, string> = {
  success: '✅ Complete — every discovered page within the configured scope was exported without known gaps.',
  partial: '⚠️ Partial — the archive is usable but some content could not be retrieved. Details below.',
  failed: '❌ Failed — no pages could be exported.',
  cancelled: '⏹ Cancelled — the export was stopped; the archive contains what was retrieved before cancellation.',
};

const LIMIT_LABEL: Record<string, string> = {
  maxPages: 'Maximum page count reached — more pages were discovered than exported.',
  maxDepth: 'Maximum relationship depth reached — deeper pages were not visited.',
  maxAssets: 'Maximum asset count reached — remaining assets were not downloaded.',
  maxTotalAssetMB: 'Maximum total asset size reached — remaining assets were not downloaded.',
  cancelled: 'Export cancelled by user.',
};

export function limitLabel(limit: string): string {
  return LIMIT_LABEL[limit] ?? limit;
}

function mdSection(title: string, items: ReportItem[], max = 500): string {
  if (!items.length) return '';
  const rows = items.slice(0, max).map((i) => {
    const href = safeLinkHref(i.url);
    return `| ${escapeMd(i.title)} | ${href ? `<${href}>` : escapeMd(i.url)} | ${escapeMd(i.detail)} |`;
  });
  const more = items.length > max ? `\n\n…and ${items.length - max} more (see manifest.json).` : '';
  return `## ${title} (${items.length})\n\n| Page | Source URL | Details |\n| --- | --- | --- |\n${rows.join('\n')}${more}`;
}

export function reportToMarkdown(r: ExportReport): string {
  return [
    `# ${escapeMd(r.title)}`,
    `**Outcome:** ${OUTCOME_LABEL[r.outcome]}`,
    r.outcomeExplanation.length ? r.outcomeExplanation.map((e) => `- ${escapeMd(e)}`).join('\n') : '',
    `- Root: <${r.rootUrl}>\n- Started: ${r.startedAt}\n- Finished: ${r.finishedAt}\n- Format: ${r.format}`,
    `## Settings\n\n${r.settingsSummary.map((s) => `- ${escapeMd(s)}`).join('\n')}`,
    `## Summary\n\n| Item | Count |\n| --- | ---: |\n${r.counts.map((c) => `| ${escapeMd(c.label)} | ${c.value} |`).join('\n')}`,
    r.limitsHit.length ? `## Limits reached\n\n${r.limitsHit.map((l) => `- ${escapeMd(limitLabel(l))}`).join('\n')}` : '',
    mdSection('Failed pages', r.failedPages),
    mdSection('Partially extracted pages', r.partialPages),
    mdSection('Skipped pages', r.skippedPages),
    mdSection('Unresolved links (not exported)', r.unresolvedLinks),
    mdSection('Assets not included', r.assetFailures),
    mdSection('External pages', r.externalPages),
    '## Notes\n\n- Extraction reads Notion as rendered in your browser. Content Notion did not render (e.g. rows hidden by database filters, collapsed toggles that failed to open) is listed above as warnings.\n- Original Notion URLs are kept in every page and in `manifest.json`.',
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n');
}

function htmlSection(title: string, items: ReportItem[], max = 500): string {
  if (!items.length) return '';
  const rows = items
    .slice(0, max)
    .map((i) => {
      const href = safeLinkHref(i.url);
      const link = href ? `<a href="${escapeHtml(href)}" class="external" rel="noopener noreferrer nofollow">${escapeHtml(i.url)}</a>` : escapeHtml(i.url);
      return `<tr><td>${escapeHtml(i.title)}</td><td>${link}</td><td>${escapeHtml(i.detail)}</td></tr>`;
    });
  return `<h2>${escapeHtml(title)} (${items.length})</h2><table><thead><tr><th>Page</th><th>Source URL</th><th>Details</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export function reportToHtmlBody(r: ExportReport): string {
  return [
    `<nav class="crumbs"><a href="index.html">← Index</a></nav>`,
    `<h1>${escapeHtml(r.title)}</h1>`,
    `<p><strong>Outcome:</strong> ${escapeHtml(OUTCOME_LABEL[r.outcome])}</p>`,
    r.outcomeExplanation.length ? `<ul>${r.outcomeExplanation.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` : '',
    `<dl class="meta"><dt>Root</dt><dd>${escapeHtml(r.rootUrl)}</dd><dt>Started</dt><dd>${escapeHtml(r.startedAt)}</dd><dt>Finished</dt><dd>${escapeHtml(r.finishedAt)}</dd><dt>Format</dt><dd>${escapeHtml(r.format)}</dd></dl>`,
    `<h2>Settings</h2><ul>${r.settingsSummary.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`,
    `<h2>Summary</h2><table><tbody>${r.counts.map((c) => `<tr><th>${escapeHtml(c.label)}</th><td>${c.value}</td></tr>`).join('')}</tbody></table>`,
    r.limitsHit.length ? `<h2>Limits reached</h2><ul>${r.limitsHit.map((l) => `<li>${escapeHtml(limitLabel(l))}</li>`).join('')}</ul>` : '',
    htmlSection('Failed pages', r.failedPages),
    htmlSection('Partially extracted pages', r.partialPages),
    htmlSection('Skipped pages', r.skippedPages),
    htmlSection('Unresolved links (not exported)', r.unresolvedLinks),
    htmlSection('Assets not included', r.assetFailures),
    htmlSection('External pages', r.externalPages),
  ].join('\n');
}
