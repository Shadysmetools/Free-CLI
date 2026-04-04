import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import chalk from 'chalk';

import { loadSettings, saveSettings } from './config/settings';
import { loadProjectConfig, initProjectMemory } from './config/project';
import { createProvider, PROVIDER_INFO } from './providers/index';
import { createConversation, compactConversation, clearConversation, getConversationStats, buildSystemPrompt } from './agent/conversation';
import { runAgent } from './agent/core';
import { fileChanges } from './agent/tools';
import { setupMCPClient } from './mcp/config';
import { transcribeFile, transcribeViaGroq, getWhisperInstallInstructions } from './whisper/transcribe';
import { printBanner, printHelp, printError, printSuccess, printInfo, printStatus, printDivider, colors } from './ui/terminal';
import { renderMarkdown } from './ui/markdown';

export interface CLIOptions {
  provider?: string;
  model?: string;
  cwd?: string;
  noColor?: boolean;
  oneShot?: string;
}

export async function startCLI(opts: CLIOptions = {}): Promise<void> {
  // Load config
  const settings = loadSettings();
  const cwd = opts.cwd || process.cwd();
  const projectConfig = loadProjectConfig(cwd);

  // Determine provider
  let providerName = opts.provider || settings.defaultProvider;
  let modelName = opts.model;

  if (modelName) {
    settings.providers[providerName] = settings.providers[providerName] || {};
    settings.providers[providerName].model = modelName;
  }

  // Setup MCP client
  const mcpClient = await setupMCPClient(settings);

  // Create provider
  let provider = createProvider(providerName, settings);

  // Build system prompt
  const systemPrompt = buildSystemPrompt(projectConfig.memoryContent, cwd);

  // Create conversation
  let conversation = createConversation(systemPrompt);

  if (!opts.noColor) {
    printBanner();
  }

  if (projectConfig.memoryFile) {
    printInfo(`📋 Loaded project memory: ${path.relative(cwd, projectConfig.memoryFile)}`);
  }

  const isAvailable = await provider.isAvailable();
  if (!isAvailable) {
    printError(`Provider "${providerName}" is not available. Check your API key or start Ollama.`);
    printInfo(`Tip: Run "ollama pull qwen2.5-coder:7b" for a free local model, or set GROQ_API_KEY for free cloud inference.`);
  }

  console.log(chalk.dim(`\nProvider: ${providerName}/${provider.model} | Type /help for commands\n`));

  // One-shot mode
  if (opts.oneShot) {
    const result = await runAgent(provider, conversation, opts.oneShot, {
      cwd,
      stream: true,
      mcpClient,
    });
    if (result.usage) {
      printStatus(providerName, provider.model, result.usage.total_tokens, 0);
    }
    return;
  }

  // Interactive REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: chalk.cyan('› '),
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // Handle slash commands
    if (input.startsWith('/')) {
      const handled = await handleSlashCommand(input, {
        settings,
        conversation,
        provider,
        providerName,
        cwd,
        mcpClient,
        rl,
        onProviderChange: (newProvider, newName) => {
          provider = newProvider;
          providerName = newName;
        },
        onConversationReset: (newConv) => {
          conversation = newConv;
        },
      });
      if (!handled && input === '/exit') {
        rl.close();
        return;
      }
      rl.prompt();
      return;
    }

    // Regular message → run agent
    try {
      console.log(); // newline before response
      console.log(chalk.green('AI  › '));

      const result = await runAgent(provider, conversation, input, {
        cwd,
        stream: true,
        mcpClient,
      });

      if (result.usage) {
        console.log(chalk.dim(`\n[${providerName}/${provider.model} · ${result.usage.total_tokens} tokens]`));
      }
    } catch (err) {
      printError((err as Error).message);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.dim('\nGoodbye! 👋'));
    process.exit(0);
  });
}

interface SlashCommandContext {
  settings: ReturnType<typeof loadSettings>;
  conversation: ReturnType<typeof createConversation>;
  provider: ReturnType<typeof createProvider>;
  providerName: string;
  cwd: string;
  mcpClient: Awaited<ReturnType<typeof setupMCPClient>>;
  rl: readline.Interface;
  onProviderChange: (provider: ReturnType<typeof createProvider>, name: string) => void;
  onConversationReset: (conv: ReturnType<typeof createConversation>) => void;
}

