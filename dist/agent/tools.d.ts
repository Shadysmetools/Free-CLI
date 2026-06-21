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
/** Path to the bundled ripgrep binary, or null if unavailable. */
export declare function rgPath(): string | null;
export declare const TOOLS: Tool[];
export declare function executeTool(name: string, args: Record<string, unknown>, cwd: string): Promise<ToolResult>;
//# sourceMappingURL=tools.d.ts.map