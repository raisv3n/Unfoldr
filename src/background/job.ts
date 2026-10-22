// One export job: crawl → assets → archive → ZIP → download. Persists its state after every
// page so it can be resumed if the service worker is restarted mid-export.

import { buildArchive } from '../archive/archive';
import { createZip } from '../archive/zip';
import { AssetManager, type AssetRecord, type AssetStore } from '../assets/asset-manager';
import { Crawler, type CrawlOptions, type CrawlSnapshot, type PageFetcher } from '../crawler/crawler';
import { idbDelete, idbDeletePrefix, idbGet, idbGetPrefix, idbPut } from '../shared/idb';
import { isNotionAssetHost } from '../shared/ids';
import { isYouTubeThumbnailHost } from '../shared/youtube';
import type { JobProgress } from '../shared/messages';
import type { ExportPage } from '../shared/model';
import type { ExportSettings } from '../shared/settings';
import { downloadStoredZip } from './download';
import { fetchAssetInTab, fetchExternalPage, fetchNotionPage, hasExternalPermission } from './fetchers';
import { TabPool } from './tab-pool';

export const ACTIVE_JOB_KEY = 'activeJob';
export const ZIP_KEY = 'zip:latest';

export interface JobInit {
  id: string;
  settings: ExportSettings;
  rootUrl: string;
  rootTitle?: string;
  startedAt: string;
  originWindowId?: number;
}

interface PersistedJob extends JobInit {
  crawl?: CrawlSnapshot;
  assets?: AssetRecord[];
}

class IdbAssetStore implements AssetStore {
  constructor(private readonly jobId: string) {}
  put(assetId: string, blob: Blob) {
    return idbPut('blobs', `${this.jobId}|${assetId}`, blob);
  }
  get(assetId: string) {
    return idbGet<Blob>('blobs', `${this.jobId}|${assetId}`);
  }
}

function emptyProgress(init: JobInit): JobProgress {
  return {
    jobId: init.id,
    phase: 'crawling',
    rootUrl: init.rootUrl,
    rootTitle: init.rootTitle,
    startedAt: init.startedAt,
    pages: { queued: 0, processing: 0, completed: 0, partial: 0, failed: 0, skipped: 0 },
    assets: { queued: 0, downloaded: 0, failed: 0, skipped: 0, bytes: 0 },
    limitsHit: [],
  };
}

export class ExportJob {
  readonly progress: JobProgress;
  private pages = new Map<string, ExportPage>();
  private pool?: TabPool;
  private crawler?: Crawler;
  private assets?: AssetManager;
  private readonly assetAbort = new AbortController();
  private cancelled = false;
  private drainRunning?: Promise<void>;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private keepAlive?: ReturnType<typeof setInterval>;

  private constructor(
    private readonly init: JobInit,
    private readonly onUpdate: (p: JobProgress) => void,
    private readonly restored?: PersistedJob,
  ) {
    this.progress = emptyProgress(init);
  }

  static create(init: JobInit, onUpdate: (p: JobProgress) => void): ExportJob {
    return new ExportJob(init, onUpdate);
  }

  static async loadResumable(): Promise<PersistedJob | undefined> {
    return idbGet<PersistedJob>('kv', ACTIVE_JOB_KEY);
  }

  static async resume(onUpdate: (p: JobProgress) => void): Promise<ExportJob | undefined> {
    const saved = await ExportJob.loadResumable();
    if (!saved) return undefined;
    const job = new ExportJob(saved, onUpdate, saved);
    for (const page of await idbGetPrefix<ExportPage>('pages', `${saved.id}|`)) job.pages.set(page.key, page);
    return job;
  }

  static async discardResumable(): Promise<void> {
    const saved = await ExportJob.loadResumable();
    if (saved) await ExportJob.clearData(saved.id);
    await idbDelete('kv', ACTIVE_JOB_KEY);
  }

  private static async clearData(jobId: string): Promise<void> {
    await idbDeletePrefix('pages', `${jobId}|`);
    await idbDeletePrefix('blobs', `${jobId}|`);
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.progress.message = 'Cancelling… packaging what was retrieved so far.';
    this.crawler?.cancel();
    this.assetAbort.abort();
    this.emit();
  }

  private emit(): void {
    if (this.crawler) this.progress.pages = this.crawler.stats();
    if (this.assets) this.progress.assets = this.assets.stats();
    this.onUpdate({ ...this.progress, pages: { ...this.progress.pages }, assets: { ...this.progress.assets } });
  }

