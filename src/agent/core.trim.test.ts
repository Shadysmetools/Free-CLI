import { describe, it, expect } from 'vitest';
import { trimMessages } from './core';

// trimMessages only reads m.role and m.content, so minimal shapes suffice.
type M = { role: string; content: string; tool_call_id?: string; name?: string; tool_calls?: unknown };

describe('trimMessages', () => {
  it('returns messages unchanged when under the limit', () => {
    const msgs: M[] = [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }];
    const out = trimMessages(msgs as never, 1000);
    expect(out.length).toBe(2);
  });

  it('never leaves an orphaned tool result at the front of the kept window', () => {
    const msgs: M[] = [
      { role: 'user', content: 'x'.repeat(100) },
      { role: 'assistant', content: 'a', tool_calls: [{ id: 't1' }] },
      { role: 'tool', content: 'y'.repeat(100), tool_call_id: 't1', name: 'read_file' },
    ];
    const out = trimMessages(msgs as never, 50, 1) as unknown as M[];
    const nonSys = out.filter(m => m.role !== 'system');
    if (nonSys.length) expect(nonSys[0].role).not.toBe('tool');
  });

  it('keeps system messages even when trimming hard', () => {
    const msgs: M[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'x'.repeat(200) },
      { role: 'user', content: 'y'.repeat(200) },
    ];
    const out = trimMessages(msgs as never, 50, 1) as unknown as M[];
    expect(out.some(m => m.role === 'system')).toBe(true);
  });

  it('truncates long tool results in place', () => {
    const big: M = { role: 'tool', content: 'z'.repeat(1000), tool_call_id: 't', name: 'x' };
    const msgs: M[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'a', tool_calls: [{ id: 't' }] },
      big,
    ];
    trimMessages(msgs as never, 100000);
    expect(big.content.length).toBeLessThan(1000);
  });
});
