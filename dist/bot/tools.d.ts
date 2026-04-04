/**
 * tools.ts — Tool execution bridge for the bot
 *
 * Adapts the existing coderaw tool registry for Telegram bot use.
 * Applies security checks (sandboxing, blocked commands) before execution.
 * Truncates large outputs to stay within Telegram limits.
 *
 * All 18 existing tools continue to work through this bridge.
 */
import { ToolRegistry } from '../registry/index';
import { BotConfig } from './config';
import { SecurityManager } from './security';
export declare class BotToolBridge {
    private config;
    private security;
    registry: ToolRegistry;
    constructor(config: BotConfig, security: SecurityManager);
    private applyFeatureFlags;
    /**
     * Execute a tool call with security checks applied.
     * Returns truncated output suitable for Telegram messages.
     */
    execute(toolName: string, args: Record<string, any>, cwd: string): Promise<{
        content: string;
        isError: boolean;
    }>;
    listEnabledTools(): string[];
    getToolDescriptions(): string;
}
//# sourceMappingURL=tools.d.ts.map