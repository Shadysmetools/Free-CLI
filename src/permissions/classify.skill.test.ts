import { describe, it, expect } from 'vitest';
import { classify } from './classify';

const root = process.cwd();
const baseRules = { enabled: true, allow: [] as string[], ask: [] as string[], deny: [] as string[] };

describe('classify — skill tool', () => {
  it('is silent (safe) by default', () => {
    const v = classify('skill', { name: 'github' }, root, baseRules as never);
    expect(v.decision).toBe('silent');
  });
  it('is still blocked by a user deny rule', () => {
    const v = classify('skill', { name: 'github' }, root, { ...baseRules, deny: ['skill'] } as never);
    expect(v.decision).toBe('block');
  });
});
