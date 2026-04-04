/**
 * Mistral AI Provider
 *
 * Supports Mistral models via api.mistral.ai
 * Free tier: codestral, mistral-small, open-mistral-nemo
 * BYOK: mistral-large, mistral-medium
 *
 * Get free API key: https://console.mistral.ai/api-keys
 */
import { Provider, CompletionOptions, CompletionResult } from './index';
export declare class MistralProvider implements Provider {
    model: string;
    private apiKey?;
    name: string;
    constructor(model?: string, apiKey?: string | undefined);
    isAvailable(): Promise<boolean>;
    complete(options: CompletionOptions): Promise<CompletionResult>;
    private parseResponse;
    private post;
    private streamRequest;
}
//# sourceMappingURL=mistral.d.ts.map