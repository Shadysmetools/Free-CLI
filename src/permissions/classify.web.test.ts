import { describe, it, expect } from 'vitest';
import { classify } from './classify';
import type { Rules } from './types';

const rules: Rules = { enabled: true, projectRoot: process.cwd(), allow: [], ask: [], deny: [], unattended: 'deny', confirmDefault: 'approve' } as Rules;

describe('web tools permission classification', () => {
  it('web_search is silent (safe read)', () => {
    expect(classify('web_search', { query: 'x' }, process.cwd(), rules).decision).toBe('silent');
  });
  it('web_fetch is silent (safe read)', () => {
    expect(classify('web_fetch', { url: 'https://x.com' }, process.cwd(), rules).decision).toBe('silent');
  });
  it('a user deny rule still blocks web_fetch', () => {
    const denied = { ...rules, deny: ['web_fetch'] } as Rules;
    expect(classify('web_fetch', { url: 'https://x.com' }, process.cwd(), denied).decision).toBe('block');
  });
});
