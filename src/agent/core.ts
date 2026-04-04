import { Provider, Message } from '../providers/index';
import { ConversationState, addMessage, addUsage } from './conversation';
import { TOOLS, executeTool, fileChanges } from './tools';
import { MCPClient } from '../mcp/client';
import { Tool } from '../providers/index';
import { printToolCall, printToolResult, printError } from '../ui/terminal';
import { renderMarkdown } from '../ui/markdown';
import chalk from 'chalk';

export interface AgentOptions {
  cwd: string;
  stream: boolean;
  onToken?: (token: string) => void;
  maxIterations?: number;
  mcpClient?: MCPClient;
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
  const { cwd, stream, onToken, maxIterations = 10, mcpClient } = options;

  // Add user message
  addMessage(conversation, { role: 'user', content: userMessage });

  // Get tools (built-in + MCP)
  const allTools: Tool[] = [...TOOLS];
  if (mcpClient) {
    const mcpTools = await mcpClient.getTools();
    allTools.push(...mcpTools);
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

    // If streamed, we already printed it
    if (doStream && result.content) {
      process.stdout.write('\n');
    }

    lastContent = result.content;

    // No tool calls — we're done
    if (!result.tool_calls || result.tool_calls.length === 0) {
      addMessage(conversation, { role: 'assistant', content: result.content });
      break;
    }

    // Has tool calls — process them
    const assistantMsg: Message = {
      role: 'assistant',
      content: result.content,
      tool_calls: result.tool_calls,
    };
    addMessage(conversation, assistantMsg);

    // Execute each tool
    for (const toolCall of result.tool_calls) {
      const toolName = toolCall.function.name;
      let toolArgs: Record<string, unknown> = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch { /* ignore */ }

      printToolCall(toolName, toolArgs);

      let toolResult: string;
      try {
        // Check if it's an MCP tool
        if (mcpClient && await mcpClient.hasTool(toolName)) {
          const mcpResult = await mcpClient.callTool(toolName, toolArgs);
          toolResult = mcpResult.content;
        } else {
          const result = await executeTool(toolName, toolArgs, cwd);
          toolResult = result.content;
          if (result.isError) {
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

    // Continue the loop to get next response
  }

  return { content: lastContent, usage: totalUsage };
}
