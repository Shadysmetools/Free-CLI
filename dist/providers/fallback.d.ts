/**
 * Auto-Fallback Provider Chain
 *
 * When a provider fails with a retriable error (429, 413, 404, quota, rate limit),
 * automatically tries the next free provider without user intervention.
 *
 * Chain order: OpenRouter free → Groq → Google → (exhausted)
 */
import { Provider, CompletionOptions, CompletionResult } from './index';
export interface FallbackEntry {
    provider: string;
    model: string;
    label: string;
    createProvider: () => Provider;
}
export declare const FREE_FALLBACK_CHAIN: FallbackEntry[];
/**
 * Returns true if the error is retriable (rate limit, quota, context too large, etc.)
 */
export declare function isRetriableError(error: unknown): boolean;
export type FallbackNotifier = (message: string) => void;
/**
 * Try provider.complete(); on retriable failure, walk FREE_FALLBACK_CHAIN
 * and return the first successful result.
 *
 * @param provider      The primary provider to try first
 * @param options       CompletionOptions (messages, tools, etc.)
 * @param notify        Optional callback to print status lines to the user
 * @returns             CompletionResult from whichever provider succeeded
 */
export declare function completeWithFallback(provider: Provider, options: CompletionOptions, notify?: FallbackNotifier): Promise<{
    result: CompletionResult;
    activeProvider: Provider;
}>;
export interface ProviderStatus {
    id: string;
    label: string;
    model: string;
    available: boolean;
    reason: string;
}
/**
 * Check availability of all known providers and return their status.
 */
export declare function checkAllProviders(): Promise<ProviderStatus[]>;
//# sourceMappingURL=fallback.d.ts.map