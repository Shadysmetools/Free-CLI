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

import chalk from 'chalk';

// Chalk v4 CommonJS
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
  filePath: (s: string) => c.magenta(s),
  user: (s: string) => c.bold.cyan(s),
  assistant: (s: string) => c.bold.green(s),
  system: (s: string) => c.bold.magenta(s),
  tool: (s: string) => c.bold.yellow(s),
  memory: (s: string) => c.magenta(s),
  skill: (s: string) => c.blue(s),
};

// ─── Banner ───────────────────────────────────────────────────────────────────

export function printBanner(): void {
  console.log(`
${c.cyan('┌─────────────────────────────────────────┐')}
${c.cyan('│')}  ${c.bold.cyan('⚡ knowcap-code')}  ${c.dim('free AI coding agent')}   ${c.cyan('│')}
${c.cyan('│')}  ${c.dim('ollama · groq · gemini · claude · gpt')}  ${c.cyan('│')}
${c.cyan('└─────────────────────────────────────────┘')}
`);
}

// ─── Help ─────────────────────────────────────────────────────────────────────

export function printHelp(): void {
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

  ${c.bold.dim('── Providers & Models ───────────────────────')}
  ${c.green('/providers')}           Status of all providers (🟢/🔴)
  ${c.green('/models')} [provider]   Full model list per provider
  ${c.green('/model')} <p>:<m>       Switch provider/model mid-session

  ${c.bold.dim('── Other ─────────────────────────────────────')}
  ${c.green('/transcribe')} <file>   Transcribe audio/video
  ${c.green('/mcp')}                 List MCP servers + tools
  ${c.green('/config')}              Show configuration

${c.bold('FREE PROVIDERS')}
  ${c.yellow('ollama')}      Local models — zero cost, zero API key
  ${c.yellow('groq')}        Ultra-fast free tier — llama-3.3-70b, deepseek-r1
  ${c.yellow('google')}      Gemini free tier — gemini-2.5-flash (2.0 deprecated)
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

export function printWarning(msg: string): void {
  console.log(`${c.yellow('⚠')} ${c.yellow(msg)}`);
}

// ─── Tool Calls ───────────────────────────────────────────────────────────────

export function printToolCall(toolName: string, input: Record<string, unknown>): void {
  const shortInput = JSON.stringify(input);
  const displayInput = shortInput.length > 100 ? shortInput.slice(0, 97) + '...' : shortInput;
  console.log(`\n${c.yellow('┌─')} ${c.bold.yellow('⚙')} ${c.yellow(toolName)}`);
  console.log(`${c.yellow('│')} ${c.dim(displayInput)}`);
}

export function printToolResult(toolName: string, result: string): void {
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
export function printResponseFooter(provider: string, model: string, tokenLine: string): void {
  console.log(`\n${c.dim(`[${provider}/${model} · ${tokenLine}]`)}`);
}

/**
 * Legacy status for one-shot mode
 */
export function printStatus(provider: string, model: string, tokens: number, cost: number): void {
  const costStr = cost > 0 ? ` · $${cost.toFixed(4)}` : ' · free';
  console.log(`\n${c.dim('─'.repeat(50))}`);
  console.log(`${c.dim(`${provider}/${model} · ${tokens.toLocaleString()} tokens${costStr}`)}`);
}

export function printDivider(): void {
  console.log(c.dim('─'.repeat(50)));
}

// ─── Section Headers ──────────────────────────────────────────────────────────

export function printSectionHeader(title: string): void {
  console.log(`\n${c.bold(title)}`);
  console.log(c.dim('─'.repeat(title.length)));
}

// ─── Box ─────────────────────────────────────────────────────────────────────

export function printBox(title: string, content: string, color: 'cyan' | 'green' | 'yellow' | 'red' | 'magenta' = 'cyan'): void {
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
