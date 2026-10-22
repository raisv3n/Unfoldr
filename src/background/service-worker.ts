// Service worker: owns the export job and answers popup requests.

import { idbGet } from '../shared/idb';
import { isNotionPageHost, parseUrl } from '../shared/ids';
import type { JobProgress, PopupRequest, PopupResponse, ProbeResult, StatusBroadcast } from '../shared/messages';
import { sanitizeSettings } from '../shared/settings';
import { downloadStoredZip } from './download';
import { NOTION_SCRIPT, hasExternalPermission } from './fetchers';
import { ExportJob, ZIP_KEY } from './job';
import { closeOrphanedCrawlerTabs } from './tab-pool';

let job: ExportJob | undefined;
let last: JobProgress | undefined;
let storeTimer: ReturnType<typeof setTimeout> | undefined;

const ready = (async () => {
  await closeOrphanedCrawlerTabs().catch(() => undefined);
  last = (await chrome.storage.local.get('lastProgress')).lastProgress as JobProgress | undefined;
  const resumable = await ExportJob.loadResumable().catch(() => undefined);
  if (resumable) {
    last = {
      ...(last ?? {
        jobId: resumable.id,
        rootUrl: resumable.rootUrl,
        startedAt: resumable.startedAt,
        pages: { queued: 0, processing: 0, completed: 0, partial: 0, failed: 0, skipped: 0 },
        assets: { queued: 0, downloaded: 0, failed: 0, skipped: 0, bytes: 0 },
        limitsHit: [],
      }),
      jobId: resumable.id,
      rootUrl: resumable.rootUrl,
      rootTitle: resumable.rootTitle,
      phase: 'idle',
      currentUrl: undefined,
      resumable: true,
      message: 'A previous export was interrupted. You can resume it or discard it.',
    };
  }
})();

function onUpdate(p: JobProgress): void {
  last = p;
  const msg: StatusBroadcast = { type: 'jobProgress', progress: p };
  chrome.runtime.sendMessage(msg).catch(() => undefined); // popup may be closed
  if (!storeTimer) {
    storeTimer = setTimeout(() => {
      storeTimer = undefined;
      void chrome.storage.local.set({ lastProgress: last });
    }, 500);
  }
  if (['done', 'cancelled', 'error'].includes(p.phase)) void chrome.storage.local.set({ lastProgress: p });
}

function startJob(created: ExportJob): void {
  job = created;
  void created.run().finally(() => {
    if (job === created) job = undefined;
  });
}

async function probeTab(tabId: number): Promise<ProbeResult | undefined> {
  const tab = await chrome.tabs.get(tabId);
  const host = parseUrl(tab.url ?? '')?.hostname;
  if (!host || !isNotionPageHost(host)) return undefined;
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [NOTION_SCRIPT] });
  return (await chrome.tabs.sendMessage(tabId, { target: 'notion-content', cmd: 'probe' }, { frameId: 0 })) as ProbeResult;
}

async function handle(msg: PopupRequest): Promise<PopupResponse> {
  await ready;
  switch (msg.type) {
    case 'getStatus':
      return { ok: true, progress: job?.progress ?? last };
    case 'startExport': {
      if (job) return { ok: false, error: 'An export is already running.' };
      const host = parseUrl(msg.tabUrl)?.hostname;
      if (!host || !isNotionPageHost(host)) return { ok: false, error: 'The current tab is not a Notion page.' };
      const settings = sanitizeSettings(msg.settings);
      if (settings.captureExternal && !(await hasExternalPermission())) settings.captureExternal = false;
      await chrome.storage.local.set({ settings });
      await ExportJob.discardResumable();
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const created = ExportJob.create(
        { id: crypto.randomUUID(), settings, rootUrl: msg.tabUrl, rootTitle: msg.tabTitle, startedAt: new Date().toISOString(), originWindowId: active?.windowId },
        onUpdate,
      );
      startJob(created);
      return { ok: true, progress: created.progress };
    }
    case 'cancelExport':
      job?.cancel();
      return { ok: true, progress: job?.progress ?? last };
    case 'resumeExport': {
      if (job) return { ok: false, error: 'An export is already running.' };
      const resumed = await ExportJob.resume(onUpdate);
      if (!resumed) return { ok: false, error: 'Nothing to resume.' };
      startJob(resumed);
      return { ok: true, progress: resumed.progress };
    }
    case 'discardResumable':
      await ExportJob.discardResumable();
      if (last?.resumable) last = undefined;
      await chrome.storage.local.remove('lastProgress');
      return { ok: true };
    case 'downloadAgain': {
      const meta = await idbGet<{ name: string }>('kv', 'zip:meta');
      if (!meta) return { ok: false, error: 'No archive available. Run an export first.' };
      await downloadStoredZip(ZIP_KEY, meta.name);
      return { ok: true };
    }
    case 'dismissResult':
      if (!job && last && !last.resumable) {
        last = undefined;
        await chrome.storage.local.remove('lastProgress');
      }
      return { ok: true };
    case 'probeTab':
      return { ok: true, probe: await probeTab(msg.tabId) };
    default:
      return { ok: false, error: 'Unknown request' };
  }
}

chrome.runtime.onMessage.addListener((msg: PopupRequest & { target?: string }, sender, sendResponse) => {
  // Only the extension's own pages may control exports; content scripts and the offscreen
  // document use targeted messages handled elsewhere.
  if (msg?.target || sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  handle(msg).then(sendResponse, (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true;
});
