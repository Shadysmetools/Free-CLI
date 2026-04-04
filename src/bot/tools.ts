/**
 * tools.ts — Tool execution bridge for the bot
 *
 * Adapts the existing knowcap-code tool registry for Telegram bot use.
 * Applies security checks (sandboxing, blocked commands) before execution.
 * Truncates large outputs to stay within Telegram limits.
 *
 * All 18 existing tools continue to work through this bridge.
 */

import { executeTool } from '../agent/tools';
import { ToolRegistry, createDefaultRegistry } from '../registry/index';
import { BotConfig } from './config';
import { SecurityManager } from './security';
import { truncateOutput } from './formatter';

// ─── Tool Bridge ──────────────────────────────────────────────────────────────

export class BotToolBridge {
  private config: BotConfig;
  private security: SecurityManager;
  public registry: ToolRegistry;

  constructor(config: BotConfig, security: SecurityManager) {
    this.config = config;
    this.security = security;
    this.registry = createDefaultRegistry();
    this.applyFeatureFlags();
  }

  // ── Feature flag enforcement ───────────────────────────────────────────────

  private applyFeatureFlags(): void {
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
  async execute(
    toolName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: Record<string, any>,
    cwd: string,
  ): Promise<{ content: string; isError: boolean }> {
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

    // Execute
    try {
      const result = await executeTool(toolName, args, cwd);

      // Truncate large output
      const truncated = truncateOutput(
        result.content,
        this.config.security.max_output,
      );

      return {
        content: truncated,
        isError: result.isError ?? false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: `Tool execution error: ${message}`,
        isError: true,
      };
    }
  }

  // ── Tool list ─────────────────────────────────────────────────────────────

  listEnabledTools(): string[] {
    return this.registry.getEnabled().map(t => t.name);
  }

  getToolDescriptions(): string {
    const tools = this.registry.getEnabled();
    return tools
      .map(t => `• <code>${t.name}</code> — ${t.description.slice(0, 80)}`)
      .join('\n');
  }
}
