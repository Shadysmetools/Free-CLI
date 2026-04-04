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
async function startCLI(opts = {}) {
    // Load config
    const settings = (0, settings_1.loadSettings)();
    const cwd = opts.cwd || process.cwd();
    const projectConfig = (0, project_1.loadProjectConfig)(cwd);
    // Determine provider
    let providerName = opts.provider || settings.defaultProvider;
    let modelName = opts.model;
    if (modelName) {
        settings.providers[providerName] = settings.providers[providerName] || {};
        settings.providers[providerName].model = modelName;
    }
    // Setup MCP client
    const mcpClient = await (0, config_1.setupMCPClient)(settings);
    // Create provider
    let provider = (0, index_1.createProvider)(providerName, settings);
    // Build system prompt
    const systemPrompt = (0, conversation_1.buildSystemPrompt)(projectConfig.memoryContent, cwd);
    // Create conversation
    let conversation = (0, conversation_1.createConversation)(systemPrompt);
    if (!opts.noColor) {
        (0, terminal_1.printBanner)();
    }
    if (projectConfig.memoryFile) {
        (0, terminal_1.printInfo)(`📋 Loaded project memory: ${path.relative(cwd, projectConfig.memoryFile)}`);
    }
    const isAvailable = await provider.isAvailable();
    if (!isAvailable) {
        (0, terminal_1.printError)(`Provider "${providerName}" is not available. Check your API key or start Ollama.`);
        (0, terminal_1.printInfo)(`Tip: Run "ollama pull qwen2.5-coder:7b" for a free local model, or set GROQ_API_KEY for free cloud inference.`);
    }
    console.log(chalk_1.default.dim(`\nProvider: ${providerName}/${provider.model} | Type /help for commands\n`));
    // One-shot mode
    if (opts.oneShot) {
        const result = await (0, core_1.runAgent)(provider, conversation, opts.oneShot, {
            cwd,
            stream: true,
            mcpClient,
        });
        if (result.usage) {
            (0, terminal_1.printStatus)(providerName, provider.model, result.usage.total_tokens, 0);
        }
        return;
    }
    // Interactive REPL
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
            console.log(chalk_1.default.green('AI  › '));
            const result = await (0, core_1.runAgent)(provider, conversation, input, {
                cwd,
                stream: true,
                mcpClient,
            });
            if (result.usage) {
                console.log(chalk_1.default.dim(`\n[${providerName}/${provider.model} · ${result.usage.total_tokens} tokens]`));
            }
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
async function handleSlashCommand(input, ctx) {
    const parts = input.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    switch (cmd) {
        case 'help':
            (0, terminal_1.printHelp)();
            return true;
        case 'exit':
        case 'quit':
        case 'q':
            ctx.rl.close();
            process.exit(0);
        case 'clear':
            (0, conversation_1.clearConversation)(ctx.conversation);
            (0, terminal_1.printSuccess)('Conversation cleared.');
            return true;
        case 'compact': {
            const result = (0, conversation_1.compactConversation)(ctx.conversation);
            (0, terminal_1.printSuccess)(result);
            return true;
        }
        case 'cost':
        case 'stats': {
            const stats = (0, conversation_1.getConversationStats)(ctx.conversation);
            console.log('\n' + chalk_1.default.cyan(stats));
            return true;
        }
        case 'config': {
            if (args[0] === 'set' && args[1] && args[2]) {
                // /config set provider.key value
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
                console.log('\n' + chalk_1.default.bold('Current Configuration:'));
                console.log(chalk_1.default.cyan('Provider:'), ctx.providerName);
                console.log(chalk_1.default.cyan('Model:'), ctx.provider.model);
                console.log(chalk_1.default.cyan('Working dir:'), ctx.cwd);
                console.log(chalk_1.default.cyan('Config file:'), `~/.knowcap-code/config.yaml`);
                console.log('\n' + chalk_1.default.bold('Configured providers:'));
                for (const [name, cfg] of Object.entries(ctx.settings.providers)) {
                    const info = index_1.PROVIDER_INFO[name];
                    const hasKey = cfg.apiKey ? '✓ key set' : (info?.requiresKey ? '✗ no key' : 'no key needed');
                    console.log(`  ${chalk_1.default.yellow(name.padEnd(12))} ${cfg.model?.padEnd(35) || ''} ${chalk_1.default.dim(hasKey)}`);
                }
                if (ctx.mcpClient) {
                    console.log('\n' + chalk_1.default.bold('MCP Servers:'));
                    for (const server of ctx.mcpClient.listServers()) {
                        console.log(`  ${chalk_1.default.green('✓')} ${server}`);
                    }
                }
            }
            return true;
        }
        case 'model': {
            if (args.length === 0) {
                // Show available providers
                console.log('\n' + chalk_1.default.bold('Available providers:'));
                for (const [name, info] of Object.entries(index_1.PROVIDER_INFO)) {
                    const current = name === ctx.providerName ? chalk_1.default.green(' ← current') : '';
                    console.log(`  ${chalk_1.default.yellow(name.padEnd(12))} ${chalk_1.default.dim(info.description)}${current}`);
                }
                console.log('\nUsage: /model <provider>[:<model>]');
                console.log('Example: /model groq:llama-3.3-70b-versatile');
                console.log('         /model ollama:codellama:7b');
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
            console.log(chalk_1.default.green('\nAI  › '));
            await (0, core_1.runAgent)(ctx.provider, ctx.conversation, message, {
                cwd: ctx.cwd, stream: true, mcpClient: ctx.mcpClient,
            });
            return true;
        }
        case 'test': {
            const message = 'Please run the project tests and report the results. If tests fail, explain what needs to be fixed.';
            console.log(chalk_1.default.green('\nAI  › '));
            await (0, core_1.runAgent)(ctx.provider, ctx.conversation, message, {
                cwd: ctx.cwd, stream: true, mcpClient: ctx.mcpClient,
            });
            return true;
        }
        case 'diff': {
            const file = args[0] ? `-- "${args[0]}"` : '';
            try {
                const diff = child_process.execSync(`git diff ${file}`, { cwd: ctx.cwd, encoding: 'utf-8' });
                if (!diff.trim()) {
                    console.log(chalk_1.default.dim('No unstaged changes.'));
                }
                else {
                    // Color the diff output
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
                console.log(chalk_1.default.dim('Not a git repository.'));
            }
            return true;
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
            return true;
        }
        case 'undo': {
            if (tools_1.fileChanges.length === 0) {
                (0, terminal_1.printInfo)('No file changes to undo.');
                return true;
            }
            const last = tools_1.fileChanges.pop();
            try {
                if (last.action === 'create' && last.originalContent === null) {
                    // Delete the file
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
            return true;
        }
        case 'transcribe': {
            const filePath = args.join(' ');
            if (!filePath) {
                console.log(chalk_1.default.dim('Usage: /transcribe <audio-or-video-file>'));
                console.log((0, transcribe_1.getWhisperInstallInstructions)());
                return true;
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
                console.log('\n' + chalk_1.default.bold('Transcript:'));
                console.log(result.text);
            }
            catch (err) {
                (0, terminal_1.printError)(err.message);
            }
            return true;
        }
        case 'mcp': {
            if (!ctx.mcpClient) {
                console.log(chalk_1.default.dim('No MCP servers configured.'));
                console.log('\nAdd MCP servers to ~/.knowcap-code/config.yaml:');
                console.log(chalk_1.default.dim(`
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
            }
            else {
                console.log('\n' + chalk_1.default.bold('MCP Servers:'));
                for (const server of ctx.mcpClient.listServers()) {
                    console.log(`  ${chalk_1.default.green('✓')} ${server}`);
                }
                const tools = ctx.mcpClient.listTools();
                if (tools.length > 0) {
                    console.log('\n' + chalk_1.default.bold('MCP Tools:'));
                    for (const t of tools) {
                        console.log(`  ${chalk_1.default.yellow(t.name.padEnd(30))} ${chalk_1.default.dim(t.description.substring(0, 60))}`);
                    }
                }
            }
            return true;
        }
        case 'init': {
            const filePath = (0, project_1.initProjectMemory)(ctx.cwd);
            (0, terminal_1.printSuccess)(`Created ${path.relative(ctx.cwd, filePath)}`);
            (0, terminal_1.printInfo)('Edit it to add project context for the AI.');
            return true;
        }
        default:
            (0, terminal_1.printError)(`Unknown command: /${cmd}. Type /help for available commands.`);
            return true;
    }
}
//# sourceMappingURL=cli.js.map