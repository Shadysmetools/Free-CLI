/**
 * config.ts — Bot YAML config loader
 *
 * Config file: ~/.knowcap-code/bot.yaml
 * Creates default config on first run.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface BotTelegramConfig {
  token: string;
  /** Allowlisted Telegram user IDs (numeric). Empty = deny all. */
  allowed_users: number[];
  /** Group IDs the bot works in. '*' = all groups. */
  allowed_groups: Array<number | string>;
  /** Admin user IDs who can run /admin commands */
  admin_users: number[];
  /** Require @mention in groups */
  require_mention: boolean;
  /** Enable webhook mode instead of long polling */
  webhook_url?: string;
  webhook_port?: number;
  webhook_secret?: string;
}

export interface BotProviderConfig {
  provider: string;
  model: string;
}

export interface BotFeaturesConfig {
  shell: boolean;
  files: boolean;
  web_search: boolean;
  code_exec: boolean;
  memory: boolean;
  voice: boolean;
  images: boolean;
  diagrams: boolean;
  scheduler: boolean;
  streaming: boolean; // Stream responses via message edits
}

export interface BotSecurityConfig {
  sandbox: boolean;
  sandbox_dir: string;
  max_output: number;
  blocked_commands: string[];
  rate_limit_per_minute: number;
  rate_limit_burst: number;
}

export interface BotSchedulerConfig {
  enabled: boolean;
  store: string;
  timezone: string;
}

export interface BotUIConfig {
  ack_reaction: string; // Emoji to react with while processing (e.g. "👀")
  typing_indicator: boolean;
  chunk_size: number; // Max chars per message
  stream_edits: boolean; // Edit message while streaming
  link_previews: boolean;
}

export interface BotConfig {
  telegram: BotTelegramConfig;
  provider: string;
  model: string;
  features: BotFeaturesConfig;
  security: BotSecurityConfig;
  scheduler: BotSchedulerConfig;
  ui: BotUIConfig;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BotConfig = {
  telegram: {
    token: 'YOUR_BOT_TOKEN_HERE',
    allowed_users: [],
    allowed_groups: [],
    admin_users: [],
    require_mention: true,
  },
  provider: 'openrouter',
  model: 'openrouter/free',
  features: {
    shell: true,
    files: true,
    web_search: true,
    code_exec: true,
    memory: true,
    voice: true,
    images: true,
    diagrams: true,
    scheduler: true,
    streaming: true,
  },
  security: {
    sandbox: true,
    sandbox_dir: path.join(os.homedir(), 'sandbox'),
    max_output: 4000,
    blocked_commands: ['rm -rf /', 'sudo', 'shutdown', 'reboot', 'mkfs', 'dd if='],
    rate_limit_per_minute: 20,
    rate_limit_burst: 5,
  },
  scheduler: {
    enabled: true,
    store: path.join(os.homedir(), '.knowcap-code', 'bot-jobs.json'),
    timezone: 'UTC',
  },
  ui: {
    ack_reaction: '👀',
    typing_indicator: true,
    chunk_size: 4000,
    stream_edits: true,
    link_previews: true,
  },
};

// ─── Config path ──────────────────────────────────────────────────────────────

export function getBotConfigPath(): string {
  const envPath = process.env.KCC_BOT_CONFIG;
  if (envPath) return envPath;
  return path.join(os.homedir(), '.knowcap-code', 'bot.yaml');
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export function loadBotConfig(): BotConfig {
  const configPath = getBotConfigPath();

  if (!fs.existsSync(configPath)) {
    createDefaultConfig(configPath);
    console.log(`\n✅ Created default bot config: ${configPath}`);
    console.log('⚠️  Edit the config and set your telegram.token before running.\n');
    process.exit(0);
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = yaml.parse(raw) as Partial<BotConfig>;

  // Deep merge with defaults
  return deepMerge(DEFAULT_CONFIG, parsed) as BotConfig;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export function saveBotConfig(config: BotConfig): void {
  const configPath = getBotConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.stringify(config), 'utf-8');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createDefaultConfig(configPath: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const content = `# knowcap-code Telegram Bot Configuration
# Run: kcc bot start

telegram:
  token: "YOUR_BOT_TOKEN_HERE"
  # Get from @BotFather on Telegram
  # Allowlisted user IDs (numeric). Get yours: message @userinfobot
  allowed_users: []
  # Admin users can run /admin commands
  admin_users: []
  # Group IDs this bot works in. Use '*' for all groups.
  allowed_groups: []
  require_mention: true  # Require @botname mention in groups

# AI provider and model
provider: openrouter
model: "meta-llama/llama-3.3-70b-instruct:free"

# Feature flags
features:
  shell: true        # Execute shell commands
  files: true        # Read/write files
  web_search: false  # Web search (needs BRAVE_API_KEY or similar)
  code_exec: true    # Run code snippets
  memory: true       # Per-user memory (MEMORY.md)
  voice: true        # Transcribe voice messages (needs Whisper/Groq)
  images: true       # Analyze images sent to bot
  diagrams: true     # Generate Mermaid diagrams
  scheduler: true    # Cron jobs and reminders
  streaming: true    # Stream AI responses via message edits

# Security settings
security:
  sandbox: true
  sandbox_dir: ~/sandbox
  max_output: 4000
  blocked_commands:
    - "rm -rf /"
    - "sudo"
    - "shutdown"
    - "reboot"
  rate_limit_per_minute: 20
  rate_limit_burst: 5

# Scheduler / Cron jobs
scheduler:
  enabled: true
  store: ~/.knowcap-code/bot-jobs.json
  timezone: UTC

# UI behavior
ui:
  ack_reaction: "👀"      # React to messages while processing
  typing_indicator: true  # Show typing...
  chunk_size: 4000        # Max chars per Telegram message
  stream_edits: true      # Edit message while streaming
  link_previews: true
`;
  fs.writeFileSync(configPath, content, 'utf-8');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(base: any, override: any): any {
  if (!override || typeof override !== 'object') return base;
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (override[key] !== null && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = deepMerge(base[key] ?? {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateBotConfig(config: BotConfig): string[] {
  const errors: string[] = [];

  if (!config.telegram.token || config.telegram.token === 'YOUR_BOT_TOKEN_HERE') {
    errors.push('telegram.token is not set. Get a token from @BotFather.');
  }

  if (config.telegram.allowed_users.length === 0) {
    errors.push('telegram.allowed_users is empty. Set at least one user ID to allow access.');
  }

  if (!config.provider) {
    errors.push('provider is not set.');
  }

  return errors;
}
