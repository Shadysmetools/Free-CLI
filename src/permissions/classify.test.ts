import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { classify } from './classify';
import { defaultRules } from './rules';

const ROOT = path.resolve('C:/proj');
const R = () => defaultRules(ROOT);

describe('classify default buckets', () => {
  it('read_file -> silent', () => {
    expect(classify('read_file', { path: 'a.ts' }, ROOT, R()).decision).toBe('silent');
  });
  it('in-project write_file -> silent', () => {
    expect(classify('write_file', { path: 'src/a.ts', content: 'x' }, ROOT, R()).decision).toBe('silent');
  });
  it('out-of-project write_file -> ask + warn', () => {
    const v = classify('write_file', { path: 'C:/Windows/x.txt', content: 'x' }, ROOT, R());
    expect(v.decision).toBe('ask');
    expect(v.severity).toBe('warn');
  });
  it('run_command -> ask (normal)', () => {
    const v = classify('run_command', { command: 'npm test' }, ROOT, R());
    expect(v.decision).toBe('ask');
    expect(v.severity).toBe('normal');
  });
  it('destructive run_command -> ask + warn', () => {
    expect(classify('run_command', { command: 'rm -rf build' }, ROOT, R()).severity).toBe('warn');
  });
  it('git_commit -> ask', () => {
    expect(classify('git_commit', { message: 'x' }, ROOT, R()).decision).toBe('ask');
  });
  it('unknown / MCP tool -> ask', () => {
    expect(classify('some_mcp_tool', { foo: 1 }, ROOT, R()).decision).toBe('ask');
  });
});

describe('classify rules precedence', () => {
  it('user deny -> block', () => {
    const r = R(); r.deny = ['npm *'];
    expect(classify('run_command', { command: 'npm test' }, ROOT, r).decision).toBe('block');
  });
  it('user allow -> silent', () => {
    const r = R(); r.allow = ['npm test'];
    expect(classify('run_command', { command: 'npm test' }, ROOT, r).decision).toBe('silent');
  });
  it('catastrophic DEFAULT_DENY -> block', () => {
    expect(classify('run_command', { command: 'rm -rf /' }, ROOT, R()).decision).toBe('block');
  });
  it('user allow overrides catastrophic DEFAULT_DENY', () => {
    const r = R(); r.allow = ['rm -rf /'];
    expect(classify('run_command', { command: 'rm -rf /' }, ROOT, r).decision).toBe('silent');
  });
  it('user ask forces a normally-silent tool to ask', () => {
    const r = R(); r.ask = ['read_file *'];
    expect(classify('read_file', { path: 'a.ts' }, ROOT, r).decision).toBe('ask');
  });
  it('disabled -> everything silent', () => {
    const r = R(); r.enabled = false;
    expect(classify('run_command', { command: 'rm -rf /' }, ROOT, r).decision).toBe('silent');
  });
});
