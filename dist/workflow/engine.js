"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.substitute = substitute;
exports.runWorkflow = runWorkflow;
/**
 * Layer 2 — the DAG executor. Runs validated workflow steps in dependency order
 * (independent steps together via parallel()), substitutes {{inputs}} and
 * {{steps.id.output}} into each task, and isolates failures: a failed step's
 * dependents are skipped while independent branches continue.
 */
const schema_1 = require("./schema");
const primitives_1 = require("./primitives");
const runner_1 = require("./runner");
const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;
function substitute(template, inputs, outputs) {
    return template.replace(PLACEHOLDER, (_m, expr) => {
        const stepMatch = /^steps\.([A-Za-z0-9_-]+)\.output$/.exec(expr);
        if (stepMatch) {
            if (!(stepMatch[1] in outputs))
                throw new Error(`unknown step output placeholder: {{${expr}}}`);
            return outputs[stepMatch[1]];
        }
        if (!(expr in inputs))
            throw new Error(`unknown placeholder: {{${expr}}}`);
        return inputs[expr];
    });
}
function concurrencyFor(ctx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wf = ctx.settings.workflows;
    const isOllama = ctx.defaultProviderName === 'ollama';
    return (isOllama ? wf?.concurrency?.ollama : wf?.concurrency?.default) ?? (isOllama ? 1 : 4);
}
async function runWorkflow(def, inputs, ctx, deps = {}) {
    const runSubAgent = deps.runSubAgent ?? runner_1.runSubAgent;
    const byId = new Map(def.steps.map(s => [s.id, s]));
    const outputs = {};
    const stepResults = [];
    const failed = new Set();
    const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const conc = concurrencyFor(ctx);
    const addUsage = (u) => {
        if (!u)
            return;
        usage.prompt_tokens += u.prompt_tokens;
        usage.completion_tokens += u.completion_tokens;
        usage.total_tokens += u.total_tokens;
    };
    const runOneStep = async (step) => {
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
                if (!res.ok)
                    failed.add(step.id);
                stepResults.push({ id: step.id, ok: res.ok, output: res.content, error: res.error });
            }
            else if (step.type === 'parallel') {
                const results = await (0, primitives_1.parallel)((step.branches ?? []).map(b => () => runSubAgent({ task: substitute(b.task, inputs, outputs), role: b.role, tools: b.tools, provider: step.provider, model: step.model }, ctx)), { concurrency: conc });
                results.forEach(r => addUsage(r?.usage));
                const ok = results.every(r => r?.ok);
                const output = results.map(r => r?.content ?? '[failed]').join('\n---\n');
                outputs[step.id] = output;
                if (!ok)
                    failed.add(step.id);
                stepResults.push({ id: step.id, ok, output });
            }
            else { // pipeline
                const stages = step.stages ?? [];
                const out = await (0, primitives_1.pipeline)([0], ...stages.map((stg) => async (prev) => {
                    const resolved = stg.task.replace(/\{\{\s*prev\s*\}\}/g, String(prev ?? ''));
                    const task = substitute(resolved, inputs, outputs);
                    const res = await runSubAgent({ task, role: stg.role, tools: stg.tools, provider: step.provider, model: step.model }, ctx);
                    addUsage(res.usage);
                    if (!res.ok)
                        throw new Error(res.error ?? 'stage failed');
                    return res.content;
                }));
                const content = String(out[0] ?? '');
                const ok = out[0] !== null;
                outputs[step.id] = content;
                if (!ok)
                    failed.add(step.id);
                stepResults.push({ id: step.id, ok, output: content });
            }
        }
        catch (err) {
            failed.add(step.id);
            outputs[step.id] = '';
            stepResults.push({ id: step.id, ok: false, output: '', error: err.message });
        }
    };
    for (const level of (0, schema_1.topoOrder)(def.steps)) {
        await (0, primitives_1.parallel)(level.map(id => () => runOneStep(byId.get(id))), { concurrency: conc });
    }
    return { ok: failed.size === 0, outputs, steps: stepResults, usage };
}
//# sourceMappingURL=engine.js.map