"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileChanges = void 0;
exports.looksLikeToolAttempt = looksLikeToolAttempt;
exports.trimMessages = trimMessages;
exports.runAgent = runAgent;
const conversation_1 = require("./conversation");
const tools_1 = require("./tools");
Object.defineProperty(exports, "fileChanges", { enumerable: true, get: function () { return tools_1.fileChanges; } });
const terminal_1 = require("../ui/terminal");
const fallback_1 = require("../providers/fallback");
const permissions_1 = require("../permissions");
const chalk_1 = __importDefault(require("chalk"));
/** Heuristic: the model tried to call a tool but emitted broken/partial JSON. */
function looksLikeToolAttempt(content) {
    const t = (content || '').trim();
    if (!t)
        return false;
    if (t.includes('<tool_call>'))
        return true;
    if (/"name"\s*:/.test(t) && /"(arguments|parameters)"\s*:/.test(t))
        return true;
    return false;
}
/**
 * Trim a conversation to fit a character budget WITHOUT orphaning tool-result
 * messages. Providers (Anthropic/OpenAI/Groq) return 400 if a `tool` message is
 * not immediately preceded by the assistant message carrying its tool_calls, so
 * after trimming we drop any leading `tool` messages left at the front.
 */
function trimMessages(messages, contextLimit, minKeep = 5) {
    const systemMsgs = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');
    for (const m of nonSystem) {
        if (m.role === 'tool' && m.content.length > 500) {
            m.content = m.content.slice(0, 500) + '\n…[truncated]';
        }
    }
    const total = () => [...systemMsgs, ...nonSystem].reduce((s, m) => s + m.content.length, 0);
    if (total() <= contextLimit)
        return messages;
    while (nonSystem.length > minKeep && total() > contextLimit) {
        nonSystem.shift();
    }
    // Never start the kept window on an orphaned tool result.
    while (nonSystem.length > 0 && nonSystem[0].role === 'tool') {
        nonSystem.shift();
    }
    return [...systemMsgs, ...nonSystem];
}
async function runAgent(providerArg, conversation, userMessage, options) {
    let provider = providerArg;
    const { cwd, stream, onToken, maxIterations = 10, mcpClient, registry, memory, skills, tokenTracker, permissions, unattended, sessionAllow, } = options;
    const turnStart = Date.now();
    // ── Permission gate context (built once per turn) ─────────────────────────
    const gateCtx = permissions
        ? {
            cwd,
            rules: permissions,
            isInteractive: Boolean(process.stdout.isTTY) && !unattended,
            sessionAllow: sessionAllow ?? new Set(),
            persistAllow: permissions_1.persistAllowPattern,
        }
        : undefined;
    // ── Skill injection ───────────────────────────────────────────────────────
    if (skills) {
        const skillCtx = skills.getSkillContext(userMessage);
        if (skillCtx) {
            const systemIdx = conversation.messages.findIndex(m => m.role === 'system');
            const existing = systemIdx >= 0 ? conversation.messages[systemIdx].content : '';
            if (!existing.includes(skillCtx.slice(0, 40))) {
                (0, conversation_1.addMessage)(conversation, {
                    role: 'system',
                    content: `[Active Skills for this request]${skillCtx}`,
                });
            }
        }
    }
    (0, conversation_1.addMessage)(conversation, { role: 'user', content: userMessage });
    // ── Build tool list ───────────────────────────────────────────────────────
    let allTools;
    if (registry) {
        allTools = registry.getEnabled();
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
    let repairedOnce = false;
    const CONTEXT_CHAR_LIMITS = {
        groq: 24000,
        openrouter: 80000,
        anthropic: 200000,
        ollama: 60000,
        google: 200000,
    };
    const contextLimit = CONTEXT_CHAR_LIMITS[provider.name] ?? 60000;
    function trimConversation(minKeep = 5) {
        conversation.messages = trimMessages(conversation.messages, contextLimit, minKeep);
    }
    while (iterations < maxIterations) {
        iterations++;
        const doStream = stream && iterations === 1;
        let tokensStreamed = false;
        trimConversation(5);
        let result;
        try {
            const fallbackResult = await (0, fallback_1.completeWithFallback)(provider, {
                messages: conversation.messages,
                tools: allTools,
                stream: doStream,
                onToken: doStream ? (token) => {
                    tokensStreamed = true;
                    process.stdout.write(chalk_1.default.white(token));
                    if (onToken)
                        onToken(token);
                } : undefined,
            }, (modelName) => {
                // Quiet one-liner when fallback provider is used
                process.stdout.write(chalk_1.default.dim(`\n  ℹ switched to ${modelName}\n`));
            });
            result = fallbackResult.result;
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
        // Only add newline if tokens actually streamed to stdout
        if (tokensStreamed && result.content) {
            process.stdout.write('\n');
        }
        lastContent = result.content;
        // ── No tool calls → maybe a botched call, else done ───────────────────
        if (!result.tool_calls || result.tool_calls.length === 0) {
            if (looksLikeToolAttempt(result.content) && !repairedOnce) {
                repairedOnce = true;
                (0, conversation_1.addMessage)(conversation, { role: 'assistant', content: result.content });
                (0, conversation_1.addMessage)(conversation, {
                    role: 'user',
                    content: 'Your previous tool call was not valid JSON. Resend ONLY the corrected tool call as a single JSON object {"name":..., "arguments":{...}} with no extra text.',
                });
                continue;
            }
            (0, conversation_1.addMessage)(conversation, { role: 'assistant', content: result.content });
            break;
        }
        // ── Tool calls → process them ─────────────────────────────────────────
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
            // ── Permission gate ───────────────────────────────────────────────────
            if (gateCtx) {
                const decision = await (0, permissions_1.gate)(toolName, toolArgs, gateCtx);
                if (!decision.allowed) {
                    (0, terminal_1.printToolCall)(toolName, toolArgs);
                    // Always-visible denial (printToolResult hides content in non-verbose mode)
                    process.stdout.write(`\n  ${chalk_1.default.yellow(`⛔ ${decision.reasonForModel ?? 'Not permitted.'}`)}\n`);
                    (0, conversation_1.addMessage)(conversation, {
                        role: 'tool',
                        content: decision.reasonForModel ?? 'Action not permitted by user permission rules.',
                        tool_call_id: toolCall.id,
                        name: toolName,
                    });
                    continue;
                }
            }
            (0, terminal_1.printToolCall)(toolName, toolArgs);
            let toolResult;
            try {
                if (memory && toolName === 'memory_search') {
                    const query = String(toolArgs.query ?? '');
                    const results = memory.search(query);
                    toolResult = results.length === 0
                        ? 'No memory entries found matching that query.'
                        : results.map(r => `${r.file}:${r.line}  ${r.content}`).join('\n');
                }
                else if (memory && toolName === 'memory_save') {
                    const note = String(toolArgs.note ?? '');
                    const category = toolArgs.category ? String(toolArgs.category) : 'Notes';
                    memory.save(note, category);
                    toolResult = `✓ Saved to MEMORY.md under "${category}"`;
                }
                else if (mcpClient && await mcpClient.hasTool(toolName)) {
                    const mcpResult = await mcpClient.callTool(toolName, toolArgs);
                    toolResult = mcpResult.content;
                }
                else {
                    const execResult = await (0, tools_1.executeTool)(toolName, toolArgs, cwd);
                    toolResult = execResult.content;
                    if (execResult.isError)
                        toolResult = `ERROR: ${toolResult}`;
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
    // ── Build footer line + track tokens ──────────────────────────────────────
    let footerLine;
    if (tokenTracker && totalUsage.total_tokens > 0) {
        const durationMs = Date.now() - turnStart;
        const entry = tokenTracker.track(totalUsage, provider.name, provider.model, durationMs);
        const cost = tokenTracker.getCostForEntry(entry);
        const costStr = cost > 0 ? `$${cost.toFixed(4)}` : 'free';
        const totalToks = (entry.inputTokens + entry.outputTokens).toLocaleString();
        const modelShort = entry.model.split('/').pop() ?? entry.model;
        footerLine = chalk_1.default.dim(`  ${modelShort} · ${totalToks} tokens · ${costStr}`);
        const budget = tokenTracker.checkBudget();
        if (budget.message) {
            (0, terminal_1.printWarning)(budget.message);
        }
    }
    // ── Auto-save session log ─────────────────────────────────────────────────
    if (memory && lastContent) {
        try {
            memory.appendToday(`**User:** ${userMessage.slice(0, 200)}\n\n**AI:** ${lastContent.slice(0, 500)}`);
        }
        catch { /* non-fatal */ }
    }
    return { content: lastContent, usage: totalUsage, footerLine };
}
//# sourceMappingURL=core.js.map