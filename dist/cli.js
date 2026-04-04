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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCLI = startCLI;
const readline = __importStar(require("readline"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process = __importStar(require("child_process"));
const chalk_1 = __importDefault(require("chalk"));
const settings_1 = require("./config/settings");
const project_1 = require("./config/project");
const index_1 = require("./providers/index");
const fallback_1 = require("./providers/fallback");
const conversation_1 = require("./agent/conversation");
const core_1 = require("./agent/core");
const tools_1 = require("./agent/tools");
const config_1 = require("./mcp/config");
const transcribe_1 = require("./whisper/transcribe");
const terminal_1 = require("./ui/terminal");
const index_2 = require("./memory/index");
const index_3 = require("./skills/index");
const tokens_1 = require("./tracking/tokens");
const index_4 = require("./registry/index");
const client_1 = require("./openclaw/client");
const index_5 = require("./history/index");
const index_6 = require("./profile/index");
const rerank_1 = require("./rag/rerank");
const roles_1 = require("./agents/roles");
const index_7 = require("./diagrams/index");
const index_8 = require("./persona/index");
async function startCLI(opts = {}) {
    const settings = (0, settings_1.loadSettings)();
    const cwd = opts.cwd || process.cwd();
    const projectConfig = (0, project_1.loadProjectConfig)(cwd);
    // ── Provider setup ────────────────────────────────────────────────────────
    let providerName = opts.provider || settings.defaultProvider;
    let modelName = opts.model;
    if (modelName) {
        settings.providers[providerName] = settings.providers[providerName] || {};
        settings.providers[providerName].model = modelName;
    }
    // ── MCP setup ─────────────────────────────────────────────────────────────
    const mcpClient = await (0, config_1.setupMCPClient)(settings);
    // ── Provider ──────────────────────────────────────────────────────────────
    let provider = (0, index_1.createProvider)(providerName, settings);
    // ── Initialize all systems ────────────────────────────────────────────────
    const memory = new index_2.MemoryManager(cwd);
    const skills = new index_3.SkillsManager(cwd);
    skills.loadAll();
    const tokenTracker = new tokens_1.TokenTracker();
    const registry = (0, index_4.createDefaultRegistry)();
    const profile = new index_6.ProfileManager();
    const persona = new index_8.PersonaManager();
    if (mcpClient) {
        const mcpTools = await mcpClient.getTools();
        registry.registerMCPTools(mcpTools);
    }
    // Budget from config
    if (settings.budget) {
        tokenTracker.setBudget(settings.budget);
    }
    // ── OpenClaw client (optional) ────────────────────────────────────────────
    let openclawClient = null;
    if (settings.openclaw?.url) {
        openclawClient = new client_1.OpenClawClient({
            url: settings.openclaw.url,
            token: settings.openclaw.token,
        });
    }
    // ── System prompt builder (re-used on provider/persona change) ────────────
    const buildSystem = () => (0, conversation_1.buildSystemPrompt)({
        cwd,
        projectMemory: projectConfig.memoryContent,
        memoryContext: memory.getSystemContext(),
        profileContext: profile.buildSystemBlock(cwd),
        personaContext: persona.buildSystemBlock(),
    });
    // ── History ───────────────────────────────────────────────────────────────
    const history = new index_5.HistoryManager(providerName, provider.model, cwd);
    let conversation = (0, conversation_1.createConversation)(buildSystem());
    // ── Banner ────────────────────────────────────────────────────────────────
    if (!opts.noColor) {
        (0, terminal_1.printBanner)();
    }
    // 👤 Profile greeting
    if (!profile.isEmpty()) {
        const name = profile.getName();
        const role = profile.getRole();
        const greeting = name ? `👤 Hello, ${chalk_1.default.bold(name)}${role ? chalk_1.default.dim(` (${role})`) : ''}!` : '👤 Profile loaded';
        console.log(chalk_1.default.cyan(greeting));
    }
    if (projectConfig.memoryFile) {
        (0, terminal_1.printInfo)(`📋 Loaded project memory: ${path.relative(cwd, projectConfig.memoryFile)}`);
    }
    const memContent = memory.load();
    if (memContent) {
        (0, terminal_1.printInfo)(`🧠 Loaded MEMORY.md`);
    }
    const skillList = skills.list();
    if (skillList.length > 0) {
        (0, terminal_1.printInfo)(`🎯 ${skillList.length} skill${skillList.length !== 1 ? 's' : ''} available (${skillList.map(s => s.name).slice(0, 4).join(', ')}${skillList.length > 4 ? '...' : ''})`);
    }
    // 🎭 Show active persona if not default
    if (!persona.isDefault()) {
        const p = persona.getActive();
        const flag = p.flag ?? '🎭';
        console.log(chalk_1.default.magenta(`${flag}  Persona: ${p.name}${p.nativeName ? ` (${p.nativeName})` : ''}`));
    }
    // ── OpenClaw agents count (non-blocking) ──────────────────────────────────
    if (openclawClient) {
        openclawClient.getAgentsStatus().then(info => {
            if (info.reachable) {
                const online = info.agents.filter(a => a.online).length;
                const total = info.agents.length;
                console.log(chalk_1.default.blue(`🤖 OpenClaw: ${info.gatewayUrl} — ${total} agent${total !== 1 ? 's' : ''} (${online} online)`));
            }
        }).catch(() => { });
    }
    const isAvailable = await provider.isAvailable();
    if (!isAvailable) {
        (0, terminal_1.printError)(`Provider "${providerName}" is not available. Check your API key or start Ollama.`);
        (0, terminal_1.printInfo)(`Tip: Run "ollama pull qwen2.5-coder:7b" for a free local model.`);
    }
    // Status bar: provider · persona
    const personaTag = persona.isDefault() ? '' : chalk_1.default.magenta(` · ${persona.getActive().flag ?? '🎭'} ${persona.getActive().id}`);
    console.log(chalk_1.default.dim(`\nProvider: ${providerName}/${provider.model}${personaTag} | Type /help for commands\n`));
    // ── One-shot mode ─────────────────────────────────────────────────────────
    if (opts.oneShot) {
        const result = await (0, core_1.runAgent)(provider, conversation, opts.oneShot, {
            cwd, stream: true, mcpClient, registry, memory, skills, tokenTracker,
        });
        if (result.usage) {
            console.log(chalk_1.default.dim(`\n[${providerName}/${provider.model} · ${result.usage.total_tokens} tokens]`));
        }
        return;
    }
    // ── Interactive REPL ──────────────────────────────────────────────────────
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: chalk_1.default.cyan('› '),
    });
    rl.prompt();
    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }
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
                    if (sysIdx >= 0)
                        msgs[sysIdx].content = buildSystem();
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
            console.log(chalk_1.default.green('AI  › '));
            const result = await (0, core_1.runAgent)(provider, conversation, input, {
                cwd, stream: true, mcpClient, registry, memory, skills, tokenTracker,
            });
            if (result.content) {
                history.addMessage({ role: 'assistant', content: result.content });
            }
        }
        catch (err) {
            (0, terminal_1.printError)(err.message);
        }
        rl.prompt();
    });
    rl.on('close', () => {
        history.save();
        console.log(chalk_1.default.dim('\nGoodbye! 👋'));
        process.exit(0);
    });
}
// ─── Slash Command Handler ────────────────────────────────────────────────────
async function handleSlashCommand(input, ctx) {
    const parts = input.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    switch (cmd) {
        // ── Help ──────────────────────────────────────────────────────────────────
        case 'help':
            (0, terminal_1.printHelp)();
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
            (0, conversation_1.clearConversation)(ctx.conversation);
            (0, terminal_1.printSuccess)('Conversation cleared.');
            break;
        case 'compact': {
            const result = (0, conversation_1.compactConversation)(ctx.conversation);
            (0, terminal_1.printSuccess)(result);
            break;
        }
        // ── Memory ────────────────────────────────────────────────────────────────
        case 'memory': {
            const sub = args[0]?.toLowerCase();
            if (!sub) {
                // Show MEMORY.md contents
                const content = ctx.memory.loadFull();
                if (!content.trim()) {
                    (0, terminal_1.printInfo)('MEMORY.md is empty. Use /memory save <note> to add notes.');
                }
                else {
                    (0, terminal_1.printSectionHeader)('📋 MEMORY.md');
                    console.log(content);
                }
            }
            else if (sub === 'search') {
                const query = args.slice(1).join(' ');
                if (!query) {
                    (0, terminal_1.printError)('Usage: /memory search <query>');
                    break;
                }
                const results = ctx.memory.search(query);
                if (results.length === 0) {
                    (0, terminal_1.printInfo)(`No results found for: "${query}"`);
                }
                else {
                    (0, terminal_1.printSectionHeader)(`🔍 Memory Search: "${query}"`);
                    for (const r of results) {
                        console.log(`  ${chalk_1.default.magenta(r.file)}:${chalk_1.default.dim(String(r.line))}  ${r.content}`);
                    }
                }
            }
            else if (sub === 'save') {
                const note = args.slice(1).join(' ');
                if (!note) {
                    (0, terminal_1.printError)('Usage: /memory save <note>');
                    break;
                }
                ctx.memory.save(note);
                (0, terminal_1.printSuccess)(`Saved to MEMORY.md`);
            }
            else if (sub === 'clear') {
                console.log(chalk_1.default.yellow('\n⚠  This will clear MEMORY.md. Type "yes" to confirm:'));
                // Simple inline confirmation
                const confirm = await new Promise(resolve => {
                    const tempRl = readline.createInterface({ input: process.stdin, output: process.stdout });
                    tempRl.question('', (ans) => { tempRl.close(); resolve(ans.trim()); });
                });
                if (confirm.toLowerCase() === 'yes') {
                    ctx.memory.clear();
                    (0, terminal_1.printSuccess)('MEMORY.md cleared.');
                }
                else {
                    (0, terminal_1.printInfo)('Cancelled.');
                }
            }
            else if (sub === 'today') {
                const content = ctx.memory.getToday();
                (0, terminal_1.printSectionHeader)(`📅 Today's Session Log`);
                console.log(content || chalk_1.default.dim('(empty)'));
            }
            else {
                (0, terminal_1.printError)(`Unknown /memory subcommand: ${sub}. Try: /memory, /memory search <q>, /memory save <note>, /memory clear`);
            }
            break;
        }
        // ── Skills ────────────────────────────────────────────────────────────────
        case 'skills': {
            const sub = args[0]?.toLowerCase();
            if (!sub || sub === 'list') {
                const list = ctx.skills.list();
                if (list.length === 0) {
                    (0, terminal_1.printInfo)('No skills loaded. Add skills to the skills/ folder.');
                    break;
                }
                (0, terminal_1.printSectionHeader)('🎯 Available Skills');
                for (const s of list) {
                    const status = s.enabled ? chalk_1.default.green('✓') : chalk_1.default.red('✗');
                    const source = chalk_1.default.dim(`[${s.source}]`);
                    const desc = s.description.length > 70 ? s.description.slice(0, 67) + '...' : s.description;
                    console.log(`  ${status} ${chalk_1.default.bold(s.name.padEnd(16))} ${source} ${chalk_1.default.dim(desc)}`);
                }
                console.log(`\n  ${chalk_1.default.dim('Usage: /skills info <name> | /skills add <name>')}`);
            }
            else if (sub === 'info') {
                const name = args[1];
                if (!name) {
                    (0, terminal_1.printError)('Usage: /skills info <name>');
                    break;
                }
                const skill = ctx.skills.get(name);
                if (!skill) {
                    (0, terminal_1.printError)(`Skill not found: ${name}`);
                    break;
                }
                (0, terminal_1.printSectionHeader)(`🎯 Skill: ${skill.name}`);
                console.log(`  Source: ${skill.source} | File: ${chalk_1.default.magenta(skill.filePath)}`);
                console.log(`  ${skill.description}\n`);
                console.log(skill.body);
            }
            else if (sub === 'add') {
                const name = args[1];
                if (!name) {
                    (0, terminal_1.printError)('Usage: /skills add <name>');
                    break;
                }
                const filePath = ctx.skills.createSkill(name, ctx.cwd);
                ctx.skills.loadAll();
                (0, terminal_1.printSuccess)(`Created skill: ${chalk_1.default.magenta(filePath)}`);
                (0, terminal_1.printInfo)('Edit the SKILL.md file to add your skill instructions.');
            }
            else {
                (0, terminal_1.printError)(`Unknown /skills subcommand: ${sub}. Try: /skills, /skills info <name>, /skills add <name>`);
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
            const convStats = (0, conversation_1.getConversationStats)(ctx.conversation);
            console.log(chalk_1.default.dim('  ' + convStats));
            break;
        }
        case 'budget': {
            const amount = parseFloat(args[0]);
            if (isNaN(amount) || amount <= 0) {
                (0, terminal_1.printError)('Usage: /budget <amount>  (e.g. /budget 1.00)');
                break;
            }
            ctx.tokenTracker.setBudget(amount);
            ctx.settings.budget = amount;
            (0, settings_1.saveSettings)(ctx.settings);
            (0, terminal_1.printSuccess)(`Budget set to $${amount.toFixed(2)} per session`);
            break;
        }
        // ── Tools ─────────────────────────────────────────────────────────────────
        case 'tools': {
            const sub = args[0]?.toLowerCase();
            if (!sub || sub === 'list') {
                (0, terminal_1.printSectionHeader)('🔧 Tool Registry');
                console.log(ctx.registry.formatList());
                console.log(chalk_1.default.dim('  Usage: /tools info <name> | /tools enable <name> | /tools disable <name>'));
            }
            else if (sub === 'info') {
                const name = args[1];
                if (!name) {
                    (0, terminal_1.printError)('Usage: /tools info <name>');
                    break;
                }
                const info = ctx.registry.formatInfo(name);
                if (!info) {
                    (0, terminal_1.printError)(`Tool not found: ${name}`);
                    break;
                }
                console.log(info);
            }
            else if (sub === 'enable') {
                const name = args[1];
                if (!name) {
                    (0, terminal_1.printError)('Usage: /tools enable <name>');
                    break;
                }
                if (ctx.registry.enable(name)) {
                    (0, terminal_1.printSuccess)(`Enabled: ${name}`);
                }
                else {
                    (0, terminal_1.printError)(`Tool not found: ${name}`);
                }
            }
            else if (sub === 'disable') {
                const name = args[1];
                if (!name) {
                    (0, terminal_1.printError)('Usage: /tools disable <name>');
                    break;
                }
                if (ctx.registry.disable(name)) {
                    (0, terminal_1.printWarning)(`Disabled: ${name}`);
                }
                else {
                    (0, terminal_1.printError)(`Tool not found: ${name}`);
                }
            }
            else if (sub === 'search') {
                const query = args.slice(1).join(' ');
                if (!query) {
                    (0, terminal_1.printError)('Usage: /tools search <query>');
                    break;
                }
                const results = ctx.registry.search(query);
                (0, terminal_1.printSectionHeader)(`🔍 Tools matching: "${query}"`);
                for (const t of results) {
                    const status = t.enabled ? chalk_1.default.green('✓') : chalk_1.default.red('✗');
                    console.log(`  ${status} ${chalk_1.default.bold(t.name.padEnd(22))} [${t.category}] ${chalk_1.default.dim(t.description.slice(0, 60))}`);
                }
            }
            else {
                (0, terminal_1.printError)(`Unknown /tools subcommand: ${sub}. Try: /tools, /tools info <name>, /tools enable/disable <name>`);
            }
            break;
        }
        // ── OpenClaw ──────────────────────────────────────────────────────────────
        case 'openclaw': {
            if (!ctx.openclawClient) {
                (0, terminal_1.printError)('OpenClaw gateway not configured. Add to ~/.knowcap-code/config.yaml:');
                console.log(chalk_1.default.dim(`
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
                    const s = ctx.settings;
                    s[section] = s[section] || {};
                    s[section][key] = args.slice(2).join(' ');
                    (0, settings_1.saveSettings)(ctx.settings);
                    (0, terminal_1.printSuccess)(`Set ${args[1]} = ${args.slice(2).join(' ')}`);
                }
            }
            else {
                (0, terminal_1.printSectionHeader)('⚙  Configuration');
                console.log(`  ${chalk_1.default.cyan('Provider:')}   ${ctx.providerName}`);
                console.log(`  ${chalk_1.default.cyan('Model:')}      ${ctx.provider.model}`);
                console.log(`  ${chalk_1.default.cyan('Working dir:')} ${ctx.cwd}`);
                console.log(`  ${chalk_1.default.cyan('Config:')}     ~/.knowcap-code/config.yaml`);
                console.log(`\n  ${chalk_1.default.bold('Providers:')}`);
                for (const [name, cfg] of Object.entries(ctx.settings.providers)) {
                    const info = index_1.PROVIDER_INFO[name];
                    const hasKey = cfg.apiKey ? '✓ key set' : (info?.requiresKey ? '✗ no key' : 'free');
                    console.log(`    ${chalk_1.default.yellow(name.padEnd(12))} ${(cfg.model ?? '').padEnd(35)} ${chalk_1.default.dim(hasKey)}`);
                }
                if (ctx.openclawClient) {
                    console.log(`\n  ${chalk_1.default.bold('OpenClaw:')} ${ctx.settings.openclaw?.url}`);
                }
                if (ctx.mcpClient) {
                    console.log(`\n  ${chalk_1.default.bold('MCP Servers:')}`);
                    for (const server of ctx.mcpClient.listServers()) {
                        console.log(`    ${chalk_1.default.green('✓')} ${server}`);
                    }
                }
            }
            break;
        }
        // ── Model ─────────────────────────────────────────────────────────────────
        case 'model': {
            if (args.length === 0) {
                (0, terminal_1.printSectionHeader)('Available Providers');
                for (const [name, info] of Object.entries(index_1.PROVIDER_INFO)) {
                    const current = name === ctx.providerName ? chalk_1.default.green(' ← current') : '';
                    console.log(`  ${chalk_1.default.yellow(name.padEnd(12))} ${chalk_1.default.dim(info.description)}${current}`);
                }
                console.log('\nUsage: /model <provider>[:<model>]');
                console.log(chalk_1.default.dim('       /models  — see all models per provider'));
            }
            else {
                // Parse provider:model (model may contain colons e.g. openrouter:meta-llama/llama-3.3-70b:free)
                const colonIdx = args[0].indexOf(':');
                const newProviderName = colonIdx >= 0 ? args[0].slice(0, colonIdx) : args[0];
                const newModelName = colonIdx >= 0 ? args[0].slice(colonIdx + 1) : '';
                try {
                    if (newModelName) {
                        ctx.settings.providers[newProviderName] = ctx.settings.providers[newProviderName] || {};
                        ctx.settings.providers[newProviderName].model = newModelName;
                    }
                    const newProvider = (0, index_1.createProvider)(newProviderName, ctx.settings);
                    ctx.onProviderChange(newProvider, newProviderName);
                    (0, settings_1.saveSettings)(ctx.settings);
                    (0, terminal_1.printSuccess)(`Switched to ${newProviderName}/${newProvider.model}`);
                }
                catch (err) {
                    (0, terminal_1.printError)(err.message);
                }
            }
            break;
        }
        // ── Models catalog ────────────────────────────────────────────────────────
        case 'models': {
            const filterProvider = args[0]?.toLowerCase();
            console.log('');
            (0, terminal_1.printSectionHeader)('📋 Available Models');
            console.log('');
            for (const [provName, models] of Object.entries(index_1.PROVIDER_MODELS)) {
                if (filterProvider && provName !== filterProvider)
                    continue;
                const info = index_1.PROVIDER_INFO[provName];
                const isCurrent = provName === ctx.providerName;
                const currentTag = isCurrent ? chalk_1.default.green(' ← active') : '';
                const tierTag = info?.requiresKey ? chalk_1.default.yellow('BYOK') : chalk_1.default.green('free');
                const keyTag = provName !== 'ollama'
                    ? (ctx.settings.providers[provName]?.apiKey ? chalk_1.default.green('key ✓') : chalk_1.default.dim('no key'))
                    : chalk_1.default.dim('local');
                console.log(`${chalk_1.default.bold(provName.toUpperCase())} ${tierTag} ${keyTag}${currentTag}`);
                for (const m of models) {
                    const recTag = m.recommended ? chalk_1.default.cyan(' ★') : '';
                    const freeTag = m.free ? '' : chalk_1.default.yellow(' $');
                    const isCurModel = isCurrent && ctx.provider.model === m.id;
                    const curTag = isCurModel ? chalk_1.default.green(' ◀ current') : '';
                    console.log(`  ${chalk_1.default.dim('›')} ${chalk_1.default.white(m.id.padEnd(52))}${chalk_1.default.dim(m.label)}${recTag}${freeTag}${curTag}`);
                }
                console.log('');
            }
            console.log(chalk_1.default.dim('Switch: /model <provider>:<model>'));
            console.log(chalk_1.default.dim('Example: /model openrouter:meta-llama/llama-3.3-70b-instruct:free'));
            console.log(chalk_1.default.dim('         /model google:gemini-2.5-pro'));
            console.log(chalk_1.default.dim('         /model groq:llama-3.1-8b-instant'));
            console.log('');
            break;
        }
        // ── Code commands ─────────────────────────────────────────────────────────
        case 'review': {
            const file = args[0] ? `\n\nFocus on: ${args.join(' ')}` : '';
            const message = `Please review the recent code changes and provide feedback on correctness, code quality, performance considerations, and security issues.${file}`;
            console.log(chalk_1.default.green('\nAI  › '));
            await (0, core_1.runAgent)(ctx.provider, ctx.conversation, message, {
                cwd: ctx.cwd, stream: true, mcpClient: ctx.mcpClient,
                registry: ctx.registry, memory: ctx.memory, skills: ctx.skills, tokenTracker: ctx.tokenTracker,
            });
            break;
        }
        case 'test': {
            const message = 'Please run the project tests and report the results. If tests fail, explain what needs to be fixed.';
            console.log(chalk_1.default.green('\nAI  › '));
            await (0, core_1.runAgent)(ctx.provider, ctx.conversation, message, {
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
                    (0, terminal_1.printInfo)('No unstaged changes.');
                }
                else {
                    diff.split('\n').forEach(line => {
                        if (line.startsWith('+') && !line.startsWith('+++'))
                            console.log(chalk_1.default.green(line));
                        else if (line.startsWith('-') && !line.startsWith('---'))
                            console.log(chalk_1.default.red(line));
                        else if (line.startsWith('@@'))
                            console.log(chalk_1.default.cyan(line));
                        else
                            console.log(line);
                    });
                }
            }
            catch {
                (0, terminal_1.printInfo)('Not a git repository.');
            }
            break;
        }
        case 'git': {
            const gitCmd = args.join(' ') || 'status';
            try {
                const result = child_process.execSync(`git ${gitCmd}`, { cwd: ctx.cwd, encoding: 'utf-8' });
                console.log('\n' + result);
            }
            catch (err) {
                (0, terminal_1.printError)(err.message);
            }
            break;
        }
        case 'undo': {
            if (tools_1.fileChanges.length === 0) {
                (0, terminal_1.printInfo)('No file changes to undo.');
                break;
            }
            const last = tools_1.fileChanges.pop();
            try {
                if (last.action === 'create' && last.originalContent === null) {
                    fs.unlinkSync(last.path);
                    (0, terminal_1.printSuccess)(`Deleted ${path.relative(ctx.cwd, last.path)}`);
                }
                else if (last.originalContent !== null) {
                    fs.writeFileSync(last.path, last.originalContent, 'utf-8');
                    (0, terminal_1.printSuccess)(`Restored ${path.relative(ctx.cwd, last.path)}`);
                }
            }
            catch (err) {
                (0, terminal_1.printError)(`Undo failed: ${err.message}`);
            }
            break;
        }
        case 'transcribe': {
            const filePath = args.join(' ');
            if (!filePath) {
                (0, terminal_1.printInfo)('Usage: /transcribe <audio-or-video-file>');
                console.log((0, transcribe_1.getWhisperInstallInstructions)());
                break;
            }
            const resolved = path.resolve(ctx.cwd, filePath);
            (0, terminal_1.printInfo)(`Transcribing: ${resolved}`);
            const groqKey = ctx.settings.providers.groq?.apiKey || process.env.GROQ_API_KEY;
            try {
                let result;
                if (groqKey) {
                    (0, terminal_1.printInfo)('Using Groq Whisper API (free)...');
                    result = await (0, transcribe_1.transcribeViaGroq)(resolved, groqKey);
                }
                else {
                    (0, terminal_1.printInfo)('Using local Whisper...');
                    result = await (0, transcribe_1.transcribeFile)(resolved, { model: ctx.settings.whisper?.model || 'base' });
                }
                (0, terminal_1.printSectionHeader)('Transcript');
                console.log(result.text);
            }
            catch (err) {
                (0, terminal_1.printError)(err.message);
            }
            break;
        }
        case 'mcp': {
            if (!ctx.mcpClient) {
                (0, terminal_1.printInfo)('No MCP servers configured. Add to ~/.knowcap-code/config.yaml under mcp.servers');
                break;
            }
            (0, terminal_1.printSectionHeader)('🔌 MCP Servers');
            for (const server of ctx.mcpClient.listServers()) {
                console.log(`  ${chalk_1.default.green('✓')} ${server}`);
            }
            const tools = ctx.mcpClient.listTools();
            if (tools.length > 0) {
                console.log(`\n  ${chalk_1.default.bold('Tools:')}`);
                for (const t of tools) {
                    console.log(`  ${chalk_1.default.yellow(t.name.padEnd(30))} ${chalk_1.default.dim(t.description.slice(0, 60))}`);
                }
            }
            break;
        }
        case 'init': {
            const { initProjectMemory } = await Promise.resolve().then(() => __importStar(require('./config/project')));
            const filePath = initProjectMemory(ctx.cwd);
            (0, terminal_1.printSuccess)(`Created ${path.relative(ctx.cwd, filePath)}`);
            (0, terminal_1.printInfo)('Edit it to add project context for the AI.');
            break;
        }
        // ── Persona ───────────────────────────────────────────────────────────────
        case 'persona': {
            const sub = args[0]?.toLowerCase();
            if (!sub || sub === 'list') {
                (0, terminal_1.printSectionHeader)('🎭 Personas');
                console.log(ctx.persona.formatList());
            }
            else if (sub === 'set') {
                const query = args.slice(1).join(' ');
                if (!query) {
                    (0, terminal_1.printError)('Usage: /persona set <id>  e.g. /persona set franco');
                    break;
                }
                const resolved = (0, index_8.resolvePersonaId)(query);
                const p = ctx.persona.setActive(resolved);
                if (!p) {
                    (0, terminal_1.printError)(`Persona not found: "${query}". Run /persona list to see options.`);
                    break;
                }
                const flag = p.flag ?? '🎭';
                console.log(`\n${chalk_1.default.magenta(`${flag}  Persona set: `)}${chalk_1.default.bold(p.name)}${p.nativeName ? chalk_1.default.dim(` (${p.nativeName})`) : ''}`);
                if (p.id === 'franco') {
                    console.log(chalk_1.default.dim('  Numbers: 3=ع 7=ح 2=أ 5=خ 8=غ 6=ط 9=ق'));
                }
                ctx.onSystemUpdate();
                (0, terminal_1.printSuccess)(`AI will now respond in ${p.name}`);
            }
            else if (sub === 'reset' || sub === 'clear') {
                ctx.persona.setActive('english');
                ctx.onSystemUpdate();
                (0, terminal_1.printSuccess)('Persona reset to English (default)');
            }
            else if (sub === 'create') {
                // /persona create <id> <name> <lang> [system-prompt...]
                const id = args[1];
                const name = args[2];
                const lang = args[3];
                const prompt = args.slice(4).join(' ');
                if (!id || !name || !lang) {
                    (0, terminal_1.printError)('Usage: /persona create <id> <name> <lang-code> [system-prompt]');
                    (0, terminal_1.printInfo)('Example: /persona create hinglish "Hindi-English" hi-en Respond in Hinglish mix.');
                    break;
                }
                const p = ctx.persona.createCustom(id, name, lang, prompt || `Respond in ${name} language.`);
                (0, terminal_1.printSuccess)(`Created custom persona: ${p.name} (${p.id})`);
                (0, terminal_1.printInfo)(`Use: /persona set ${p.id}`);
            }
            else if (sub === 'delete') {
                const id = args[1];
                if (!id) {
                    (0, terminal_1.printError)('Usage: /persona delete <id>');
                    break;
                }
                if (ctx.persona.deleteCustom(id)) {
                    (0, terminal_1.printSuccess)(`Deleted persona: ${id}`);
                    ctx.onSystemUpdate();
                }
                else {
                    (0, terminal_1.printError)(`Cannot delete "${id}" — not found or it's a built-in.`);
                }
            }
            else if (sub === 'info') {
                const query = args.slice(1).join(' ');
                const resolved = (0, index_8.resolvePersonaId)(query || ctx.persona.getActive().id);
                const p = ctx.persona.find(resolved);
                if (!p) {
                    (0, terminal_1.printError)(`Persona not found: ${query}`);
                    break;
                }
                (0, terminal_1.printSectionHeader)(`${p.flag ?? '🎭'} ${p.name}`);
                console.log(`  ID: ${p.id}  |  Language: ${p.language}  |  Source: ${p.source}`);
                if (p.nativeName)
                    console.log(`  Native name: ${p.nativeName}`);
                console.log(`\n  System prompt:\n`);
                p.systemPrompt.split('\n').slice(0, 10).forEach(l => console.log(`    ${chalk_1.default.dim(l)}`));
                if (p.systemPrompt.split('\n').length > 10)
                    console.log(chalk_1.default.dim(`    … (${p.systemPrompt.split('\n').length - 10} more lines)`));
            }
            else {
                (0, terminal_1.printError)(`Unknown /persona subcommand: ${sub}. Try: list, set, reset, create, delete, info`);
            }
            break;
        }
        // ── Lang shortcut ─────────────────────────────────────────────────────────
        case 'lang': {
            const query = args.join(' ');
            if (!query) {
                const p = ctx.persona.getActive();
                console.log(`\n  Current language: ${p.flag ?? '🎭'} ${chalk_1.default.bold(p.name)} (${p.language})`);
                console.log(chalk_1.default.dim('  Use /lang <code>  e.g. /lang franco  /lang egyptian  /lang fr'));
                break;
            }
            const resolved = (0, index_8.resolvePersonaId)(query);
            const p = ctx.persona.setActive(resolved);
            if (!p) {
                (0, terminal_1.printError)(`Language/persona not found: "${query}". Run /persona list to see options.`);
                break;
            }
            ctx.onSystemUpdate();
            console.log(`\n${p.flag ?? '🎭'} ${chalk_1.default.bold(`Language: ${p.name}`)}${p.nativeName ? chalk_1.default.dim(` (${p.nativeName})`) : ''}`);
            break;
        }
        // ── History ───────────────────────────────────────────────────────────────
        case 'history': {
            const sub = args[0]?.toLowerCase();
            if (!sub || sub === 'list') {
                const days = parseInt(args[1] || '30', 10);
                const sessions = index_5.HistoryManager.list(isNaN(days) ? 30 : days);
                if (sessions.length === 0) {
                    (0, terminal_1.printInfo)('No saved sessions found.');
                    break;
                }
                (0, terminal_1.printSectionHeader)(`📜 Session History (last ${days || 30} days)`);
                console.log('');
                for (const s of sessions.slice(0, 25)) {
                    const age = (0, index_5.formatRelativeTime)(s.updatedAt);
                    const msgs = chalk_1.default.dim(`${s.messageCount} msgs`);
                    const prov = chalk_1.default.dim(`${s.provider}/${s.model}`);
                    const title = s.title.length > 55 ? s.title.slice(0, 52) + '…' : s.title;
                    console.log(`  ${chalk_1.default.cyan(s.id)}  ${chalk_1.default.bold(title)}`);
                    console.log(`            ${chalk_1.default.dim(age)} · ${msgs} · ${prov}`);
                }
                console.log(`\n  ${chalk_1.default.dim('Use: /history load <id>  |  /history export <id>  |  /history search <query>')}`);
            }
            else if (sub === 'load' || sub === 'resume') {
                const id = args[1];
                if (!id) {
                    (0, terminal_1.printError)('Usage: /history load <session-id>');
                    break;
                }
                const record = index_5.HistoryManager.load(id);
                if (!record) {
                    (0, terminal_1.printError)(`Session not found: ${id}`);
                    break;
                }
                // Rebuild conversation from saved messages
                const sysMsg = ctx.conversation.messages.find(m => m.role === 'system');
                ctx.conversation.messages.length = 0;
                if (sysMsg)
                    ctx.conversation.messages.push(sysMsg);
                for (const m of record.messages) {
                    if (m.role !== 'system')
                        ctx.conversation.messages.push(m);
                }
                (0, terminal_1.printSuccess)(`Loaded session: ${record.title}`);
                (0, terminal_1.printInfo)(`${record.messageCount} messages restored · ${record.provider}/${record.model}`);
            }
            else if (sub === 'export') {
                const id = args[1] ?? ctx.history.getCurrentId();
                const record = index_5.HistoryManager.load(id);
                if (!record) {
                    (0, terminal_1.printError)(`Session not found: ${id}`);
                    break;
                }
                const md = index_5.HistoryManager.exportMarkdown(record);
                const outFile = `session-${id}.md`;
                const { writeFileSync } = await Promise.resolve().then(() => __importStar(require('fs')));
                writeFileSync(path.resolve(ctx.cwd, outFile), md, 'utf-8');
                (0, terminal_1.printSuccess)(`Exported to: ${outFile}`);
            }
            else if (sub === 'search') {
                const query = args.slice(1).join(' ');
                if (!query) {
                    (0, terminal_1.printError)('Usage: /history search <query>');
                    break;
                }
                const results = index_5.HistoryManager.search(query);
                if (results.length === 0) {
                    (0, terminal_1.printInfo)(`No sessions found matching: "${query}"`);
                    break;
                }
                (0, terminal_1.printSectionHeader)(`🔍 History Search: "${query}"`);
                for (const r of results) {
                    const age = (0, index_5.formatRelativeTime)(r.session.updatedAt);
                    console.log(`\n  ${chalk_1.default.cyan(r.session.id)}  ${chalk_1.default.bold(r.session.title)}`);
                    console.log(`  ${chalk_1.default.dim(age)} · ${chalk_1.default.dim(r.snippet)}`);
                }
            }
            else if (sub === 'delete') {
                const id = args[1];
                if (!id) {
                    (0, terminal_1.printError)('Usage: /history delete <session-id>');
                    break;
                }
                if (index_5.HistoryManager.delete(id)) {
                    (0, terminal_1.printSuccess)(`Deleted session: ${id}`);
                }
                else {
                    (0, terminal_1.printError)(`Session not found: ${id}`);
                }
            }
            else if (sub === 'current') {
                const id = ctx.history.getCurrentId();
                const title = ctx.history.getCurrentTitle();
                console.log(`\n  Current session: ${chalk_1.default.cyan(id)}`);
                console.log(`  Title: ${chalk_1.default.bold(title)}`);
            }
            else {
                (0, terminal_1.printError)(`Unknown /history subcommand: ${sub}. Try: list, load, export, search, delete, current`);
            }
            break;
        }
        // ── Profile ───────────────────────────────────────────────────────────────
        case 'profile': {
            const sub = args[0]?.toLowerCase();
            if (!sub || sub === 'show') {
                (0, terminal_1.printSectionHeader)('👤 Your Profile');
                console.log(ctx.profile.format());
            }
            else if (sub === 'set') {
                // /profile set name "Shady"  OR  /profile set pref.language TypeScript
                const key = args[1];
                const value = args.slice(2).join(' ');
                if (!key || !value) {
                    (0, terminal_1.printError)('Usage: /profile set <field> <value>');
                    (0, terminal_1.printInfo)('Fields: name, role, company, email, custom_instructions');
                    (0, terminal_1.printInfo)('Prefs:  pref.language, pref.style, pref.expertise, pref.review_strictness');
                    break;
                }
                if (key.startsWith('pref.')) {
                    const prefKey = key.slice(5);
                    ctx.profile.setPreference(prefKey, value);
                    (0, terminal_1.printSuccess)(`Preference set: ${prefKey} = ${value}`);
                }
                else {
                    ctx.profile.set({ [key]: value });
                    (0, terminal_1.printSuccess)(`Profile updated: ${key} = ${value}`);
                }
                ctx.onSystemUpdate();
            }
            else if (sub === 'add-project') {
                const name = args[1];
                const stack = args.slice(2).join(' ');
                if (!name) {
                    (0, terminal_1.printError)('Usage: /profile add-project <name> [stack]');
                    break;
                }
                ctx.profile.addProject({ name, path: ctx.cwd, stack: stack || undefined });
                (0, terminal_1.printSuccess)(`Added project: ${name}${stack ? ` (${stack})` : ''}`);
                ctx.onSystemUpdate();
            }
            else if (sub === 'edit') {
                const filePath = index_6.ProfileManager.profilePath();
                (0, terminal_1.printInfo)(`Profile file: ${filePath}`);
                try {
                    child_process.execSync(`${process.env.EDITOR || 'nano'} "${filePath}"`, { stdio: 'inherit' });
                    ctx.onSystemUpdate();
                    (0, terminal_1.printSuccess)('Profile saved.');
                }
                catch {
                    (0, terminal_1.printInfo)('Open the file manually to edit it.');
                }
            }
            else {
                (0, terminal_1.printError)(`Unknown /profile subcommand: ${sub}. Try: show, set, add-project, edit`);
            }
            break;
        }
        // ── Plan ──────────────────────────────────────────────────────────────────
        case 'plan': {
            const task = args.join(' ');
            if (!task) {
                (0, terminal_1.printError)('Usage: /plan <what to build>');
                (0, terminal_1.printInfo)('Example: /plan Build a user authentication system with JWT');
                break;
            }
            const spinner = (0, terminal_1.createSpinner)('Generating execution plan…');
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
                const planRole = roles_1.BUILTIN_ROLES['planner'];
                const planConv = (0, conversation_1.createConversation)(planRole.systemPrompt);
                let planText = '';
                await (0, core_1.runAgent)(ctx.provider, planConv, planPrompt, {
                    cwd: ctx.cwd, stream: false, mcpClient: ctx.mcpClient,
                    registry: ctx.registry, memory: ctx.memory, skills: ctx.skills, tokenTracker: ctx.tokenTracker,
                    onToken: (t) => { planText += t; },
                });
                // Display the plan in a formatted box
                (0, terminal_1.printSectionHeader)('🎯 Execution Plan');
                console.log('');
                const lines = planText.split('\n');
                for (const line of lines) {
                    if (line.startsWith('## Plan:')) {
                        console.log(chalk_1.default.bold.cyan(line));
                    }
                    else if (line.startsWith('**Summary:**')) {
                        console.log(chalk_1.default.white(line));
                    }
                    else if (line.startsWith('**Complexity:**')) {
                        const lvl = line.includes('High') ? chalk_1.default.red(line) : line.includes('Medium') ? chalk_1.default.yellow(line) : chalk_1.default.green(line);
                        console.log(lvl);
                    }
                    else if (/^\d+\.\s/.test(line)) {
                        console.log(chalk_1.default.cyan('  ' + line));
                    }
                    else if (line.startsWith('### Risks')) {
                        console.log('\n' + chalk_1.default.bold.yellow(line));
                    }
                    else if (line.startsWith('- ')) {
                        console.log(chalk_1.default.yellow('  ' + line));
                    }
                    else if (line.trim()) {
                        console.log(chalk_1.default.dim('  ' + line));
                    }
                }
                console.log('');
                console.log(chalk_1.default.dim('  Execute this plan? Just say "go" or ask me to start with step 1.'));
                console.log('');
                // Also save plan to history
                ctx.history.addMessage({ role: 'user', content: `/plan ${task}` });
                ctx.history.addMessage({ role: 'assistant', content: planText });
            }
            catch (err) {
                spinner.stop();
                (0, terminal_1.printError)(`Plan generation failed: ${err.message}`);
            }
            break;
        }
        // ── Agents ────────────────────────────────────────────────────────────────
        case 'agents': {
            const sub = args[0]?.toLowerCase();
            if (!sub || sub === 'list') {
                (0, terminal_1.printSectionHeader)('🤖 Available Agent Roles');
                console.log('');
                for (const role of (0, roles_1.listRoles)()) {
                    console.log(`  ${role.icon}  ${chalk_1.default.bold(role.id.padEnd(14))} ${chalk_1.default.dim(role.description)}`);
                }
                console.log(`\n  ${chalk_1.default.dim('Use: /plan <task> — orchestrate agents on a task')}`);
                console.log('');
            }
            else if (sub === 'info') {
                const roleId = args[1];
                if (!roleId) {
                    (0, terminal_1.printError)('Usage: /agents info <role-id>');
                    break;
                }
                const role = roles_1.BUILTIN_ROLES[roleId];
                if (!role) {
                    (0, terminal_1.printError)(`Role not found: ${roleId}. Run /agents list`);
                    break;
                }
                (0, terminal_1.printSectionHeader)(`${role.icon} Agent Role: ${role.name}`);
                console.log(`\n  ${role.description}`);
                if (role.allowedTools?.length) {
                    console.log(`\n  Allowed tools: ${role.allowedTools.join(', ')}`);
                }
                console.log(`\n  System prompt preview:\n`);
                role.systemPrompt.split('\n').slice(0, 6).forEach(l => console.log(`    ${chalk_1.default.dim(l)}`));
            }
            else {
                (0, terminal_1.printError)(`Unknown /agents subcommand: ${sub}. Try: list, info <role>`);
            }
            break;
        }
        // ── RAG ───────────────────────────────────────────────────────────────────
        case 'rag': {
            const sub = args[0]?.toLowerCase();
            if (!sub || sub === 'search') {
                const query = args.slice(1).join(' ');
                if (!query) {
                    (0, terminal_1.printError)('Usage: /rag search <query>');
                    break;
                }
                (0, terminal_1.printSectionHeader)(`🔍 RAG Search: "${query}"`);
                const spinner2 = (0, terminal_1.createSpinner)('Searching codebase…');
                spinner2.start();
                const results = (0, rerank_1.ragSearch)(query, ctx.cwd, { topK: 10 });
                spinner2.stop(`Found ${results.length} results`);
                if (results.length === 0) {
                    (0, terminal_1.printInfo)('No results found.');
                    break;
                }
                console.log('');
                for (const r of results) {
                    const score = chalk_1.default.dim(`(${(r.score * 100).toFixed(0)}%)`);
                    console.log(`  ${chalk_1.default.magenta(r.relativePath)}${chalk_1.default.dim(':' + r.line)}  ${score}`);
                    if (r.content.trim()) {
                        console.log(`    ${chalk_1.default.dim(r.content.trim().slice(0, 100))}`);
                    }
                }
                console.log('');
            }
            else if (sub === 'status') {
                (0, terminal_1.printSectionHeader)('📚 RAG Status');
                (0, terminal_1.printInfo)(`Working directory: ${ctx.cwd}`);
                (0, terminal_1.printInfo)('Keyword + pattern search (RRF) — no index required');
                (0, terminal_1.printInfo)('Run /rag search <query> to search your codebase');
            }
            else {
                (0, terminal_1.printError)(`Unknown /rag subcommand: ${sub}. Try: search <query>, status`);
            }
            break;
        }
        // ── Diagram ───────────────────────────────────────────────────────────────
        case 'diagram':
        case 'architecture': {
            const desc = args.join(' ');
            if (!desc) {
                (0, terminal_1.printError)(`Usage: /${cmd} <description>`);
                (0, terminal_1.printInfo)('Examples:');
                (0, terminal_1.printInfo)('  /diagram auth flow with JWT and refresh tokens');
                (0, terminal_1.printInfo)('  /architecture microservices app with API gateway');
                break;
            }
            const diagramType = cmd === 'architecture' ? 'architecture' : (0, index_7.detectDiagramType)(desc);
            const spinner3 = (0, terminal_1.createSpinner)(`Generating ${diagramType} diagram…`);
            spinner3.start();
            try {
                // Ask the AI to produce Mermaid code
                const diagramPrompt = (0, index_7.buildDiagramPrompt)(desc, diagramType);
                const diagramConv = (0, conversation_1.createConversation)('You are a technical diagram specialist. Output ONLY Mermaid code — no explanation, no markdown fences.');
                let mermaidCode = '';
                await (0, core_1.runAgent)(ctx.provider, diagramConv, diagramPrompt, {
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
                (0, terminal_1.printSectionHeader)(`🎨 ${diagramType.charAt(0).toUpperCase() + diagramType.slice(1)} Diagram`);
                console.log('');
                console.log(chalk_1.default.cyan('┌─ Mermaid code ─────────────────────────────────'));
                (0, index_7.mermaidPreview)(mermaidCode).split('\n').forEach(l => console.log(chalk_1.default.cyan('│ ') + chalk_1.default.dim(l)));
                console.log(chalk_1.default.cyan('└────────────────────────────────────────────────'));
                console.log('');
                // Render to file
                const safeName = desc.slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const outFile = path.resolve(ctx.cwd, `${safeName}.png`);
                const renderSpinner = (0, terminal_1.createSpinner)('Rendering PNG with Mermaid CLI…');
                renderSpinner.start();
                const result = await (0, index_7.generateDiagram)({
                    type: diagramType,
                    code: mermaidCode,
                    outputPath: outFile,
                    format: 'png',
                });
                const kb = (result.sizeBytes / 1024).toFixed(1);
                renderSpinner.stop(`Saved: ${path.relative(ctx.cwd, result.outputPath)} (${kb} KB)`);
                (0, terminal_1.printSuccess)(`✅ Diagram saved: ${path.relative(ctx.cwd, result.outputPath)}`);
            }
            catch (err) {
                spinner3.stop();
                (0, terminal_1.printError)(`Diagram failed: ${err.message}`);
            }
            break;
        }
        // ── Image ─────────────────────────────────────────────────────────────────
        case 'image': {
            const prompt = args.join(' ');
            if (!prompt) {
                (0, terminal_1.printError)('Usage: /image <prompt>');
                (0, terminal_1.printInfo)('Requires: OPENAI_API_KEY (DALL-E 3) or STABILITY_API_KEY');
                (0, terminal_1.printInfo)('Without keys: generates a placeholder SVG');
                break;
            }
            const imgSpinner = (0, terminal_1.createSpinner)('🎨 Generating image…');
            imgSpinner.start();
            try {
                const safeName = prompt.slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const outFile = path.resolve(ctx.cwd, `${safeName}.png`);
                const result = await (0, index_7.generateImage)({
                    prompt,
                    outputPath: outFile,
                    size: '1024x1024',
                    onProgress: (msg) => imgSpinner.stop(msg),
                });
                const kb = (result.sizeBytes / 1024).toFixed(1);
                const provLabel = result.provider === 'dalle' ? 'DALL-E 3' :
                    result.provider === 'stability' ? 'Stability AI' : 'Placeholder SVG';
                (0, terminal_1.printSuccess)(`✅ Image saved: ${path.relative(ctx.cwd, result.outputPath)} (${kb} KB) via ${provLabel}`);
            }
            catch (err) {
                imgSpinner.stop();
                (0, terminal_1.printError)(`Image generation failed: ${err.message}`);
            }
            break;
        }
        // ── Providers status ──────────────────────────────────────────────────────
        case 'providers': {
            console.log('');
            (0, terminal_1.printSectionHeader)('🔌 Provider Status');
            console.log('');
            const spinner = (0, terminal_1.createSpinner)('Checking providers…');
            spinner.start();
            const statuses = await (0, fallback_1.checkAllProviders)();
            spinner.stop('');
            for (const s of statuses) {
                const dot = s.available ? chalk_1.default.green('🟢') : chalk_1.default.red('🔴');
                const label = s.available ? chalk_1.default.green(s.label) : chalk_1.default.dim(s.label);
                const model = chalk_1.default.dim(` — ${s.model}`);
                const reason = chalk_1.default.dim(` (${s.reason})`);
                const isCurrent = s.id === ctx.providerName;
                const curTag = isCurrent ? chalk_1.default.cyan(' ← active') : '';
                console.log(`  ${dot} ${label}${model}${reason}${curTag}`);
            }
            const available = statuses.filter(s => s.available).length;
            console.log('');
            console.log(chalk_1.default.dim(`  ${available}/${statuses.length} providers available`));
            console.log(chalk_1.default.dim('  /models — see all models  |  /model <provider>:<model> — switch'));
            console.log('');
            break;
        }
        default:
            (0, terminal_1.printError)(`Unknown command: /${cmd}. Type /help for available commands.`);
    }
}
// ─── OpenClaw sub-commands ────────────────────────────────────────────────────
async function handleOpenClaw(sub, args, client) {
    switch (sub) {
        case 'status': {
            (0, terminal_1.printSectionHeader)('🤖 OpenClaw Gateway');
            const info = await client.getAgentsStatus();
            const gwIndicator = info.gatewayStatus.running
                ? chalk_1.default.green('✅ running')
                : chalk_1.default.red('❌ stopped');
            const apiIndicator = info.reachable
                ? chalk_1.default.green('✓ reachable')
                : chalk_1.default.red('✗ unreachable');
            console.log(`\n  Gateway:  ${gwIndicator}  ${chalk_1.default.dim(info.gatewayUrl)}`);
            if (info.gatewayStatus.version)
                console.log(`  Version:  ${info.gatewayStatus.version}`);
            console.log(`  HTTP API: ${apiIndicator}`);
            if (info.agents.length > 0) {
                const online = info.agents.filter(a => a.online).length;
                console.log(`\n  Agents: ${online} online / ${info.agents.length} total\n`);
                for (const a of info.agents) {
                    const dot = a.online ? chalk_1.default.green('🟢') : chalk_1.default.red('🔴');
                    const sessions = a.sessionCount > 0 ? chalk_1.default.dim(` (${a.sessionCount} session${a.sessionCount !== 1 ? 's' : ''})`) : '';
                    const model = a.model ? chalk_1.default.dim(` · ${a.model}`) : '';
                    const activity = a.lastActivity ? chalk_1.default.dim(` · ${a.lastActivity}`) : '';
                    console.log(`  ${dot} ${chalk_1.default.bold(a.id)}${model}${sessions}${activity}`);
                }
            }
            else if (info.reachable) {
                console.log(chalk_1.default.dim('\n  No active agent sessions found.'));
            }
            if (!info.gatewayStatus.running && info.gatewayStatus.raw) {
                console.log(chalk_1.default.dim('\n  ' + info.gatewayStatus.raw.split('\n').slice(0, 5).join('\n  ')));
            }
            console.log();
            break;
        }
        case 'agents': {
            (0, terminal_1.printSectionHeader)('🤖 OpenClaw Agents');
            try {
                const agents = await client.listAgents();
                if (agents.length === 0) {
                    (0, terminal_1.printInfo)('No agents found.');
                }
                else {
                    for (const a of agents) {
                        const model = a.model ? chalk_1.default.dim(` · ${a.model}`) : '';
                        console.log(`  ${chalk_1.default.bold(a.id)}${model}`);
                    }
                }
            }
            catch (err) {
                (0, terminal_1.printError)(`Failed: ${err.message}`);
            }
            break;
        }
        case 'sessions': {
            (0, terminal_1.printSectionHeader)('💬 OpenClaw Sessions');
            try {
                const sessions = await client.listSessions({ limit: 20, activeMinutes: 60 * 24 });
                if (sessions.length === 0) {
                    (0, terminal_1.printInfo)('No active sessions found.');
                }
                else {
                    for (const s of sessions) {
                        console.log(`  ${client.formatSessionRow(s)}`);
                    }
                }
            }
            catch (err) {
                (0, terminal_1.printError)(`Failed: ${err.message}`);
            }
            break;
        }
        case 'send': {
            // /openclaw send <sessionKey> <message...>
            const [sessionKey, ...msgParts] = args;
            const message = msgParts.join(' ');
            if (!sessionKey || !message) {
                (0, terminal_1.printError)('Usage: /openclaw send <session-key> <message>');
                break;
            }
            (0, terminal_1.printInfo)(`Sending to ${sessionKey}...`);
            try {
                const result = await client.sendMessage(sessionKey, message, 30);
                (0, terminal_1.printSuccess)(`Status: ${result.status}`);
                if (result.reply) {
                    console.log('\n' + chalk_1.default.green('Reply › ') + result.reply);
                }
            }
            catch (err) {
                (0, terminal_1.printError)(`Failed: ${err.message}`);
            }
            break;
        }
        case 'history': {
            const sessionKey = args[0];
            if (!sessionKey) {
                (0, terminal_1.printError)('Usage: /openclaw history <session-key>');
                break;
            }
            (0, terminal_1.printSectionHeader)(`📜 Session History: ${sessionKey}`);
            try {
                const messages = await client.getSessionHistory(sessionKey, { limit: 20 });
                for (const m of messages) {
                    const role = m.role === 'user' ? chalk_1.default.cyan('User') : chalk_1.default.green('AI  ');
                    const content = m.content.length > 200 ? m.content.slice(0, 197) + '...' : m.content;
                    console.log(`\n${role} › ${content}`);
                }
            }
            catch (err) {
                (0, terminal_1.printError)(`Failed: ${err.message}`);
            }
            break;
        }
        case 'cron': {
            (0, terminal_1.printSectionHeader)('⏰ OpenClaw Cron Jobs');
            const jobs = client.listCronJobs();
            if (jobs.length === 0) {
                (0, terminal_1.printInfo)('No cron jobs found or openclaw CLI not available.');
            }
            else {
                for (const job of jobs) {
                    const schedule = job.schedule ? chalk_1.default.dim(` · ${job.schedule}`) : '';
                    const status = job.status ? ` [${job.status}]` : '';
                    console.log(`  ${chalk_1.default.bold(job.id)}${schedule}${chalk_1.default.dim(status)}`);
                }
            }
            break;
        }
        default:
            (0, terminal_1.printError)(`Unknown /openclaw subcommand: ${sub}. Try: status, agents, sessions, send, history, cron`);
    }
}
//# sourceMappingURL=cli.js.map