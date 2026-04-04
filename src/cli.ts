import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import chalk from 'chalk';

import { loadSettings, saveSettings } from './config/settings';
import { loadProjectConfig } from './config/project';
import { createProvider, PROVIDER_INFO, PROVIDER_MODELS } from './providers/index';
import { checkAllProviders } from './providers/fallback';
import { createConversation, compactConversation, clearConversation, getConversationStats, buildSystemPrompt } from './agent/conversation';
import { runAgent } from './agent/core';
import { fileChanges } from './agent/tools';
import { setupMCPClient } from './mcp/config';
import { transcribeFile, transcribeViaGroq, getWhisperInstallInstructions } from './whisper/transcribe';
import { printBanner, printHelp, printError, printSuccess, printInfo, printWarning, printSectionHeader, printBox, createSpinner } from './ui/terminal';
import { renderMarkdown } from './ui/markdown';
import { MemoryManager } from './memory/index';
import { SkillsManager } from './skills/index';
import { TokenTracker } from './tracking/tokens';
import { ToolRegistry, createDefaultRegistry } from './registry/index';
import { OpenClawClient } from './openclaw/client';
import { HistoryManager, formatRelativeTime } from './history/index';
import { ProfileManager } from './profile/index';
import { ragSearch } from './rag/rerank';
import { listRoles, BUILTIN_ROLES } from './agents/roles';
import { generateDiagram as renderDiagram, generateImage as renderImage, detectDiagramType, buildDiagramPrompt, mermaidPreview } from './diagrams/index';
import { PersonaManager, resolvePersonaId } from './persona/index';

export interface CLIOptions {
  provider?: string;
  model?: string;
  cwd?: string;
  noColor?: boolean;
  oneShot?: string;
  resumeSession?: string;  // session id to resume
  noHistory?: boolean;     // skip history auto-save
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
  const profile = new ProfileManager();
  const persona = new PersonaManager();
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

  // ── System prompt builder (re-used on provider/persona change) ────────────
  const buildSystem = () => buildSystemPrompt({
    cwd,
    projectMemory: projectConfig.memoryContent,
    memoryContext: memory.getSystemContext(),
    profileContext: profile.buildSystemBlock(cwd),
    personaContext: persona.buildSystemBlock(),
  });

  // ── History ───────────────────────────────────────────────────────────────
  const history = new HistoryManager(providerName, provider.model, cwd);

  let conversation = createConversation(buildSystem());

  // ── Banner ────────────────────────────────────────────────────────────────
  if (!opts.noColor) {
    printBanner();
  }

  // 👤 Profile greeting
  if (!profile.isEmpty()) {
    const name = profile.getName();
    const role = profile.getRole();
    const greeting = name ? `👤 Hello, ${chalk.bold(name)}${role ? chalk.dim(` (${role})`) : ''}!` : '👤 Profile loaded';
    console.log(chalk.cyan(greeting));
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
    printInfo(`🎯 ${skillList.length} skill${skillList.length !== 1 ? 's' : ''} available (${skillList.map(s => s.name).slice(0, 4).join(', ')}${skillList.length > 4 ? '...' : ''})`);
  }

  // 🎭 Show active persona if not default
  if (!persona.isDefault()) {
    const p = persona.getActive();
    const flag = p.flag ?? '🎭';
    console.log(chalk.magenta(`${flag}  Persona: ${p.name}${p.nativeName ? ` (${p.nativeName})` : ''}`));
  }

  // ── OpenClaw agents count (non-blocking) ──────────────────────────────────
  if (openclawClient) {
    openclawClient.getAgentsStatus().then(info => {
      if (info.reachable) {
        const online = info.agents.filter(a => a.online).length;
        const total = info.agents.length;
        console.log(chalk.blue(`🤖 OpenClaw: ${info.gatewayUrl} — ${total} agent${total !== 1 ? 's' : ''} (${online} online)`));
      }
    }).catch(() => { /* non-fatal */ });
  }

  const isAvailable = await provider.isAvailable();
  if (!isAvailable) {
    printError(`Provider "${providerName}" is not available. Check your API key or start Ollama.`);
    printInfo(`Tip: Run "ollama pull qwen2.5-coder:7b" for a free local model.`);
  }

