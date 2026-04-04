"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolRegistry = void 0;
exports.createDefaultRegistry = createDefaultRegistry;
// ─── ToolRegistry ─────────────────────────────────────────────────────────────
class ToolRegistry {
    constructor() {
        this.tools = new Map();
    }
    // ─── Registration ──────────────────────────────────────────────────────────
    register(tool, category, source = 'builtin') {
        this.tools.set(tool.name, {
            ...tool,
            category,
            enabled: true,
            source,
        });
    }
    unregister(name) {
        return this.tools.delete(name);
    }
    /** Register MCP tools in bulk */
    registerMCPTools(tools) {
        for (const tool of tools) {
            this.tools.set(tool.name, {
                ...tool,
                category: 'mcp',
                enabled: true,
                source: 'mcp',
            });
        }
    }
    /** Remove all MCP tools (called when MCP disconnects) */
    clearMCPTools() {
        for (const [name, tool] of this.tools) {
            if (tool.source === 'mcp') {
                this.tools.delete(name);
            }
        }
    }
    // ─── Enable / Disable ──────────────────────────────────────────────────────
    enable(name) {
        const tool = this.tools.get(name);
        if (!tool)
            return false;
        tool.enabled = true;
        return true;
    }
    disable(name) {
        const tool = this.tools.get(name);
        if (!tool)
            return false;
        tool.enabled = false;
        return true;
    }
    // ─── Query ─────────────────────────────────────────────────────────────────
    get(name) {
        return this.tools.get(name);
    }
    /** All registered tools (enabled + disabled) */
    list(category) {
        const all = Array.from(this.tools.values());
        return category ? all.filter(t => t.category === category) : all;
    }
    /** Only enabled tools — passed to provider.complete() */
    getEnabled() {
        return Array.from(this.tools.values())
            .filter(t => t.enabled)
            .map(({ name, description, parameters }) => ({ name, description, parameters }));
    }
    /** Fuzzy search across name + description */
    search(query) {
        const q = query.toLowerCase();
        return Array.from(this.tools.values()).filter(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    }
    // ─── Format ────────────────────────────────────────────────────────────────
    /** Pretty-print all tools grouped by category */
    formatList() {
        const byCategory = new Map();
        for (const tool of this.tools.values()) {
            const list = byCategory.get(tool.category) ?? [];
            list.push(tool);
            byCategory.set(tool.category, list);
        }
        const categoryOrder = ['file', 'shell', 'git', 'memory', 'whisper', 'mcp', 'custom'];
        const lines = [''];
        for (const cat of categoryOrder) {
            const tools = byCategory.get(cat);
            if (!tools || tools.length === 0)
                continue;
            lines.push(`  ${categoryLabel(cat)}`);
            for (const t of tools) {
                const status = t.enabled ? '✓' : '✗';
                const desc = t.description.length > 60 ? t.description.slice(0, 57) + '...' : t.description;
                lines.push(`  ${status} ${t.name.padEnd(22)} ${desc}`);
            }
            lines.push('');
        }
        return lines.join('\n');
    }
    /** Describe a single tool in detail */
    formatInfo(name) {
        const tool = this.tools.get(name);
        if (!tool)
            return null;
        const props = Object.entries(tool.parameters.properties ?? {})
            .map(([k, v]) => {
            const req = tool.parameters.required?.includes(k) ? ' (required)' : '';
            return `    ${k}${req}: ${v.description ?? ''}`;
        })
            .join('\n');
        return [
            '',
            `  Tool: ${tool.name}`,
            `  Category: ${tool.category} | Source: ${tool.source} | ${tool.enabled ? 'enabled' : 'DISABLED'}`,
            `  ${tool.description}`,
            '',
            '  Parameters:',
            props || '    (none)',
            '',
        ].join('\n');
    }
}
exports.ToolRegistry = ToolRegistry;
// ─── Helpers ─────────────────────────────────────────────────────────────────
function categoryLabel(cat) {
    const labels = {
        file: '📄 File Tools',
        shell: '⚡ Shell Tools',
        git: '🌿 Git Tools',
        memory: '🧠 Memory Tools',
        whisper: '🎤 Whisper Tools',
        mcp: '🔌 MCP Tools',
        custom: '🔧 Custom Tools',
    };
    return labels[cat] ?? cat;
}
// ─── Factory: build the default registry from existing TOOLS ─────────────────
function createDefaultRegistry() {
    const registry = new ToolRegistry();
    // File tools
    for (const name of ['read_file', 'write_file', 'edit_file', 'search_files', 'list_files']) {
        const tool = getBuiltinTool(name);
        if (tool)
            registry.register(tool, 'file');
    }
    // Shell tools
    const runCmd = getBuiltinTool('run_command');
    if (runCmd)
        registry.register(runCmd, 'shell');
    // Git tools
    for (const name of ['git_status', 'git_diff', 'git_commit', 'git_log']) {
        const tool = getBuiltinTool(name);
        if (tool)
            registry.register(tool, 'git');
    }
    // Memory tools (definitions only — execution handled by memory system)
    registry.register({
        name: 'memory_search',
        description: 'Search across all project memory files for a keyword or phrase.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search term to find in memory' },
            },
            required: ['query'],
        },
    }, 'memory');
    registry.register({
        name: 'memory_save',
        description: 'Save an important note or decision to project memory (MEMORY.md).',
        parameters: {
            type: 'object',
            properties: {
                note: { type: 'string', description: 'The note to save' },
                category: { type: 'string', description: 'Category heading (e.g. Decisions, Context, Todo)' },
            },
            required: ['note'],
        },
    }, 'memory');
    return registry;
}
/** Lazy-import TOOLS to avoid circular deps */
function getBuiltinTool(name) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { TOOLS } = require('../agent/tools');
        return TOOLS.find((t) => t.name === name) ?? null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=index.js.map