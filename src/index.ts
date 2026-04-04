#!/usr/bin/env node
import * as dotenv from 'dotenv';
dotenv.config();

import { startCLI } from './cli';
import { runSetupWizard, isSetupComplete, silentAutoDetect } from './setup/wizard';
import { printHelp, setVerboseMode } from './ui/terminal';
import { runBotCommand } from './bot/index';

const args = process.argv.slice(2);

// Parse flags
const opts: {
  provider?: string;
  model?: string;
  cwd?: string;
  noColor?: boolean;
  oneShot?: string;
} = {};
let verboseArg = false;

const positional: string[] = [];
let runSetup = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--provider' || arg === '-p') {
    opts.provider = args[++i];
  } else if (arg === '--model' || arg === '-m') {
    opts.model = args[++i];
  } else if (arg === '--cwd') {
    opts.cwd = args[++i];
  } else if (arg === '--no-color') {
    opts.noColor = true;
  } else if (arg === '--verbose' || arg === '-V') {
    verboseArg = true;
  } else if (arg === '--setup' || arg === 'setup') {
    runSetup = true;
  } else if (arg === '--version' || arg === '-v') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../package.json') as { version: string };
    console.log(`knowcap-code v${pkg.version}`);
    process.exit(0);
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  } else if (!arg.startsWith('-')) {
    positional.push(arg);
  }
}

// kcc bot [subcommand] — Telegram bot mode (must run before main())
if (positional[0] === 'bot') {
  const subcommand = positional[1] ?? 'start';
  const extraArgs = positional.slice(2);
  runBotCommand(subcommand, extraArgs).catch(err => {
    console.error('Bot error:', (err as Error).message);
    process.exit(1);
  });
  // Stop here — don't fall through to normal CLI
} else {
  // If positional args given, treat as one-shot query
  if (positional.length > 0 && positional[0] !== 'setup') {
    opts.oneShot = positional.join(' ');
  }

  main().catch(err => {
    console.error('Fatal error:', (err as Error).message);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  if (verboseArg) setVerboseMode(true);

  // `kcc setup` — force re-run wizard
  if (runSetup || positional[0] === 'setup') {
    await runSetupWizard(true);
    return;
  }

  // First run — show setup wizard
  if (!isSetupComplete()) {
    await runSetupWizard();
  } else if (!opts.provider) {
    // Subsequent runs — silently auto-detect best available provider
    // (overrides default only if current default isn't reachable)
    const detected = await silentAutoDetect();
    if (detected && !opts.provider) {
      opts.provider = detected.provider;
      if (!opts.model && detected.model) {
        opts.model = detected.model;
      }
    }
  }

  await startCLI(opts);
}
