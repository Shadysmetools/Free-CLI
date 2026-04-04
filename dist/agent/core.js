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
const fallback_1 = require("../providers/fallback");
const chalk_1 = __importDefault(require("chalk"));
async function runAgent(providerArg, conversation, userMessage, options) {
    // Allow provider to be reassigned on fallback
    let provider = providerArg;
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
    // Provider-specific context limits (in characters — rough proxy for tokens)
    const CONTEXT_CHAR_LIMITS = {
        groq: 24000, // ~6K tokens × ~4 chars/token — conservative for 8K limit
        openrouter: 80000,
        anthropic: 200000,
        ollama: 60000,
        google: 200000,
    };
    const contextLimit = CONTEXT_CHAR_LIMITS[provider.name] ?? 60000;
    /** Trim conversation to fit within charLimit, keeping system + last minKeep messages. */
    function trimConversation(minKeep = 5) {
        const msgs = conversation.messages;
        const systemMsgs = msgs.filter(m => m.role === 'system');
        const nonSystem = msgs.filter(m => m.role !== 'system');
        // Truncate long tool results to 500 chars to save context
        for (const m of nonSystem) {
            if (m.role === 'tool' && m.content.length > 500) {
                m.content = m.content.slice(0, 500) + '\n…[truncated]';
            }
        }
        const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
        if (totalChars <= contextLimit)
            return;
        // Remove old non-system messages until we're under the limit, keeping last minKeep
        while (nonSystem.length > minKeep) {
            const totalNow = [...systemMsgs, ...nonSystem].reduce((sum, m) => sum + m.content.length, 0);
            if (totalNow <= contextLimit)
                break;
            nonSystem.shift(); // remove oldest
        }
        conversation.messages = [...systemMsgs, ...nonSystem];
    }
    while (iterations < maxIterations) {
        iterations++;
        const doStream = stream && iterations === 1;
        // Auto-trim context before each provider call
        trimConversation(5);
        let result;
        try {
            const fallbackResult = await (0, fallback_1.completeWithFallback)(provider, {
                messages: conversation.messages,
                tools: allTools,
                stream: doStream,
                onToken: doStream ? (token) => {
                    process.stdout.write(chalk_1.default.white(token));
                    if (onToken)
                        onToken(token);
                } : undefined,
            }, (msg) => {
                // Print fallback status on its own line
                process.stdout.write('\n' + chalk_1.default.yellow(msg) + '\n');
            });
            result = fallbackResult.result;
            // If provider was swapped, update for remaining iterations
            if (fallbackResult.activeProvider !== provider) {
                provider = fallbackResult.activeProvider;
            }
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