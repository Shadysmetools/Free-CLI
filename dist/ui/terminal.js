"use strict";
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
exports.printToolCall = printToolCall;
exports.printToolResult = printToolResult;
exports.printStatus = printStatus;
exports.printDivider = printDivider;
exports.createSpinner = createSpinner;
const chalk_1 = __importDefault(require("chalk"));
// Use chalk v4 (CommonJS)
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
    user: (s) => c.bold.cyan(s),
    assistant: (s) => c.bold.green(s),
    system: (s) => c.bold.magenta(s),
    tool: (s) => c.bold.yellow(s),
};
function printBanner() {
    const logo = `
${c.cyan('╔══════════════════════════════════════╗')}
${c.cyan('║')}  ${c.bold.cyan('⚡ knowcap-code')}  ${c.dim('free AI coding agent')}  ${c.cyan('║')}
${c.cyan('╚══════════════════════════════════════╝')}
`;
    console.log(logo);
}
function printHelp() {
    console.log(`
${c.bold.cyan('knowcap-code')} — Free AI Coding Assistant

${c.bold('USAGE')}
  ${c.cyan('knowcap-code')} [options]        Start interactive session
  ${c.cyan('knowcap-code')} "your question"  Single-turn query

${c.bold('OPTIONS')}
  ${c.yellow('--provider')} <name>   Set AI provider (ollama, groq, anthropic, openai, google, openrouter)
  ${c.yellow('--model')} <name>      Set model name
  ${c.yellow('--cwd')} <path>        Set working directory
  ${c.yellow('--no-color')}          Disable colors
  ${c.yellow('-v, --version')}       Show version
  ${c.yellow('-h, --help')}          Show this help

${c.bold('SLASH COMMANDS')} (type inside the session)
  ${c.green('/help')}              Show this help
  ${c.green('/model')} [provider:model]  Switch model (e.g. /model groq:llama-3.3-70b-versatile)
  ${c.green('/review')} [file]     Review code changes or a specific file
  ${c.green('/test')}              Run project tests
  ${c.green('/compact')}           Summarize and compact conversation history
  ${c.green('/clear')}             Clear conversation history
  ${c.green('/config')}            Show current configuration
  ${c.green('/transcribe')} <file> Transcribe audio/video with local Whisper
  ${c.green('/mcp')}               List connected MCP servers and tools
  ${c.green('/git')} [args]        Run git commands
  ${c.green('/diff')} [file]       Show file diffs
  ${c.green('/undo')}              Undo last file change
  ${c.green('/init')}              Create KNOWCAP.md project memory file
  ${c.green('/cost')}              Show token usage and estimated cost
  ${c.green('/exit')}              Exit the session

${c.bold('FREE PROVIDERS')}
  ${c.yellow('ollama')}      Local models — zero cost, zero API key needed
  ${c.yellow('groq')}        Fast free tier — llama-3.3-70b, deepseek-r1
  ${c.yellow('google')}      Gemini free tier — gemini-2.0-flash
  ${c.yellow('openrouter')}  Many free models via openrouter.ai

${c.bold('BYOK PROVIDERS')}
  ${c.yellow('anthropic')}   Claude models (ANTHROPIC_API_KEY)
  ${c.yellow('openai')}      GPT models (OPENAI_API_KEY)

${c.bold('EXAMPLES')}
  ${c.dim('$')} knowcap-code
  ${c.dim('>')} Create a REST API in Express.js
  ${c.dim('>')} /review src/api.ts
  ${c.dim('>')} /model groq:llama-3.3-70b-versatile
  ${c.dim('>')} /test
`);
}
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
function printToolCall(toolName, input) {
    const shortInput = JSON.stringify(input).substring(0, 80);
    console.log(`\n${c.yellow('⚙')} ${c.yellow(toolName)} ${c.dim(shortInput)}`);
}
function printToolResult(toolName, result) {
    const preview = result.length > 200 ? result.substring(0, 200) + '...' : result;
    console.log(`  ${c.dim('└─')} ${c.dim(preview)}`);
}
function printStatus(provider, model, tokens, cost) {
    const costStr = cost > 0 ? ` · $${cost.toFixed(4)}` : ' · free';
    console.log(`\n${c.dim('─'.repeat(50))}`);
    console.log(`${c.dim(`${provider}/${model} · ${tokens} tokens${costStr}`)}`);
}
function printDivider() {
    console.log(c.dim('─'.repeat(50)));
}
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