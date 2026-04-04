"use strict";
/**
 * tools.ts — Tool execution bridge for the bot
 *
 * Adapts the existing coderaw tool registry for Telegram bot use.
 * Applies security checks (sandboxing, blocked commands) before execution.
 * Truncates large outputs to stay within Telegram limits.
 *
 * All 18 existing tools continue to work through this bridge.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotToolBridge = void 0;
const tools_1 = require("../agent/tools");
const index_1 = require("../registry/index");
const formatter_1 = require("./formatter");
const web_tools_1 = require("./web_tools");
// ─── Tool Bridge ──────────────────────────────────────────────────────────────
class BotToolBridge {
    constructor(config, security) {
        this.config = config;
        this.security = security;
        this.registry = (0, index_1.createDefaultRegistry)();
        this.registerWebTools();
        this.applyFeatureFlags();
    }
    // ── Web tool registration ──────────────────────────────────────────────────
    registerWebTools() {
        for (const def of web_tools_1.WEB_TOOL_DEFS) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.registry.register(def, 'custom', 'custom');
        }
    }
    // ── Feature flag enforcement ───────────────────────────────────────────────
    applyFeatureFlags() {
        const features = this.config.features;
        // Disable tools based on feature flags
        if (!features.shell) {
            this.registry.disable('run_command');
        }
        if (!features.files) {
            this.registry.disable('read_file');
            this.registry.disable('write_file');
            this.registry.disable('edit_file');
            this.registry.disable('list_files');
            this.registry.disable('search_files');
        }
        if (!features.diagrams) {
            this.registry.disable('generate_diagram');
        }
        if (!features.images) {
            this.registry.disable('generate_image');
        }
    }
    // ── Tool execution ────────────────────────────────────────────────────────
    /**
     * Execute a tool call with security checks applied.
     * Returns truncated output suitable for Telegram messages.
     */
    async execute(toolName, 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args, cwd) {
        // Check if tool is enabled
        const toolDef = this.registry.get(toolName);
        if (!toolDef) {
            return { content: `Tool "${toolName}" is not available.`, isError: true };
        }
        // Security: block dangerous shell commands
        if (toolName === 'run_command' && args.command) {
            const blockResult = this.security.isCommandBlocked(String(args.command));
            if (blockResult.blocked) {
                return {
                    content: `🔒 Blocked: ${blockResult.reason}`,
                    isError: true,
                };
            }
        }
        // Security: sandbox file paths
        if (this.config.security.sandbox) {
            for (const key of ['path', 'file', 'output_path']) {
                if (args[key] && typeof args[key] === 'string') {
                    if (!this.security.isPathAllowed(args[key])) {
                        // Redirect to sandbox
                        args[key] = this.security.sandboxPath(args[key]);
                    }
                }
            }
        }
        // ── Web tools — handled directly (not in agent/tools.ts) ─────────────────
        if (toolName === 'web_search') {
            try {
                const result = await (0, web_tools_1.executeWebSearch)(String(args.query ?? ''));
                return { content: (0, formatter_1.truncateOutput)(result.content, this.config.security.max_output), isError: result.isError ?? false };
            }
            catch (err) {
                return { content: `web_search error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
            }
        }
        if (toolName === 'web_fetch') {
            try {
                const maxChars = typeof args.max_chars === 'number' ? args.max_chars : 8000;
                const result = await (0, web_tools_1.executeWebFetch)(String(args.url ?? ''), maxChars);
                return { content: (0, formatter_1.truncateOutput)(result.content, this.config.security.max_output), isError: result.isError ?? false };
            }
            catch (err) {
                return { content: `web_fetch error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
            }
        }
        if (toolName === 'api_call') {
            try {
                const result = await (0, web_tools_1.executeApiCall)(args);
                return { content: (0, formatter_1.truncateOutput)(result.content, this.config.security.max_output), isError: result.isError ?? false };
            }
            catch (err) {
                return { content: `api_call error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
            }
        }
        // Execute
        try {
            const result = await (0, tools_1.executeTool)(toolName, args, cwd);
            // Truncate large output
            const truncated = (0, formatter_1.truncateOutput)(result.content, this.config.security.max_output);
            return {
                content: truncated,
                isError: result.isError ?? false,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                content: `Tool execution error: ${message}`,
                isError: true,
            };
        }
    }
    // ── Tool list ─────────────────────────────────────────────────────────────
    listEnabledTools() {
        return this.registry.getEnabled().map(t => t.name);
    }
    getToolDescriptions() {
        const tools = this.registry.getEnabled();
        return tools
            .map(t => `• <code>${t.name}</code> — ${t.description.slice(0, 80)}`)
            .join('\n');
    }
}
exports.BotToolBridge = BotToolBridge;
//# sourceMappingURL=tools.js.map