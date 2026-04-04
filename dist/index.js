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
const args = process.argv.slice(2);
// Parse flags
const opts = {};
const positional = [];
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
    else if (arg === '--version' || arg === '-v') {
        const pkg = require('../package.json');
        console.log(`knowcap-code v${pkg.version}`);
        process.exit(0);
    }
    else if (arg === '--help' || arg === '-h') {
        // Will be printed by startCLI
        const { printHelp } = require('./ui/terminal');
        printHelp();
        process.exit(0);
    }
    else if (!arg.startsWith('-')) {
        positional.push(arg);
    }
}
// If positional args given, treat as one-shot query
if (positional.length > 0) {
    opts.oneShot = positional.join(' ');
}
// Start
(0, cli_1.startCLI)(opts).catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
//# sourceMappingURL=index.js.map