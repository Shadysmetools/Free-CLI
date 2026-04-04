"use strict";
/**
 * Terminal UI — improved display matching Claude Code quality
 *
 * Color scheme:
 *   Blue/Cyan  = AI responses, prompts
 *   Green      = success, tool results
 *   Red        = errors
 *   Yellow     = warnings, tool calls
 *   Magenta    = file paths, memory
 *   Dim/Gray   = metadata, status lines
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.colors = void 0;
exports.printBanner = printBanner;
exports.printHelp = printHelp;
exports.printMessage = printMessage;
exports.printError = printError;
exports.printSuccess = printSuccess;
exports.printInfo = printInfo;
exports.printWarning = printWarning;
exports.printToolCall = printToolCall;
exports.printToolResult = printToolResult;
exports.printResponseFooter = printResponseFooter;
exports.printStatus = printStatus;
exports.printDivider = printDivider;
exports.printSectionHeader = printSectionHeader;
exports.printBox = printBox;
exports.createSpinner = createSpinner;
const chalk_1 = __importDefault(require("chalk"));
// Chalk v4 CommonJS
const c = chalk_1.default;
exports.colors = {
    primary: (s) => c.cyan(s),
    secondary: (s) => c.gray(s),
    success: (s) => c.green(s),
    error: (s) => c.red(s),
    warning: (s) => c.yellow(s),
    info: (s) => c.blue(s),
    bold: (s) => c.bold(s),
    dim: (s) => c.dim(s),
    code: (s) => c.bgBlack.white(` ${s} `),
    filePath: (s) => c.magenta(s),
    user: (s) => c.bold.cyan(s),
    assistant: (s) => c.bold.green(s),
    system: (s) => c.bold.magenta(s),
    tool: (s) => c.bold.yellow(s),
    memory: (s) => c.magenta(s),
    skill: (s) => c.blue(s),
};
// ─── Banner ───────────────────────────────────────────────────────────────────
function printBanner() {
    console.log(`
${c.cyan('┌─────────────────────────────────────────┐')}
${c.cyan('│')}  ${c.bold.cyan('⚡ knowcap-code')}  ${c.dim('free AI coding agent')}   ${c.cyan('│')}
${c.cyan('│')}  ${c.dim('ollama · groq · gemini · claude · gpt')}  ${c.cyan('│')}
${c.cyan('└─────────────────────────────────────────┘')}
`);
}
// ─── Help ─────────────────────────────────────────────────────────────────────
function printHelp() {
    console.log(`
${c.bold.cyan('knowcap-code')} — Free AI Coding Assistant  ${c.dim('(Claude Code-inspired)')}

${c.bold('USAGE')}
  ${c.cyan('knowcap-code')} [options]         Start interactive session
  ${c.cyan('knowcap-code')} "your question"   Single-turn query

${c.bold('OPTIONS')}
  ${c.yellow('--provider')} <name>    Set AI provider
  ${c.yellow('--model')} <name>       Set model name
  ${c.yellow('--cwd')} <path>         Set working directory
  ${c.yellow('--no-color')}           Disable colors
  ${c.yellow('-v, --version')}        Show version

${c.bold('SLASH COMMANDS')}

  ${c.bold.dim('── Conversation ─────────────────────────────')}
  ${c.green('/help')}                Show this help
  ${c.green('/model')} [provider:model]  Switch model
  ${c.green('/clear')}               Clear conversation
  ${c.green('/compact')}             Summarize conversation history
  ${c.green('/exit')}                Exit session

  ${c.bold.dim('── Code ─────────────────────────────────────')}
  ${c.green('/review')} [file]       Review code changes
  ${c.green('/test')}                Run project tests
  ${c.green('/diff')} [file]         Show git diff
  ${c.green('/git')} [args]          Run git commands
  ${c.green('/undo')}                Undo last file change
  ${c.green('/init')}                Create KNOWCAP.md memory file

  ${c.bold.dim('── Memory ───────────────────────────────────')}
  ${c.green('/memory')}              Show MEMORY.md contents
  ${c.green('/memory search')} <q>   Search across all memory files
  ${c.green('/memory save')} <note>  Save a note to MEMORY.md
  ${c.green('/memory clear')}        Clear session memory

  ${c.bold.dim('── Skills ───────────────────────────────────')}
  ${c.green('/skills')}              List available skills
  ${c.green('/skills info')} <name>  Show skill details
  ${c.green('/skills add')} <name>   Create a new custom skill

  ${c.bold.dim('── Tokens & Cost ────────────────────────────')}
  ${c.green('/cost')}                Session token usage + cost breakdown
  ${c.green('/stats')}               Alias for /cost
  ${c.green('/tokens')}              Compact token summary
  ${c.green('/budget')} <amount>     Set USD budget limit (e.g. /budget 1.00)

  ${c.bold.dim('── Tools Registry ───────────────────────────')}
  ${c.green('/tools')}               List all tools by category
  ${c.green('/tools info')} <name>   Show tool details
  ${c.green('/tools enable')} <name> Enable a disabled tool
  ${c.green('/tools disable')} <name> Disable a tool

  ${c.bold.dim('── OpenClaw Gateway ─────────────────────────')}
  ${c.green('/openclaw status')}     Gateway health + overview
  ${c.green('/openclaw agents')}     List configured agents
  ${c.green('/openclaw sessions')}   Active sessions
  ${c.green('/openclaw send')} <agent> <msg>  Send a message to an agent
  ${c.green('/openclaw history')} <session>   View session history
  ${c.green('/openclaw cron')}       List cron jobs

  ${c.bold.dim('── Other ─────────────────────────────────────')}
  ${c.green('/transcribe')} <file>   Transcribe audio/video
  ${c.green('/mcp')}                 List MCP servers + tools
  ${c.green('/config')}              Show configuration

${c.bold('FREE PROVIDERS')}
  ${c.yellow('ollama')}      Local models — zero cost, zero API key
  ${c.yellow('groq')}        Ultra-fast free tier — llama-3.3-70b, deepseek-r1
  ${c.yellow('google')}      Gemini free tier — gemini-2.0-flash
  ${c.yellow('openrouter')}  Many free models via openrouter.ai

${c.bold('BYOK PROVIDERS')}
  ${c.yellow('anthropic')}   Claude models (ANTHROPIC_API_KEY)
  ${c.yellow('openai')}      GPT models (OPENAI_API_KEY)

${c.bold('EXAMPLES')}
  ${c.dim('$')} knowcap-code
  ${c.dim('›')} Create a REST API in Express.js
  ${c.dim('›')} /review src/api.ts
  ${c.dim('›')} /model groq:llama-3.3-70b-versatile
  ${c.dim('›')} /memory save "Use pnpm for this project"
  ${c.dim('›')} /skills
  ${c.dim('›')} /cost
`);
}
// ─── Messages ─────────────────────────────────────────────────────────────────
function printMessage(role, content) {
    const prefix = {
        user: exports.colors.user('You › '),
        assistant: exports.colors.assistant('AI  › '),
        system: exports.colors.system('Sys › '),
        tool: exports.colors.tool('⚙   › '),
    }[role];
    console.log(`\n${prefix}${content}`);
}
function printError(msg) {
    console.error(`\n${c.red('✗')} ${c.red(msg)}`);
}
function printSuccess(msg) {
    console.log(`\n${c.green('✓')} ${c.green(msg)}`);
}
function printInfo(msg) {
    console.log(`${c.blue('ℹ')} ${c.dim(msg)}`);
}
function printWarning(msg) {
    console.log(`${c.yellow('⚠')} ${c.yellow(msg)}`);
}
// ─── Tool Calls ───────────────────────────────────────────────────────────────
function printToolCall(toolName, input) {
    const shortInput = JSON.stringify(input);
    const displayInput = shortInput.length > 100 ? shortInput.slice(0, 97) + '...' : shortInput;
    console.log(`\n${c.yellow('┌─')} ${c.bold.yellow('⚙')} ${c.yellow(toolName)}`);
    console.log(`${c.yellow('│')} ${c.dim(displayInput)}`);
}
function printToolResult(toolName, result) {
    const lines = result.split('\n').slice(0, 8); // max 8 lines preview
    const truncated = result.split('\n').length > 8;
    for (const line of lines) {
        const trimmed = line.length > 120 ? line.slice(0, 117) + '...' : line;
        console.log(`${c.yellow('│')} ${c.dim(trimmed)}`);
    }
    if (truncated) {
        console.log(`${c.yellow('│')} ${c.dim(`... (${result.split('\n').length} lines total)`)}`);
    }
    console.log(c.yellow('└─'));
}
// ─── Status / Footer ──────────────────────────────────────────────────────────
/**
 * Shown after every AI response.
 * Format: [provider/model · 1,234 in / 567 out · $0.00]
 */
