export type ExportFormat = 'html' | 'markdown' | 'both';
export type ToggleMode = 'interactive' | 'portable';
export type CrawlSurface = 'window' | 'background-tab';

export interface ExportSettings {
  format: ExportFormat;
  /** Follow links, mentions and link-to-page references recursively. */
  followLinks: boolean;
  includeChildPages: boolean;
  includeDatabaseEntries: boolean;
  /** Open collapsed toggles in the crawler tab to capture hidden content. */
  expandToggles: boolean;
  /** Re-collapse toggles that the exporter opened. */
  restoreToggles: boolean;
  /** Markdown handling of expandable sections. */
  markdownToggleMode: ToggleMode;
  downloadAssets: boolean;
  captureExternal: boolean;
  /** Where crawler tabs live: a separate unfocused window (default, renders reliably) or background tabs. */
  crawlSurface: CrawlSurface;
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  maxRetries: number;
  maxAssets: number;
  maxAssetMB: number;
  maxTotalAssetMB: number;
  /** Per-page timeout for loading + preparing + extracting. */
  pageTimeoutSec: number;
}

export const DEFAULT_SETTINGS: ExportSettings = {
  format: 'html',
  followLinks: true,
  includeChildPages: true,
  includeDatabaseEntries: true,
  expandToggles: true,
  restoreToggles: true,
  markdownToggleMode: 'interactive',
  downloadAssets: true,
  captureExternal: false,
  crawlSurface: 'window',
  maxPages: 500,
  maxDepth: 20,
  concurrency: 2,
  maxRetries: 2,
  maxAssets: 2000,
  maxAssetMB: 25,
  maxTotalAssetMB: 1024,
  pageTimeoutSec: 180,
};

const LIMITS: Record<'maxPages' | 'maxDepth' | 'concurrency' | 'maxRetries' | 'maxAssets' | 'maxAssetMB' | 'maxTotalAssetMB' | 'pageTimeoutSec', [number, number]> = {
  maxPages: [1, 5000],
  maxDepth: [0, 100],
  concurrency: [1, 4],
  maxRetries: [0, 5],
  maxAssets: [0, 20000],
  maxAssetMB: [1, 500],
  maxTotalAssetMB: [1, 20000],
  pageTimeoutSec: [20, 900],
};

/** Merges partial/untrusted input onto defaults, clamping numbers and validating enums. */
export function sanitizeSettings(input: unknown): ExportSettings {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: ExportSettings = { ...DEFAULT_SETTINGS };
  const bool = (k: keyof ExportSettings) => {
    if (typeof src[k] === 'boolean') (out as unknown as Record<string, unknown>)[k] = src[k];
  };
  (['followLinks', 'includeChildPages', 'includeDatabaseEntries', 'expandToggles', 'restoreToggles', 'downloadAssets', 'captureExternal'] as const).forEach(bool);
  if (src.format === 'html' || src.format === 'markdown' || src.format === 'both') out.format = src.format;
  if (src.markdownToggleMode === 'interactive' || src.markdownToggleMode === 'portable') out.markdownToggleMode = src.markdownToggleMode;
  if (src.crawlSurface === 'window' || src.crawlSurface === 'background-tab') out.crawlSurface = src.crawlSurface;
  for (const [k, [min, max]] of Object.entries(LIMITS) as [keyof typeof LIMITS, [number, number]][]) {
    const v = Number(src[k]);
    if (src[k] !== undefined && src[k] !== '' && Number.isFinite(v)) out[k] = Math.min(max, Math.max(min, Math.round(v)));
  }
  return out;
}
