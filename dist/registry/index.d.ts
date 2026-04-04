/**
 * Tool Registry — centralized tool management
 *
 * Wraps the existing TOOLS array, adds:
 * - Categories (file | shell | git | mcp | whisper | memory | custom)
 * - Enable/disable per tool
 * - Search and list by category
 * - MCP tools auto-register on connect
 * - core.ts calls registry.getEnabled() instead of TOOLS constant
 */
import { Tool } from '../providers/index';
import { ToolResult } from '../agent/tools';
export type ToolCategory = 'file' | 'shell' | 'git' | 'mcp' | 'whisper' | 'memory' | 'document' | 'visual' | 'custom';
export interface RegisteredTool extends Tool {
    category: ToolCategory;
    enabled: boolean;
    source: 'builtin' | 'mcp' | 'custom';
}
export interface AgentContext {
    cwd: string;
}
export declare class ToolRegistry {
    private tools;
    register(tool: Tool, category: ToolCategory, source?: 'builtin' | 'mcp' | 'custom'): void;
    unregister(name: string): boolean;
    /** Register MCP tools in bulk */
    registerMCPTools(tools: Tool[]): void;
    /** Remove all MCP tools (called when MCP disconnects) */
    clearMCPTools(): void;
    enable(name: string): boolean;
    disable(name: string): boolean;
    get(name: string): RegisteredTool | undefined;
    /** All registered tools (enabled + disabled) */
    list(category?: ToolCategory): RegisteredTool[];
    /** Only enabled tools — passed to provider.complete() */
    getEnabled(): Tool[];
    /** Fuzzy search across name + description */
    search(query: string): RegisteredTool[];
    /** Pretty-print all tools grouped by category */
    formatList(): string;
    /** Describe a single tool in detail */
    formatInfo(name: string): string | null;
}
export declare function createDefaultRegistry(): ToolRegistry;
export type { ToolResult };
//# sourceMappingURL=index.d.ts.map