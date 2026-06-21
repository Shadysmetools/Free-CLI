import { describe, it, expect } from 'vitest';
import { pLimit, parallel, pipeline } from './primitives';

const defer = (ms: number, v: unknown) => new Promise(r => setTimeout(() => r(v), ms));

describe('pLimit', () => {
  it('never runs more than `concurrency` thunks at once', async () => {
    let active = 0, peak = 0;
    const limit = pLimit(2);
    const make = () => limit(async () => { active++; peak = Math.max(peak, active); await defer(10, 0); active--; return 1; });
    await Promise.all(Array.from({ length: 6 }, make));
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('parallel', () => {
  it('returns results in input order', async () => {
    const out = await parallel([() => defer(20, 'a'), () => defer(5, 'b'), () => defer(10, 'c')], { concurrency: 3 });
    expect(out).toEqual(['a', 'b', 'c']);
  });
  it('maps a throwing thunk to null and never rejects', async () => {
    const out = await parallel([() => Promise.resolve('ok'), () => Promise.reject(new Error('boom'))], { concurrency: 2 });
    expect(out).toEqual(['ok', null]);
  });
  it('defaults concurrency to 1 when unspecified', async () => {
    let active = 0, peak = 0;
    const make = (v: number) => async () => { active++; peak = Math.max(peak, active); await defer(8, 0); active--; return v; };
    const out = await parallel([make(1), make(2), make(3)]);
    expect(peak).toBe(1);
    expect(out).toEqual([1, 2, 3]);
  });
});

describe('pipeline', () => {
  it('flows each item through all stages independently', async () => {
    const out = await pipeline(
      [1, 2, 3],
      async (_prev, item) => item * 10,
      async (prev) => prev + 1,
    );
    expect(out).toEqual([11, 21, 31]);
  });
  it('passes prev / item / index to each stage', async () => {
    const seen: Array<[unknown, unknown, number]> = [];
    await pipeline(['x'], async (prev, item, i) => { seen.push([prev, item, i]); return 'y'; });
    expect(seen).toEqual([[undefined, 'x', 0]]);
  });
  it('drops an item to null when a stage throws and skips its later stages', async () => {
    let stage2Calls = 0;
    const out = await pipeline(
      [1, 2],
      async (_p, item) => { if (item === 2) throw new Error('bad'); return item; },
      async (prev) => { stage2Calls++; return prev + 100; },
    );
    expect(out).toEqual([101, null]);
    expect(stage2Calls).toBe(1);
  });
});
