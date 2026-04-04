"use strict";
/**
 * Token Tracker — models Claude Code's /cost command output format
 *
 * /cost output:
 *   Total cost:            $0.55
 *   Total duration (API):  6m 19.7s
 *   Total duration (wall): 6h 33m 10.2s
 *
 * Per-response footer:
 *   [groq/llama-3.3-70b · 1,234 in / 567 out · $0.02]
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenTracker = void 0;
const PRICING = {
    // Free / local
    'ollama': { input: 0, output: 0 },
    // Groq free tier
    'groq/llama-3.3-70b-versatile': { input: 0, output: 0 },
    'groq/llama-3.3-70b-specdec': { input: 0, output: 0 },
    'groq/deepseek-r1-distill-llama-70b': { input: 0, output: 0 },
    'groq/gemma2-9b-it': { input: 0, output: 0 },
    'groq/llama-3.1-8b-instant': { input: 0, output: 0 },
    // Groq paid
    'groq/llama-3.1-70b-versatile': { input: 0.59, output: 0.79 },
    // Google
    'google/gemini-2.5-flash': { input: 0.15, output: 0.60 },
    'google/gemini-2.5-pro': { input: 1.25, output: 10.0 },
    'google/gemini-2.0-flash': { input: 0.10, output: 0.40 },
    'google/gemini-2.0-flash-lite': { input: 0.075, output: 0.30 },
    'google/gemini-1.5-flash': { input: 0.075, output: 0.30 },
    'google/gemini-1.5-pro': { input: 1.25, output: 5.0 },
    // Anthropic
    'anthropic/claude-sonnet-4-6': { input: 3.0, output: 15.0 },
    'anthropic/claude-opus-4-6': { input: 5.0, output: 25.0 },
    'anthropic/claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
    'anthropic/claude-3-5-haiku-20241022': { input: 0.80, output: 4.0 },
    'anthropic/claude-3-opus-20240229': { input: 15.0, output: 75.0 },
    'anthropic/claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
    // OpenAI
    'openai/gpt-4o': { input: 2.5, output: 10.0 },
    'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
    'openai/gpt-4-turbo': { input: 10.0, output: 30.0 },
    'openai/o1': { input: 15.0, output: 60.0 },
    'openai/o1-mini': { input: 1.10, output: 4.40 },
    // OpenRouter (free models)
    'openrouter/meta-llama/llama-3.3-70b-instruct:free': { input: 0, output: 0 },
    'openrouter/google/gemma-3-27b-it:free': { input: 0, output: 0 },
    'openrouter/mistralai/mistral-small-3.1-24b-instruct:free': { input: 0, output: 0 },
};
// ─── TokenTracker ─────────────────────────────────────────────────────────────
class TokenTracker {
    constructor() {
        this.usages = [];
        this.sessionStart = Date.now();
        this.budgetUsd = null;
        this.budgetWarned = false;
    }
    // ─── Track ─────────────────────────────────────────────────────────────────
    track(usage, provider, model, durationMs = 0) {
        const entry = {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            provider,
            model,
            timestamp: new Date(),
            durationMs,
        };
        this.usages.push(entry);
        return entry;
    }
    // ─── Cost Calculation ──────────────────────────────────────────────────────
    getCostForEntry(entry) {
        const key = `${entry.provider}/${entry.model}`;
        const pricing = PRICING[key] ?? PRICING[entry.provider] ?? { input: 0, output: 0 };
        return ((entry.inputTokens / 1000000) * pricing.input +
            (entry.outputTokens / 1000000) * pricing.output);
    }
    // ─── Session Stats ─────────────────────────────────────────────────────────
    getStats() {
        const byModel = new Map();
        let totalInput = 0, totalOutput = 0, totalCost = 0, totalDurationMs = 0;
        for (const u of this.usages) {
            const cost = this.getCostForEntry(u);
            const key = `${u.provider}/${u.model}`;
            totalInput += u.inputTokens;
            totalOutput += u.outputTokens;
            totalCost += cost;
            totalDurationMs += u.durationMs;
            const existing = byModel.get(key) ?? { input: 0, output: 0, cost: 0, calls: 0 };
            byModel.set(key, {
                input: existing.input + u.inputTokens,
                output: existing.output + u.outputTokens,
                cost: existing.cost + cost,
                calls: existing.calls + 1,
            });
        }
        return {
            totalInput,
            totalOutput,
            totalCost,
            totalDurationMs,
            wallStartMs: this.sessionStart,
            turns: this.usages.length,
            byModel,
        };
    }
    // ─── Formatting ────────────────────────────────────────────────────────────
    /**
     * Per-response one-liner (shown after every AI response)
     * e.g. [groq/llama-3.3-70b · 1,234 in / 567 out · free]
     */
    formatResponseLine(entry) {
        const cost = this.getCostForEntry(entry);
        const costStr = cost > 0 ? `$${cost.toFixed(4)}` : 'free';
        const inputFmt = entry.inputTokens.toLocaleString();
        const outputFmt = entry.outputTokens.toLocaleString();
        return `${entry.provider}/${entry.model} · ${inputFmt} in / ${outputFmt} out · ${costStr}`;
    }
    /**
     * /cost command output — matches Claude Code's format
     */
    formatCostReport() {
        const stats = this.getStats();
        const wallMs = Date.now() - this.sessionStart;
        const lines = [
            '',
            '  Token Usage & Cost',
            '  ' + '─'.repeat(40),
            `  Total cost:            ${formatCost(stats.totalCost)}`,
            `  Total duration (API):  ${formatDuration(stats.totalDurationMs)}`,
            `  Total duration (wall): ${formatDuration(wallMs)}`,
            `  Total tokens:          ${stats.totalInput.toLocaleString()} in / ${stats.totalOutput.toLocaleString()} out`,
            `  Turns:                 ${stats.turns}`,
        ];
        if (stats.byModel.size > 1) {
            lines.push('');
            lines.push('  By model:');
            for (const [model, data] of stats.byModel) {
                const costStr = data.cost > 0 ? ` · ${formatCost(data.cost)}` : ' · free';
                lines.push(`    ${model.padEnd(45)} ${data.input.toLocaleString()} in / ${data.output.toLocaleString()} out${costStr} (${data.calls} calls)`);
            }
        }
        if (this.budgetUsd !== null) {
            const used = (stats.totalCost / this.budgetUsd) * 100;
            lines.push('');
            lines.push(`  Budget: ${formatCost(stats.totalCost)} / ${formatCost(this.budgetUsd)} (${Math.round(used)}%)`);
        }
        lines.push('');
        return lines.join('\n');
    }
    /**
     * Compact status bar line for the footer
     * e.g. 📊 15,432 in / 4,567 out | $0.00 | 12 turns
     */
    formatStatusBar() {
        const stats = this.getStats();
        const costStr = stats.totalCost > 0 ? ` | ${formatCost(stats.totalCost)}` : ' | free';
        return `📊 ${stats.totalInput.toLocaleString()} in / ${stats.totalOutput.toLocaleString()} out${costStr} | ${stats.turns} turns`;
    }
    // ─── Budget ────────────────────────────────────────────────────────────────
    setBudget(usd) {
        this.budgetUsd = usd;
        this.budgetWarned = false;
    }
    checkBudget() {
        if (this.budgetUsd === null)
            return { over: false, warning: false, message: null };
        const { totalCost } = this.getStats();
        const ratio = totalCost / this.budgetUsd;
        if (ratio >= 1.0) {
            return { over: true, warning: false, message: `⚠️  Budget exceeded! Spent ${formatCost(totalCost)} of ${formatCost(this.budgetUsd)} limit.` };
        }
        if (ratio >= 0.8 && !this.budgetWarned) {
            this.budgetWarned = true;
            return { over: false, warning: true, message: `⚠️  Approaching budget limit: ${formatCost(totalCost)} of ${formatCost(this.budgetUsd)} (${Math.round(ratio * 100)}%)` };
        }
        return { over: false, warning: false, message: null };
    }
    // ─── Pricing Lookup ────────────────────────────────────────────────────────
    static getPricing(provider, model) {
        const key = `${provider}/${model}`;
        return PRICING[key] ?? PRICING[provider] ?? { input: 0, output: 0 };
    }
    static listPricingTable() {
        return Object.entries(PRICING).map(([key, p]) => ({ key, ...p }));
    }
}
exports.TokenTracker = TokenTracker;
// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatCost(usd) {
    if (usd === 0)
        return '$0.00';
    if (usd < 0.01)
        return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
}
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const secs = ms / 1000;
    if (secs < 60)
        return `${secs.toFixed(1)}s`;
    const mins = Math.floor(secs / 60);
    const rem = (secs % 60).toFixed(1);
    return `${mins}m ${rem}s`;
}
//# sourceMappingURL=tokens.js.map