// src/workflow/runtime.ts
/**
 * Module-level holder for the orchestration context the dynamic spawn tools
 * (spawn_agent / run_parallel) read at call time. The CLI sets it before each
 * interactive turn; cleared otherwise. Same singleton pattern as agent/plan.ts.
 */
import { RunnerContext } from './runner';

let current: RunnerContext | null = null;
export function setWorkflowRuntime(ctx: RunnerContext): void { current = ctx; }
export function getWorkflowRuntime(): RunnerContext | null { return current; }
export function clearWorkflowRuntime(): void { current = null; }
