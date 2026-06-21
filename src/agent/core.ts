import { Provider, Message, Tool } from '../providers/index';
import { ConversationState, addMessage, addUsage } from './conversation';
import { TOOLS, executeTool, fileChanges } from './tools';
import { MCPClient } from '../mcp/client';
import { ToolRegistry } from '../registry/index';
import { MemoryManager } from '../memory/index';
import { SkillsManager } from '../skills/index';
import { TokenTracker } from '../tracking/tokens';
import { printToolCall, printToolResult, printError, printWarning } from '../ui/terminal';
import { completeWithFallback } from '../providers/fallback';
import { gate, GateContext, Rules, persistAllowPattern } from '../permissions';
import { StreamFilter } from './stream-filter';
import chalk from 'chalk';

export interface AgentOptions {
  cwd: string;
  stream: boolean;
  onToken?: (token: string) => void;
  maxIterations?: number;
  mcpClient?: MCPClient;
  registry?: ToolRegistry;
  memory?: MemoryManager;
  skills?: SkillsManager;
  tokenTracker?: TokenTracker;
  permissions?: Rules;
  unattended?: boolean;
  sessionAllow?: Set<string>;
}

export interface AgentResult {
  content: string;
  /** Formatted dim footer line — print AFTER the response content */
  footerLine?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Heuristic: the model tried to call a tool but emitted broken/partial JSON. */
export function looksLikeToolAttempt(content: string): boolean {
  let t = (content || '').trim();
  if (!t) return false;
  if (t.includes('<tool_call>')) return true;
  // Strip a leading ```json fence if the model wrapped the call in one.
  t = t.replace(/^```(?:json)?\s*/i, '').trim();
  // Only treat as a botched tool call if the message is DOMINATED by a JSON
  // object (starts with '{'), not merely prose that mentions name/arguments —
  // otherwise legitimate prose like "pass a name and arguments field" triggers
  // a spurious repair that pollutes the conversation.
  if (!t.startsWith('{')) return false;
  return /"name"\s*:/.test(t) && /"(arguments|parameters)"\s*:/.test(t);
}

/**
 * Estimate the number of tokens in a piece of text.
 *
 * This is a deliberately dependency-free heuristic: most byte-pair tokenizers
 * (GPT/Claude/Llama families) average roughly 4 characters per token for typical
 * English + code, so ceil(chars / 4) is a good-enough budgeting proxy for a
 * local-first tool that must not reach for the network or a heavy tokenizer dep.
 * It intentionally OVER-estimates slightly (ceil) so we trim conservatively and
 * stay safely under real provider context windows.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Per-provider context budgets, expressed in ESTIMATED TOKENS (see
 * estimateTokens). These mirror each provider's real context window with a
 * safety margin reserved for the system prompt, tool schemas, and the model's
 * own completion. `trimMessages` is fed these via the estimateTokens measure.
 */
export const CONTEXT_TOKEN_LIMITS: Record<string, number> = {
  groq: 6_000,
  openrouter: 20_000,
  anthropic: 50_000,
  ollama: 15_000,
  google: 50_000,
};

/**
 * Trim a conversation to fit a budget WITHOUT orphaning tool-result messages.
 * Providers (Anthropic/OpenAI/Groq) return 400 if a `tool` message is not
 * immediately preceded by the assistant message carrying its tool_calls, so
 * after trimming we drop any leading `tool` messages left at the front.
 *
 * The budget is measured by `measure`, which defaults to raw character length
 * (the original behaviour). Pass `estimateTokens` to budget by ESTIMATED TOKENS
 * instead — the agent loop does this so history is managed in token space.
 */
export function trimMessages(
  messages: Message[],
  contextLimit: number,
  minKeep = 5,
  measure: (text: string) => number = (t) => t.length,
): Message[] {
  const systemMsgs = messages.filter(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');

  for (const m of nonSystem) {
    if (m.role === 'tool' && m.content.length > 500) {
      m.content = m.content.slice(0, 500) + '\n…[truncated]';
    }
  }

  const total = () => [...systemMsgs, ...nonSystem].reduce((s, m) => s + measure(m.content), 0);
  if (total() <= contextLimit) return messages;

  while (nonSystem.length > minKeep && total() > contextLimit) {
    nonSystem.shift();
  }
  // Never start the kept window on an orphaned tool result.
  while (nonSystem.length > 0 && nonSystem[0].role === 'tool') {
    nonSystem.shift();
  }
  return [...systemMsgs, ...nonSystem];
}

export async function runAgent(
  providerArg: Provider,
  conversation: ConversationState,
  userMessage: string,
  options: AgentOptions,
): Promise<AgentResult> {
  let provider = providerArg;
  const {
    cwd, stream, onToken, maxIterations = 10,
    mcpClient, registry, memory, skills, tokenTracker,
    permissions, unattended, sessionAllow,
  } = options;

  const turnStart = Date.now();

  // ── Permission gate context (built once per turn) ─────────────────────────
  const gateCtx: GateContext | undefined = permissions
    ? {
        cwd,
        rules: permissions,
        isInteractive: Boolean(process.stdout.isTTY) && !unattended,
        sessionAllow: sessionAllow ?? new Set<string>(),
        persistAllow: persistAllowPattern,
      }
    : undefined;

  // ── Skill injection ───────────────────────────────────────────────────────
  if (skills) {
    const skillCtx = skills.getSkillContext(userMessage);
    if (skillCtx) {
      const systemIdx = conversation.messages.findIndex(m => m.role === 'system');
      const existing = systemIdx >= 0 ? conversation.messages[systemIdx].content : '';
      if (!existing.includes(skillCtx.slice(0, 40))) {
        addMessage(conversation, {
          role: 'system',
          content: `[Active Skills for this request]${skillCtx}`,
        });
      }
    }
  }

  addMessage(conversation, { role: 'user', content: userMessage });

  // ── Build tool list ───────────────────────────────────────────────────────
  let allTools: Tool[];
  if (registry) {
    allTools = registry.getEnabled();
    if (mcpClient) {
      const mcpTools = await mcpClient.getTools();
      registry.registerMCPTools(mcpTools);
      allTools = registry.getEnabled();
    }
  } else {
    allTools = [...TOOLS];
    if (mcpClient) {
      const mcpTools = await mcpClient.getTools();
      allTools.push(...mcpTools);
    }
  }

  let iterations = 0;
  let lastContent = '';
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let repairedOnce = false;

  // Manage history by ESTIMATED TOKENS (see estimateTokens / CONTEXT_TOKEN_LIMITS)
  // rather than raw characters, so the kept window maps to the model's real
  // context window regardless of how token-dense the text is.
  const contextLimit = CONTEXT_TOKEN_LIMITS[provider.name] ?? 15_000;

  function trimConversation(minKeep = 5): void {
    conversation.messages = trimMessages(conversation.messages, contextLimit, minKeep, estimateTokens);
  }

  while (iterations < maxIterations) {
    iterations++;
    // Stream on EVERY iteration (#7) so the final answer AFTER tool calls also
    // streams — not just iteration 1. A per-iteration StreamFilter suppresses
    // raw tool-call JSON that local models emit as text, so the user never sees
    // it mid-stream.
    const doStream = stream;
    let tokensStreamed = false;
    const streamFilter = new StreamFilter();

    trimConversation(5);

    let result;
    try {
      const fallbackResult = await completeWithFallback(
        provider,
        {
          messages: conversation.messages,
          tools: allTools,
          stream: doStream,
          onToken: doStream ? (token) => {
            const visible = streamFilter.push(token);
            if (visible) {
              tokensStreamed = true;
              process.stdout.write(chalk.white(visible));
              if (onToken) onToken(visible);
            }
          } : undefined,
        },
        (modelName) => {
          // Quiet one-liner when fallback provider is used
          process.stdout.write(chalk.dim(`\n  ℹ switched to ${modelName}\n`));
        },
      );
      result = fallbackResult.result;
      if (fallbackResult.activeProvider !== provider) {
        provider = fallbackResult.activeProvider;
      }
    } catch (err) {
      const msg = (err as Error).message;
      printError(`Provider error: ${msg}`);
      return { content: `Error: ${msg}` };
    }

    // Flush any visible content the filter buffered while still deciding
    // prose-vs-tool (e.g. short prose that never hit a flush boundary).
    if (doStream) {
      const tail = streamFilter.flush();
      if (tail) {
        tokensStreamed = true;
        process.stdout.write(chalk.white(tail));
        if (onToken) onToken(tail);
      }
    }

    if (result.usage) {
      addUsage(conversation, result.usage);
      totalUsage.prompt_tokens  += result.usage.prompt_tokens;
      totalUsage.completion_tokens += result.usage.completion_tokens;
      totalUsage.total_tokens   += result.usage.total_tokens;
    }

    // Only add newline if tokens actually streamed to stdout
    if (tokensStreamed && result.content) {
      process.stdout.write('\n');
    }

    lastContent = result.content;

    // ── No tool calls → maybe a botched call, else done ───────────────────
    if (!result.tool_calls || result.tool_calls.length === 0) {
      if (looksLikeToolAttempt(result.content) && !repairedOnce) {
        repairedOnce = true;
        addMessage(conversation, { role: 'assistant', content: result.content });
        addMessage(conversation, {
          role: 'user',
          content: 'Your previous tool call was not valid JSON. Resend ONLY the corrected tool call as a single JSON object {"name":..., "arguments":{...}} with no extra text.',
        });
        continue;
      }
      addMessage(conversation, { role: 'assistant', content: result.content });
      break;
    }

    // ── Tool calls → process them ─────────────────────────────────────────
    const assistantMsg: Message = {
      role: 'assistant',
      content: result.content,
      tool_calls: result.tool_calls,
    };
    addMessage(conversation, assistantMsg);

    for (const toolCall of result.tool_calls) {
      const toolName = toolCall.function.name;
      let toolArgs: Record<string, unknown> = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch { /* ignore */ }

      // ── Permission gate ───────────────────────────────────────────────────
      if (gateCtx) {
        const decision = await gate(toolName, toolArgs, gateCtx);
        if (!decision.allowed) {
          printToolCall(toolName, toolArgs);
          // Always-visible denial (printToolResult hides content in non-verbose mode)
          process.stdout.write(`\n  ${chalk.yellow(`⛔ ${decision.reasonForModel ?? 'Not permitted.'}`)}\n`);
          addMessage(conversation, {
            role: 'tool',
            content: decision.reasonForModel ?? 'Action not permitted by user permission rules.',
            tool_call_id: toolCall.id,
            name: toolName,
          });
          continue;
        }
      }

      printToolCall(toolName, toolArgs);

      let toolResult: string;
      try {
        if (memory && toolName === 'memory_search') {
          const query = String(toolArgs.query ?? '');
          const results = memory.search(query);
          toolResult = results.length === 0
            ? 'No memory entries found matching that query.'
            : results.map(r => `${r.file}:${r.line}  ${r.content}`).join('\n');
        } else if (memory && toolName === 'memory_save') {
          const note = String(toolArgs.note ?? '');
          const category = toolArgs.category ? String(toolArgs.category) : 'Notes';
          memory.save(note, category);
          toolResult = `✓ Saved to MEMORY.md under "${category}"`;
        } else if (mcpClient && await mcpClient.hasTool(toolName)) {
          const mcpResult = await mcpClient.callTool(toolName, toolArgs);
          toolResult = mcpResult.content;
        } else {
          const execResult = await executeTool(toolName, toolArgs, cwd);
          toolResult = execResult.content;
          if (execResult.isError) toolResult = `ERROR: ${toolResult}`;
        }
      } catch (err) {
        toolResult = `ERROR: ${(err as Error).message}`;
      }

      printToolResult(toolName, toolResult);

      addMessage(conversation, {
        role: 'tool',
        content: toolResult,
        tool_call_id: toolCall.id,
        name: toolName,
      });
    }
  }

  // ── Build footer line + track tokens ──────────────────────────────────────
  let footerLine: string | undefined;
  if (tokenTracker && totalUsage.total_tokens > 0) {
    const durationMs = Date.now() - turnStart;
    const entry = tokenTracker.track(totalUsage, provider.name, provider.model, durationMs);

    const cost = tokenTracker.getCostForEntry(entry);
    const costStr = cost > 0 ? `$${cost.toFixed(4)}` : 'free';
    const totalToks = (entry.inputTokens + entry.outputTokens).toLocaleString();
    const modelShort = entry.model.split('/').pop() ?? entry.model;
    footerLine = chalk.dim(`  ${modelShort} · ${totalToks} tokens · ${costStr}`);

    const budget = tokenTracker.checkBudget();
    if (budget.message) {
      printWarning(budget.message);
    }
  }

  // ── Auto-save session log ─────────────────────────────────────────────────
  if (memory && lastContent) {
    try {
      memory.appendToday(`**User:** ${userMessage.slice(0, 200)}\n\n**AI:** ${lastContent.slice(0, 500)}`);
    } catch { /* non-fatal */ }
  }

  return { content: lastContent, usage: totalUsage, footerLine };
}

export { fileChanges };
