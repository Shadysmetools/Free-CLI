#!/usr/bin/env node
import * as dotenv from 'dotenv';
dotenv.config();

import { startCLI } from './cli';

const args = process.argv.slice(2);

// Parse flags
const opts: {
  provider?: string;
  model?: string;
  cwd?: string;
  noColor?: boolean;
  oneShot?: string;
} = {};

const positional: string[] = [];

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
  } else if (arg === '--version' || arg === '-v') {
    const pkg = require('../package.json');
    console.log(`knowcap-code v${pkg.version}`);
    process.exit(0);
  } else if (arg === '--help' || arg === '-h') {
    // Will be printed by startCLI
    const { printHelp } = require('./ui/terminal');
    printHelp();
    process.exit(0);
  } else if (!arg.startsWith('-')) {
    positional.push(arg);
  }
}

// If positional args given, treat as one-shot query
if (positional.length > 0) {
  opts.oneShot = positional.join(' ');
}

// Start
startCLI(opts).catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
