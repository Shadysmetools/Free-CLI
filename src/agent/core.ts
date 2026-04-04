import { Provider, Message, Tool } from '../providers/index';
import { ConversationState, addMessage, addUsage } from './conversation';
import { TOOLS, executeTool, fileChanges } from './tools';
import { MCPClient } from '../mcp/client';
import { ToolRegistry } from '../registry/index';
import { MemoryManager } from '../memory/index';
import { SkillsManager } from '../skills/index';
import { TokenTracker } from '../tracking/tokens';
import { printToolCall, printToolResult, printError, printResponseFooter, printWarning } from '../ui/terminal';
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
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function runAgent(
  provider: Provider,
  conversation: ConversationState,
  userMessage: string,
  options: AgentOptions
): Promise<AgentResult> {
  const {
    cwd,
    stream,
    onToken,
    maxIterations = 10,
    mcpClient,
    registry,
    memory,
    skills,
    tokenTracker,
  } = options;

  const turnStart = Date.now();

  // ── Skill injection per-message ──────────────────────────────────────────
  // Detect relevant skills and inject into this turn's system message
  if (skills) {
    const skillCtx = skills.getSkillContext(userMessage);
    if (skillCtx) {
      // Inject as a temporary system message for this turn
      const systemIdx = conversation.messages.findIndex(m => m.role === 'system');
      const existing = systemIdx >= 0 ? conversation.messages[systemIdx].content : '';
      if (!existing.includes(skillCtx.slice(0, 40))) {
        // Only inject if not already present
        addMessage(conversation, {
          role: 'system',
          content: `[Active Skills for this request]${skillCtx}`,
        });
      }
    }
  }

  // Add user message
  addMessage(conversation, { role: 'user', content: userMessage });

  // ── Build tool list ───────────────────────────────────────────────────────
  let allTools: Tool[];
  if (registry) {
    allTools = registry.getEnabled();
    // Sync MCP tools into registry if connected
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

  while (iterations < maxIterations) {
    iterations++;
    const doStream = stream && iterations === 1;

    let result;
    try {
      result = await provider.complete({
        messages: conversation.messages,
        tools: allTools,
        stream: doStream,
        onToken: doStream ? (token) => {
          process.stdout.write(chalk.white(token));
          if (onToken) onToken(token);
        } : undefined,
      });
    } catch (err) {
      const msg = (err as Error).message;
      printError(`Provider error: ${msg}`);
      return { content: `Error: ${msg}` };
    }

    if (result.usage) {
      addUsage(conversation, result.usage);
      totalUsage.prompt_tokens += result.usage.prompt_tokens;
      totalUsage.completion_tokens += result.usage.completion_tokens;
      totalUsage.total_tokens += result.usage.total_tokens;
    }

    if (doStream && result.content) {
      process.stdout.write('\n');
    }

    lastContent = result.content;

    // ── No tool calls — done ────────────────────────────────────────────────
    if (!result.tool_calls || result.tool_calls.length === 0) {
      addMessage(conversation, { role: 'assistant', content: result.content });
      break;
    }

    // ── Has tool calls — process them ───────────────────────────────────────
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
        // Memory tools (intercepted before executeTool)
        if (memory && toolName === 'memory_search') {
          const query = String(toolArgs.query ?? '');
          const results = memory.search(query);
          if (results.length === 0) {
            toolResult = 'No memory entries found matching that query.';
          } else {
            toolResult = results.map(r => `${r.file}:${r.line}  ${r.content}`).join('\n');
          }
        } else if (memory && toolName === 'memory_save') {
          const note = String(toolArgs.note ?? '');
          const category = toolArgs.category ? String(toolArgs.category) : 'Notes';
          memory.save(note, category);
          toolResult = `✓ Saved to MEMORY.md under "${category}"`;
        }
        // MCP tools
        else if (mcpClient && await mcpClient.hasTool(toolName)) {
          const mcpResult = await mcpClient.callTool(toolName, toolArgs);
          toolResult = mcpResult.content;
        }
        // Built-in tools
        else {
          const execResult = await executeTool(toolName, toolArgs, cwd);
          toolResult = execResult.content;
          if (execResult.isError) {
            toolResult = `ERROR: ${toolResult}`;
          }
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

  // ── Track tokens ──────────────────────────────────────────────────────────
  if (tokenTracker && totalUsage.total_tokens > 0) {
    const durationMs = Date.now() - turnStart;
    const entry = tokenTracker.track(totalUsage, provider.name, provider.model, durationMs);
    const tokenLine = tokenTracker.formatResponseLine(entry);
    printResponseFooter(provider.name, provider.model, tokenLine);

    // Budget check
    const budget = tokenTracker.checkBudget();
    if (budget.message) {
      printWarning(budget.message);
    }
  }

  // ── Auto-save to session log ──────────────────────────────────────────────
  if (memory && lastContent) {
    try {
      memory.appendToday(`**User:** ${userMessage.slice(0, 200)}\n\n**AI:** ${lastContent.slice(0, 500)}`);
    } catch { /* non-fatal */ }
  }

  return { content: lastContent, usage: totalUsage };
}

// Re-export fileChanges for /undo command
export { fileChanges };
