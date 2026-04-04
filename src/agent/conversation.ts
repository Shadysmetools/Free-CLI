import { Message } from '../providers/index';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ConversationState {
  messages: Message[];
  totalUsage: TokenUsage;
  turnCount: number;
}

export function createConversation(systemPrompt?: string): ConversationState {
  const messages: Message[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  return {
    messages,
    totalUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    turnCount: 0,
  };
}

export function addMessage(state: ConversationState, message: Message): void {
  state.messages.push(message);
}

export function addUsage(state: ConversationState, usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): void {
  state.totalUsage.promptTokens += usage.prompt_tokens;
  state.totalUsage.completionTokens += usage.completion_tokens;
  state.totalUsage.totalTokens += usage.total_tokens;
  state.turnCount++;
}

export function compactConversation(state: ConversationState): string {
  // Keep system message and last few messages, summarize the rest
  const systemMsg = state.messages.find(m => m.role === 'system');
  const nonSystem = state.messages.filter(m => m.role !== 'system');

  if (nonSystem.length <= 6) {
    return 'Conversation is already compact (≤3 turns).';
  }

  // Build a summary of removed messages
  const toRemove = nonSystem.slice(0, -4);
  const summary = toRemove
    .filter(m => m.role !== 'tool')
    .map(m => `[${m.role}]: ${m.content.substring(0, 100)}...`)
    .join('\n');

  const summaryMessage: Message = {
    role: 'system',
    content: `[Conversation compacted. Earlier context summary:\n${summary}\n---\nContinuing from here:]`,
  };

  const kept = nonSystem.slice(-4);
  state.messages = [
    ...(systemMsg ? [systemMsg] : []),
    summaryMessage,
    ...kept,
  ];

  const removed = toRemove.length;
  return `✓ Compacted: removed ${removed} old messages, kept last 2 turns.`;
}

export function clearConversation(state: ConversationState): void {
  const systemMsg = state.messages.find(m => m.role === 'system');
  state.messages = systemMsg ? [systemMsg] : [];
  state.turnCount = 0;
}

export function getConversationStats(state: ConversationState): string {
  const msgs = state.messages.filter(m => m.role !== 'system').length;
  const { totalTokens, promptTokens, completionTokens } = state.totalUsage;
  return `Messages: ${msgs} | Turns: ${state.turnCount} | Tokens: ${totalTokens} (${promptTokens} in, ${completionTokens} out)`;
}

export interface SystemPromptOptions {
  cwd: string;
  projectMemory?: string | null;       // legacy KNOWCAP.md / CLAUDE.md
  memoryContext?: string;              // from MemoryManager.getSystemContext()
  skillContext?: string;               // from SkillsManager.getSkillContext()
  profileContext?: string;             // from ProfileManager.buildSystemBlock()
  personaContext?: string;             // from PersonaManager.buildSystemBlock()
}

export function buildSystemPrompt(
  projectMemoryOrOptions: string | null | SystemPromptOptions,
  cwd?: string
): string {
  // Support both legacy call signature and new options object
  let opts: SystemPromptOptions;
  if (typeof projectMemoryOrOptions === 'object' && projectMemoryOrOptions !== null && 'cwd' in projectMemoryOrOptions) {
    opts = projectMemoryOrOptions as SystemPromptOptions;
  } else {
    opts = {
      cwd: cwd ?? process.cwd(),
      projectMemory: projectMemoryOrOptions as string | null,
    };
  }

  const date = new Date().toISOString().split('T')[0];
  let prompt = `You are coderaw, an expert AI coding assistant. You help with writing, editing, debugging, and understanding code.

Current date: ${date}
Working directory: ${opts.cwd}

## Your Capabilities
You have access to tools for:
- Reading and writing files
- Editing files with precise text replacement
- Searching across the codebase
- Running shell commands
- Git operations (status, diff, commit)
- Saving notes to project memory (memory_save, memory_search)

## How You Work
1. When asked to modify code, always READ the file first
2. Use edit_file for small targeted changes, write_file for new files or major rewrites
3. Use search_files to explore unfamiliar codebases
4. Run tests after making changes when asked
5. Be concise — give code directly, minimal explanation unless asked
6. If you're unsure about something, use tools to investigate before answering
7. Save important decisions and patterns to memory using memory_save

## Code Style
- Match the existing code style in the project
- Prefer clean, readable code over clever code
- Add comments only when the code is non-obvious
- Handle errors appropriately for the language`;

  // Legacy project memory (KNOWCAP.md / CLAUDE.md)
  if (opts.projectMemory) {
    prompt += `\n\n## Project Memory (KNOWCAP.md)\n${opts.projectMemory}`;
  }

  // New memory system (MEMORY.md)
  if (opts.memoryContext) {
    prompt += opts.memoryContext;
  }

  // Active skills (injected per-message in core.ts, but can also be base context)
  if (opts.skillContext) {
    prompt += opts.skillContext;
  }

  // User profile context
  if (opts.profileContext) {
    prompt += opts.profileContext;
  }

  // Persona / language context
  if (opts.personaContext) {
    prompt += opts.personaContext;
  }

  return prompt;
}
