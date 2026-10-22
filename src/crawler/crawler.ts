// Graph-based crawler. Nodes are keyed by stable page ID when known, otherwise by normalized
// URL (`url:` keys are re-keyed to the page ID once the page has been visited). All discovered
// relationships are kept as edges, including those pointing at already-processed pages.

import { shortHash } from '../shared/hash';
import { normalizeUrlForDedupe, parseNotionUrl } from '../shared/ids';
import type { ExportPage, PageReference, ReferenceKind } from '../shared/model';

export type NodeStatus = 'queued' | 'processing' | 'completed' | 'partial' | 'failed' | 'skipped';
export type SkipReason = 'page-limit' | 'depth-limit' | 'cancelled' | 'not-followed' | 'duplicate';

export interface CrawlNode {
  key: string;
  url: string;
  kind: 'notion' | 'external';
  pageId?: string;
  depth: number;
  status: NodeStatus;
  attempts: number;
  seq: number;
  title?: string;
  error?: string;
  errorCode?: CrawlErrorCode;
  skipReason?: SkipReason;
  aliasOf?: string;
  via?: ReferenceKind;
  discoveredFrom?: string;
  notBefore?: number;
}

export interface CrawlEdge {
  from: string;
  to: string;
  kind: ReferenceKind;
  url: string;
  blockId?: string;
  title?: string;
}

export type CrawlErrorCode = 'inaccessible' | 'login_required' | 'not_found' | 'challenge' | 'timeout' | 'extract' | 'network' | 'cancelled' | 'unsupported';

export class CrawlError extends Error {
  constructor(
    message: string,
    readonly code: CrawlErrorCode,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'CrawlError';
  }
}

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  maxRetries: number;
  followLinks: boolean;
  includeChildPages: boolean;
  includeDatabaseEntries: boolean;
  captureExternal: boolean;
  retryDelayMs?: number;
}

export type PageFetcher = (node: Readonly<CrawlNode>, signal: AbortSignal) => Promise<ExportPage>;

export interface CrawlEvents {
  onPage?: (page: ExportPage, node: Readonly<CrawlNode>) => void | Promise<void>;
  onProgress?: (crawler: Crawler) => void;
}

export interface CrawlSnapshot {
  nodes: CrawlNode[];
  edges: CrawlEdge[];
  aliases: [string, string][];
  limitsHit: string[];
  seq: number;
}

export interface CrawlStats {
  queued: number;
  processing: number;
  completed: number;
  partial: number;
  failed: number;
  skipped: number;
}

export function externalKey(url: string): string {
  return `ext:${shortHash(normalizeUrlForDedupe(url) ?? url, 16)}`;
}

