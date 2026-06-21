import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './conversation';

describe('buildSystemPrompt — skillsCatalog block', () => {
  it('appends the skills catalog when provided', () => {
    const prompt = buildSystemPrompt({ cwd: process.cwd(), skillsCatalog: '\n\n## Available Skills\n- github — gh ops\n' });
    expect(prompt).toContain('## Available Skills');
    expect(prompt).toContain('- github — gh ops');
  });
  it('omits it when not provided', () => {
    const prompt = buildSystemPrompt({ cwd: process.cwd() });
    expect(prompt).not.toContain('## Available Skills');
  });
});
