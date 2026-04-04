#!/usr/bin/env node
"use strict";
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
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const cli_1 = require("./cli");
const wizard_1 = require("./setup/wizard");
const terminal_1 = require("./ui/terminal");
const index_1 = require("./bot/index");
const args = process.argv.slice(2);
// Parse flags
const opts = {};
let verboseArg = false;
const positional = [];
let runSetup = false;
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--provider' || arg === '-p') {
        opts.provider = args[++i];
    }
    else if (arg === '--model' || arg === '-m') {
        opts.model = args[++i];
    }
    else if (arg === '--cwd') {
        opts.cwd = args[++i];
    }
    else if (arg === '--no-color') {
        opts.noColor = true;
    }
    else if (arg === '--verbose' || arg === '-V') {
        verboseArg = true;
    }
    else if (arg === '--setup' || arg === 'setup') {
        runSetup = true;
    }
    else if (arg === '--version' || arg === '-v') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pkg = require('../package.json');
        console.log(`knowcap-code v${pkg.version}`);
        process.exit(0);
    }
    else if (arg === '--help' || arg === '-h') {
        (0, terminal_1.printHelp)();
        process.exit(0);
    }
    else if (!arg.startsWith('-')) {
        positional.push(arg);
    }
}
// kcc bot [subcommand] — Telegram bot mode (must run before main())
if (positional[0] === 'bot') {
    const subcommand = positional[1] ?? 'start';
    const extraArgs = positional.slice(2);
    (0, index_1.runBotCommand)(subcommand, extraArgs).catch(err => {
        console.error('Bot error:', err.message);
        process.exit(1);
    });
    // Stop here — don't fall through to normal CLI
}
else {
    // If positional args given, treat as one-shot query
    if (positional.length > 0 && positional[0] !== 'setup') {
        opts.oneShot = positional.join(' ');
    }
    main().catch(err => {
        console.error('Fatal error:', err.message);
        process.exit(1);
    });
}
async function main() {
    if (verboseArg)
        (0, terminal_1.setVerboseMode)(true);
    // `kcc setup` — force re-run wizard
    if (runSetup || positional[0] === 'setup') {
        await (0, wizard_1.runSetupWizard)(true);
        return;
    }
    // First run — show setup wizard
    if (!(0, wizard_1.isSetupComplete)()) {
        await (0, wizard_1.runSetupWizard)();
    }
    else if (!opts.provider) {
        // Subsequent runs — silently auto-detect best available provider
        // (overrides default only if current default isn't reachable)
        const detected = await (0, wizard_1.silentAutoDetect)();
        if (detected && !opts.provider) {
            opts.provider = detected.provider;
            if (!opts.model && detected.model) {
                opts.model = detected.model;
            }
        }
    }
    await (0, cli_1.startCLI)(opts);
}
//# sourceMappingURL=index.js.map