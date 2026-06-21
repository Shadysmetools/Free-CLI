import { WorkflowDef } from './schema';
export declare function parseWorkflow(text: string): {
    ok: true;
    def: WorkflowDef;
} | {
    ok: false;
    errors: string[];
};
export declare function workflowDirs(cwd: string): string[];
export declare function loadWorkflows(dirs: string[]): Map<string, WorkflowDef>;
//# sourceMappingURL=loader.d.ts.map