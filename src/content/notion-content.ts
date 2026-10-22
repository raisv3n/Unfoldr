// Content script injected (on demand, via chrome.scripting) into crawler tabs showing Notion pages.
// Each command does a small, bounded amount of work; the service worker drives the loop and timing.

import type { ContentCommand, ExtractResult, ProbeResult, StepResult } from '../shared/messages';
import { BlockAccumulator } from './accumulator';
import {
  collapsedToggleButtons,
  countBlocks,
  detectAccessState,
  extractPage,
  extractTopLevel,
  findRootBlock,
  getFrame,
  loadMoreButtons,
  toggleButtonOf,
} from './notion-dom';
import { NOTION } from './notion-selectors';
import { fetchSameOrigin } from './in-tab-fetch';

interface ContentState {
  opened: string[];
  clickedLoadMore: WeakSet<Element>;
  maxBlockCount: number;
  acc: BlockAccumulator;
}

declare global {
  interface Window {
    __notionExporterInstalled?: boolean;
    __notionExporterState?: ContentState;
  }
}

function state(): ContentState {
  window.__notionExporterState ??= { opened: [], clickedLoadMore: new WeakSet(), maxBlockCount: 0, acc: new BlockAccumulator() };
  return window.__notionExporterState;
}

function scroller(): HTMLElement | null {
  return getFrame(document)?.querySelector<HTMLElement>(NOTION.scroller) ?? null;
}

function probe(): ProbeResult {
  const root = findRootBlock(document);
  return {
    state: detectAccessState(document),
    pageId: root?.getAttribute('data-block-id') ?? undefined,
    title: root?.querySelector('h1')?.textContent?.trim() ?? undefined,
    blockCount: countBlocks(document),
    url: location.href,
  };
}

function step(cmd: Extract<ContentCommand, { cmd: 'step'; target: 'notion-content' }>): StepResult {
  const st = state();
  let clicked = 0;
  // Capture what is rendered now: Notion unmounts blocks that scroll far out of view.
  st.acc.add(extractTopLevel(document));

  if (cmd.expandToggles) {
    for (const btn of collapsedToggleButtons(document)) {
      if (clicked >= cmd.maxClicks) break;
      const block = btn.closest(NOTION.block);
      const id = block?.getAttribute('data-block-id');
      if (!id || st.opened.includes(id)) continue;
      st.opened.push(id);
      btn.click();
      clicked++;
    }
  }

  if (cmd.loadMore) {
    for (const btn of loadMoreButtons(document)) {
      if (clicked >= cmd.maxClicks || st.clickedLoadMore.has(btn)) continue;
      st.clickedLoadMore.add(btn);
      btn.click();
      clicked++;
    }
  }

  const sc = scroller();
  let atBottom = true;
  if (sc) {
    // Never scroll in the same step as clicking: opened content must render (and be captured) first.
    if (clicked === 0) sc.scrollTop = Math.min(sc.scrollTop + Math.max(400, sc.clientHeight * 1.2), sc.scrollHeight);
    atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4;
  }
  const blockCount = countBlocks(document);
  st.maxBlockCount = Math.max(st.maxBlockCount, blockCount);
  return {
    blockCount,
    collapsedRemaining: cmd.expandToggles ? collapsedToggleButtons(document).filter((b) => !st.opened.includes(b.closest(NOTION.block)?.getAttribute('data-block-id') ?? '')).length : 0,
    clicked,
    atBottom,
    scrollHeight: sc?.scrollHeight ?? 0,
  };
}

function extract(url: string): ExtractResult {
  try {
    const st = state();
    st.acc.add(extractTopLevel(document));
    return { ok: true, page: extractPage(document, { url, togglesOpened: st.opened.length, maxBlockCountSeen: st.maxBlockCount, accumulated: st.acc.list() }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Re-collapse toggles this exporter opened (deepest first), leaving the page as the user had it. */
function restore(): { restored: number } {
  const st = state();
  let restored = 0;
  for (const id of [...st.opened].reverse()) {
    const block = document.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
    const btn = block ? toggleButtonOf(block) : undefined;
    if (btn?.getAttribute('aria-expanded') === 'true') {
      btn.click();
      restored++;
    }
  }
  st.opened = [];
  return { restored };
}

if (!window.__notionExporterInstalled) {
  window.__notionExporterInstalled = true;
  chrome.runtime.onMessage.addListener((msg: ContentCommand, _sender, sendResponse) => {
    if (!msg || msg.target !== 'notion-content') return false;
    switch (msg.cmd) {
      case 'probe':
        sendResponse(probe());
        return false;
      case 'step':
        sendResponse(step(msg));
        return false;
      case 'extract':
        sendResponse(extract(msg.url));
        return false;
      case 'restore':
        sendResponse(restore());
        return false;
      case 'fetch':
        fetchSameOrigin(msg.url, msg.maxBytes).then(sendResponse);
        return true;
      default:
        return false;
    }
  });
}
