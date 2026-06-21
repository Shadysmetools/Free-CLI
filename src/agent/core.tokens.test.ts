import { describe, it, expect } from 'vitest';
import { estimateTokens, trimMessages, CONTEXT_TOKEN_LIMITS } from './core';

// Token-aware tests for Feature A. These cover the estimateTokens heuristic and
// the token-budget mode of trimMessages (passing estimateTokens as the measure).
type M = { role: string; content: string; tool_call_id?: string; name?: string; tool_calls?: unknown };

describe('estimateTokens', () => {
  it('returns 0 for empty/whitespace-ish input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('approximates ~1 token per 4 characters (ceil)', () => {
    expect(estimateTokens('abcd')).toBe(1);      // 4 chars  -> 1
    expect(estimateTokens('abcde')).toBe(2);     // 5 chars  -> ceil(1.25) = 2
    expect(estimateTokens('x'.repeat(40))).toBe(10);
  });

  it('grows monotonically with length', () => {
    expect(estimateTokens('x'.repeat(100))).toBeGreaterThan(estimateTokens('x'.repeat(10)));
  });
});

describe('CONTEXT_TOKEN_LIMITS', () => {
  it('exposes per-provider token budgets', () => {
    expect(CONTEXT_TOKEN_LIMITS.ollama).toBeGreaterThan(0);
    expect(CONTEXT_TOKEN_LIMITS.anthropic).toBeGreaterThan(CONTEXT_TOKEN_LIMITS.ollama);
    // budgets are token counts, so meaningfully smaller than the old char counts
    expect(CONTEXT_TOKEN_LIMITS.anthropic).toBeLessThanOrEqual(200_000);
  });
});

describe('trimMessages with a token measure', () => {
  it('trims by ESTIMATED TOKENS when given estimateTokens as the measure', () => {
    // 4000 chars ≈ 1000 tokens each. A 1500-token budget keeps ~1 of them past minKeep.
    const msgs: M[] = [
      { role: 'user', content: 'a'.repeat(4000) },
      { role: 'user', content: 'b'.repeat(4000) },
      { role: 'user', content: 'c'.repeat(4000) },
    ];
    const out = trimMessages(msgs as never, 1500, 1, estimateTokens) as unknown as M[];
    const totalTokens = out
      .filter(m => m.role !== 'system')
      .reduce((s, m) => s + estimateTokens(m.content), 0);
    expect(totalTokens).toBeLessThanOrEqual(1500);
    expect(out.length).toBeLessThan(3);
  });

  it('does NOT trim under a token budget the messages fit within', () => {
    const msgs: M[] = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'short' },
    ];
    const out = trimMessages(msgs as never, 1000, 1, estimateTokens);
    expect(out.length).toBe(2);
  });

  it('still protects the tool-pairing invariant in token mode', () => {
    const msgs: M[] = [
      { role: 'user', content: 'x'.repeat(4000) },
      { role: 'assistant', content: 'a', tool_calls: [{ id: 't1' }] },
      { role: 'tool', content: 'y'.repeat(4000), tool_call_id: 't1', name: 'read_file' },
    ];
    const out = trimMessages(msgs as never, 200, 1, estimateTokens) as unknown as M[];
    const nonSys = out.filter(m => m.role !== 'system');
    if (nonSys.length) expect(nonSys[0].role).not.toBe('tool');
  });
});
