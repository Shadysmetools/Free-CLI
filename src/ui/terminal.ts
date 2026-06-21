/**
 * Terminal UI — ChatGPT-clean output
 *
 * Design principles:
 *   • Show WHAT happened, not HOW (no raw JSON, no boxes for tool calls)
 *   • Response appears inline with "AI  › " prefix (no blank line)
 *   • Token stats as dim footer AFTER response
 *   • Tool calls as compact one-liners
 *   • Code blocks with line numbers + syntax highlighting
 *   • Inquirer-powered interactive choices everywhere
 */

import chalk from 'chalk';

const c = chalk;

// ─── Verbose flag ─────────────────────────────────────────────────────────────
export let verboseMode = false;
export function setVerboseMode(v: boolean): void { verboseMode = v; }

// ─── Tool display helpers ─────────────────────────────────────────────────────

const TOOL_EMOJIS: Record<string, string> = {
  read_file:       '📖',
  write_file:      '✏️ ',
  edit_file:       '✏️ ',
  search_files:    '🔍',
  list_files:      '📂',
  run_command:     '⚡',
  git_status:      '📊',
  git_diff:        '📊',
  git_commit:      '✅',
  git_log:         '📜',
  generate_pdf:    '📄',
  generate_excel:  '📊',
  generate_diagram:'🎨',
  generate_image:  '🖼️ ',
  memory_search:   '🧠',
  memory_save:     '💾',
};

function extractMainArg(toolName: string, input: Record<string, unknown>): string {
  const candidates = [
    input.path, input.command, input.pattern, input.query,
    input.message, input.output_path, input.title, input.prompt,
    input.url, input.note,
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) {
      const trimmed = v.trim();
      return trimmed.length > 55 ? trimmed.slice(0, 52) + '…' : trimmed;
    }
  }
  // Fall back: first string value in input
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.trim()) {
      const trimmed = v.trim();
      return trimmed.length > 55 ? trimmed.slice(0, 52) + '…' : trimmed;
    }
  }
  return '';
  void toolName;
}

// ─── Colors palette (kept for compatibility) ──────────────────────────────────
export const colors = {
  primary:   (s: string) => c.cyan(s),
  secondary: (s: string) => c.gray(s),
  success:   (s: string) => c.green(s),
  error:     (s: string) => c.red(s),
  warning:   (s: string) => c.yellow(s),
  info:      (s: string) => c.blue(s),
  bold:      (s: string) => c.bold(s),
  dim:       (s: string) => c.dim(s),
  code:      (s: string) => c.bgBlack.white(` ${s} `),
  filePath:  (s: string) => c.magenta(s),
  user:      (s: string) => c.bold.cyan(s),
  assistant: (s: string) => c.bold.green(s),
  system:    (s: string) => c.bold.magenta(s),
  tool:      (s: string) => c.bold.yellow(s),
  memory:    (s: string) => c.magenta(s),
  skill:     (s: string) => c.blue(s),
};

// ─── Banner ───────────────────────────────────────────────────────────────────
export function printBanner(): void {
  console.log(`
${c.cyan('┌─────────────────────────────────────────┐')}
${c.cyan('│')}  ${c.bold.cyan('⚡ coderaw')}  ${c.dim('free AI coding agent')}   ${c.cyan('│')}
${c.cyan('│')}  ${c.dim('ollama · groq · gemini · mistral · claude · gpt')}  ${c.cyan('│')}
${c.cyan('└─────────────────────────────────────────┘')}
`);
}

