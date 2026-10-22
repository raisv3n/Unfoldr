// Offscreen document: turns the ZIP stored in IndexedDB into a blob URL for chrome.downloads.

import { idbGet } from '../shared/idb';
import type { OffscreenRequest, OffscreenResponse } from '../shared/messages';

chrome.runtime.onMessage.addListener((msg: OffscreenRequest, sender, sendResponse: (r: OffscreenResponse) => void) => {
  if (msg?.target !== 'offscreen' || sender.id !== chrome.runtime.id) return false;
  if (msg.type === 'createObjectUrl') {
    idbGet<Blob>('blobs', msg.key)
      .then((blob) => (blob ? sendResponse({ ok: true, url: URL.createObjectURL(blob) }) : sendResponse({ ok: false, error: 'Archive not found in storage' })))
      .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }
  if (msg.type === 'revokeObjectUrl') {
    if (msg.url.startsWith('blob:')) URL.revokeObjectURL(msg.url);
    sendResponse({ ok: true });
  }
  return false;
});
