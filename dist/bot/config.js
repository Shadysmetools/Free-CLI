"use strict";
/**
 * config.ts — Bot YAML config loader
 *
 * Config file: ~/.knowcap-code/bot.yaml
 * Creates default config on first run.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBotConfigPath = getBotConfigPath;
exports.loadBotConfig = loadBotConfig;
exports.saveBotConfig = saveBotConfig;
exports.validateBotConfig = validateBotConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const yaml = __importStar(require("yaml"));
// ─── Defaults ────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
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
function getBotConfigPath() {
    const envPath = process.env.KCC_BOT_CONFIG;
    if (envPath)
        return envPath;
    return path.join(os.homedir(), '.knowcap-code', 'bot.yaml');
}
// ─── Load ─────────────────────────────────────────────────────────────────────
function loadBotConfig() {
    const configPath = getBotConfigPath();
    if (!fs.existsSync(configPath)) {
        createDefaultConfig(configPath);
        console.log(`\n✅ Created default bot config: ${configPath}`);
        console.log('⚠️  Edit the config and set your telegram.token before running.\n');
        process.exit(0);
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = yaml.parse(raw);
    // Deep merge with defaults
    return deepMerge(DEFAULT_CONFIG, parsed);
}
// ─── Save ─────────────────────────────────────────────────────────────────────
function saveBotConfig(config) {
    const configPath = getBotConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, yaml.stringify(config), 'utf-8');
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function createDefaultConfig(configPath) {
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
function deepMerge(base, override) {
    if (!override || typeof override !== 'object')
        return base;
    const result = { ...base };
    for (const key of Object.keys(override)) {
        if (override[key] !== null && typeof override[key] === 'object' && !Array.isArray(override[key])) {
            result[key] = deepMerge(base[key] ?? {}, override[key]);
        }
        else {
            result[key] = override[key];
        }
    }
    return result;
}
// ─── Validation ───────────────────────────────────────────────────────────────
function validateBotConfig(config) {
    const errors = [];
    if (!config.telegram.token || config.telegram.token === 'YOUR_BOT_TOKEN_HERE') {
        errors.push('telegram.token is not set. Get a token from @BotFather.');
    }
    // allowed_users empty = open to everyone (first user auto-claimed as admin)
    if (!config.provider) {
        errors.push('provider is not set.');
    }
    return errors;
}
//# sourceMappingURL=config.js.map