export function notionKeyFor(url: string, pageId?: string): string {
  return pageId ?? `url:${normalizeUrlForDedupe(url) ?? url}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

export class Crawler {
  private nodes = new Map<string, CrawlNode>();
  private aliases = new Map<string, string>();
  private edges: CrawlEdge[] = [];
  private limitsHit = new Set<string>();
  private seq = 0;
  private controller = new AbortController();

  constructor(
    private readonly opts: CrawlOptions,
    private readonly fetcher: PageFetcher,
    private readonly events: CrawlEvents = {},
  ) {}

  // ---- seeding / snapshot ----------------------------------------------------------------------

  seed(url: string): CrawlNode {
    const pageId = parseNotionUrl(url).pageId;
    const node = this.createNode({ key: notionKeyFor(url, pageId), url, kind: 'notion', pageId, depth: 0 });
    this.nodes.set(node.key, node);
    return node;
  }

  static restore(snapshot: CrawlSnapshot, opts: CrawlOptions, fetcher: PageFetcher, events?: CrawlEvents): Crawler {
    const c = new Crawler(opts, fetcher, events);
    for (const n of snapshot.nodes) {
      const node = { ...n };
      if (node.status === 'processing') node.status = 'queued';
      if (node.status === 'skipped' && node.skipReason === 'cancelled') {
        node.status = 'queued';
        node.skipReason = undefined;
      }
      c.nodes.set(node.key, node);
    }
    c.edges = [...snapshot.edges];
    c.aliases = new Map(snapshot.aliases);
    c.limitsHit = new Set(snapshot.limitsHit);
    c.seq = snapshot.seq;
    return c;
  }

  snapshot(): CrawlSnapshot {
    return {
      nodes: [...this.nodes.values()].map((n) => ({ ...n })),
      edges: [...this.edges],
      aliases: [...this.aliases.entries()],
      limitsHit: [...this.limitsHit],
      seq: this.seq,
    };
  }

  // ---- public state ----------------------------------------------------------------------------

  cancel(): void {
    this.controller.abort();
  }

  get cancelled(): boolean {
    return this.controller.signal.aborted;
  }

  resolveKey(key: string): string {
    let k = key;
    for (let i = 0; i < 20 && this.aliases.has(k); i++) k = this.aliases.get(k)!;
    return k;
  }

  getNodes(): CrawlNode[] {
    return [...this.nodes.values()];
  }

  getNode(key: string): CrawlNode | undefined {
    return this.nodes.get(this.resolveKey(key));
  }

  getEdges(): CrawlEdge[] {
    return this.edges.map((e) => ({ ...e, from: this.resolveKey(e.from), to: this.resolveKey(e.to) }));
  }

  getLimitsHit(): string[] {
    return [...this.limitsHit];
  }

  stats(): CrawlStats {
    const s: CrawlStats = { queued: 0, processing: 0, completed: 0, partial: 0, failed: 0, skipped: 0 };
    for (const n of this.nodes.values()) if (!n.aliasOf) s[n.status]++;
    return s;
  }

  // ---- main loop -------------------------------------------------------------------------------

  async run(): Promise<void> {
    const signal = this.controller.signal;
    const inflight = new Set<Promise<void>>();
    while (!signal.aborted) {
      while (inflight.size < Math.max(1, this.opts.concurrency)) {
        const node = this.next();
        if (!node) break;
        const p: Promise<void> = this.process(node).finally(() => inflight.delete(p));
        inflight.add(p);
      }
      const delay = this.nextDelay();
      if (inflight.size === 0 && delay === undefined) break;
      const waiters: Promise<unknown>[] = [...inflight];
      if (delay !== undefined) waiters.push(sleep(Math.max(1, delay), signal));
      await Promise.race(waiters);
    }
    await Promise.allSettled([...inflight]);
    if (signal.aborted) {
      for (const n of this.nodes.values()) {
        if (n.status === 'queued' || n.status === 'processing') {
          n.status = 'skipped';
          n.skipReason = 'cancelled';
        }
      }
      this.limitsHit.add('cancelled');
    }
    this.events.onProgress?.(this);
  }

  private next(): CrawlNode | undefined {
    const now = Date.now();
    let best: CrawlNode | undefined;
    for (const n of this.nodes.values()) {
      if (n.status !== 'queued' || n.aliasOf || (n.notBefore && n.notBefore > now)) continue;
      if (
        !best ||
        (n.kind === 'notion' && best.kind === 'external') ||
        (n.kind === best.kind && (n.depth < best.depth || (n.depth === best.depth && n.seq < best.seq)))
      ) {
        best = n;
      }
    }
    return best;
  }

  private nextDelay(): number | undefined {
    const now = Date.now();
    let min: number | undefined;
    for (const n of this.nodes.values()) {
      if (n.status === 'queued' && !n.aliasOf && n.notBefore && n.notBefore > now) {
        min = Math.min(min ?? Infinity, n.notBefore - now);
      }
    }
    return min;
  }

  private async process(node: CrawlNode): Promise<void> {
    node.status = 'processing';
    node.attempts++;
    node.notBefore = undefined;
    this.events.onProgress?.(this);
    let page: ExportPage;
    try {
      page = await this.fetcher(node, this.controller.signal);
    } catch (e) {
      this.handleFailure(node, e);
      this.events.onProgress?.(this);
      return;
    }
    const target = this.adopt(node, page);
    if (target) {
      target.title = page.title;
      target.pageId = page.pageId ?? target.pageId;
      target.status = page.status === 'partial' ? 'partial' : 'completed';
      target.error = undefined;
      target.errorCode = undefined;
      try {
        await this.events.onPage?.(page, target);
      } catch (err) {
        target.status = 'failed';
        target.error = `Failed to store page: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (!this.cancelled) this.discover(target, page.references);
    }
    this.events.onProgress?.(this);
  }

  private handleFailure(node: CrawlNode, e: unknown): void {
    const err = e instanceof CrawlError ? e : new CrawlError(e instanceof Error ? e.message : String(e), 'extract', true);
    node.error = err.message;
    node.errorCode = err.code;
    if (err.code === 'cancelled' || this.cancelled) {
      node.status = 'skipped';
      node.skipReason = 'cancelled';
      return;
    }
    if (err.retryable && node.attempts <= this.opts.maxRetries) {
      node.status = 'queued';
      node.notBefore = Date.now() + (this.opts.retryDelayMs ?? 1500) * node.attempts;
      return;
    }
    node.status = 'failed';
  }

  /**
   * Reconciles the fetched page's identity with the node. Returns the node that owns the
   * result, or undefined when the page was already handled under another key (duplicate).
   */
  private adopt(node: CrawlNode, page: ExportPage): CrawlNode | undefined {
    const newKey = page.key;
    if (newKey === node.key) return node;
    const existing = this.nodes.get(this.resolveKey(newKey));
    if (!existing || existing === node) {
      this.nodes.delete(node.key);
      this.aliases.set(node.key, newKey);
      node.key = newKey;
      this.nodes.set(newKey, node);
      return node;
    }
    // Another node already represents this page.
    node.aliasOf = existing.key;
    node.status = 'skipped';
    node.skipReason = 'duplicate';
    this.aliases.set(node.key, existing.key);
    if (existing.status === 'queued' || existing.status === 'failed' || existing.status === 'skipped') {
      existing.depth = Math.min(existing.depth, node.depth);
      existing.skipReason = undefined;
      existing.attempts = Math.max(existing.attempts, 1);
      return existing;
    }
    return undefined;
  }

  private follows(kind: ReferenceKind): boolean {
    switch (kind) {
      case 'child_page':
      case 'child_database':
        return this.opts.includeChildPages;
      case 'database_entry':
        return this.opts.includeDatabaseEntries;
      case 'link':
      case 'mention':
      case 'link_to_page':
        return this.opts.followLinks;
      case 'external':
        return this.opts.captureExternal;
      case 'synced_block':
        return false;
    }
  }

  private countsTowardLimit(): number {
    let n = 0;
    for (const node of this.nodes.values()) if (!node.aliasOf && node.status !== 'skipped') n++;
    return n;
  }

  private discover(from: CrawlNode, refs: PageReference[]): void {
    for (const ref of refs) {
      if (!ref.url && !ref.pageId) continue;
      const isExternal = ref.kind === 'external';
      const key = isExternal ? externalKey(ref.url) : notionKeyFor(ref.url, ref.pageId);
      const resolved = this.resolveKey(key);
      this.edges.push({ from: from.key, to: resolved, kind: ref.kind, url: ref.url, blockId: ref.blockId, title: ref.title });

      // External pages are leaves: their links are recorded as edges but never followed.
      const follow = this.follows(ref.kind) && from.kind === 'notion';
      if (isExternal && !follow) continue; // recorded as an edge only
      const depth = from.depth + 1;
      const existing = this.nodes.get(resolved);
      if (existing) {
        const requeue = follow && existing.status === 'skipped' && (existing.skipReason === 'not-followed' || (existing.skipReason === 'depth-limit' && depth <= this.opts.maxDepth));
        if (!requeue) continue;
        if (this.countsTowardLimit() >= this.opts.maxPages) {
          existing.skipReason = 'page-limit';
          this.limitsHit.add('maxPages');
          continue;
        }
        existing.status = 'queued';
        existing.skipReason = undefined;
        existing.depth = depth;
        continue;
      }
      const node = this.createNode({
        key: resolved,
        url: ref.url || `https://www.notion.so/${ref.pageId}`,
        kind: isExternal ? 'external' : 'notion',
        pageId: ref.pageId,
        depth,
        via: ref.kind,
        discoveredFrom: from.key,
        title: ref.title,
      });
      if (!follow) {
        node.status = 'skipped';
        node.skipReason = 'not-followed';
      } else if (depth > this.opts.maxDepth) {
        node.status = 'skipped';
        node.skipReason = 'depth-limit';
        this.limitsHit.add('maxDepth');
      } else if (this.countsTowardLimit() >= this.opts.maxPages) {
        node.status = 'skipped';
        node.skipReason = 'page-limit';
        this.limitsHit.add('maxPages');
      }
      this.nodes.set(node.key, node);
    }
  }

  private createNode(init: Pick<CrawlNode, 'key' | 'url' | 'kind' | 'depth'> & Partial<CrawlNode>): CrawlNode {
    return { status: 'queued', attempts: 0, seq: this.seq++, ...init };
  }
}
