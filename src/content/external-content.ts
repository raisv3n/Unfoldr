// Content script injected into crawler tabs showing opted-in external websites.

import type { ContentCommand, ExtractResult, ProbeResult, StepResult } from '../shared/messages';
import { extractExternalPage, findAccordionPanels, isSafeToggleTrigger } from './external-dom';
import { fetchSameOrigin } from './in-tab-fetch';

declare global {
  interface Window {
    __externalExporterInstalled?: boolean;
    __externalExporterClicked?: WeakSet<Element>;
  }
}

function probe(): ProbeResult {
  const text = (document.body?.textContent ?? '').trim();
  const challenge = /just a moment|verify you are human|checking your browser/i.test(document.title);
  return {
    state: challenge ? 'challenge' : document.readyState === 'complete' || text.length > 200 ? 'ready' : 'loading',
    title: document.title,
    blockCount: document.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td').length,
    url: location.href,
  };
}

/** Clicks safe accordion triggers whose panels are empty (content loaded on demand). */
function step(maxClicks: number): StepResult {
  window.__externalExporterClicked ??= new WeakSet();
  const clickedSet = window.__externalExporterClicked;
  let clicked = 0;
  for (const [trigger, panel] of findAccordionPanels(document, document)) {
    if (clicked >= maxClicks) break;
    if (clickedSet.has(trigger) || (panel.textContent ?? '').trim() || !isSafeToggleTrigger(trigger)) continue;
    clickedSet.add(trigger);
    (trigger as HTMLElement).click();
    clicked++;
  }
  const se = document.scrollingElement;
  if (se) se.scrollTop = Math.min(se.scrollTop + window.innerHeight, se.scrollHeight);
  const atBottom = !se || se.scrollTop + window.innerHeight >= se.scrollHeight - 4;
  return { blockCount: document.querySelectorAll('*').length, collapsedRemaining: 0, clicked, atBottom, scrollHeight: se?.scrollHeight ?? 0 };
}

function extract(url: string): ExtractResult {
  try {
    return { ok: true, page: extractExternalPage(document, url) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

if (!window.__externalExporterInstalled) {
  window.__externalExporterInstalled = true;
  chrome.runtime.onMessage.addListener((msg: ContentCommand, _sender, sendResponse) => {
    if (!msg || msg.target !== 'external-content') return false;
    switch (msg.cmd) {
      case 'probe':
        sendResponse(probe());
        return false;
      case 'step':
        sendResponse(step(msg.maxClicks));
        return false;
      case 'extract':
        sendResponse(extract(msg.url));
        return false;
      case 'fetch':
        fetchSameOrigin(msg.url, msg.maxBytes).then(sendResponse);
        return true;
      default:
        return false;
    }
  });
}
