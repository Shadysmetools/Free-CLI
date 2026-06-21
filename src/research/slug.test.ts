import { describe, it, expect } from 'vitest';
import { slugify } from './index';

describe('slugify', () => {
  it('lowercases, replaces non-alphanumerics with hyphens, trims, caps length', () => {
    expect(slugify('What is TypeScript??')).toBe('what-is-typescript');
    expect(slugify('  a/b c  ')).toBe('a-b-c');
    expect(slugify('x'.repeat(80)).length).toBeLessThanOrEqual(50);
  });
  it('never produces an empty string', () => {
    expect(slugify('???').length).toBeGreaterThan(0);
  });
});
