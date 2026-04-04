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
export interface ModelPricing {
    input: number;
    output: number;
}
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    provider: string;
    model: string;
    timestamp: Date;
    durationMs: number;
}
export interface SessionStats {
    totalInput: number;
    totalOutput: number;
    totalCost: number;
    totalDurationMs: number;
    wallStartMs: number;
    turns: number;
    byModel: Map<string, {
        input: number;
        output: number;
        cost: number;
        calls: number;
    }>;
}
export declare class TokenTracker {
    private usages;
    private sessionStart;
    private budgetUsd;
    private budgetWarned;
    track(usage: {
        prompt_tokens: number;
        completion_tokens: number;
    }, provider: string, model: string, durationMs?: number): TokenUsage;
    getCostForEntry(entry: TokenUsage): number;
    getStats(): SessionStats;
    /**
     * Per-response one-liner (shown after every AI response)
     * e.g. [groq/llama-3.3-70b · 1,234 in / 567 out · free]
     */
    formatResponseLine(entry: TokenUsage): string;
    /**
     * /cost command output — matches Claude Code's format
     */
    formatCostReport(): string;
    /**
     * Compact status bar line for the footer
     * e.g. 📊 15,432 in / 4,567 out | $0.00 | 12 turns
     */
    formatStatusBar(): string;
    setBudget(usd: number): void;
    checkBudget(): {
        over: boolean;
        warning: boolean;
        message: string | null;
    };
    static getPricing(provider: string, model: string): ModelPricing;
    static listPricingTable(): Array<{
        key: string;
        input: number;
        output: number;
    }>;
}
//# sourceMappingURL=tokens.d.ts.map