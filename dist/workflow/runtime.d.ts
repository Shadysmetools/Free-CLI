/**
 * Module-level holder for the orchestration context the dynamic spawn tools
 * (spawn_agent / run_parallel) read at call time. The CLI sets it before each
 * interactive turn; cleared otherwise. Same singleton pattern as agent/plan.ts.
 */
import { RunnerContext } from './runner';
export declare function setWorkflowRuntime(ctx: RunnerContext): void;
export declare function getWorkflowRuntime(): RunnerContext | null;
export declare function clearWorkflowRuntime(): void;
//# sourceMappingURL=runtime.d.ts.map