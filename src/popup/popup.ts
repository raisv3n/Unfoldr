import { isNotionPageHost, parseNotionUrl, parseUrl } from '../shared/ids';
import type { JobProgress, PopupRequest, PopupResponse, ProbeResult, StatusBroadcast } from '../shared/messages';
import { DEFAULT_SETTINGS, sanitizeSettings, type ExportSettings } from '../shared/settings';

const EXTERNAL_ORIGINS = ['https://*/*'];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const BOOL_FIELDS = ['followLinks', 'includeChildPages', 'includeDatabaseEntries', 'expandToggles', 'captureExternal', 'downloadAssets', 'restoreToggles'] as const;
const NUM_FIELDS = ['maxPages', 'maxDepth', 'concurrency', 'maxRetries', 'maxAssets', 'maxAssetMB', 'maxTotalAssetMB', 'pageTimeoutSec'] as const;

let activeTab: chrome.tabs.Tab | undefined;
let pageSupported = false;
let running = false;

async function request(msg: PopupRequest): Promise<PopupResponse> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as PopupResponse;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function showError(text?: string): void {
  const el = $('error');
  el.hidden = !text;
  el.textContent = text ?? '';
}

// ---- settings form ---------------------------------------------------------------------------

function writeForm(s: ExportSettings): void {
  (document.querySelector(`input[name="format"][value="${s.format}"]`) as HTMLInputElement).checked = true;
  for (const k of BOOL_FIELDS) $<HTMLInputElement>(k).checked = s[k];
  for (const k of NUM_FIELDS) $<HTMLInputElement>(k).value = String(s[k]);
  $<HTMLSelectElement>('markdownToggleMode').value = s.markdownToggleMode;
  $<HTMLSelectElement>('crawlSurface').value = s.crawlSurface;
  syncDependentFields();
}

function readForm(): ExportSettings {
  const raw: Record<string, unknown> = {
    format: (document.querySelector('input[name="format"]:checked') as HTMLInputElement | null)?.value,
    markdownToggleMode: $<HTMLSelectElement>('markdownToggleMode').value,
    crawlSurface: $<HTMLSelectElement>('crawlSurface').value,
  };
  for (const k of BOOL_FIELDS) raw[k] = $<HTMLInputElement>(k).checked;
  for (const k of NUM_FIELDS) raw[k] = $<HTMLInputElement>(k).value;
  return sanitizeSettings(raw);
}

function syncDependentFields(): void {
  const format = (document.querySelector('input[name="format"]:checked') as HTMLInputElement | null)?.value;
  $('toggle-mode-field').hidden = format === 'html';
  $('toggle-hint').hidden = !$<HTMLInputElement>('expandToggles').checked;
  $('external-hint').hidden = !$<HTMLInputElement>('captureExternal').checked;
  $<HTMLButtonElement>('start-btn').disabled = !pageSupported || running;
}

async function saveSettings(): Promise<void> {
  await chrome.storage.local.set({ settings: readForm() });
}

// ---- current tab -----------------------------------------------------------------------------

function setPageStatus(text: string, tone: 'ok' | 'warn' | 'bad' | 'neutral'): void {
  const el = $('page-status');
  el.textContent = text;
  el.className = `badge ${tone}`;
}

const ACCESS_TEXT: Record<string, [string, 'ok' | 'warn' | 'bad']> = {
  ready: ['Supported Notion page', 'ok'],
  loading: ['Notion page (still loading — export will wait)', 'warn'],
  login_required: ['Not signed in to Notion', 'bad'],
  no_access: ['No access to this page', 'bad'],
  not_found: ['Page not found', 'bad'],
  challenge: ['Notion is showing a verification check', 'warn'],
};

