// Downloads a ZIP stored in IndexedDB. Service workers cannot create blob URLs, and data URLs
// are capped at 2 MB, so an offscreen document creates the blob URL for chrome.downloads.

import type { OffscreenRequest, OffscreenResponse } from '../shared/messages';

const OFFSCREEN_URL = 'offscreen.html';

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Create a blob URL for the generated export archive so it can be saved with chrome.downloads.',
  });
}

async function toOffscreen(msg: OffscreenRequest): Promise<OffscreenResponse> {
  return (await chrome.runtime.sendMessage(msg)) as OffscreenResponse;
}

function waitForDownload(id: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const done = (state: string) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(listener);
      resolve(state);
    };
    const listener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== id || !delta.state?.current) return;
      if (delta.state.current === 'complete' || delta.state.current === 'interrupted') done(delta.state.current);
    };
    const timer = setTimeout(() => done('timeout'), timeoutMs);
    chrome.downloads.onChanged.addListener(listener);
  });
}

export async function downloadStoredZip(key: string, filename: string): Promise<void> {
  await ensureOffscreen();
  const res = await toOffscreen({ target: 'offscreen', type: 'createObjectUrl', key });
  if (!res.ok || !res.url) throw new Error(res.ok ? 'No URL returned for the archive' : res.error);
  try {
    const id = await chrome.downloads.download({ url: res.url, filename, saveAs: false, conflictAction: 'uniquify' });
    const state = await waitForDownload(id, 10 * 60 * 1000);
    if (state === 'interrupted') {
      const [item] = await chrome.downloads.search({ id });
      throw new Error(`Download interrupted${item?.error ? ` (${item.error})` : ''}`);
    }
  } finally {
    await toOffscreen({ target: 'offscreen', type: 'revokeObjectUrl', url: res.url }).catch(() => undefined);
    await chrome.offscreen.closeDocument().catch(() => undefined);
  }
}
