// Notion virtualizes long pages: blocks scrolled out of view are unmounted. The accumulator
// collects top-level blocks from every scroll position and merges them, in page order, by ID.

import type { RawBlock } from '../shared/raw';

/**
 * Merges an ordered window of IDs into an ordered list. Windows come from contiguous rendered ranges
 * of the same page, so relative order is consistent and windows overlap or are adjacent.
 */
export function mergeOrder(order: string[], window: string[]): void {
  const known = new Set(order);
  let cursor = -1; // index in `order` after which new IDs are inserted
  for (let i = 0; i < window.length; i++) {
    const id = window[i]!;
    if (known.has(id)) {
      cursor = order.indexOf(id);
      continue;
    }
    if (cursor === -1) {
      // Before any known ID in this window: insert before the next known ID, or append.
      const nextKnown = window.slice(i + 1).find((x) => known.has(x));
      const at = nextKnown ? order.indexOf(nextKnown) : order.length;
      order.splice(at, 0, id);
      cursor = at;
    } else {
      order.splice(cursor + 1, 0, id);
      cursor++;
    }
    known.add(id);
  }
}

function weight(b: RawBlock): number {
  let n = 1 + (b.text?.length ?? 0) + (b.collection?.rows.length ?? 0) + (b.expanded ? 1 : 0);
  for (const c of b.children) n += weight(c);
  return n;
}

export class BlockAccumulator {
  private order: string[] = [];
  private blocks = new Map<string, { block: RawBlock; weight: number }>();

  /** Adds the currently rendered top-level blocks (in DOM order). */
  add(window: RawBlock[]): void {
    const ids: string[] = [];
    for (const b of window) {
      if (!b.id) continue;
      ids.push(b.id);
      const w = weight(b);
      const prev = this.blocks.get(b.id);
      // Keep the most complete rendering (e.g. a toggle captured after it was expanded).
      if (!prev || w >= prev.weight) this.blocks.set(b.id, { block: b, weight: w });
    }
    mergeOrder(this.order, ids);
  }

  get size(): number {
    return this.order.length;
  }

  list(): RawBlock[] {
    return this.order.map((id) => this.blocks.get(id)!.block);
  }
}
