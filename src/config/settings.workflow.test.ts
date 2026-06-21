import { describe, it, expect } from 'vitest';
import { getDefaultSettings } from './settings';

describe('settings.workflows defaults', () => {
  it('provides workflow concurrency + goal defaults', () => {
    const s = getDefaultSettings();
    expect(s.workflows?.concurrency?.ollama).toBe(1);
    expect(s.workflows?.concurrency?.default).toBe(4);
    expect(s.workflows?.goal?.maxRounds).toBe(5);
  });
});
