import { describe, it, expect } from 'vitest';
import { getDefaultSettings } from './settings';

describe('settings.research defaults', () => {
  it('provides research defaults', () => {
    const s = getDefaultSettings() as any;
    expect(s.research.maxQueries).toBe(5);
    expect(s.research.maxSources).toBe(8);
  });
});
