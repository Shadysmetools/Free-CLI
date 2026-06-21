import { describe, it, expect } from 'vitest';
import { getRole } from './roles';

describe('workflow roles', () => {
  it('orchestrator exists and can spawn sub-agents', () => {
    const r = getRole('orchestrator');
    expect(r).toBeDefined();
    expect(r!.allowedTools).toContain('spawn_agent');
    expect(r!.allowedTools).toContain('run_parallel');
    expect(r!.systemPrompt).toMatch(/self-contained/i);
  });
  it('verifier exists and is read+run only (last-resort judge)', () => {
    const r = getRole('verifier');
    expect(r).toBeDefined();
    expect(r!.allowedTools).toContain('run_command');
    expect(r!.allowedTools).not.toContain('write_file');
  });
});
