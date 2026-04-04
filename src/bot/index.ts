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

import chalk from 'chalk';
import * as readline from 'readline';
import { loadBotConfig, validateBotConfig, getBotConfigPath, saveBotConfig, BotConfig } from './config';
import { createTelegramBot } from './telegram';

// ─── Banner ───────────────────────────────────────────────────────────────────

function printBotBanner(token: string, provider: string, model: string): void {
  const tokenPreview = token.slice(0, 8) + '...' + token.slice(-4);
  console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════╗'));
  console.log(chalk.bold.cyan('  ║   coderaw  Telegram Bot          ║'));
  console.log(chalk.bold.cyan('  ╚══════════════════════════════════╝'));
  console.log(chalk.dim(`  Token:    ${tokenPreview}`));
  console.log(chalk.dim(`  Provider: ${provider} / ${model}`));
  console.log(chalk.dim(`  Config:   ${getBotConfigPath()}`));
  console.log();
}

// ─── Interactive Setup Wizard ──────────────────────────────────────────────────

async function ask(question: string, defaultVal?: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultVal ? chalk.dim(` (${defaultVal})`) : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

async function runSetupWizard(): Promise<BotConfig> {
  console.log(chalk.bold.cyan('\n  🤖 coderaw Bot Setup\n'));
  console.log(chalk.dim('  Just paste your bot token and you\'re live!\n'));
  console.log(chalk.dim('  Don\'t have one? Open Telegram → @BotFather → /newbot\n'));

  const token = await ask('Bot token');

  if (!token || token.length < 20) {
    console.log(chalk.red('\n  ❌ Invalid token. Get one from @BotFather first.'));
    process.exit(1);
  }

  // Auto-detect everything else
  const provider = 'openrouter';
  const model = 'openrouter/free';

  const fs = await import('fs');
  const pathMod = await import('path');
  const configPath = getBotConfigPath();
  const dir = pathMod.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Open access by default — first user to message becomes admin
  const configContent = `# coderaw Telegram Bot Configuration
telegram:
  token: "${token}"
  # Empty = open to everyone. First /admin claim sets the admin.
  allowed_users: []
  admin_users: []
  allowed_groups: []
  require_mention: true

provider: ${provider}
model: "${model}"

features:
  shell: true
  files: true
  web_search: false
  code_exec: true
  memory: true
  voice: true
  images: true
  diagrams: true
  scheduler: true
  streaming: true

security:
  sandbox: true
  sandbox_dir: ~/sandbox
  max_output: 4000
  blocked_commands: ["rm -rf /", "sudo", "shutdown", "reboot"]
  rate_limit_per_minute: 20
  rate_limit_burst: 5

ui:
  ack_reaction: "👀"
  typing_indicator: true
  chunk_size: 4000
  stream_edits: true
  link_previews: true
`;
  fs.writeFileSync(configPath, configContent, 'utf-8');
  console.log(chalk.green(`\n  ✅ Ready!`));
  console.log(chalk.dim('  Starting bot...\n'));

  const { loadBotConfig: loadDefaults } = await import('./config');
  return loadDefaults();
}

// ─── Sub-commands ─────────────────────────────────────────────────────────────

export async function runBotCommand(subcommand: string, extraArgs: string[]): Promise<void> {
  switch (subcommand) {

    // ── bot init — create default config ──────────────────────────────────
    case 'init':
    case 'setup': {
      await runSetupWizard();
      break;
    }

    // ── bot status — validate config ───────────────────────────────────────
    case 'status': {
      const configPath = getBotConfigPath();
      const { existsSync } = await import('fs');
      if (!existsSync(configPath)) {
        console.log(chalk.red('❌ Bot config not found:'), configPath);
        console.log(chalk.dim('Run: cr bot init'));
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
      // Auto-run setup wizard if no config exists
      const fs = await import('fs');
      let config: BotConfig;
      if (!fs.existsSync(getBotConfigPath())) {
        config = await runSetupWizard();
      } else {
        config = loadBotConfig();
      }
      // If token is placeholder, ask for it
      if (!config.telegram.token || config.telegram.token === 'YOUR_BOT_TOKEN_HERE') {
        console.log(chalk.yellow('\n  ⚠️  No bot token set.\n'));
        const token = await ask('Paste your bot token from @BotFather');
        if (!token || token.length < 20) {
          console.log(chalk.red('  ❌ Invalid token.'));
          process.exit(1);
        }
        config.telegram.token = token;
        saveBotConfig(config);
        console.log(chalk.green('  ✅ Token saved!\n'));
      }

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
