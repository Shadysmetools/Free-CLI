import { describe, it, expect } from 'vitest';
import { buildPreview } from './prompt';
import { Verdict } from './types';

const v = (severity: 'normal' | 'warn'): Verdict =>
  ({ decision: 'ask', severity, reasons: ['shell command'], subject: 'x' });

describe('buildPreview', () => {
  it('shows the command for run_command', () => {
    const out = buildPreview('run_command', { command: 'npm test' }, v('normal'));
    expect(out).toContain('npm test');
  });
  it('warn severity includes a warning marker', () => {
    const out = buildPreview('run_command', { command: 'rm -rf x' }, v('warn'));
    expect(out).toContain('⚠');
  });
  it('shows a diff-ish view for edit_file', () => {
    const out = buildPreview('edit_file', { path: 'a.ts', old_text: 'foo', new_text: 'bar' }, v('normal'));
    expect(out).toContain('foo');
    expect(out).toContain('bar');
  });
  it('shows tool name + args for unknown tools', () => {
    const out = buildPreview('weird_tool', { a: 1 }, v('normal'));
    expect(out).toContain('weird_tool');
  });
});
