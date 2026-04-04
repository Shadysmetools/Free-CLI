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
import * as readline from 'readline';
import { loadBotConfig, validateBotConfig, getBotConfigPath, saveBotConfig, BotConfig } from './config';
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
  console.log(chalk.bold.cyan('\n  🤖 knowcap-code Bot Setup\n'));
  console.log(chalk.dim('  Quick setup — you\'ll be running in 30 seconds!\n'));

  // Step 1: Token
  console.log(chalk.yellow('  Step 1:'), 'Get a bot token from @BotFather on Telegram');
  console.log(chalk.dim('  Open Telegram → search @BotFather → send /newbot → copy the token\n'));
  const token = await ask('Paste your bot token');

  if (!token || token.length < 20) {
    console.log(chalk.red('\n  ❌ Invalid token. Get one from @BotFather first.'));
    process.exit(1);
  }

  // Step 2: User ID
  console.log(chalk.yellow('\n  Step 2:'), 'Your Telegram user ID (for security)');
  console.log(chalk.dim('  Send /start to @userinfobot on Telegram to get your ID\n'));
  const userId = await ask('Your Telegram user ID');

  // Step 3: Provider
  console.log(chalk.yellow('\n  Step 3:'), 'AI Provider');
  const provider = await ask('Provider', 'openrouter');
  const model = await ask('Model', 'openrouter/free');

  // Build config
  const { loadBotConfig: loadDefaults } = await import('./config');
  const fs = await import('fs');
  const configPath = getBotConfigPath();

  // Create directory
  const path = await import('path');
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Write config
  const configContent = `# knowcap-code Telegram Bot Configuration
telegram:
  token: "${token}"
  allowed_users: [${userId || ''}]
  admin_users: [${userId || ''}]
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
  console.log(chalk.green(`\n  ✅ Config saved to ${configPath}`));
  console.log(chalk.dim('  Starting bot...\n'));

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
      // Auto-run setup wizard if no config exists
      const fs = await import('fs');
      let config: BotConfig;
      if (!fs.existsSync(getBotConfigPath())) {
        config = await runSetupWizard();
      } else {
        config = loadBotConfig();
      }
      // If token is placeholder, ask for it interactively
      if (!config.telegram.token || config.telegram.token === 'YOUR_BOT_TOKEN_HERE') {
        console.log(chalk.yellow('\n  ⚠️  No bot token set. Let\'s fix that!\n'));
        const token = await ask('Paste your bot token from @BotFather');
        if (!token || token.length < 20) {
          console.log(chalk.red('  ❌ Invalid token.'));
          process.exit(1);
        }
        config.telegram.token = token;

        if (config.telegram.allowed_users.length === 0) {
          const userId = await ask('Your Telegram user ID (from @userinfobot)');
          if (userId) {
            config.telegram.allowed_users = [parseInt(userId, 10)];
            config.telegram.admin_users = [parseInt(userId, 10)];
          }
        }

        saveBotConfig(config);
        console.log(chalk.green('  ✅ Config updated!\n'));
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
