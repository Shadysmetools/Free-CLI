/**
 * Auto-Fallback Provider Chain
 *
 * When a provider fails with a retriable error, automatically tries the next
 * free provider. Only emits ONE quiet notification if a fallback succeeds.
 */
import { Provider, CompletionOptions, CompletionResult } from './index';
export interface FallbackEntry {
    provider: string;
    model: string;
    label: string;
    createProvider: () => Provider;
}
export declare const FREE_FALLBACK_CHAIN: FallbackEntry[];
export declare function isRetriableError(error: unknown): boolean;
/** Called with the short model name when a fallback succeeds */
export type FallbackNotifier = (modelName: string) => void;
/**
 * Try provider.complete(); on retriable failure, walk FREE_FALLBACK_CHAIN
 * and return the first successful result.
 *
 * Emits ONE quiet notification (via `notify`) when a fallback succeeds.
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
export declare function checkAllProviders(): Promise<ProviderStatus[]>;
export declare function extractShortError(msg: string): string;
//# sourceMappingURL=fallback.d.ts.map