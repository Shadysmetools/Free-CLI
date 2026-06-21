import { Provider, CompletionOptions, CompletionResult } from './index';
/**
 * Custom OpenAI-compatible provider.
 *
 * Points coderaw at ANY OpenAI-compatible endpoint via a base URL + API key +
 * model (+ optional custom headers). Mirrors the OpenAI provider's request,
 * streaming and tool-call shape so tools and streaming work identically.
 *
 * Configure via settings.providers.custom { baseUrl, apiKey, model, headers? }
 * or env vars CUSTOM_BASE_URL / CUSTOM_API_KEY / CUSTOM_MODEL.
 */
export declare class CustomProvider implements Provider {
    model: string;
    private apiKey?;
    private baseUrl?;
    private headers?;
    name: string;
    constructor(model?: string, apiKey?: string | undefined, baseUrl?: string | undefined, headers?: Record<string, string> | undefined);
    private resolveKey;
    private resolveBaseUrl;
    isAvailable(): Promise<boolean>;
    complete(options: CompletionOptions): Promise<CompletionResult>;
    private parseResponse;
    /**
     * Build request options from the base URL. Supports http and https endpoints
     * and preserves any base path segment (e.g. https://gw.example.com/openai).
     */
    private requestOptions;
    private post;
    private streamRequest;
}
//# sourceMappingURL=custom.d.ts.map