  private setPhase(phase: JobProgress['phase'], message?: string): void {
    this.progress.phase = phase;
    this.progress.message = message;
    this.emit();
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persist();
    }, 1000);
  }

  private async persist(): Promise<void> {
    if (!this.crawler) return;
    const state: PersistedJob = { ...this.init, crawl: this.crawler.snapshot(), assets: this.assets?.getRecords() };
    await idbPut('kv', ACTIVE_JOB_KEY, state).catch(() => undefined);
  }

  private kickDrain(): void {
    if (this.drainRunning || !this.assets) return;
    this.drainRunning = (async () => {
      while (!this.assetAbort.signal.aborted && this.assets!.stats().queued > 0) await this.assets!.drain(this.assetAbort.signal);
    })().finally(() => {
      this.drainRunning = undefined;
    });
  }

  async run(): Promise<void> {
    const { settings } = this.init;
    // Any chrome.* call resets the service worker idle timer; keep it alive for long exports.
    this.keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20000);
    try {
      const externalGranted = settings.captureExternal && (await hasExternalPermission());
      this.pool = new TabPool(settings.crawlSurface, settings.concurrency, this.init.originWindowId);
      await this.pool.open();
      const pool = this.pool;

      this.assets = new AssetManager(
        {
          maxAssets: settings.maxAssets,
          maxAssetBytes: settings.maxAssetMB * 1024 * 1024,
          maxTotalBytes: settings.maxTotalAssetMB * 1024 * 1024,
          concurrency: 3,
          policy: { allowHost: (h) => isNotionAssetHost(h) || isYouTubeThumbnailHost(h) || externalGranted },
          withCredentials: (h) => isNotionAssetHost(h),
          inTabFallback: (url, max) => fetchAssetInTab(pool, url, max),
          onProgress: () => this.emit(),
        },
        new IdbAssetStore(this.init.id),
      );
      if (this.restored?.assets) this.assets.restore(this.restored.assets);

      const deps = {
        pool,
        settings,
        onCurrent: (url: string) => {
          this.progress.currentUrl = url;
          this.emit();
        },
        onStatus: (message: string) => {
          if (this.progress.phase !== 'crawling' || this.cancelled) return;
          this.progress.message = message;
          this.emit();
        },
      };
      const fetcher: PageFetcher = (node, signal) => (node.kind === 'external' ? fetchExternalPage(node, signal, deps) : fetchNotionPage(node, signal, deps));
      const opts: CrawlOptions = {
        maxPages: settings.maxPages,
        maxDepth: settings.maxDepth,
        concurrency: settings.concurrency,
        maxRetries: settings.maxRetries,
        followLinks: settings.followLinks,
        includeChildPages: settings.includeChildPages,
        includeDatabaseEntries: settings.includeDatabaseEntries,
        captureExternal: externalGranted,
      };
      const events = {
        onPage: async (page: ExportPage) => {
          this.pages.set(page.key, page);
          if (page.key === this.crawler?.resolveKey(this.rootKey()) && !this.progress.rootTitle) this.progress.rootTitle = page.title;
          await idbPut('pages', `${this.init.id}|${page.key}`, page);
          if (settings.downloadAssets && page.assets.length) {
            this.assets!.enqueue(page.assets, page.key);
            this.kickDrain();
          }
          this.schedulePersist();
        },
        onProgress: () => this.emit(),
      };
      this.crawler = this.restored?.crawl ? Crawler.restore(this.restored.crawl, opts, fetcher, events) : new Crawler(opts, fetcher, events);
      if (!this.restored?.crawl) this.crawler.seed(this.init.rootUrl);
      await this.persist();

      this.setPhase('crawling', 'Exploring pages…');
      await this.crawler.run();

      if (settings.downloadAssets && !this.cancelled) {
        this.setPhase('assets', 'Downloading images and files…');
        this.kickDrain();
        while (this.drainRunning) await this.drainRunning;
      }
      await this.drainRunning;
      if (this.cancelled) this.assets.skipPending('export cancelled');
      await pool.close();
      this.progress.currentUrl = undefined;

      this.setPhase('packaging', 'Building archive…');
      const finishedAt = new Date().toISOString();
      const crawler = this.crawler;
      const out = await buildArchive({
        settings,
        rootUrl: this.init.rootUrl,
        rootKey: this.rootKey(),
        startedAt: this.init.startedAt,
        finishedAt,
        pages: [...this.pages.values()],
        nodes: crawler.getNodes(),
        edges: crawler.getEdges(),
        resolveKey: (k) => crawler.resolveKey(k),
        limitsHit: [...new Set([...crawler.getLimitsHit(), ...this.assets.getLimitsHit()])],
        assets: this.assets.getRecords(),
        cancelled: this.cancelled,
        generator: `Notion Exporter ${chrome.runtime.getManifest().version}`,
        getAssetBlob: (id) => idbGet<Blob>('blobs', `${this.init.id}|${id}`),
      });
      let lastPct = -10;
      const zip = await createZip(out.files, (pct) => {
        if (pct - lastPct >= 5) {
          lastPct = pct;
          this.progress.message = `Compressing… ${Math.round(pct)}%`;
          this.emit();
        }
      });
      const zipName = `${out.zipBaseName}.zip`;
      await idbPut('blobs', ZIP_KEY, zip);
      await idbPut('kv', 'zip:meta', { name: zipName, size: zip.size });
      this.progress.zipName = zipName;
      this.progress.zipBytes = zip.size;
      this.progress.reportMarkdown = out.reportMarkdown;
      this.progress.outcome = out.outcome;
      this.progress.limitsHit = out.report.limitsHit;

      this.setPhase('downloading', 'Saving ZIP to your Downloads folder…');
      await downloadStoredZip(ZIP_KEY, zipName);
      this.progress.finishedAt = finishedAt;
      this.setPhase(this.cancelled ? 'cancelled' : 'done', undefined);

      await ExportJob.clearData(this.init.id);
      await idbDelete('kv', ACTIVE_JOB_KEY);
    } catch (e) {
      this.progress.error = e instanceof Error ? e.message : String(e);
      this.progress.outcome = 'failed';
      this.progress.finishedAt = new Date().toISOString();
      this.setPhase('error');
    } finally {
      clearInterval(this.keepAlive);
      if (this.persistTimer) clearTimeout(this.persistTimer);
      await this.pool?.close();
    }
  }

  private rootKey(): string {
    return this.crawler?.getNodes().find((n) => n.depth === 0 && !n.discoveredFrom)?.key ?? this.init.rootUrl;
  }
}