function printResponseFooter(provider, model, tokenLine) {
    console.log(`\n${c.dim(`[${provider}/${model} · ${tokenLine}]`)}`);
}
/**
 * Legacy status for one-shot mode
 */
function printStatus(provider, model, tokens, cost) {
    const costStr = cost > 0 ? ` · $${cost.toFixed(4)}` : ' · free';
    console.log(`\n${c.dim('─'.repeat(50))}`);
    console.log(`${c.dim(`${provider}/${model} · ${tokens.toLocaleString()} tokens${costStr}`)}`);
}
function printDivider() {
    console.log(c.dim('─'.repeat(50)));
}
// ─── Section Headers ──────────────────────────────────────────────────────────
function printSectionHeader(title) {
    console.log(`\n${c.bold(title)}`);
    console.log(c.dim('─'.repeat(title.length)));
}
// ─── Box ─────────────────────────────────────────────────────────────────────
function printBox(title, content, color = 'cyan') {
    const colorFn = c[color];
    const lines = content.split('\n');
    const width = Math.max(title.length + 4, ...lines.map(l => l.length + 4), 40);
    const bar = '─'.repeat(width);
    console.log(`\n${colorFn('┌' + bar + '┐')}`);
    console.log(`${colorFn('│')} ${c.bold(title)}${' '.repeat(width - title.length - 1)}${colorFn('│')}`);
    console.log(`${colorFn('├' + bar + '┤')}`);
    for (const line of lines) {
        const padded = line + ' '.repeat(Math.max(0, width - line.length - 1));
        console.log(`${colorFn('│')} ${padded}${colorFn('│')}`);
    }
    console.log(`${colorFn('└' + bar + '┘')}`);
}
// ─── Spinner ─────────────────────────────────────────────────────────────────
function createSpinner(text) {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    let interval = null;
    let running = false;
    return {
        start() {
            running = true;
            process.stdout.write('\n');
            interval = setInterval(() => {
                if (!running)
                    return;
                process.stdout.write(`\r${c.cyan(frames[i % frames.length])} ${c.dim(text)}`);
                i++;
            }, 80);
        },
        stop(final) {
            running = false;
            if (interval)
                clearInterval(interval);
            if (final) {
                process.stdout.write(`\r${c.green('✓')} ${final}\n`);
            }
            else {
                process.stdout.write('\r' + ' '.repeat(text.length + 4) + '\r');
            }
        },
    };
}
//# sourceMappingURL=terminal.js.map