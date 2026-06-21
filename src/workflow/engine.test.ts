// src/workflow/engine.test.ts
import { describe, it, expect } from 'vitest';
import { runWorkflow, substitute } from './engine';
import type { SubAgentSpec, SubAgentResult, RunnerContext } from './runner';
import { getDefaultSettings } from '../config/settings';
import { createDefaultRegistry } from '../registry/index';

function ctx(): RunnerContext {
  return { settings: getDefaultSettings(), defaultProviderName: 'ollama', parentRegistry: createDefaultRegistry(), cwd: process.cwd() };
}

describe('substitute', () => {
  it('fills inputs and step outputs', () => {
    expect(substitute('a={{x}} b={{steps.s1.output}}', { x: '1' }, { s1: 'OUT' })).toBe('a=1 b=OUT');
  });
  it('throws on an unknown placeholder', () => {
    expect(() => substitute('{{ghost}}', {}, {})).toThrow(/ghost/);
  });
});

describe('runWorkflow', () => {
  // fake runSubAgent: echoes which task it received, records call order
  const order: string[] = [];
  const fakeRun = async (spec: SubAgentSpec): Promise<SubAgentResult> => {
    order.push(spec.task);
    return { ok: true, content: `[${spec.task}]`, task: spec.task, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  };

  it('runs steps in dependency order and passes outputs downstream', async () => {
    order.length = 0;
    const def = { name: 'w', inputs: ['path'], steps: [
      { id: 'find', type: 'agent' as const, role: 'reviewer', task: 'review {{path}}' },
      { id: 'fix', type: 'agent' as const, role: 'coder', task: 'fix {{steps.find.output}}', depends_on: ['find'] },
    ]};
    const run = await runWorkflow(def, { path: 'a.ts' }, ctx(), { runSubAgent: fakeRun });
    expect(run.ok).toBe(true);
    expect(run.outputs.find).toBe('[review a.ts]');
    expect(run.outputs.fix).toBe('[fix [review a.ts]]');
    expect(order).toEqual(['review a.ts', 'fix [review a.ts]']);
    expect(run.usage.total_tokens).toBe(4);
  });

  it('isolates failure: a failed step skips its dependents but independents still run', async () => {
    const failing = async (spec: SubAgentSpec): Promise<SubAgentResult> =>
      spec.task === 'boom'
        ? { ok: false, content: 'err', task: spec.task, error: 'boom' }
        : { ok: true, content: `[${spec.task}]`, task: spec.task };
    const def = { name: 'w', steps: [
      { id: 'a', type: 'agent' as const, task: 'boom' },
      { id: 'b', type: 'agent' as const, task: 'fine' },
      { id: 'c', type: 'agent' as const, task: 'needs-a {{steps.a.output}}', depends_on: ['a'] },
    ]};
    const run = await runWorkflow(def, {}, ctx(), { runSubAgent: failing });
    expect(run.ok).toBe(false);
    expect(run.steps.find(s => s.id === 'b')!.ok).toBe(true);
    expect(run.steps.find(s => s.id === 'c')!.ok).toBe(false); // skipped because dep a failed
  });

  it('runs a pipeline step, feeding {{prev}} from one stage to the next', async () => {
    const run = async (spec: SubAgentSpec): Promise<SubAgentResult> => ({ ok: true, content: `<${spec.task}>`, task: spec.task });
    const def = { name: 'w', steps: [
      { id: 'p', type: 'pipeline' as const, stages: [
        { role: 'coder', task: 'start' },
        { role: 'coder', task: 'next:{{prev}}' },
      ]},
    ]};
    const r = await runWorkflow(def, {}, ctx(), { runSubAgent: run });
    expect(r.ok).toBe(true);
    // stage1 → "<start>"; stage2 task becomes "next:<start>" → "<next:<start>>"
    expect(r.outputs.p).toBe('<next:<start>>');
  });
});
