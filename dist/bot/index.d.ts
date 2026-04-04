/**
 * bot/index.ts — Bot CLI entry point
 *
 * Entry point for `kcc bot start` command.
 * Loads config, validates, creates the Telegram bot, and starts it.
 *
 * Usage:
 *   kcc bot start               — Start with default config
 *   kcc bot start --config <path>  — Use custom config file
 *   kcc bot init                — Create default config file
 *   kcc bot status              — Check if bot config is valid
 */
export declare function runBotCommand(subcommand: string, extraArgs: string[]): Promise<void>;
//# sourceMappingURL=index.d.ts.map