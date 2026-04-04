import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import chalk from 'chalk';

import { loadSettings, saveSettings } from './config/settings';
import { loadProjectConfig } from './config/project';
import { createProvider, PROVIDER_INFO } from './providers/index';
import { createConversation, compactConversation, clearConversation, getConversationStats, buildSystemPrompt } from './agent/conversation';
import { runAgent } from './agent/core';
import { fileChanges } from './agent/tools';
import { setupMCPClient } from './mcp/config';
import { transcribeFile, transcribeViaGroq, getWhisperInstallInstructions } from './whisper/transcribe';
import { printBanner, printHelp, printError, printSuccess, printInfo, printWarning, printSectionHeader } from './ui/terminal';
import { renderMarkdown } from './ui/markdown';
import { MemoryManager } from './memory/index';
import { SkillsManager } from './skills/index';
import { TokenTracker } from './tracking/tokens';
import { ToolRegistry, createDefaultRegistry } from './registry/index';
import { OpenClawClient } from './openclaw/client';

export interface CLIOptions {
  provider?: string;
  model?: string;
  cwd?: string;
  noColor?: boolean;
  oneShot?: string;
}

export async function startCLI(opts: CLIOptions = {}): Promise<void> {
  const settings = loadSettings();
  const cwd = opts.cwd || process.cwd();
  const projectConfig = loadProjectConfig(cwd);

  // ── Provider setup ────────────────────────────────────────────────────────
  let providerName = opts.provider || settings.defaultProvider;
  let modelName = opts.model;
  if (modelName) {
    settings.providers[providerName] = settings.providers[providerName] || {};
    settings.providers[providerName].model = modelName;
  }

  // ── MCP setup ─────────────────────────────────────────────────────────────
  const mcpClient = await setupMCPClient(settings);

  // ── Provider ──────────────────────────────────────────────────────────────
  let provider = createProvider(providerName, settings);

  // ── Initialize all systems ────────────────────────────────────────────────
  const memory = new MemoryManager(cwd);
  const skills = new SkillsManager(cwd);
  skills.loadAll();
  const tokenTracker = new TokenTracker();
  const registry = createDefaultRegistry();
  if (mcpClient) {
    const mcpTools = await mcpClient.getTools();
    registry.registerMCPTools(mcpTools);
  }

  // Budget from config
  if (settings.budget) {
    tokenTracker.setBudget(settings.budget);
  }

  // ── OpenClaw client (optional) ────────────────────────────────────────────
  let openclawClient: OpenClawClient | null = null;
  if (settings.openclaw?.url) {
    openclawClient = new OpenClawClient({
      url: settings.openclaw.url,
      token: settings.openclaw.token,
    });
  }

  // ── System prompt ─────────────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt({
    cwd,
    projectMemory: projectConfig.memoryContent,
    memoryContext: memory.getSystemContext(),
  });

  let conversation = createConversation(systemPrompt);

  // ── Banner ────────────────────────────────────────────────────────────────
  if (!opts.noColor) {
    printBanner();
  }

  if (projectConfig.memoryFile) {
    printInfo(`📋 Loaded project memory: ${path.relative(cwd, projectConfig.memoryFile)}`);
  }
  const memContent = memory.load();
  if (memContent) {
    printInfo(`🧠 Loaded MEMORY.md`);
  }

  const skillList = skills.list();
  if (skillList.length > 0) {
    printInfo(`🎯 ${skillList.length} skills available (${skillList.map(s => s.name).slice(0, 4).join(', ')}${skillList.length > 4 ? '...' : ''})`);
  }

  // ── OpenClaw agents count (non-blocking) ──────────────────────────────────
  if (openclawClient) {
    openclawClient.getAgentsStatus().then(info => {
      if (info.reachable) {
        const online = info.agents.filter(a => a.online).length;
        const total = info.agents.length;
        console.log(chalk.blue(`🤖 OpenClaw: ${info.gatewayUrl} — ${total} agent${total !== 1 ? 's' : ''} (${online} online)`));
      }
    }).catch(() => { /* non-fatal, skip silently */ });
  }

  const isAvailable = await provider.isAvailable();
  if (!isAvailable) {
    printError(`Provider "${providerName}" is not available. Check your API key or start Ollama.`);
    printInfo(`Tip: Run "ollama pull qwen2.5-coder:7b" for a free local model.`);
  }

  console.log(chalk.dim(`\nProvider: ${providerName}/${provider.model} | Type /help for commands\n`));

  // ── One-shot mode ─────────────────────────────────────────────────────────
  if (opts.oneShot) {
    const result = await runAgent(provider, conversation, opts.oneShot, {
      cwd, stream: true, mcpClient, registry, memory, skills, tokenTracker,
    });
    if (result.usage) {
      console.log(chalk.dim(`\n[${providerName}/${provider.model} · ${result.usage.total_tokens} tokens]`));
    }
    return;
  }

  // ── Interactive REPL ──────────────────────────────────────────────────────
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

    if (input.startsWith('/')) {
      await handleSlashCommand(input, {
        settings, conversation, provider, providerName, cwd, mcpClient, rl,
        memory, skills, tokenTracker, registry, openclawClient,
        onProviderChange: (newProvider, newName) => {
          provider = newProvider;
          providerName = newName;
        },
        onConversationReset: (newConv) => {
          conversation = newConv;
        },
      });
      rl.prompt();
      return;
    }

    // Regular message → run agent
    try {
      console.log();
      console.log(chalk.green('AI  › '));
      await runAgent(provider, conversation, input, {
        cwd, stream: true, mcpClient, registry, memory, skills, tokenTracker,
      });
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

// ─── Slash Command Context ────────────────────────────────────────────────────

interface SlashCommandContext {
  settings: ReturnType<typeof loadSettings>;
  conversation: ReturnType<typeof createConversation>;
  provider: ReturnType<typeof createProvider>;
  providerName: string;
  cwd: string;
  mcpClient: Awaited<ReturnType<typeof setupMCPClient>>;
  rl: readline.Interface;
  memory: MemoryManager;
  skills: SkillsManager;
  tokenTracker: TokenTracker;
  registry: ToolRegistry;
  openclawClient: OpenClawClient | null;
  onProviderChange: (provider: ReturnType<typeof createProvider>, name: string) => void;
  onConversationReset: (conv: ReturnType<typeof createConversation>) => void;
}

// ─── Slash Command Handler ────────────────────────────────────────────────────

async function handleSlashCommand(input: string, ctx: SlashCommandContext): Promise<void> {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {

    // ── Help ──────────────────────────────────────────────────────────────────
    case 'help':
      printHelp();
      break;

    // ── Exit ──────────────────────────────────────────────────────────────────
    case 'exit':
    case 'quit':
    case 'q':
      ctx.rl.close();
      process.exit(0);
      break;

    // ── Conversation ──────────────────────────────────────────────────────────
    case 'clear':
      clearConversation(ctx.conversation);
      printSuccess('Conversation cleared.');
      break;

    case 'compact': {
      const result = compactConversation(ctx.conversation);
      printSuccess(result);
      break;
    }

    // ── Memory ────────────────────────────────────────────────────────────────
    case 'memory': {
      const sub = args[0]?.toLowerCase();
      if (!sub) {
        // Show MEMORY.md contents
        const content = ctx.memory.loadFull();
        if (!content.trim()) {
          printInfo('MEMORY.md is empty. Use /memory save <note> to add notes.');
        } else {
          printSectionHeader('📋 MEMORY.md');
          console.log(content);
        }
      } else if (sub === 'search') {
        const query = args.slice(1).join(' ');
        if (!query) { printError('Usage: /memory search <query>'); break; }
        const results = ctx.memory.search(query);
        if (results.length === 0) {
          printInfo(`No results found for: "${query}"`);
        } else {
          printSectionHeader(`🔍 Memory Search: "${query}"`);
          for (const r of results) {
            console.log(`  ${chalk.magenta(r.file)}:${chalk.dim(String(r.line))}  ${r.content}`);
          }
        }
      } else if (sub === 'save') {
        const note = args.slice(1).join(' ');
        if (!note) { printError('Usage: /memory save <note>'); break; }
        ctx.memory.save(note);
        printSuccess(`Saved to MEMORY.md`);
      } else if (sub === 'clear') {
        console.log(chalk.yellow('\n⚠  This will clear MEMORY.md. Type "yes" to confirm:'));
        // Simple inline confirmation
        const confirm = await new Promise<string>(resolve => {
          const tempRl = readline.createInterface({ input: process.stdin, output: process.stdout });
          tempRl.question('', (ans) => { tempRl.close(); resolve(ans.trim()); });
        });
        if (confirm.toLowerCase() === 'yes') {
          ctx.memory.clear();
          printSuccess('MEMORY.md cleared.');
        } else {
          printInfo('Cancelled.');
        }
      } else if (sub === 'today') {
        const content = ctx.memory.getToday();
        printSectionHeader(`📅 Today's Session Log`);
        console.log(content || chalk.dim('(empty)'));
      } else {
        printError(`Unknown /memory subcommand: ${sub}. Try: /memory, /memory search <q>, /memory save <note>, /memory clear`);
      }
      break;
    }

    // ── Skills ────────────────────────────────────────────────────────────────
    case 'skills': {
      const sub = args[0]?.toLowerCase();
      if (!sub || sub === 'list') {
        const list = ctx.skills.list();
        if (list.length === 0) {
          printInfo('No skills loaded. Add skills to the skills/ folder.');
          break;
        }
        printSectionHeader('🎯 Available Skills');
        for (const s of list) {
          const status = s.enabled ? chalk.green('✓') : chalk.red('✗');
          const source = chalk.dim(`[${s.source}]`);
          const desc = s.description.length > 70 ? s.description.slice(0, 67) + '...' : s.description;
          console.log(`  ${status} ${chalk.bold(s.name.padEnd(16))} ${source} ${chalk.dim(desc)}`);
        }
        console.log(`\n  ${chalk.dim('Usage: /skills info <name> | /skills add <name>')}`);
      } else if (sub === 'info') {
        const name = args[1];
        if (!name) { printError('Usage: /skills info <name>'); break; }
        const skill = ctx.skills.get(name);
        if (!skill) { printError(`Skill not found: ${name}`); break; }
        printSectionHeader(`🎯 Skill: ${skill.name}`);
        console.log(`  Source: ${skill.source} | File: ${chalk.magenta(skill.filePath)}`);
        console.log(`  ${skill.description}\n`);
        console.log(skill.body);
      } else if (sub === 'add') {
        const name = args[1];
        if (!name) { printError('Usage: /skills add <name>'); break; }
        const filePath = ctx.skills.createSkill(name, ctx.cwd);
        ctx.skills.loadAll();
        printSuccess(`Created skill: ${chalk.magenta(filePath)}`);
        printInfo('Edit the SKILL.md file to add your skill instructions.');
      } else {
        printError(`Unknown /skills subcommand: ${sub}. Try: /skills, /skills info <name>, /skills add <name>`);
      }
      break;
    }

    // ── Token / Cost ──────────────────────────────────────────────────────────
    case 'cost':
    case 'stats': {
      console.log(ctx.tokenTracker.formatCostReport());
      break;
    }

    case 'tokens': {
      console.log('\n' + ctx.tokenTracker.formatStatusBar());
      // Also show conversation stats
      const convStats = getConversationStats(ctx.conversation);
      console.log(chalk.dim('  ' + convStats));
      break;
    }

    case 'budget': {
      const amount = parseFloat(args[0]);
      if (isNaN(amount) || amount <= 0) {
        printError('Usage: /budget <amount>  (e.g. /budget 1.00)');
        break;
      }
      ctx.tokenTracker.setBudget(amount);
      ctx.settings.budget = amount;
      saveSettings(ctx.settings);
      printSuccess(`Budget set to $${amount.toFixed(2)} per session`);
      break;
    }

    // ── Tools ─────────────────────────────────────────────────────────────────
    case 'tools': {
      const sub = args[0]?.toLowerCase();
      if (!sub || sub === 'list') {
        printSectionHeader('🔧 Tool Registry');
        console.log(ctx.registry.formatList());
        console.log(chalk.dim('  Usage: /tools info <name> | /tools enable <name> | /tools disable <name>'));
      } else if (sub === 'info') {
        const name = args[1];
        if (!name) { printError('Usage: /tools info <name>'); break; }
        const info = ctx.registry.formatInfo(name);
        if (!info) { printError(`Tool not found: ${name}`); break; }
        console.log(info);
      } else if (sub === 'enable') {
        const name = args[1];
        if (!name) { printError('Usage: /tools enable <name>'); break; }
        if (ctx.registry.enable(name)) {
          printSuccess(`Enabled: ${name}`);
        } else {
          printError(`Tool not found: ${name}`);
        }
      } else if (sub === 'disable') {
        const name = args[1];
        if (!name) { printError('Usage: /tools disable <name>'); break; }
        if (ctx.registry.disable(name)) {
          printWarning(`Disabled: ${name}`);
        } else {
          printError(`Tool not found: ${name}`);
        }
      } else if (sub === 'search') {
        const query = args.slice(1).join(' ');
        if (!query) { printError('Usage: /tools search <query>'); break; }
        const results = ctx.registry.search(query);
        printSectionHeader(`🔍 Tools matching: "${query}"`);
        for (const t of results) {
          const status = t.enabled ? chalk.green('✓') : chalk.red('✗');
          console.log(`  ${status} ${chalk.bold(t.name.padEnd(22))} [${t.category}] ${chalk.dim(t.description.slice(0, 60))}`);
        }
      } else {
        printError(`Unknown /tools subcommand: ${sub}. Try: /tools, /tools info <name>, /tools enable/disable <name>`);
      }
      break;
    }

    // ── OpenClaw ──────────────────────────────────────────────────────────────
    case 'openclaw': {
      if (!ctx.openclawClient) {
        printError('OpenClaw gateway not configured. Add to ~/.knowcap-code/config.yaml:');
        console.log(chalk.dim(`
  openclaw:
    url: "http://localhost:18789"
    token: "your-gateway-token"
`));
        break;
      }
      const sub = args[0]?.toLowerCase();
      await handleOpenClaw(sub ?? 'status', args.slice(1), ctx.openclawClient);
      break;
    }

    // ── Config ────────────────────────────────────────────────────────────────
    case 'config': {
      if (args[0] === 'set' && args[1] && args[2]) {
        const [section, key] = args[1].split('.');
        if (section && key) {
          const s = ctx.settings as unknown as Record<string, Record<string, unknown>>;
          s[section] = s[section] || {};
          s[section][key] = args.slice(2).join(' ');
          saveSettings(ctx.settings);
          printSuccess(`Set ${args[1]} = ${args.slice(2).join(' ')}`);
        }
      } else {
        printSectionHeader('⚙  Configuration');
        console.log(`  ${chalk.cyan('Provider:')}   ${ctx.providerName}`);
        console.log(`  ${chalk.cyan('Model:')}      ${ctx.provider.model}`);
        console.log(`  ${chalk.cyan('Working dir:')} ${ctx.cwd}`);
        console.log(`  ${chalk.cyan('Config:')}     ~/.knowcap-code/config.yaml`);
        console.log(`\n  ${chalk.bold('Providers:')}`);
        for (const [name, cfg] of Object.entries(ctx.settings.providers)) {
          const info = PROVIDER_INFO[name];
          const hasKey = cfg.apiKey ? '✓ key set' : (info?.requiresKey ? '✗ no key' : 'free');
          console.log(`    ${chalk.yellow(name.padEnd(12))} ${(cfg.model ?? '').padEnd(35)} ${chalk.dim(hasKey)}`);
        }
        if (ctx.openclawClient) {
          console.log(`\n  ${chalk.bold('OpenClaw:')} ${ctx.settings.openclaw?.url}`);
        }
        if (ctx.mcpClient) {
          console.log(`\n  ${chalk.bold('MCP Servers:')}`);
          for (const server of ctx.mcpClient.listServers()) {
            console.log(`    ${chalk.green('✓')} ${server}`);
          }
        }
      }
      break;
    }

    // ── Model ─────────────────────────────────────────────────────────────────
    case 'model': {
      if (args.length === 0) {
        printSectionHeader('Available Providers');
        for (const [name, info] of Object.entries(PROVIDER_INFO)) {
          const current = name === ctx.providerName ? chalk.green(' ← current') : '';
          console.log(`  ${chalk.yellow(name.padEnd(12))} ${chalk.dim(info.description)}${current}`);
        }
        console.log('\nUsage: /model <provider>[:<model>]');
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
      break;
    }

    // ── Code commands ─────────────────────────────────────────────────────────
    case 'review': {
      const file = args[0] ? `\n\nFocus on: ${args.join(' ')}` : '';
      const message = `Please review the recent code changes and provide feedback on correctness, code quality, performance considerations, and security issues.${file}`;
      console.log(chalk.green('\nAI  › '));
      await runAgent(ctx.provider, ctx.conversation, message, {
        cwd: ctx.cwd, stream: true, mcpClient: ctx.mcpClient,
        registry: ctx.registry, memory: ctx.memory, skills: ctx.skills, tokenTracker: ctx.tokenTracker,
      });
      break;
    }

    case 'test': {
      const message = 'Please run the project tests and report the results. If tests fail, explain what needs to be fixed.';
      console.log(chalk.green('\nAI  › '));
      await runAgent(ctx.provider, ctx.conversation, message, {
        cwd: ctx.cwd, stream: true, mcpClient: ctx.mcpClient,
        registry: ctx.registry, memory: ctx.memory, skills: ctx.skills, tokenTracker: ctx.tokenTracker,
      });
      break;
    }

    case 'diff': {
      const file = args[0] ? `-- "${args[0]}"` : '';
      try {
        const diff = child_process.execSync(`git diff ${file}`, { cwd: ctx.cwd, encoding: 'utf-8' });
        if (!diff.trim()) {
          printInfo('No unstaged changes.');
        } else {
          diff.split('\n').forEach(line => {
            if (line.startsWith('+') && !line.startsWith('+++')) console.log(chalk.green(line));
            else if (line.startsWith('-') && !line.startsWith('---')) console.log(chalk.red(line));
            else if (line.startsWith('@@')) console.log(chalk.cyan(line));
            else console.log(line);
          });
        }
      } catch {
        printInfo('Not a git repository.');
      }
      break;
    }

    case 'git': {
      const gitCmd = args.join(' ') || 'status';
      try {
        const result = child_process.execSync(`git ${gitCmd}`, { cwd: ctx.cwd, encoding: 'utf-8' });
        console.log('\n' + result);
      } catch (err) {
        printError((err as Error).message);
      }
      break;
    }

    case 'undo': {
      if (fileChanges.length === 0) {
        printInfo('No file changes to undo.');
        break;
      }
      const last = fileChanges.pop()!;
      try {
        if (last.action === 'create' && last.originalContent === null) {
          fs.unlinkSync(last.path);
          printSuccess(`Deleted ${path.relative(ctx.cwd, last.path)}`);
        } else if (last.originalContent !== null) {
          fs.writeFileSync(last.path, last.originalContent, 'utf-8');
          printSuccess(`Restored ${path.relative(ctx.cwd, last.path)}`);
        }
      } catch (err) {
        printError(`Undo failed: ${(err as Error).message}`);
      }
      break;
    }

    case 'transcribe': {
      const filePath = args.join(' ');
      if (!filePath) {
        printInfo('Usage: /transcribe <audio-or-video-file>');
        console.log(getWhisperInstallInstructions());
        break;
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
        printSectionHeader('Transcript');
        console.log(result.text);
      } catch (err) {
        printError((err as Error).message);
      }
      break;
    }

    case 'mcp': {
      if (!ctx.mcpClient) {
        printInfo('No MCP servers configured. Add to ~/.knowcap-code/config.yaml under mcp.servers');
        break;
      }
      printSectionHeader('🔌 MCP Servers');
      for (const server of ctx.mcpClient.listServers()) {
        console.log(`  ${chalk.green('✓')} ${server}`);
      }
      const tools = ctx.mcpClient.listTools();
      if (tools.length > 0) {
        console.log(`\n  ${chalk.bold('Tools:')}`);
        for (const t of tools) {
          console.log(`  ${chalk.yellow(t.name.padEnd(30))} ${chalk.dim(t.description.slice(0, 60))}`);
        }
      }
      break;
    }

    case 'init': {
      const { initProjectMemory } = await import('./config/project');
      const filePath = initProjectMemory(ctx.cwd);
      printSuccess(`Created ${path.relative(ctx.cwd, filePath)}`);
      printInfo('Edit it to add project context for the AI.');
      break;
    }

    default:
      printError(`Unknown command: /${cmd}. Type /help for available commands.`);
  }
}

// ─── OpenClaw sub-commands ────────────────────────────────────────────────────

async function handleOpenClaw(sub: string, args: string[], client: OpenClawClient): Promise<void> {
  switch (sub) {
    case 'status': {
      printSectionHeader('🤖 OpenClaw Gateway');
      const info = await client.getAgentsStatus();

      const gwIndicator = info.gatewayStatus.running
        ? chalk.green('✅ running')
        : chalk.red('❌ stopped');
      const apiIndicator = info.reachable
        ? chalk.green('✓ reachable')
        : chalk.red('✗ unreachable');

      console.log(`\n  Gateway:  ${gwIndicator}  ${chalk.dim(info.gatewayUrl)}`);
      if (info.gatewayStatus.version) console.log(`  Version:  ${info.gatewayStatus.version}`);
      console.log(`  HTTP API: ${apiIndicator}`);

      if (info.agents.length > 0) {
        const online = info.agents.filter(a => a.online).length;
        console.log(`\n  Agents: ${online} online / ${info.agents.length} total\n`);
        for (const a of info.agents) {
          const dot = a.online ? chalk.green('🟢') : chalk.red('🔴');
          const sessions = a.sessionCount > 0 ? chalk.dim(` (${a.sessionCount} session${a.sessionCount !== 1 ? 's' : ''})`) : '';
          const model = a.model ? chalk.dim(` · ${a.model}`) : '';
          const activity = a.lastActivity ? chalk.dim(` · ${a.lastActivity}`) : '';
          console.log(`  ${dot} ${chalk.bold(a.id)}${model}${sessions}${activity}`);
        }
      } else if (info.reachable) {
        console.log(chalk.dim('\n  No active agent sessions found.'));
      }

      if (!info.gatewayStatus.running && info.gatewayStatus.raw) {
        console.log(chalk.dim('\n  ' + info.gatewayStatus.raw.split('\n').slice(0, 5).join('\n  ')));
      }
      console.log();
      break;
    }

    case 'agents': {
      printSectionHeader('🤖 OpenClaw Agents');
      try {
        const agents = await client.listAgents();
        if (agents.length === 0) {
          printInfo('No agents found.');
        } else {
          for (const a of agents) {
            const model = a.model ? chalk.dim(` · ${a.model}`) : '';
            console.log(`  ${chalk.bold(a.id)}${model}`);
          }
        }
      } catch (err) {
        printError(`Failed: ${(err as Error).message}`);
      }
      break;
    }

    case 'sessions': {
      printSectionHeader('💬 OpenClaw Sessions');
      try {
        const sessions = await client.listSessions({ limit: 20, activeMinutes: 60 * 24 });
        if (sessions.length === 0) {
          printInfo('No active sessions found.');
        } else {
          for (const s of sessions) {
            console.log(`  ${client.formatSessionRow(s)}`);
          }
        }
      } catch (err) {
        printError(`Failed: ${(err as Error).message}`);
      }
      break;
    }

    case 'send': {
      // /openclaw send <sessionKey> <message...>
      const [sessionKey, ...msgParts] = args;
      const message = msgParts.join(' ');
      if (!sessionKey || !message) {
        printError('Usage: /openclaw send <session-key> <message>');
        break;
      }
      printInfo(`Sending to ${sessionKey}...`);
      try {
        const result = await client.sendMessage(sessionKey, message, 30);
        printSuccess(`Status: ${result.status}`);
        if (result.reply) {
          console.log('\n' + chalk.green('Reply › ') + result.reply);
        }
      } catch (err) {
        printError(`Failed: ${(err as Error).message}`);
      }
      break;
    }

    case 'history': {
      const sessionKey = args[0];
      if (!sessionKey) {
        printError('Usage: /openclaw history <session-key>');
        break;
      }
      printSectionHeader(`📜 Session History: ${sessionKey}`);
      try {
        const messages = await client.getSessionHistory(sessionKey, { limit: 20 });
        for (const m of messages) {
          const role = m.role === 'user' ? chalk.cyan('User') : chalk.green('AI  ');
          const content = m.content.length > 200 ? m.content.slice(0, 197) + '...' : m.content;
          console.log(`\n${role} › ${content}`);
        }
      } catch (err) {
        printError(`Failed: ${(err as Error).message}`);
      }
      break;
    }

    case 'cron': {
      printSectionHeader('⏰ OpenClaw Cron Jobs');
      const jobs = client.listCronJobs();
      if (jobs.length === 0) {
        printInfo('No cron jobs found or openclaw CLI not available.');
      } else {
        for (const job of jobs) {
          const schedule = job.schedule ? chalk.dim(` · ${job.schedule}`) : '';
          const status = job.status ? ` [${job.status}]` : '';
          console.log(`  ${chalk.bold(job.id)}${schedule}${chalk.dim(status)}`);
        }
      }
      break;
    }

    default:
      printError(`Unknown /openclaw subcommand: ${sub}. Try: status, agents, sessions, send, history, cron`);
  }
}