  // Status bar: provider · persona
  const personaTag = persona.isDefault() ? '' : chalk.magenta(` · ${persona.getActive().flag ?? '🎭'} ${persona.getActive().id}`);
  console.log(chalk.dim(`\nProvider: ${providerName}/${provider.model}${personaTag} | Type /help for commands\n`));

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
        history, profile, persona,
        onProviderChange: (newProvider, newName) => {
          provider = newProvider;
          providerName = newName;
        },
        onConversationReset: (newConv) => {
          conversation = newConv;
        },
        onSystemUpdate: () => {
          // Rebuild system prompt when persona/profile changes
          const msgs = conversation.messages;
          const sysIdx = msgs.findIndex(m => m.role === 'system');
          if (sysIdx >= 0) msgs[sysIdx].content = buildSystem();
        },
      });
      rl.prompt();
      return;
    }

    // Regular message → run agent
    // Save to history before + after
    history.addMessage({ role: 'user', content: input });
    try {
      console.log();
      console.log(chalk.green('AI  › '));
      const result = await runAgent(provider, conversation, input, {
        cwd, stream: true, mcpClient, registry, memory, skills, tokenTracker,
      });
      if (result.content) {
        history.addMessage({ role: 'assistant', content: result.content });
      }
    } catch (err) {
      printError((err as Error).message);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    history.save();
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
  history: HistoryManager;
  profile: ProfileManager;
  persona: PersonaManager;
  onProviderChange: (provider: ReturnType<typeof createProvider>, name: string) => void;
  onConversationReset: (conv: ReturnType<typeof createConversation>) => void;
  onSystemUpdate: () => void;
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
        console.log(chalk.dim('       /models  — see all models per provider'));
      } else {
        // Parse provider:model (model may contain colons e.g. openrouter:meta-llama/llama-3.3-70b:free)
        const colonIdx = args[0].indexOf(':');
        const newProviderName = colonIdx >= 0 ? args[0].slice(0, colonIdx) : args[0];
        const newModelName = colonIdx >= 0 ? args[0].slice(colonIdx + 1) : '';
        try {
          if (newModelName) {
            ctx.settings.providers[newProviderName] = ctx.settings.providers[newProviderName] || {};
            ctx.settings.providers[newProviderName].model = newModelName;
          }
          const newProvider = createProvider(newProviderName, ctx.settings);
          ctx.onProviderChange(newProvider, newProviderName);
          saveSettings(ctx.settings);
          printSuccess(`Switched to ${newProviderName}/${newProvider.model}`);
        } catch (err) {
          printError((err as Error).message);
        }
      }
      break;
    }

    // ── Models catalog ────────────────────────────────────────────────────────
    case 'models': {
      const filterProvider = args[0]?.toLowerCase();
      console.log('');
      printSectionHeader('📋 Available Models');
      console.log('');

      for (const [provName, models] of Object.entries(PROVIDER_MODELS)) {
        if (filterProvider && provName !== filterProvider) continue;

        const info = PROVIDER_INFO[provName];
        const isCurrent = provName === ctx.providerName;
        const currentTag = isCurrent ? chalk.green(' ← active') : '';
        const tierTag = info?.requiresKey ? chalk.yellow('BYOK') : chalk.green('free');
        const keyTag = provName !== 'ollama'
          ? (ctx.settings.providers[provName]?.apiKey ? chalk.green('key ✓') : chalk.dim('no key'))
          : chalk.dim('local');

        console.log(`${chalk.bold(provName.toUpperCase())} ${tierTag} ${keyTag}${currentTag}`);

        for (const m of models) {
          const recTag = m.recommended ? chalk.cyan(' ★') : '';
          const freeTag = m.free ? '' : chalk.yellow(' $');
          const isCurModel = isCurrent && ctx.provider.model === m.id;
          const curTag = isCurModel ? chalk.green(' ◀ current') : '';
          console.log(`  ${chalk.dim('›')} ${chalk.white(m.id.padEnd(52))}${chalk.dim(m.label)}${recTag}${freeTag}${curTag}`);
        }
        console.log('');
      }

      console.log(chalk.dim('Switch: /model <provider>:<model>'));
      console.log(chalk.dim('Example: /model openrouter:meta-llama/llama-3.3-70b-instruct:free'));
      console.log(chalk.dim('         /model google:gemini-2.5-pro'));
      console.log(chalk.dim('         /model groq:llama-3.1-8b-instant'));
      console.log('');
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

    // ── Persona ───────────────────────────────────────────────────────────────
    case 'persona': {
      const sub = args[0]?.toLowerCase();

      if (!sub || sub === 'list') {
        printSectionHeader('🎭 Personas');
        console.log(ctx.persona.formatList());

      } else if (sub === 'set') {
        const query = args.slice(1).join(' ');
        if (!query) { printError('Usage: /persona set <id>  e.g. /persona set franco'); break; }
        const resolved = resolvePersonaId(query);
        const p = ctx.persona.setActive(resolved);
        if (!p) {
          printError(`Persona not found: "${query}". Run /persona list to see options.`);
          break;
        }
        const flag = p.flag ?? '🎭';
        console.log(`\n${chalk.magenta(`${flag}  Persona set: `)}${chalk.bold(p.name)}${p.nativeName ? chalk.dim(` (${p.nativeName})`) : ''}`);
        if (p.id === 'franco') {
          console.log(chalk.dim('  Numbers: 3=ع 7=ح 2=أ 5=خ 8=غ 6=ط 9=ق'));
        }
        ctx.onSystemUpdate();
        printSuccess(`AI will now respond in ${p.name}`);

      } else if (sub === 'reset' || sub === 'clear') {
        ctx.persona.setActive('english');
        ctx.onSystemUpdate();
        printSuccess('Persona reset to English (default)');

      } else if (sub === 'create') {
        // /persona create <id> <name> <lang> [system-prompt...]
        const id = args[1];
        const name = args[2];
        const lang = args[3];
        const prompt = args.slice(4).join(' ');
        if (!id || !name || !lang) {
          printError('Usage: /persona create <id> <name> <lang-code> [system-prompt]');
          printInfo('Example: /persona create hinglish "Hindi-English" hi-en Respond in Hinglish mix.');
          break;
        }
        const p = ctx.persona.createCustom(id, name, lang,
          prompt || `Respond in ${name} language.`);
        printSuccess(`Created custom persona: ${p.name} (${p.id})`);
        printInfo(`Use: /persona set ${p.id}`);

      } else if (sub === 'delete') {
        const id = args[1];
        if (!id) { printError('Usage: /persona delete <id>'); break; }
        if (ctx.persona.deleteCustom(id)) {
          printSuccess(`Deleted persona: ${id}`);
          ctx.onSystemUpdate();
        } else {
          printError(`Cannot delete "${id}" — not found or it's a built-in.`);
        }

      } else if (sub === 'info') {
        const query = args.slice(1).join(' ');
        const resolved = resolvePersonaId(query || ctx.persona.getActive().id);
        const p = ctx.persona.find(resolved);
        if (!p) { printError(`Persona not found: ${query}`); break; }
        printSectionHeader(`${p.flag ?? '🎭'} ${p.name}`);
        console.log(`  ID: ${p.id}  |  Language: ${p.language}  |  Source: ${p.source}`);
        if (p.nativeName) console.log(`  Native name: ${p.nativeName}`);
        console.log(`\n  System prompt:\n`);
        p.systemPrompt.split('\n').slice(0, 10).forEach(l => console.log(`    ${chalk.dim(l)}`));
        if (p.systemPrompt.split('\n').length > 10) console.log(chalk.dim(`    … (${p.systemPrompt.split('\n').length - 10} more lines)`));

      } else {
        printError(`Unknown /persona subcommand: ${sub}. Try: list, set, reset, create, delete, info`);
      }
      break;
    }

    // ── Lang shortcut ─────────────────────────────────────────────────────────
    case 'lang': {
      const query = args.join(' ');
      if (!query) {
        const p = ctx.persona.getActive();
        console.log(`\n  Current language: ${p.flag ?? '🎭'} ${chalk.bold(p.name)} (${p.language})`);
        console.log(chalk.dim('  Use /lang <code>  e.g. /lang franco  /lang egyptian  /lang fr'));
        break;
      }
      const resolved = resolvePersonaId(query);
      const p = ctx.persona.setActive(resolved);
      if (!p) {
        printError(`Language/persona not found: "${query}". Run /persona list to see options.`);
        break;
      }
      ctx.onSystemUpdate();
      console.log(`\n${p.flag ?? '🎭'} ${chalk.bold(`Language: ${p.name}`)}${p.nativeName ? chalk.dim(` (${p.nativeName})`) : ''}`);
      break;
    }

    // ── History ───────────────────────────────────────────────────────────────
    case 'history': {
      const sub = args[0]?.toLowerCase();

      if (!sub || sub === 'list') {
        const days = parseInt(args[1] || '30', 10);
        const sessions = HistoryManager.list(isNaN(days) ? 30 : days);
        if (sessions.length === 0) {
          printInfo('No saved sessions found.');
          break;
        }
        printSectionHeader(`📜 Session History (last ${days || 30} days)`);
        console.log('');
        for (const s of sessions.slice(0, 25)) {
          const age = formatRelativeTime(s.updatedAt);
          const msgs = chalk.dim(`${s.messageCount} msgs`);
          const prov = chalk.dim(`${s.provider}/${s.model}`);
          const title = s.title.length > 55 ? s.title.slice(0, 52) + '…' : s.title;
          console.log(`  ${chalk.cyan(s.id)}  ${chalk.bold(title)}`);
          console.log(`            ${chalk.dim(age)} · ${msgs} · ${prov}`);
        }
        console.log(`\n  ${chalk.dim('Use: /history load <id>  |  /history export <id>  |  /history search <query>')}`);

      } else if (sub === 'load' || sub === 'resume') {
        const id = args[1];
        if (!id) { printError('Usage: /history load <session-id>'); break; }
        const record = HistoryManager.load(id);
        if (!record) { printError(`Session not found: ${id}`); break; }
        // Rebuild conversation from saved messages
        const sysMsg = ctx.conversation.messages.find(m => m.role === 'system');
        ctx.conversation.messages.length = 0;
        if (sysMsg) ctx.conversation.messages.push(sysMsg);
        for (const m of record.messages) {
          if (m.role !== 'system') ctx.conversation.messages.push(m);
        }
        printSuccess(`Loaded session: ${record.title}`);
        printInfo(`${record.messageCount} messages restored · ${record.provider}/${record.model}`);

      } else if (sub === 'export') {
        const id = args[1] ?? ctx.history.getCurrentId();
        const record = HistoryManager.load(id);
        if (!record) { printError(`Session not found: ${id}`); break; }
        const md = HistoryManager.exportMarkdown(record);
        const outFile = `session-${id}.md`;
        const { writeFileSync } = await import('fs');
        writeFileSync(path.resolve(ctx.cwd, outFile), md, 'utf-8');
        printSuccess(`Exported to: ${outFile}`);

      } else if (sub === 'search') {
        const query = args.slice(1).join(' ');
        if (!query) { printError('Usage: /history search <query>'); break; }
        const results = HistoryManager.search(query);
        if (results.length === 0) {
          printInfo(`No sessions found matching: "${query}"`);
          break;
        }
        printSectionHeader(`🔍 History Search: "${query}"`);
        for (const r of results) {
          const age = formatRelativeTime(r.session.updatedAt);
          console.log(`\n  ${chalk.cyan(r.session.id)}  ${chalk.bold(r.session.title)}`);
          console.log(`  ${chalk.dim(age)} · ${chalk.dim(r.snippet)}`);
        }

      } else if (sub === 'delete') {
        const id = args[1];
        if (!id) { printError('Usage: /history delete <session-id>'); break; }
        if (HistoryManager.delete(id)) {
          printSuccess(`Deleted session: ${id}`);
        } else {
          printError(`Session not found: ${id}`);
        }

      } else if (sub === 'current') {
        const id = ctx.history.getCurrentId();
        const title = ctx.history.getCurrentTitle();
        console.log(`\n  Current session: ${chalk.cyan(id)}`);
        console.log(`  Title: ${chalk.bold(title)}`);

      } else {
        printError(`Unknown /history subcommand: ${sub}. Try: list, load, export, search, delete, current`);
      }
      break;
    }

    // ── Profile ───────────────────────────────────────────────────────────────
    case 'profile': {
      const sub = args[0]?.toLowerCase();

      if (!sub || sub === 'show') {
        printSectionHeader('👤 Your Profile');
        console.log(ctx.profile.format());

      } else if (sub === 'set') {
        // /profile set name "Shady"  OR  /profile set pref.language TypeScript
        const key = args[1];
        const value = args.slice(2).join(' ');
        if (!key || !value) {
          printError('Usage: /profile set <field> <value>');
          printInfo('Fields: name, role, company, email, custom_instructions');
          printInfo('Prefs:  pref.language, pref.style, pref.expertise, pref.review_strictness');
          break;
        }
        if (key.startsWith('pref.')) {
          const prefKey = key.slice(5);
          ctx.profile.setPreference(prefKey, value);
          printSuccess(`Preference set: ${prefKey} = ${value}`);
        } else {
          ctx.profile.set({ [key]: value });
          printSuccess(`Profile updated: ${key} = ${value}`);
        }
        ctx.onSystemUpdate();

      } else if (sub === 'add-project') {
        const name = args[1];
        const stack = args.slice(2).join(' ');
        if (!name) { printError('Usage: /profile add-project <name> [stack]'); break; }
        ctx.profile.addProject({ name, path: ctx.cwd, stack: stack || undefined });
        printSuccess(`Added project: ${name}${stack ? ` (${stack})` : ''}`);
        ctx.onSystemUpdate();

      } else if (sub === 'edit') {
        const filePath = ProfileManager.profilePath();
        printInfo(`Profile file: ${filePath}`);
        try {
          child_process.execSync(`${process.env.EDITOR || 'nano'} "${filePath}"`, { stdio: 'inherit' });
          ctx.onSystemUpdate();
          printSuccess('Profile saved.');
        } catch { printInfo('Open the file manually to edit it.'); }

      } else {
        printError(`Unknown /profile subcommand: ${sub}. Try: show, set, add-project, edit`);
      }
      break;
    }

    // ── Plan ──────────────────────────────────────────────────────────────────
    case 'plan': {
      const task = args.join(' ');
      if (!task) {
        printError('Usage: /plan <what to build>');
        printInfo('Example: /plan Build a user authentication system with JWT');
        break;
      }

      const spinner = createSpinner('Generating execution plan…');
      spinner.start();

      const planPrompt = `You are a senior technical planner. Create a detailed, step-by-step execution plan for:

"${task}"

Output format (STRICTLY follow this):

## Plan: [Short Title]
**Summary:** [1-2 sentences describing what will be built]
**Complexity:** High | Medium | Low
**Estimated steps:** [N]

### Steps:
1. 📐 [architect] [What the architect does] → [file(s) or area]
2. 💻 [coder] [What to implement] → [file(s)]
3. 💻 [coder] [Next implementation] → [file(s)]
4. 🧪 [tester] [What tests to write] → [test file(s)]
5. 🔍 [reviewer] [What to review] → [file(s)]
6. 📝 [documenter] [What docs to write] → [file]

### Risks:
- [Key risk or open question]

Be specific about filenames and actions. Max 8 steps.`;

      try {
        spinner.stop();
        console.log('');
        const planRole = BUILTIN_ROLES['planner'];
        const planConv = createConversation(planRole.systemPrompt);
        let planText = '';
        await runAgent(ctx.provider, planConv, planPrompt, {
          cwd: ctx.cwd, stream: false, mcpClient: ctx.mcpClient,
          registry: ctx.registry, memory: ctx.memory, skills: ctx.skills, tokenTracker: ctx.tokenTracker,
          onToken: (t) => { planText += t; },
        });

        // Display the plan in a formatted box
        printSectionHeader('🎯 Execution Plan');
        console.log('');

        const lines = planText.split('\n');
        for (const line of lines) {
          if (line.startsWith('## Plan:')) {
            console.log(chalk.bold.cyan(line));
          } else if (line.startsWith('**Summary:**')) {
            console.log(chalk.white(line));
          } else if (line.startsWith('**Complexity:**')) {
            const lvl = line.includes('High') ? chalk.red(line) : line.includes('Medium') ? chalk.yellow(line) : chalk.green(line);
            console.log(lvl);
          } else if (/^\d+\.\s/.test(line)) {
            console.log(chalk.cyan('  ' + line));
          } else if (line.startsWith('### Risks')) {
            console.log('\n' + chalk.bold.yellow(line));
          } else if (line.startsWith('- ')) {
            console.log(chalk.yellow('  ' + line));
          } else if (line.trim()) {
            console.log(chalk.dim('  ' + line));
          }
        }

        console.log('');
        console.log(chalk.dim('  Execute this plan? Just say "go" or ask me to start with step 1.'));
        console.log('');

        // Also save plan to history
        ctx.history.addMessage({ role: 'user', content: `/plan ${task}` });
        ctx.history.addMessage({ role: 'assistant', content: planText });

      } catch (err) {
        spinner.stop();
        printError(`Plan generation failed: ${(err as Error).message}`);
      }
      break;
    }

    // ── Agents ────────────────────────────────────────────────────────────────
    case 'agents': {
      const sub = args[0]?.toLowerCase();
      if (!sub || sub === 'list') {
        printSectionHeader('🤖 Available Agent Roles');
        console.log('');
        for (const role of listRoles()) {
          console.log(`  ${role.icon}  ${chalk.bold(role.id.padEnd(14))} ${chalk.dim(role.description)}`);
        }
        console.log(`\n  ${chalk.dim('Use: /plan <task> — orchestrate agents on a task')}`);
        console.log('');
      } else if (sub === 'info') {
        const roleId = args[1];
        if (!roleId) { printError('Usage: /agents info <role-id>'); break; }
        const role = BUILTIN_ROLES[roleId];
        if (!role) { printError(`Role not found: ${roleId}. Run /agents list`); break; }
        printSectionHeader(`${role.icon} Agent Role: ${role.name}`);
        console.log(`\n  ${role.description}`);
        if (role.allowedTools?.length) {
          console.log(`\n  Allowed tools: ${role.allowedTools.join(', ')}`);
        }
        console.log(`\n  System prompt preview:\n`);
        role.systemPrompt.split('\n').slice(0, 6).forEach(l => console.log(`    ${chalk.dim(l)}`));
      } else {
        printError(`Unknown /agents subcommand: ${sub}. Try: list, info <role>`);
      }
      break;
    }

    // ── RAG ───────────────────────────────────────────────────────────────────
    case 'rag': {
      const sub = args[0]?.toLowerCase();
      if (!sub || sub === 'search') {
        const query = args.slice(1).join(' ');
        if (!query) { printError('Usage: /rag search <query>'); break; }

        printSectionHeader(`🔍 RAG Search: "${query}"`);
        const spinner2 = createSpinner('Searching codebase…');
        spinner2.start();

        const results = ragSearch(query, ctx.cwd, { topK: 10 });
        spinner2.stop(`Found ${results.length} results`);

        if (results.length === 0) {
          printInfo('No results found.');
          break;
        }
        console.log('');
        for (const r of results) {
          const score = chalk.dim(`(${(r.score * 100).toFixed(0)}%)`);
          console.log(`  ${chalk.magenta(r.relativePath)}${chalk.dim(':' + r.line)}  ${score}`);
          if (r.content.trim()) {
            console.log(`    ${chalk.dim(r.content.trim().slice(0, 100))}`);
          }
        }
        console.log('');
      } else if (sub === 'status') {
        printSectionHeader('📚 RAG Status');
        printInfo(`Working directory: ${ctx.cwd}`);
        printInfo('Keyword + pattern search (RRF) — no index required');
        printInfo('Run /rag search <query> to search your codebase');
      } else {
        printError(`Unknown /rag subcommand: ${sub}. Try: search <query>, status`);
      }
      break;
    }

    // ── Diagram ───────────────────────────────────────────────────────────────
    case 'diagram':
    case 'architecture': {
      const desc = args.join(' ');
      if (!desc) {
        printError(`Usage: /${cmd} <description>`);
        printInfo('Examples:');
        printInfo('  /diagram auth flow with JWT and refresh tokens');
        printInfo('  /architecture microservices app with API gateway');
        break;
      }

      const diagramType = cmd === 'architecture' ? 'architecture' : detectDiagramType(desc);
      const spinner3 = createSpinner(`Generating ${diagramType} diagram…`);
      spinner3.start();

      try {
        // Ask the AI to produce Mermaid code
        const diagramPrompt = buildDiagramPrompt(desc, diagramType);
        const diagramConv = createConversation(
          'You are a technical diagram specialist. Output ONLY Mermaid code — no explanation, no markdown fences.'
        );
        let mermaidCode = '';
        await runAgent(ctx.provider, diagramConv, diagramPrompt, {
          cwd: ctx.cwd, stream: false, mcpClient: ctx.mcpClient,
          registry: ctx.registry, memory: ctx.memory, skills: ctx.skills,
          tokenTracker: ctx.tokenTracker,
          onToken: (t) => { mermaidCode += t; },
        });

        // Strip markdown fences if AI included them
        mermaidCode = mermaidCode
          .replace(/^```mermaid\s*/i, '').replace(/^```\s*/i, '')
          .replace(/```\s*$/, '').trim();

        spinner3.stop('Mermaid code generated');

        // Show preview
        printSectionHeader(`🎨 ${diagramType.charAt(0).toUpperCase() + diagramType.slice(1)} Diagram`);
        console.log('');
        console.log(chalk.cyan('┌─ Mermaid code ─────────────────────────────────'));
        mermaidPreview(mermaidCode).split('\n').forEach(l =>
          console.log(chalk.cyan('│ ') + chalk.dim(l))
        );
        console.log(chalk.cyan('└────────────────────────────────────────────────'));
        console.log('');

        // Render to file
        const safeName = desc.slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const outFile = path.resolve(ctx.cwd, `${safeName}.png`);
        const renderSpinner = createSpinner('Rendering PNG with Mermaid CLI…');
        renderSpinner.start();

        const result = await renderDiagram({
          type: diagramType,
          code: mermaidCode,
          outputPath: outFile,
          format: 'png',
        });

        const kb = (result.sizeBytes / 1024).toFixed(1);
        renderSpinner.stop(`Saved: ${path.relative(ctx.cwd, result.outputPath)} (${kb} KB)`);
        printSuccess(`✅ Diagram saved: ${path.relative(ctx.cwd, result.outputPath)}`);

      } catch (err) {
        spinner3.stop();
        printError(`Diagram failed: ${(err as Error).message}`);
      }
      break;
    }

    // ── Image ─────────────────────────────────────────────────────────────────
    case 'image': {
      const prompt = args.join(' ');
      if (!prompt) {
        printError('Usage: /image <prompt>');
        printInfo('Requires: OPENAI_API_KEY (DALL-E 3) or STABILITY_API_KEY');
        printInfo('Without keys: generates a placeholder SVG');
        break;
      }

      const imgSpinner = createSpinner('🎨 Generating image…');
      imgSpinner.start();

      try {
        const safeName = prompt.slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const outFile = path.resolve(ctx.cwd, `${safeName}.png`);

        const result = await renderImage({
          prompt,
          outputPath: outFile,
          size: '1024x1024',
          onProgress: (msg) => imgSpinner.stop(msg),
        });

        const kb = (result.sizeBytes / 1024).toFixed(1);
        const provLabel = result.provider === 'dalle' ? 'DALL-E 3' :
                          result.provider === 'stability' ? 'Stability AI' : 'Placeholder SVG';
        printSuccess(`✅ Image saved: ${path.relative(ctx.cwd, result.outputPath)} (${kb} KB) via ${provLabel}`);

      } catch (err) {
        imgSpinner.stop();
        printError(`Image generation failed: ${(err as Error).message}`);
      }
      break;
    }

    // ── Providers status ──────────────────────────────────────────────────────
    case 'providers': {
      console.log('');
      printSectionHeader('🔌 Provider Status');
      console.log('');
      const spinner = createSpinner('Checking providers…');
      spinner.start();
      const statuses = await checkAllProviders();
      spinner.stop('');

      for (const s of statuses) {
        const dot = s.available ? chalk.green('🟢') : chalk.red('🔴');
        const label = s.available ? chalk.green(s.label) : chalk.dim(s.label);
        const model = chalk.dim(` — ${s.model}`);
        const reason = chalk.dim(` (${s.reason})`);
        const isCurrent = s.id === ctx.providerName;
        const curTag = isCurrent ? chalk.cyan(' ← active') : '';
        console.log(`  ${dot} ${label}${model}${reason}${curTag}`);
      }

      const available = statuses.filter(s => s.available).length;
      console.log('');
      console.log(chalk.dim(`  ${available}/${statuses.length} providers available`));
      console.log(chalk.dim('  /models — see all models  |  /model <provider>:<model> — switch'));
      console.log('');
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
