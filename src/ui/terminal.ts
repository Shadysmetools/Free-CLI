import chalk from 'chalk';

// Use chalk v4 (CommonJS)
const c = chalk;

export const colors = {
  primary: (s: string) => c.cyan(s),
  secondary: (s: string) => c.gray(s),
  success: (s: string) => c.green(s),
  error: (s: string) => c.red(s),
  warning: (s: string) => c.yellow(s),
  info: (s: string) => c.blue(s),
  bold: (s: string) => c.bold(s),
  dim: (s: string) => c.dim(s),
  code: (s: string) => c.bgBlack.white(` ${s} `),
  user: (s: string) => c.bold.cyan(s),
  assistant: (s: string) => c.bold.green(s),
  system: (s: string) => c.bold.magenta(s),
  tool: (s: string) => c.bold.yellow(s),
};

export function printBanner(): void {
  const logo = `
${c.cyan('╔══════════════════════════════════════╗')}
${c.cyan('║')}  ${c.bold.cyan('⚡ knowcap-code')}  ${c.dim('free AI coding agent')}  ${c.cyan('║')}
${c.cyan('╚══════════════════════════════════════╝')}
`;
  console.log(logo);
}

export function printHelp(): void {
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

export function printMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string): void {
  const prefix = {
    user: colors.user('You › '),
    assistant: colors.assistant('AI  › '),
    system: colors.system('Sys › '),
    tool: colors.tool('⚙   › '),
  }[role];
  console.log(`\n${prefix}${content}`);
}

export function printError(msg: string): void {
  console.error(`\n${c.red('✗')} ${c.red(msg)}`);
}

export function printSuccess(msg: string): void {
  console.log(`\n${c.green('✓')} ${c.green(msg)}`);
}

export function printInfo(msg: string): void {
  console.log(`${c.blue('ℹ')} ${c.dim(msg)}`);
}

export function printToolCall(toolName: string, input: Record<string, unknown>): void {
  const shortInput = JSON.stringify(input).substring(0, 80);
  console.log(`\n${c.yellow('⚙')} ${c.yellow(toolName)} ${c.dim(shortInput)}`);
}

export function printToolResult(toolName: string, result: string): void {
  const preview = result.length > 200 ? result.substring(0, 200) + '...' : result;
  console.log(`  ${c.dim('└─')} ${c.dim(preview)}`);
}

export function printStatus(provider: string, model: string, tokens: number, cost: number): void {
  const costStr = cost > 0 ? ` · $${cost.toFixed(4)}` : ' · free';
  console.log(`\n${c.dim('─'.repeat(50))}`);
  console.log(`${c.dim(`${provider}/${model} · ${tokens} tokens${costStr}`)}`);
}

export function printDivider(): void {
  console.log(c.dim('─'.repeat(50)));
}

export function createSpinner(text: string): { start: () => void; stop: (final?: string) => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let interval: NodeJS.Timeout | null = null;
  let running = false;

  return {
    start() {
      running = true;
      process.stdout.write('\n');
      interval = setInterval(() => {
        if (!running) return;
        process.stdout.write(`\r${c.cyan(frames[i % frames.length])} ${c.dim(text)}`);
        i++;
      }, 80);
    },
    stop(final?: string) {
      running = false;
      if (interval) clearInterval(interval);
      if (final) {
        process.stdout.write(`\r${c.green('✓')} ${final}\n`);
      } else {
        process.stdout.write('\r' + ' '.repeat(text.length + 4) + '\r');
      }
    },
  };
}