async function handleSlashCommand(input: string, ctx: SlashCommandContext): Promise<boolean> {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case 'help':
      printHelp();
      return true;

    case 'exit':
    case 'quit':
    case 'q':
      ctx.rl.close();
      process.exit(0);

    case 'clear':
      clearConversation(ctx.conversation);
      printSuccess('Conversation cleared.');
      return true;

    case 'compact': {
      const result = compactConversation(ctx.conversation);
      printSuccess(result);
      return true;
    }

    case 'cost':
    case 'stats': {
      const stats = getConversationStats(ctx.conversation);
      console.log('\n' + chalk.cyan(stats));
      return true;
    }

    case 'config': {
      if (args[0] === 'set' && args[1] && args[2]) {
        // /config set provider.key value
        const [section, key] = args[1].split('.');
        if (section && key) {
          const s = ctx.settings as unknown as Record<string, Record<string, unknown>>;
          s[section] = s[section] || {};
          s[section][key] = args.slice(2).join(' ');
          saveSettings(ctx.settings);
          printSuccess(`Set ${args[1]} = ${args.slice(2).join(' ')}`);
        }
      } else {
        console.log('\n' + chalk.bold('Current Configuration:'));
        console.log(chalk.cyan('Provider:'), ctx.providerName);
        console.log(chalk.cyan('Model:'), ctx.provider.model);
        console.log(chalk.cyan('Working dir:'), ctx.cwd);
        console.log(chalk.cyan('Config file:'), `~/.knowcap-code/config.yaml`);
        console.log('\n' + chalk.bold('Configured providers:'));
        for (const [name, cfg] of Object.entries(ctx.settings.providers)) {
          const info = PROVIDER_INFO[name];
          const hasKey = cfg.apiKey ? '✓ key set' : (info?.requiresKey ? '✗ no key' : 'no key needed');
          console.log(`  ${chalk.yellow(name.padEnd(12))} ${cfg.model?.padEnd(35) || ''} ${chalk.dim(hasKey)}`);
        }
        if (ctx.mcpClient) {
          console.log('\n' + chalk.bold('MCP Servers:'));
          for (const server of ctx.mcpClient.listServers()) {
            console.log(`  ${chalk.green('✓')} ${server}`);
          }
        }
      }
      return true;
    }

    case 'model': {
      if (args.length === 0) {
        // Show available providers
        console.log('\n' + chalk.bold('Available providers:'));
        for (const [name, info] of Object.entries(PROVIDER_INFO)) {
          const current = name === ctx.providerName ? chalk.green(' ← current') : '';
          console.log(`  ${chalk.yellow(name.padEnd(12))} ${chalk.dim(info.description)}${current}`);
        }
        console.log('\nUsage: /model <provider>[:<model>]');
        console.log('Example: /model groq:llama-3.3-70b-versatile');
        console.log('         /model ollama:codellama:7b');
      } else {
        const [newProviderName, ...modelParts] = args[0].split(':');
        const newModelName = modelParts.join(':');
        try {
          if (newModelName) {
            ctx.settings.providers[newProviderName] = ctx.settings.providers[newProviderName] || {};
            ctx.settings.providers[newProviderName].model = newModelName;
          }
          const newProvider = createProvider(newProviderName, ctx.settings);
          ctx.onProviderChange(newProvider, newProviderName);
          printSuccess(`Switched to ${newProviderName}/${newProvider.model}`);
        } catch (err) {
          printError((err as Error).message);
        }
      }
      return true;
    }

    case 'review': {
      const file = args[0] ? `\n\nFocus on: ${args.join(' ')}` : '';
      const message = `Please review the recent code changes and provide feedback on:
1. Correctness and potential bugs
2. Code quality and best practices
3. Performance considerations
4. Security issues
${file}`;
      console.log(chalk.green('\nAI  › '));
      await runAgent(ctx.provider, ctx.conversation, message, {
        cwd: ctx.cwd, stream: true, mcpClient: ctx.mcpClient,
      });
      return true;
    }

    case 'test': {
      const message = 'Please run the project tests and report the results. If tests fail, explain what needs to be fixed.';
      console.log(chalk.green('\nAI  › '));
      await runAgent(ctx.provider, ctx.conversation, message, {
        cwd: ctx.cwd, stream: true, mcpClient: ctx.mcpClient,
      });
      return true;
    }

    case 'diff': {
      const file = args[0] ? `-- "${args[0]}"` : '';
      try {
        const diff = child_process.execSync(`git diff ${file}`, { cwd: ctx.cwd, encoding: 'utf-8' });
        if (!diff.trim()) {
          console.log(chalk.dim('No unstaged changes.'));
        } else {
          // Color the diff output
          diff.split('\n').forEach(line => {
            if (line.startsWith('+') && !line.startsWith('+++')) console.log(chalk.green(line));
            else if (line.startsWith('-') && !line.startsWith('---')) console.log(chalk.red(line));
            else if (line.startsWith('@@')) console.log(chalk.cyan(line));
            else console.log(line);
          });
        }
      } catch {
        console.log(chalk.dim('Not a git repository.'));
      }
      return true;
    }

    case 'git': {
      const gitCmd = args.join(' ') || 'status';
      try {
        const result = child_process.execSync(`git ${gitCmd}`, { cwd: ctx.cwd, encoding: 'utf-8' });
        console.log('\n' + result);
      } catch (err) {
        printError((err as Error).message);
      }
      return true;
    }

    case 'undo': {
      if (fileChanges.length === 0) {
        printInfo('No file changes to undo.');
        return true;
      }
      const last = fileChanges.pop()!;
      try {
        if (last.action === 'create' && last.originalContent === null) {
          // Delete the file
          fs.unlinkSync(last.path);
          printSuccess(`Deleted ${path.relative(ctx.cwd, last.path)}`);
        } else if (last.originalContent !== null) {
          fs.writeFileSync(last.path, last.originalContent, 'utf-8');
          printSuccess(`Restored ${path.relative(ctx.cwd, last.path)}`);
        }
      } catch (err) {
        printError(`Undo failed: ${(err as Error).message}`);
      }
      return true;
    }

    case 'transcribe': {
      const filePath = args.join(' ');
      if (!filePath) {
        console.log(chalk.dim('Usage: /transcribe <audio-or-video-file>'));
        console.log(getWhisperInstallInstructions());
        return true;
      }
      const resolved = path.resolve(ctx.cwd, filePath);
      printInfo(`Transcribing: ${resolved}`);

      const groqKey = ctx.settings.providers.groq?.apiKey || process.env.GROQ_API_KEY;
      try {
        let result;
        if (groqKey) {
          printInfo('Using Groq Whisper API (free)...');
          result = await transcribeViaGroq(resolved, groqKey);
        } else {
          printInfo('Using local Whisper...');
          result = await transcribeFile(resolved, { model: ctx.settings.whisper?.model || 'base' });
        }
        console.log('\n' + chalk.bold('Transcript:'));
        console.log(result.text);
      } catch (err) {
        printError((err as Error).message);
      }
      return true;
    }

    case 'mcp': {
      if (!ctx.mcpClient) {
        console.log(chalk.dim('No MCP servers configured.'));
        console.log('\nAdd MCP servers to ~/.knowcap-code/config.yaml:');
        console.log(chalk.dim(`
mcp:
  servers:
    filesystem:
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allow"]
    github:
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_PERSONAL_ACCESS_TOKEN: your_token
`));
      } else {
        console.log('\n' + chalk.bold('MCP Servers:'));
        for (const server of ctx.mcpClient.listServers()) {
          console.log(`  ${chalk.green('✓')} ${server}`);
        }
        const tools = ctx.mcpClient.listTools();
        if (tools.length > 0) {
          console.log('\n' + chalk.bold('MCP Tools:'));
          for (const t of tools) {
            console.log(`  ${chalk.yellow(t.name.padEnd(30))} ${chalk.dim(t.description.substring(0, 60))}`);
          }
        }
      }
      return true;
    }

    case 'init': {
      const filePath = initProjectMemory(ctx.cwd);
      printSuccess(`Created ${path.relative(ctx.cwd, filePath)}`);
      printInfo('Edit it to add project context for the AI.');
      return true;
    }

    default:
      printError(`Unknown command: /${cmd}. Type /help for available commands.`);
      return true;
  }
}
