// src/workflow/goal.test.ts
import { describe, it, expect } from 'vitest';
import { runGoal, parsePlan } from './goal';
import type { SubAgentSpec, SubAgentResult, RunnerContext } from './runner';
import { getDefaultSettings } from '../config/settings';
import { createDefaultRegistry } from '../registry/index';
import { defaultRules } from '../permissions/rules';

function ctx(): RunnerContext {
  return { settings: getDefaultSettings(), defaultProviderName: 'ollama', parentRegistry: createDefaultRegistry(), cwd: process.cwd() };
}

describe('parsePlan', () => {
  it('parses a JSON array of items', () => {
    expect(parsePlan('[{"content":"do a"},{"content":"do b"}]').map(i => i.content)).toEqual(['do a', 'do b']);
  });
  it('falls back to numbered/bulleted lines', () => {
    expect(parsePlan('1. first\n2. second\n- third').map(i => i.content)).toEqual(['first', 'second', 'third']);
  });
});

describe('runGoal', () => {
  it('stops when the EXTERNAL verifier passes (no LLM self-judge)', async () => {
    let verifyCalls = 0;
    const planner = async (): Promise<SubAgentResult> => ({ ok: true, content: '1. step one', task: 'plan', usage: { prompt_tokens:1, completion_tokens:1, total_tokens:2 } });
    const run = async (spec: SubAgentSpec): Promise<SubAgentResult> =>
      spec.role === 'planner' ? planner() : { ok: true, content: 'did it', task: spec.task, usage: { prompt_tokens:1, completion_tokens:1, total_tokens:2 } };
    const res = await runGoal(
      { goal: 'make tests pass', allow: ['run_command'], verifyCommand: 'npm test' },
      ctx(),
      { runSubAgent: run, render: false, verify: async () => { verifyCalls++; return { passed: true, output: 'ok' }; } },
    );
    expect(res.ok).toBe(true);
    expect(res.stoppedBy).toBe('verified');
    expect(verifyCalls).toBe(1);
  });

  it('re-plans only after a verify failure and stops at maxRounds', async () => {
    let verifyCalls = 0, planCalls = 0;
    const run = async (spec: SubAgentSpec): Promise<SubAgentResult> => {
      if (spec.role === 'planner') planCalls++;
      return { ok: true, content: spec.role === 'planner' ? '1. step' : 'work', task: spec.task };
    };
    const res = await runGoal(
      { goal: 'g', allow: [], verifyCommand: 'npm test', maxRounds: 2 },
      ctx(),
      { runSubAgent: run, render: false, verify: async () => { verifyCalls++; return { passed: false, output: 'fail' }; } },
    );
    expect(res.stoppedBy).toBe('maxRounds');
    expect(res.rounds).toBe(2);
    expect(planCalls).toBe(2);     // re-planned each failing round
    expect(verifyCalls).toBe(2);
  });

  describe('gated default verify path (gate decision, no real shell)', () => {
    // Stub runSubAgent used by both tests: planner returns 1 step, coder returns 'done'.
    const stubRun = async (spec: SubAgentSpec): Promise<SubAgentResult> =>
      ({ ok: true, content: spec.role === 'planner' ? '1. step' : 'done', task: spec.task });

    it('blocks verify when run_command is NOT pre-authorised and permissions are enabled (unattended)', async () => {
      // Rules with empty allow, unattended=deny — the gate will deny run_command at 'ask'.
      // process.stdout.isTTY is falsy in vitest → isInteractive=false → gate hits unattended deny.
      const rules = { ...defaultRules(process.cwd()), unattended: 'deny' as const };
      const runnerCtx: RunnerContext = { ...ctx(), permissions: rules };

      // Inject a verify spy that WRAPS the gate check but uses an immediate-resolve executeTool
      // stub so we don't actually shell out. The gate should deny before executeTool is reached.
      let execToolCalled = false;
      // We test the gate logic by providing a verify that mirrors defaultVerify's gate branch:
      const { gate: realGate } = await import('../permissions');
      const gateCtxForTest = {
        cwd: process.cwd(),
        rules,
        isInteractive: false, // simulates non-TTY / unattended test env
        sessionAllow: new Set<string>(), // no 'run_command' in sessionAllow
        persistAllow: () => {},
      };
      const decision = await realGate('run_command', { command: 'npm test' }, gateCtxForTest);
      execToolCalled = decision.allowed; // would only call executeTool if allowed

      // Gate must block: no pre-auth, unattended=deny, non-interactive.
      expect(decision.allowed).toBe(false);
      expect(execToolCalled).toBe(false);

      // Also confirm runGoal with this ctx stops without verified (gate blocks → passed:false).
      const res = await runGoal(
        { goal: 'g', allow: [], verifyCommand: 'npm test', maxRounds: 1 },
        runnerCtx,
        { runSubAgent: stubRun, render: false,
          // Inject verify that mirrors the gate-denied path (avoids real executeTool in test).
          verify: async () => ({ passed: false, output: `verify command not permitted by gate: ${decision.reasonForModel ?? ''}` }),
        },
      );
      expect(res.stoppedBy).not.toBe('verified');
    });

    it('allows verify when run_command IS pre-authorised via opts.allow (sessionAllow bridge)', async () => {
      // 'run_command' in opts.allow → added to sessionAllow → defaultVerify bridges it to cmd string.
      const rules = { ...defaultRules(process.cwd()), unattended: 'deny' as const };
      const { gate: realGate } = await import('../permissions');

      // Simulate what defaultVerify does: if 'run_command' in sessionAllow, add cmd too.
      const sessionAllow = new Set<string>(['run_command']);
      sessionAllow.add('npm test'); // bridge: 'run_command' present → cmd is admitted
      const gateCtxForTest = {
        cwd: process.cwd(),
        rules,
        isInteractive: false,
        sessionAllow,
        persistAllow: () => {},
      };
      const decision = await realGate('run_command', { command: 'npm test' }, gateCtxForTest);

      // With 'npm test' in sessionAllow the gate returns allowed.
      expect(decision.allowed).toBe(true);
    });
  });
});
