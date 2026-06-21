/**
 * Workflow definition types + validation. A workflow is a small DAG of steps;
 * validateWorkflow() guarantees shape, unique ids, resolvable dependencies, and
 * the absence of cycles BEFORE any agent runs. topoOrder() returns dependency
 * levels so the engine can run independent steps together.
 */
export interface WorkflowSubStep {
    role?: string;
    task: string;
    tools?: string[];
}
export interface WorkflowStep {
    id: string;
    type: 'agent' | 'parallel' | 'pipeline';
    role?: string;
    task?: string;
    branches?: WorkflowSubStep[];
    stages?: WorkflowSubStep[];
    depends_on?: string[];
    tools?: string[];
    provider?: string;
    model?: string;
    maxIterations?: number;
}
export interface WorkflowDef {
    name: string;
    description?: string;
    inputs?: string[];
    steps: WorkflowStep[];
}
export declare function validateWorkflow(def: unknown): {
    ok: true;
    def: WorkflowDef;
} | {
    ok: false;
    errors: string[];
};
/** Kahn's algorithm → dependency levels. Throws "dependency cycle: …" if not a DAG. */
export declare function topoOrder(steps: WorkflowStep[]): string[][];
//# sourceMappingURL=schema.d.ts.map