async function detectTab(): Promise<void> {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = activeTab?.url;
  const host = url ? parseUrl(url)?.hostname : undefined;
  if (!url || !host || !isNotionPageHost(host)) {
    $('page-title').textContent = 'No Notion page in this tab';
    $('page-url').textContent = 'Open a page on notion.so, notion.com or a notion.site page, then click the extension again.';
    setPageStatus('Not supported', 'neutral');
    pageSupported = false;
    syncDependentFields();
    return;
  }
  $('page-title').textContent = activeTab?.title?.replace(/\s*[|–-]\s*Notion\s*$/, '') || 'Notion page';
  $('page-url').textContent = url;
  const info = parseNotionUrl(url);
  if (info.isNonPage) {
    setPageStatus('Not a Notion page view', 'neutral');
    pageSupported = false;
    syncDependentFields();
    return;
  }
  pageSupported = true;
  setPageStatus(info.pageId ? `Notion page · ${info.pageId.slice(0, 8)}…` : 'Notion page', 'ok');
  syncDependentFields();
  if (activeTab?.id === undefined) return;
  const res = await request({ type: 'probeTab', tabId: activeTab.id });
  const probe: ProbeResult | undefined = res.ok ? res.probe : undefined;
  if (!probe) return;
  if (probe.title) $('page-title').textContent = probe.title;
  const [text, tone] = ACCESS_TEXT[probe.state] ?? ['Notion page', 'ok'];
  const id = probe.pageId?.replace(/-/g, '') ?? info.pageId;
  setPageStatus(probe.state === 'ready' && id ? `${text} · ${id.slice(0, 8)}…` : text, tone);
}

// ---- progress / result -------------------------------------------------------------------------

const PHASE_TEXT: Record<JobProgress['phase'], string> = {
  idle: 'Idle',
  crawling: 'Exporting pages…',
  assets: 'Downloading images & files…',
  packaging: 'Building ZIP archive…',
  downloading: 'Saving ZIP…',
  done: 'Done',
  cancelled: 'Cancelled',
  error: 'Failed',
};

const OUTCOME_TEXT: Record<string, string> = {
  success: '✅ Export complete',
  partial: '⚠️ Partial export — some content could not be retrieved',
  failed: '❌ Export failed',
  cancelled: '⏹ Export cancelled — partial archive saved',
};

