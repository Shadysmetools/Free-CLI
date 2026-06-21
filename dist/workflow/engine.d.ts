/**
 * Layer 2 — the DAG executor. Runs validated workflow steps in dependency order
 * (independent steps together via parallel()), substitutes {{inputs}} and
 * {{steps.id.output}} into each task, and isolates failures: a failed step's
 * dependents are skipped while independent branches continue.
 */
import { WorkflowDef } from './schema';
import { RunnerContext, SubAgentResult, SubAgentSpec } from './runner';
export interface WorkflowRun {
    ok: boolean;
    outputs: Record<string, string>;
    steps: Array<{
        id: string;
        ok: boolean;
        output: string;
        error?: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
export declare function substitute(template: string, inputs: Record<string, string>, outputs: Record<string, string>): string;
export declare function runWorkflow(def: WorkflowDef, inputs: Record<string, string>, ctx: RunnerContext, deps?: {
    runSubAgent?: (s: SubAgentSpec, c: RunnerContext) => Promise<SubAgentResult>;
}): Promise<WorkflowRun>;
//# sourceMappingURL=engine.d.ts.map