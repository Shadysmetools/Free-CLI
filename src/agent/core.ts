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
  const t = (content || '').trim();
  if (!t) return false;
  if (t.includes('<tool_call>')) return true;
  if (/"name"\s*:/.test(t) && /"(arguments|parameters)"\s*:/.test(t)) return true;
  return false;
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
  } = options;

  const turnStart = Date.now();

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

  const CONTEXT_CHAR_LIMITS: Record<string, number> = {
    groq: 24_000,
    openrouter: 80_000,
    anthropic: 200_000,
    ollama: 60_000,
    google: 200_000,
  };
  const contextLimit = CONTEXT_CHAR_LIMITS[provider.name] ?? 60_000;

  function trimConversation(minKeep = 5): void {
    const msgs = conversation.messages;
    const systemMsgs = msgs.filter(m => m.role === 'system');
    const nonSystem = msgs.filter(m => m.role !== 'system');

    for (const m of nonSystem) {
      if (m.role === 'tool' && m.content.length > 500) {
        m.content = m.content.slice(0, 500) + '\n…[truncated]';
      }
    }

    const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars <= contextLimit) return;

    while (nonSystem.length > minKeep) {
      const totalNow = [...systemMsgs, ...nonSystem].reduce((sum, m) => sum + m.content.length, 0);
      if (totalNow <= contextLimit) break;
      nonSystem.shift();
    }

    conversation.messages = [...systemMsgs, ...nonSystem];
  }

  while (iterations < maxIterations) {
    iterations++;
    const doStream = stream && iterations === 1;
    let tokensStreamed = false;

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
            tokensStreamed = true;
            process.stdout.write(chalk.white(token));
            if (onToken) onToken(token);
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
