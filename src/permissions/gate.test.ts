import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import { gate } from './gate';
import { defaultRules } from './rules';
import { GateContext, ConfirmChoice } from './types';

const ROOT = path.resolve('C:/proj');

function ctx(over: Partial<GateContext> = {}, choice: ConfirmChoice = { kind: 'yes' }): GateContext {
  return {
    cwd: ROOT,
    rules: defaultRules(ROOT),
    isInteractive: true,
    sessionAllow: new Set<string>(),
    confirm: vi.fn(async () => choice),
    persistAllow: vi.fn(),
    ...over,
  };
}

describe('gate', () => {
  it('silent verdict -> allowed, no prompt', async () => {
    const c = ctx();
    const r = await gate('read_file', { path: 'a.ts' }, c);
    expect(r.allowed).toBe(true);
    expect(c.confirm).not.toHaveBeenCalled();
  });

  it('block verdict -> denied with reason', async () => {
    const r = await gate('run_command', { command: 'rm -rf /' }, ctx());
    expect(r.allowed).toBe(false);
    expect(r.reasonForModel).toMatch(/block|denied|rules/i);
  });

  it('ask + confirm yes -> allowed', async () => {
    const r = await gate('run_command', { command: 'npm test' }, ctx({}, { kind: 'yes' }));
    expect(r.allowed).toBe(true);
  });

  it('ask + confirm no -> denied with reason', async () => {
    const r = await gate('run_command', { command: 'npm test' }, ctx({}, { kind: 'no' }));
    expect(r.allowed).toBe(false);
    expect(r.reasonForModel).toMatch(/declined/i);
  });

  it('session: second identical call is silent', async () => {
    const c = ctx({}, { kind: 'session' });
    await gate('run_command', { command: 'npm test' }, c);
    (c.confirm as ReturnType<typeof vi.fn>).mockClear();
    const r2 = await gate('run_command', { command: 'npm test' }, c);
    expect(r2.allowed).toBe(true);
    expect(c.confirm).not.toHaveBeenCalled();
  });

  it('persist: calls persistAllow and allows', async () => {
    const c = ctx({}, { kind: 'persist' });
    const r = await gate('run_command', { command: 'npm test' }, c);
    expect(r.allowed).toBe(true);
    expect(c.persistAllow).toHaveBeenCalledWith('npm test');
  });

  it('non-interactive + unattended deny -> denied', async () => {
    const c = ctx({ isInteractive: false });
    const r = await gate('run_command', { command: 'npm test' }, c);
    expect(r.allowed).toBe(false);
    expect(r.reasonForModel).toMatch(/unattended/i);
  });

  it('non-interactive + unattended allow -> allowed', async () => {
    const c = ctx({ isInteractive: false });
    c.rules.unattended = 'allow';
    const r = await gate('run_command', { command: 'npm test' }, c);
    expect(r.allowed).toBe(true);
  });

  it('confirm throws -> denied for safety', async () => {
    const c = ctx();
    c.confirm = vi.fn(async () => { throw new Error('no tty'); });
    const r = await gate('run_command', { command: 'npm test' }, c);
    expect(r.allowed).toBe(false);
  });
});
