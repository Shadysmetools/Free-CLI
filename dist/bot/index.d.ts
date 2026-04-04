/**
 * bot/index.ts — Bot CLI entry point
 *
 * Entry point for `cr bot start` command.
 * Loads config, validates, creates the Telegram bot, and starts it.
 *
 * Usage:
 *   cr bot start               — Start with default config
 *   cr bot start --config <path>  — Use custom config file
 *   cr bot init                — Create default config file
 *   cr bot status              — Check if bot config is valid
 */
export declare function runBotCommand(subcommand: string, extraArgs: string[]): Promise<void>;
//# sourceMappingURL=index.d.ts.map