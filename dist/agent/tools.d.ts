import { Tool } from '../providers/index';
export interface ToolResult {
    content: string;
    isError?: boolean;
}
export interface FileChange {
    path: string;
    originalContent: string | null;
    action: 'create' | 'edit' | 'delete';
}
export declare const fileChanges: FileChange[];
export declare const TOOLS: Tool[];
export declare function executeTool(name: string, args: Record<string, unknown>, cwd: string): Promise<ToolResult>;
//# sourceMappingURL=tools.d.ts.map