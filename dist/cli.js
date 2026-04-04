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
    // ── System prompt ─────────────────────────────────────────────────────────
    const systemPrompt = (0, conversation_1.buildSystemPrompt)({
        cwd,
        projectMemory: projectConfig.memoryContent,
        memoryContext: memory.getSystemContext(),
    });
    let conversation = (0, conversation_1.createConversation)(systemPrompt);
    // ── Banner ────────────────────────────────────────────────────────────────
    if (!opts.noColor) {
        (0, terminal_1.printBanner)();
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
        (0, terminal_1.printInfo)(`🎯 ${skillList.length} skills available (${skillList.map(s => s.name).slice(0, 4).join(', ')}${skillList.length > 4 ? '...' : ''})`);
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
    console.log(chalk_1.default.dim(`\nProvider: ${providerName}/${provider.model} | Type /help for commands\n`));
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
            console.log(chalk_1.default.green('AI  › '));
            await (0, core_1.runAgent)(provider, conversation, input, {
                cwd, stream: true, mcpClient, registry, memory, skills, tokenTracker,
            });
        }
        catch (err) {
            (0, terminal_1.printError)(err.message);
        }
        rl.prompt();
    });
    rl.on('close', () => {
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
            }
            else {
                const [newProviderName, ...modelParts] = args[0].split(':');
                const newModelName = modelParts.join(':');
                try {
                    if (newModelName) {
                        ctx.settings.providers[newProviderName] = ctx.settings.providers[newProviderName] || {};
                        ctx.settings.providers[newProviderName].model = newModelName;
                    }
                    const newProvider = (0, index_1.createProvider)(newProviderName, ctx.settings);
                    ctx.onProviderChange(newProvider, newProviderName);
                    (0, terminal_1.printSuccess)(`Switched to ${newProviderName}/${newProvider.model}`);
                }
                catch (err) {
                    (0, terminal_1.printError)(err.message);
                }
            }
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