// ─── Help ─────────────────────────────────────────────────────────────────────
export function printHelp(): void {
  console.log(`
${c.bold.cyan('coderaw')} — Free AI Coding Assistant  ${c.dim('(Claude Code-inspired)')}

${c.bold('USAGE')}
  ${c.cyan('coderaw')} [options]         Start interactive session
  ${c.cyan('coderaw')} "your question"   Single-turn query
  ${c.cyan('cr bot start')}            Start Telegram bot (see ~/.coderaw/bot.yaml)
  ${c.cyan('cr bot init')}             Create bot config file
  ${c.cyan('cr bot status')}           Validate bot config

${c.bold('OPTIONS')}
  ${c.yellow('--provider')} <name>    Set AI provider
  ${c.yellow('--model')} <name>       Set model name
  ${c.yellow('--cwd')} <path>         Set working directory
  ${c.yellow('--no-color')}           Disable colors
  ${c.yellow('--verbose')}            Show full tool output
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

  ${c.bold.dim('── Permissions ──────────────────────────────')}
  ${c.green('/permissions')}          Show permission rules (allow/ask/deny)
  ${c.green('/permissions allow')} <p>  Allow a command/path pattern (persists)
  ${c.green('/permissions deny')} <p>   Block a pattern this session

  ${c.bold.dim('── Tokens & Cost ────────────────────────────')}
  ${c.green('/cost')}                Session token usage + cost breakdown
  ${c.green('/tokens')}              Compact token summary
  ${c.green('/budget')} <amount>     Set USD budget limit

  ${c.bold.dim('── Tools Registry ───────────────────────────')}
  ${c.green('/tools')}               List all tools by category
  ${c.green('/tools info')} <name>   Show tool details

  ${c.bold.dim('── Providers & Models ───────────────────────')}
  ${c.green('/providers')}           Status of all providers (🟢/🔴)
  ${c.green('/models')} [provider]   Full model list per provider
  ${c.green('/model')} <p>:<m>       Switch provider/model mid-session

  ${c.bold.dim('── Workflows ────────────────────────────────')}
  ${c.green('/workflows')}           List available workflow definitions
  ${c.green('/workflow')} <name>     Run a named workflow (--input k=v)
  ${c.green('/goal')} "<text>"       Run an autonomous goal with pre-auth tools
  ${c.green('/research')} "<question>"  Deep research: web search → fetch → cited report

  ${c.bold.dim('── Other ─────────────────────────────────────')}
  ${c.green('/plan')} <task>         Generate execution plan
  ${c.green('/persona')} [list/set]  Manage language persona
  ${c.green('/history')}             Session history
  ${c.green('/transcribe')} <file>   Transcribe audio/video
  ${c.green('/key [provider] [key]')} Show/set API keys
  ${c.green('/config')}              Show configuration

${c.bold('FREE PROVIDERS')}
  ${c.yellow('ollama')}      Local models — zero cost, zero API key
  ${c.yellow('groq')}        Ultra-fast free tier — llama-3.3-70b, deepseek-r1
  ${c.yellow('google')}      Gemini free tier — gemini-2.5-flash
  ${c.yellow('openrouter')}  Many free models via openrouter.ai

${c.bold('BYOK PROVIDERS')}
  ${c.yellow('anthropic')}   Claude models (ANTHROPIC_API_KEY)
  ${c.yellow('openai')}      GPT models (OPENAI_API_KEY)
`);
}

