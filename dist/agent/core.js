"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileChanges = void 0;
exports.runAgent = runAgent;
const conversation_1 = require("./conversation");
const tools_1 = require("./tools");
Object.defineProperty(exports, "fileChanges", { enumerable: true, get: function () { return tools_1.fileChanges; } });
const terminal_1 = require("../ui/terminal");
const chalk_1 = __importDefault(require("chalk"));
async function runAgent(provider, conversation, userMessage, options) {
    const { cwd, stream, onToken, maxIterations = 10, mcpClient, registry, memory, skills, tokenTracker, } = options;
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
                (0, conversation_1.addMessage)(conversation, {
                    role: 'system',
                    content: `[Active Skills for this request]${skillCtx}`,
                });
            }
        }
    }
    // Add user message
    (0, conversation_1.addMessage)(conversation, { role: 'user', content: userMessage });
    // ── Build tool list ───────────────────────────────────────────────────────
    let allTools;
    if (registry) {
        allTools = registry.getEnabled();
        // Sync MCP tools into registry if connected
        if (mcpClient) {
            const mcpTools = await mcpClient.getTools();
            registry.registerMCPTools(mcpTools);
            allTools = registry.getEnabled();
        }
    }
    else {
        allTools = [...tools_1.TOOLS];
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
        if (doStream && result.content) {
            process.stdout.write('\n');
        }
        lastContent = result.content;
        // ── No tool calls — done ────────────────────────────────────────────────
        if (!result.tool_calls || result.tool_calls.length === 0) {
            (0, conversation_1.addMessage)(conversation, { role: 'assistant', content: result.content });
            break;
        }
        // ── Has tool calls — process them ───────────────────────────────────────
        const assistantMsg = {
            role: 'assistant',
            content: result.content,
            tool_calls: result.tool_calls,
        };
        (0, conversation_1.addMessage)(conversation, assistantMsg);
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
                // Memory tools (intercepted before executeTool)
                if (memory && toolName === 'memory_search') {
                    const query = String(toolArgs.query ?? '');
                    const results = memory.search(query);
                    if (results.length === 0) {
                        toolResult = 'No memory entries found matching that query.';
                    }
                    else {
                        toolResult = results.map(r => `${r.file}:${r.line}  ${r.content}`).join('\n');
                    }
                }
                else if (memory && toolName === 'memory_save') {
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
                    const execResult = await (0, tools_1.executeTool)(toolName, toolArgs, cwd);
                    toolResult = execResult.content;
                    if (execResult.isError) {
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
    }
    // ── Track tokens ──────────────────────────────────────────────────────────
    if (tokenTracker && totalUsage.total_tokens > 0) {
        const durationMs = Date.now() - turnStart;
        const entry = tokenTracker.track(totalUsage, provider.name, provider.model, durationMs);
        const tokenLine = tokenTracker.formatResponseLine(entry);
        (0, terminal_1.printResponseFooter)(provider.name, provider.model, tokenLine);
        // Budget check
        const budget = tokenTracker.checkBudget();
        if (budget.message) {
            (0, terminal_1.printWarning)(budget.message);
        }
    }
    // ── Auto-save to session log ──────────────────────────────────────────────
    if (memory && lastContent) {
        try {
            memory.appendToday(`**User:** ${userMessage.slice(0, 200)}\n\n**AI:** ${lastContent.slice(0, 500)}`);
        }
        catch { /* non-fatal */ }
    }
    return { content: lastContent, usage: totalUsage };
}
//# sourceMappingURL=core.js.map