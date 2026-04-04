"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgent = runAgent;
const conversation_1 = require("./conversation");
const tools_1 = require("./tools");
const terminal_1 = require("../ui/terminal");
const chalk_1 = __importDefault(require("chalk"));
async function runAgent(provider, conversation, userMessage, options) {
    const { cwd, stream, onToken, maxIterations = 10, mcpClient } = options;
    // Add user message
    (0, conversation_1.addMessage)(conversation, { role: 'user', content: userMessage });
    // Get tools (built-in + MCP)
    const allTools = [...tools_1.TOOLS];
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
                    process.stdout.write(chalk_1.default.white(token));
                    if (onToken)
                        onToken(token);
                } : undefined,
            });
        }
        catch (err) {
            const msg = err.message;
            (0, terminal_1.printError)(`Provider error: ${msg}`);
            return { content: `Error: ${msg}` };
        }
        if (result.usage) {
            (0, conversation_1.addUsage)(conversation, result.usage);
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
            (0, conversation_1.addMessage)(conversation, { role: 'assistant', content: result.content });
            break;
        }
        // Has tool calls — process them
        const assistantMsg = {
            role: 'assistant',
            content: result.content,
            tool_calls: result.tool_calls,
        };
        (0, conversation_1.addMessage)(conversation, assistantMsg);
        // Execute each tool
        for (const toolCall of result.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs = {};
            try {
                toolArgs = JSON.parse(toolCall.function.arguments);
            }
            catch { /* ignore */ }
            (0, terminal_1.printToolCall)(toolName, toolArgs);
            let toolResult;
            try {
                // Check if it's an MCP tool
                if (mcpClient && await mcpClient.hasTool(toolName)) {
                    const mcpResult = await mcpClient.callTool(toolName, toolArgs);
                    toolResult = mcpResult.content;
                }
                else {
                    const result = await (0, tools_1.executeTool)(toolName, toolArgs, cwd);
                    toolResult = result.content;
                    if (result.isError) {
                        toolResult = `ERROR: ${toolResult}`;
                    }
                }
            }
            catch (err) {
                toolResult = `ERROR: ${err.message}`;
            }
            (0, terminal_1.printToolResult)(toolName, toolResult);
            (0, conversation_1.addMessage)(conversation, {
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
//# sourceMappingURL=core.js.map