// ─── Messages ─────────────────────────────────────────────────────────────────
export function printMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string): void {
  const prefix = {
    user:      colors.user('You › '),
    assistant: colors.assistant('AI  › '),
    system:    colors.system('Sys › '),
    tool:      colors.tool('⚙   › '),
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

// ─── Tool Calls — compact one-liners ─────────────────────────────────────────
/**
 * Writes "  emoji tool_name → arg" WITHOUT trailing newline.
 * printToolResult() will append the result info on the same line.
 */
export function printToolCall(toolName: string, input: Record<string, unknown>): void {
  const emoji = TOOL_EMOJIS[toolName] ?? '⚙ ';
  const mainArg = extractMainArg(toolName, input);
  const argStr = mainArg ? ` → ${c.dim(mainArg)}` : '';
  process.stdout.write(`\n  ${emoji} ${c.dim(toolName)}${argStr}`);
}

/**
 * Appends " (N lines)" to the tool call line, or shows full output in verbose mode.
 */
export function printToolResult(_toolName: string, result: string): void {
  const lines = result.split('\n');
  const lineCount = lines.length;

  if (verboseMode) {
    // Verbose: show full content in indented block
    process.stdout.write('\n');
    const preview = lines.slice(0, 40);
    for (const line of preview) {
      const trimmed = line.length > 120 ? line.slice(0, 117) + '…' : line;
      console.log(`    ${c.dim(trimmed)}`);
    }
    if (lineCount > 40) {
      console.log(c.dim(`    … (${lineCount} lines total)`));
    }
  } else {
    // Compact: just append line count
    const info = lineCount > 1 ? ` ${c.dim(`(${lineCount} lines)`)}` : '';
    process.stdout.write(info + '\n');
  }
}

// ─── Response Footer — dim, after response ────────────────────────────────────
/**
 * Format: "  model · 1,234 tokens · free"  (dim, shown after AI response)
 */
export function printResponseFooter(provider: string, model: string, tokenLine: string): void {
  // tokenLine format from formatResponseLine: "provider/model · N in / M out · cost"
  const parts = tokenLine.split(' · ');
  const costPart = (parts[2] ?? 'free').trim();

  // Extract token count
  const tokenMatch = tokenLine.match(/(\d[\d,]*) in \/ (\d[\d,]*) out/);
  let tokenStr = '';
  if (tokenMatch) {
    const totalToks = parseInt(tokenMatch[1].replace(/,/g, '')) +
                      parseInt(tokenMatch[2].replace(/,/g, ''));
    tokenStr = `${totalToks.toLocaleString()} tokens`;
  }

  // Short model name (strip prefix like "openrouter/", "qwen/", etc.)
  const modelShort = model.split('/').pop() ?? model;
  const tag = [modelShort, tokenStr, costPart].filter(Boolean).join(' · ');

  console.log(c.dim(`\n  ${tag}`));
  void provider;
}

// ─── Code Block — line numbers + syntax highlighting ─────────────────────────
/**
 * Renders a file/code block with line numbers and (optional) syntax highlighting.
 * Used for verbose file reads and explicit code display.
 */
export function printCodeBlock(code: string, lang?: string, filename?: string): void {
  const rawLines = code.split('\n');
  // Remove trailing empty line from split
  if (rawLines[rawLines.length - 1] === '') rawLines.pop();

  // Try syntax highlighting with cli-highlight
  let highlighted: string[];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const { highlight } = require('cli-highlight') as { highlight: (s: string, o: object) => string };
    const result = highlight(code, { language: lang ?? 'plaintext', ignoreIllegals: true });
    highlighted = result.split('\n');
    if (highlighted[highlighted.length - 1] === '') highlighted.pop();
  } catch {
    highlighted = rawLines.map(l => c.white(l));
  }

  const lineNumWidth = String(rawLines.length).length;
  // Find max visible line length (strip ANSI codes for width calc)
  const visibleLen = rawLines.reduce((max, l) => Math.max(max, l.length), 0);
  const innerWidth = Math.min(Math.max(visibleLen, 40), 96);
  const boxInner = lineNumWidth + 2 + innerWidth + 1; // num + │ + content + space

  // Header
  if (filename) {
    console.log(`\n  ${c.dim('📄')} ${c.cyan.bold(filename)}`);
  } else if (lang) {
    console.log(`\n  ${c.dim(lang)}`);
  } else {
    console.log();
  }

  // Top border
  console.log(`  ${c.dim('┌' + '─'.repeat(lineNumWidth + 2) + '┬' + '─'.repeat(innerWidth + 2) + '┐')}`);

  for (let i = 0; i < rawLines.length; i++) {
    const num = String(i + 1).padStart(lineNumWidth);
    const hlLine = highlighted[i] ?? '';
    const rawLine = rawLines[i];
    // Pad the raw line for consistent box width
    const padding = Math.max(0, innerWidth - rawLine.length);
    console.log(`  ${c.dim('│')} ${c.dim(num)} ${c.dim('│')} ${hlLine}${' '.repeat(padding)} ${c.dim('│')}`);
  }

  // Bottom border
  console.log(`  ${c.dim('└' + '─'.repeat(lineNumWidth + 2) + '┴' + '─'.repeat(innerWidth + 2) + '┘')}`);
}

// ─── Plan Box ─────────────────────────────────────────────────────────────────

export interface PlanStep {
  num: number;
  icon: string;
  role: string;
  description: string;
  target?: string;
  estMin?: number;
}

export function printPlanBox(title: string, steps: PlanStep[], summary?: string): void {
  const width = 57;
  const bar = '─'.repeat(width);

  const padEnd = (s: string, len: number) => {
    // Strip ANSI for length
    const visible = s.replace(/\x1B\[[0-9;]*m/g, '');
    return s + ' '.repeat(Math.max(0, len - visible.length));
  };

  console.log(`\n  ${c.cyan('┌' + bar + '┐')}`);
  // Title row
  const titleStr = `  📋 ${title}`;
  console.log(`  ${c.cyan('│')}${padEnd(c.bold.cyan(titleStr), width + 11)}  ${c.cyan('│')}`);
  console.log(`  ${c.cyan('├' + bar + '┤')}`);

  for (const step of steps) {
    const estStr = step.estMin ? c.dim(` [${step.estMin}m]`) : '';
    const targetStr = step.target ? c.dim(` → ${step.target.slice(0, 20)}`) : '';
    const desc = step.description.length > 35 ? step.description.slice(0, 32) + '…' : step.description;
    const row = `  ${step.num}. ${step.icon} ${c.white(desc)}${targetStr}${estStr}`;
    console.log(`  ${c.cyan('│')}${padEnd('  ' + row, width + 4)}  ${c.cyan('│')}`);
  }

  if (summary) {
    console.log(`  ${c.cyan('├' + bar + '┤')}`);
    const summaryRow = `  ${summary}`;
    console.log(`  ${c.cyan('│')}${padEnd(c.dim('  ' + summaryRow), width + 8)}  ${c.cyan('│')}`);
  }

  console.log(`  ${c.cyan('└' + bar + '┘')}\n`);
}

// ─── File Operation ───────────────────────────────────────────────────────────
export function printFileOp(action: 'created' | 'updated' | 'deleted', filePath: string, extra?: string): void {
  const icons = { created: '✅', updated: '✏️ ', deleted: '🗑️ ' };
  const extraStr = extra ? c.dim(` (${extra})`) : '';
  console.log(`  ${icons[action]} ${c.cyan(filePath)}${extraStr}`);
}

// ─── Status / Footer (legacy) ─────────────────────────────────────────────────
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
  console.log(c.dim('─'.repeat(Math.min(title.replace(/\x1B\[[0-9;]*m/g, '').length, 60))));
}

// ─── Box ─────────────────────────────────────────────────────────────────────
export function printBox(
  title: string,
  content: string,
  color: 'cyan' | 'green' | 'yellow' | 'red' | 'magenta' = 'cyan',
): void {
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
