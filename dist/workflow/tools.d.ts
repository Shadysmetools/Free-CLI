/**
 * Layer 3a — dynamic orchestration tools. These let the main agent decompose
 * work at runtime. Execution reads the active RunnerContext from runtime.ts and
 * delegates to runSubAgent. They are gated like any tool (consequential) via the
 * core.ts gate() choke point before executeTool dispatches here.
 */
import { Tool } from '../providers/index';
import { ToolRegistry } from '../registry/index';
import { ToolResult } from '../agent/tools';
export declare const WORKFLOW_TOOLS: Tool[];
export declare function registerWorkflowTools(registry: ToolRegistry): void;
export declare function executeWorkflowTool(name: string, args: Record<string, unknown>, _cwd: string): Promise<ToolResult>;
//# sourceMappingURL=tools.d.ts.map