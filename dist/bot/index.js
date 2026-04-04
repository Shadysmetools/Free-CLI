"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBotCommand = runBotCommand;
const chalk_1 = __importDefault(require("chalk"));
const config_1 = require("./config");
const telegram_1 = require("./telegram");
// ─── Banner ───────────────────────────────────────────────────────────────────
function printBotBanner(token, provider, model) {
    const tokenPreview = token.slice(0, 8) + '...' + token.slice(-4);
    console.log(chalk_1.default.bold.cyan('\n  ╔══════════════════════════════════╗'));
    console.log(chalk_1.default.bold.cyan('  ║   knowcap-code  Telegram Bot     ║'));
    console.log(chalk_1.default.bold.cyan('  ╚══════════════════════════════════╝'));
    console.log(chalk_1.default.dim(`  Token:    ${tokenPreview}`));
    console.log(chalk_1.default.dim(`  Provider: ${provider} / ${model}`));
    console.log(chalk_1.default.dim(`  Config:   ${(0, config_1.getBotConfigPath)()}`));
    console.log();
}
// ─── Sub-commands ─────────────────────────────────────────────────────────────
async function runBotCommand(subcommand, extraArgs) {
    switch (subcommand) {
        // ── bot init — create default config ──────────────────────────────────
        case 'init':
        case 'setup': {
            // loadBotConfig() will create the config and exit if it doesn't exist
            (0, config_1.loadBotConfig)();
            break;
        }
        // ── bot status — validate config ───────────────────────────────────────
        case 'status': {
            const configPath = (0, config_1.getBotConfigPath)();
            const { existsSync } = await Promise.resolve().then(() => __importStar(require('fs')));
            if (!existsSync(configPath)) {
                console.log(chalk_1.default.red('❌ Bot config not found:'), configPath);
                console.log(chalk_1.default.dim('Run: kcc bot init'));
                process.exit(1);
            }
            const config = (0, config_1.loadBotConfig)();
            const errors = (0, config_1.validateBotConfig)(config);
            if (errors.length > 0) {
                console.log(chalk_1.default.red('\n❌ Bot config has errors:\n'));
                for (const err of errors) {
                    console.log(chalk_1.default.red(`  • ${err}`));
                }
                console.log(chalk_1.default.dim(`\nEdit: ${configPath}`));
                process.exit(1);
            }
            console.log(chalk_1.default.green('\n✅ Bot config is valid!\n'));
            console.log(chalk_1.default.dim(`  Config:   ${configPath}`));
            console.log(chalk_1.default.dim(`  Provider: ${config.provider} / ${config.model}`));
            console.log(chalk_1.default.dim(`  Users:    ${config.telegram.allowed_users.length} allowed`));
            console.log(chalk_1.default.dim(`  Features: ${Object.entries(config.features).filter(([, v]) => v).map(([k]) => k).join(', ')}`));
            console.log();
            break;
        }
        // ── bot start — start the Telegram bot ─────────────────────────────────
        case 'start':
        default: {
            // Load and validate config
            const config = (0, config_1.loadBotConfig)();
            const errors = (0, config_1.validateBotConfig)(config);
            if (errors.length > 0) {
                console.error(chalk_1.default.red('\n❌ Bot config errors:'));
                for (const err of errors) {
                    console.error(chalk_1.default.red(`  • ${err}`));
                }
                console.error(chalk_1.default.dim(`\nEdit: ${(0, config_1.getBotConfigPath)()}`));
                process.exit(1);
            }
            printBotBanner(config.telegram.token, config.provider, config.model);
            // Show feature summary
            const enabledFeatures = Object.entries(config.features)
                .filter(([, v]) => v).map(([k]) => k);
            console.log(chalk_1.default.cyan(`  Features: ${enabledFeatures.join(', ')}`));
            const allowedUsers = config.telegram.allowed_users;
            console.log(chalk_1.default.cyan(`  Allowed users: ${allowedUsers.length > 0 ? allowedUsers.join(', ') : 'none (open)'}`));
            console.log();
            // Create and start bot
            console.log(chalk_1.default.dim('  Starting Telegram bot...'));
            const { bot, runtime, start, stop } = await (0, telegram_1.createTelegramBot)(config);
            // Graceful shutdown
            const shutdown = async (signal) => {
                console.log(chalk_1.default.yellow(`\n  Received ${signal}, shutting down...`));
                await stop();
                console.log(chalk_1.default.green('  ✅ Bot stopped gracefully'));
                process.exit(0);
            };
            process.on('SIGINT', () => shutdown('SIGINT'));
            process.on('SIGTERM', () => shutdown('SIGTERM'));
            // Uncaught error recovery
            process.on('unhandledRejection', (reason) => {
                console.error(chalk_1.default.red('[Bot] Unhandled rejection:'), reason);
                // Don't crash — log and continue
            });
            await start();
            break;
        }
    }
}
//# sourceMappingURL=index.js.map