import { describe, it, expect } from 'vitest';
import { getRole } from './roles';

describe('researcher role', () => {
  it('exists with minimal web tools', () => {
    const r = getRole('researcher');
    expect(r).toBeDefined();
    expect(r!.allowedTools).toContain('web_search');
    expect(r!.allowedTools).toContain('web_fetch');
    expect(r!.systemPrompt).toMatch(/cite/i);
  });
});
