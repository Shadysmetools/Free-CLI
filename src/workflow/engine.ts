/**
 * Layer 2 — the DAG executor. Runs validated workflow steps in dependency order
 * (independent steps together via parallel()), substitutes {{inputs}} and
 * {{steps.id.output}} into each task, and isolates failures: a failed step's
 * dependents are skipped while independent branches continue.
 */
import { WorkflowDef, WorkflowStep, topoOrder } from './schema';
import { parallel, pipeline } from './primitives';
import { runSubAgent as realRunSubAgent, RunnerContext, SubAgentResult, SubAgentSpec } from './runner';

export interface WorkflowRun {
  ok: boolean;
  outputs: Record<string, string>;
  steps: Array<{ id: string; ok: boolean; output: string; error?: string }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

export function substitute(template: string, inputs: Record<string, string>, outputs: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (_m, expr: string) => {
    const stepMatch = /^steps\.([A-Za-z0-9_-]+)\.output$/.exec(expr);
    if (stepMatch) {
      if (!(stepMatch[1] in outputs)) throw new Error(`unknown step output placeholder: {{${expr}}}`);
      return outputs[stepMatch[1]];
    }
    if (!(expr in inputs)) throw new Error(`unknown placeholder: {{${expr}}}`);
    return inputs[expr];
  });
}

function concurrencyFor(ctx: RunnerContext): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wf = (ctx.settings as any).workflows;
  const isOllama = ctx.defaultProviderName === 'ollama';
  return (isOllama ? wf?.concurrency?.ollama : wf?.concurrency?.default) ?? (isOllama ? 1 : 4);
}

export async function runWorkflow(
  def: WorkflowDef,
  inputs: Record<string, string>,
  ctx: RunnerContext,
  deps: { runSubAgent?: (s: SubAgentSpec, c: RunnerContext) => Promise<SubAgentResult> } = {},
): Promise<WorkflowRun> {
  const runSubAgent = deps.runSubAgent ?? realRunSubAgent;
  const byId = new Map(def.steps.map(s => [s.id, s]));
  const outputs: Record<string, string> = {};
  const stepResults: WorkflowRun['steps'] = [];
  const failed = new Set<string>();
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const conc = concurrencyFor(ctx);

  const addUsage = (u?: SubAgentResult['usage']) => {
    if (!u) return; usage.prompt_tokens += u.prompt_tokens; usage.completion_tokens += u.completion_tokens; usage.total_tokens += u.total_tokens;
  };

  const runOneStep = async (step: WorkflowStep): Promise<void> => {
    // Skip if any dependency failed.
    if ((step.depends_on ?? []).some(d => failed.has(d))) {
      failed.add(step.id);
      stepResults.push({ id: step.id, ok: false, output: '', error: `skipped: dependency failed` });
      outputs[step.id] = '';
      return;
    }
    try {
      if (step.type === 'agent') {
        const task = substitute(step.task ?? '', inputs, outputs);
        const res = await runSubAgent({ task, role: step.role, tools: step.tools, provider: step.provider, model: step.model, maxIterations: step.maxIterations }, ctx);
        addUsage(res.usage);
        outputs[step.id] = res.content;
        if (!res.ok) failed.add(step.id);
        stepResults.push({ id: step.id, ok: res.ok, output: res.content, error: res.error });
      } else if (step.type === 'parallel') {
        const results = await parallel((step.branches ?? []).map(b => () =>
          runSubAgent({ task: substitute(b.task, inputs, outputs), role: b.role, tools: b.tools, provider: step.provider, model: step.model }, ctx)), { concurrency: conc });
        results.forEach(r => addUsage(r?.usage));
        const ok = results.every(r => r?.ok);
        const output = results.map(r => r?.content ?? '[failed]').join('\n---\n');
        outputs[step.id] = output;
        if (!ok) failed.add(step.id);
        stepResults.push({ id: step.id, ok, output });
      } else { // pipeline
        const stages = step.stages ?? [];
        const out = await pipeline([0],
          ...stages.map((stg) => async (prev: unknown) => {
            const resolved = stg.task.replace(/\{\{\s*prev\s*\}\}/g, String(prev ?? ''));
            const task = substitute(resolved, inputs, outputs);
            const res = await runSubAgent({ task, role: stg.role, tools: stg.tools, provider: step.provider, model: step.model }, ctx);
            addUsage(res.usage);
            if (!res.ok) throw new Error(res.error ?? 'stage failed');
            return res.content;
          }),
        );
        const content = String(out[0] ?? '');
        const ok = out[0] !== null;
        outputs[step.id] = content;
        if (!ok) failed.add(step.id);
        stepResults.push({ id: step.id, ok, output: content });
      }
    } catch (err) {
      failed.add(step.id);
      outputs[step.id] = '';
      stepResults.push({ id: step.id, ok: false, output: '', error: (err as Error).message });
    }
  };

  for (const level of topoOrder(def.steps)) {
    await parallel(level.map(id => () => runOneStep(byId.get(id)!)), { concurrency: conc });
  }

  return { ok: failed.size === 0, outputs, steps: stepResults, usage };
}
