// src/workflow/goal.test.ts
import { describe, it, expect } from 'vitest';
import { runGoal, parsePlan } from './goal';
import type { SubAgentSpec, SubAgentResult, RunnerContext } from './runner';
import { getDefaultSettings } from '../config/settings';
import { createDefaultRegistry } from '../registry/index';

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
});