function render(p: JobProgress | undefined): void {
  const isRunning = !!p && ['crawling', 'assets', 'packaging', 'downloading'].includes(p.phase);
  const isFinished = !!p && ['done', 'cancelled', 'error'].includes(p.phase);
  running = isRunning;
  $('export-form').hidden = isRunning || isFinished;
  $('progress').hidden = !isRunning;
  $('result').hidden = !isFinished;
  $('resume-banner').hidden = !(p?.resumable && !isRunning);
  if (p?.resumable) $('resume-text').textContent = `An export of “${p.rootTitle ?? p.rootUrl}” was interrupted.`;
  syncDependentFields();
  if (!p) return;

  if (isRunning) {
    const done = p.pages.completed + p.pages.partial + p.pages.failed;
    const total = done + p.pages.queued + p.pages.processing;
    const bar = $<HTMLProgressElement>('progress-bar');
    if (p.phase === 'crawling' && total > 0) bar.value = Math.round((done / total) * 100);
    else if (p.phase === 'assets') {
      const a = p.assets;
      const t = a.downloaded + a.failed + a.skipped + a.queued;
      bar.value = t ? Math.round(((t - a.queued) / t) * 100) : 100;
    } else bar.removeAttribute('value');
    $('phase-label').textContent = PHASE_TEXT[p.phase];
    $('s-pages').textContent = String(p.pages.completed + p.pages.partial);
    $('s-queued').textContent = String(p.pages.queued + p.pages.processing);
    $('s-failed').textContent = String(p.pages.failed);
    $('s-assets').textContent = `${p.assets.downloaded}${p.assets.queued ? `/${p.assets.downloaded + p.assets.queued}` : ''}`;
    $('current-url').textContent = p.currentUrl ?? '';
    $('progress-message').textContent = p.message ?? '';
    return;
  }

  if (isFinished) {
    const outcome = p.phase === 'error' ? 'failed' : (p.outcome ?? 'failed');
    const el = $('outcome');
    el.className = `outcome ${outcome}`;
    el.textContent = OUTCOME_TEXT[outcome] ?? outcome;
    const items: string[] = [];
    if (p.error) items.push(`Error: ${p.error}`);
    items.push(`${p.pages.completed} complete, ${p.pages.partial} partial, ${p.pages.failed} failed, ${p.pages.skipped} skipped page(s)`);
    items.push(`${p.assets.downloaded} asset(s) downloaded${p.assets.failed + p.assets.skipped ? `, ${p.assets.failed + p.assets.skipped} not included` : ''}`);
    if (p.zipName) items.push(`Saved: ${p.zipName} (${((p.zipBytes ?? 0) / 1024 / 1024).toFixed(1)} MB)`);
    for (const l of p.limitsHit.filter((x) => x !== 'cancelled')) items.push(`Limit reached: ${l}`);
    const list = $('outcome-details');
    list.replaceChildren(...items.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    $('report-text').textContent = p.reportMarkdown ?? 'No report available.';
    $('report-box').hidden = !p.reportMarkdown;
    $<HTMLButtonElement>('download-again').hidden = !p.zipName;
  }
}

// ---- wiring ----------------------------------------------------------------------------------

async function init(): Promise<void> {
  const stored = (await chrome.storage.local.get('settings')).settings;
  writeForm(sanitizeSettings(stored ?? DEFAULT_SETTINGS));
  if ($<HTMLInputElement>('captureExternal').checked && !(await chrome.permissions.contains({ origins: EXTERNAL_ORIGINS }))) {
    $<HTMLInputElement>('captureExternal').checked = false;
    syncDependentFields();
  }

  chrome.runtime.onMessage.addListener((msg: StatusBroadcast) => {
    if (msg?.type === 'jobProgress') render(msg.progress);
  });

  const status = await request({ type: 'getStatus' });
  render(status.ok ? status.progress : undefined);
  await detectTab().catch((e: unknown) => setPageStatus(`Could not inspect tab: ${e instanceof Error ? e.message : String(e)}`, 'warn'));
}

$('export-form').addEventListener('change', (e) => {
  syncDependentFields();
  if ((e.target as HTMLElement).id !== 'captureExternal') void saveSettings();
});

$<HTMLInputElement>('captureExternal').addEventListener('change', async (e) => {
  const box = e.target as HTMLInputElement;
  if (box.checked) {
    // Must run inside the user gesture.
    const granted = await chrome.permissions.request({ origins: EXTERNAL_ORIGINS }).catch(() => false);
    if (!granted) {
      box.checked = false;
      showError('External website capture needs permission to read websites. It stays disabled.');
    } else showError();
  }
  syncDependentFields();
  await saveSettings();
});

$('revoke-external').addEventListener('click', async () => {
  await chrome.permissions.remove({ origins: EXTERNAL_ORIGINS }).catch(() => false);
  $<HTMLInputElement>('captureExternal').checked = false;
  syncDependentFields();
  await saveSettings();
  showError();
});

$('export-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError();
  if (!activeTab?.url || !pageSupported) return;
  const settings = readForm();
  await chrome.storage.local.set({ settings });
  $<HTMLButtonElement>('start-btn').disabled = true;
  const res = await request({ type: 'startExport', tabUrl: activeTab.url, tabTitle: $('page-title').textContent ?? undefined, settings });
  if (!res.ok) {
    showError(res.error);
    syncDependentFields();
    return;
  }
  render(res.progress);
});

$('cancel-btn').addEventListener('click', async () => {
  $<HTMLButtonElement>('cancel-btn').disabled = true;
  await request({ type: 'cancelExport' });
});

$('resume-btn').addEventListener('click', async () => {
  const res = await request({ type: 'resumeExport' });
  if (!res.ok) showError(res.error);
  else render(res.progress);
});

$('discard-btn').addEventListener('click', async () => {
  await request({ type: 'discardResumable' });
  render(undefined);
});

$('download-again').addEventListener('click', async () => {
  const res = await request({ type: 'downloadAgain' });
  if (!res.ok) showError(res.error);
});

$('new-export').addEventListener('click', async () => {
  $<HTMLButtonElement>('cancel-btn').disabled = false;
  showError();
  await request({ type: 'dismissResult' });
  render(undefined);
});

void init();
