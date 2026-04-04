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

import chalk from 'chalk';
import { loadBotConfig, validateBotConfig, getBotConfigPath } from './config';
import { createTelegramBot } from './telegram';

// ─── Banner ───────────────────────────────────────────────────────────────────

function printBotBanner(token: string, provider: string, model: string): void {
  const tokenPreview = token.slice(0, 8) + '...' + token.slice(-4);
  console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════╗'));
  console.log(chalk.bold.cyan('  ║   knowcap-code  Telegram Bot     ║'));
  console.log(chalk.bold.cyan('  ╚══════════════════════════════════╝'));
  console.log(chalk.dim(`  Token:    ${tokenPreview}`));
  console.log(chalk.dim(`  Provider: ${provider} / ${model}`));
  console.log(chalk.dim(`  Config:   ${getBotConfigPath()}`));
  console.log();
}

// ─── Sub-commands ─────────────────────────────────────────────────────────────

export async function runBotCommand(subcommand: string, extraArgs: string[]): Promise<void> {
  switch (subcommand) {

    // ── bot init — create default config ──────────────────────────────────
    case 'init':
    case 'setup': {
      // loadBotConfig() will create the config and exit if it doesn't exist
      loadBotConfig();
      break;
    }

    // ── bot status — validate config ───────────────────────────────────────
    case 'status': {
      const configPath = getBotConfigPath();
      const { existsSync } = await import('fs');
      if (!existsSync(configPath)) {
        console.log(chalk.red('❌ Bot config not found:'), configPath);
        console.log(chalk.dim('Run: kcc bot init'));
        process.exit(1);
      }

      const config = loadBotConfig();
      const errors = validateBotConfig(config);

      if (errors.length > 0) {
        console.log(chalk.red('\n❌ Bot config has errors:\n'));
        for (const err of errors) {
          console.log(chalk.red(`  • ${err}`));
        }
        console.log(chalk.dim(`\nEdit: ${configPath}`));
        process.exit(1);
      }

      console.log(chalk.green('\n✅ Bot config is valid!\n'));
      console.log(chalk.dim(`  Config:   ${configPath}`));
      console.log(chalk.dim(`  Provider: ${config.provider} / ${config.model}`));
      console.log(chalk.dim(`  Users:    ${config.telegram.allowed_users.length} allowed`));
      console.log(chalk.dim(`  Features: ${Object.entries(config.features).filter(([, v]) => v).map(([k]) => k).join(', ')}`));
      console.log();
      break;
    }

    // ── bot start — start the Telegram bot ─────────────────────────────────
    case 'start':
    default: {
      // Load and validate config
      const config = loadBotConfig();
      const errors = validateBotConfig(config);

      if (errors.length > 0) {
        console.error(chalk.red('\n❌ Bot config errors:'));
        for (const err of errors) {
          console.error(chalk.red(`  • ${err}`));
        }
        console.error(chalk.dim(`\nEdit: ${getBotConfigPath()}`));
        process.exit(1);
      }

      printBotBanner(config.telegram.token, config.provider, config.model);

      // Show feature summary
      const enabledFeatures = Object.entries(config.features)
        .filter(([, v]) => v).map(([k]) => k);
      console.log(chalk.cyan(`  Features: ${enabledFeatures.join(', ')}`));

      const allowedUsers = config.telegram.allowed_users;
      console.log(chalk.cyan(`  Allowed users: ${allowedUsers.length > 0 ? allowedUsers.join(', ') : 'none (open)'}`));
      console.log();

      // Create and start bot
      console.log(chalk.dim('  Starting Telegram bot...'));
      const { bot, runtime, start, stop } = await createTelegramBot(config);

      // Graceful shutdown
      const shutdown = async (signal: string) => {
        console.log(chalk.yellow(`\n  Received ${signal}, shutting down...`));
        await stop();
        console.log(chalk.green('  ✅ Bot stopped gracefully'));
        process.exit(0);
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));

      // Uncaught error recovery
      process.on('unhandledRejection', (reason) => {
        console.error(chalk.red('[Bot] Unhandled rejection:'), reason);
        // Don't crash — log and continue
      });

      await start();
      break;
    }
  }
}
