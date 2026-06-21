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
/** Load a skill's full body on demand. Reaches the SkillsManager via the runtime holder. */
export declare function loadSkill(args: {
    name: string;
}): {
    content: string;
    isError?: boolean;
};
/**
 * Pure edit helper. Refuses ambiguous edits (old_text matching 0 or >1 places)
 * instead of silently replacing the first match and corrupting the file.
 */
export declare function applyEdit(content: string, oldText: string, newText: string): {
    ok: true;
    content: string;
} | {
    ok: false;
    error: string;
};
//# sourceMappingURL=tools.d.ts.map