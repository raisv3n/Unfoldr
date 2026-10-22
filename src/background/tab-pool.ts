// Crawler tabs. Never uses the user's active tab: either one unfocused window per slot
// (default — a window's active tab keeps rendering, which Notion needs for lazy content)
// or inactive background tabs in the user's window.

import type { CrawlSurface } from '../shared/settings';

const SESSION_KEY = 'crawlerTabs';

/** Closes crawler tabs/windows left behind by a service worker that was restarted mid-export. */
export async function closeOrphanedCrawlerTabs(): Promise<void> {
  const stored = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] as { tabs: number[]; windows: number[] } | undefined;
  if (!stored) return;
  for (const w of stored.windows) await chrome.windows.remove(w).catch(() => undefined);
  for (const t of stored.tabs) await chrome.tabs.remove(t).catch(() => undefined);
  await chrome.storage.session.remove(SESSION_KEY);
}

export interface Slot {
  index: number;
  tabId: number;
  windowId?: number;
  busy: boolean;
  lastUrl?: string;
}

export class TabPool {
  private slots: Slot[] = [];
  private waiters: ((slot: Slot) => void)[] = [];
  private closed = false;
  private readonly onRemoved = (tabId: number) => {
    const slot = this.slots.find((s) => s.tabId === tabId);
    if (slot) slot.tabId = -1;
  };

  constructor(
    private readonly surface: CrawlSurface,
    private readonly size: number,
    private readonly originWindowId?: number,
  ) {}

  async open(): Promise<void> {
    chrome.tabs.onRemoved.addListener(this.onRemoved);
    for (let i = 0; i < this.size; i++) this.slots.push(await this.createSlot(i));
    await this.remember();
  }

  private async remember(): Promise<void> {
    const windows = this.surface === 'window' ? this.slots.flatMap((s) => (s.windowId === undefined ? [] : [s.windowId])) : [];
    const tabs = this.surface === 'window' ? [] : this.slots.map((s) => s.tabId).filter((t) => t >= 0);
    await chrome.storage.session.set({ [SESSION_KEY]: { tabs, windows } }).catch(() => undefined);
  }

  private async createSlot(index: number): Promise<Slot> {
    if (this.surface === 'window') {
      const base: chrome.windows.CreateData = { url: 'about:blank', focused: false, type: 'normal' };
      // Preferred size/offset; small screens reject out-of-bounds windows, so fall back to defaults.
      const w = await chrome.windows
        .create({ ...base, width: 1100, height: 860, left: 60 + index * 48, top: 60 + index * 48 })
        .catch(() => chrome.windows.create(base));
      const tabId = w?.tabs?.[0]?.id;
      if (tabId === undefined || w?.id === undefined) throw new Error('Could not create export window');
      await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => undefined);
      return { index, tabId, windowId: w.id, busy: false };
    }
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false, windowId: this.originWindowId });
    if (tab.id === undefined) throw new Error('Could not create export tab');
    await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
    return { index, tabId: tab.id, windowId: tab.windowId, busy: false };
  }

  /** Recreates a slot's tab if the user closed it. */
  private async ensureAlive(slot: Slot): Promise<void> {
    if (slot.tabId >= 0) {
      const alive = await chrome.tabs.get(slot.tabId).then(() => true, () => false);
      if (alive) return;
    }
    const fresh = await this.createSlot(slot.index);
    slot.tabId = fresh.tabId;
    slot.windowId = fresh.windowId;
    slot.lastUrl = undefined;
    await this.remember();
  }

  async acquire(): Promise<Slot> {
    if (this.closed) throw new Error('Tab pool closed');
    const free = this.slots.find((s) => !s.busy);
    const slot = free ?? (await new Promise<Slot>((resolve) => this.waiters.push(resolve)));
    slot.busy = true;
    await this.ensureAlive(slot);
    return slot;
  }

  release(slot: Slot): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(slot);
    else slot.busy = false;
  }

  /** A crawler tab currently showing a page on `origin` (for same-origin asset fallback). */
  findOnOrigin(origin: string): Slot | undefined {
    return this.slots.find((s) => {
      if (s.tabId < 0 || !s.lastUrl) return false;
      try {
        return new URL(s.lastUrl).origin === origin;
      } catch {
        return false;
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    chrome.tabs.onRemoved.removeListener(this.onRemoved);
    for (const s of this.slots) {
      if (s.tabId < 0) continue;
      if (this.surface === 'window' && s.windowId !== undefined) await chrome.windows.remove(s.windowId).catch(() => undefined);
      else await chrome.tabs.remove(s.tabId).catch(() => undefined);
    }
    this.slots = [];
    await chrome.storage.session.remove(SESSION_KEY).catch(() => undefined);
  }
}
