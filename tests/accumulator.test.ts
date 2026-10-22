import { describe, expect, it } from 'vitest';
import { BlockAccumulator, mergeOrder } from '../src/content/accumulator';
import type { RawBlock } from '../src/shared/raw';

const b = (id: string, extra: Partial<RawBlock> = {}): RawBlock => ({ id, type: 'text', children: [], ...extra });

describe('mergeOrder', () => {
  it('merges overlapping scroll windows in page order', () => {
    const order: string[] = [];
    mergeOrder(order, ['a', 'b', 'c', 'd']);
    mergeOrder(order, ['c', 'd', 'e', 'f']);
    mergeOrder(order, ['f', 'g']);
    expect(order).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('inserts blocks that appear before known ones (scrolling up / late-rendered blocks)', () => {
    const order = ['c', 'd'];
    mergeOrder(order, ['a', 'b', 'c']);
    mergeOrder(order, ['d', 'd2', 'e']);
    mergeOrder(order, ['b', 'b2', 'c']);
    expect(order).toEqual(['a', 'b', 'b2', 'c', 'd', 'd2', 'e']);
  });

  it('appends disjoint windows', () => {
    const order = ['a'];
    mergeOrder(order, ['x', 'y']);
    expect(order).toEqual(['a', 'x', 'y']);
  });
});

describe('BlockAccumulator', () => {
  it('keeps every block seen across virtualized windows, preferring the most complete rendering', () => {
    const acc = new BlockAccumulator();
    acc.add([b('t1', { type: 'toggle', toggleable: true, expanded: false }), b('p1')]);
    acc.add([b('p1'), b('p2')]);
    acc.add([b('t1', { type: 'toggle', toggleable: true, expanded: true, children: [b('c1')] }), b('p1')]);
    acc.add([b('p2'), b('p3')]);
    const list = acc.list();
    expect(list.map((x) => x.id)).toEqual(['t1', 'p1', 'p2', 'p3']);
    expect(list[0]?.expanded).toBe(true);
    expect(list[0]?.children.map((c) => c.id)).toEqual(['c1']);
  });
});
