import { describe, it, expect } from 'vitest';
import { applyEdit } from './tools';

describe('applyEdit', () => {
  it('replaces a unique occurrence', () => {
    const r = applyEdit('hello world', 'world', 'there');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe('hello there');
  });

  it('errors when the text is not found', () => {
    const r = applyEdit('abc', 'xyz', 'q');
    expect(r.ok).toBe(false);
  });

  it('errors (ambiguous) when the text appears multiple times — no silent corruption', () => {
    const r = applyEdit('count++\ncount++\n', 'count++', 'count--');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/2|ambiguous|occurrence/i);
  });

  it('errors on empty old_text', () => {
    const r = applyEdit('abc', '', 'x');
    expect(r.ok).toBe(false);
  });

  it('replaces a unique multi-line block', () => {
    const r = applyEdit('a\nOLD\nb', 'OLD', 'NEW');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe('a\nNEW\nb');
  });
});
