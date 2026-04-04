import { Provider, CompletionOptions, CompletionResult } from './index';
export declare class OpenRouterProvider implements Provider {
    model: string;
    private apiKey?;
    name: string;
    private inner;
    constructor(model?: string, apiKey?: string | undefined, baseUrl?: string);
    isAvailable(): Promise<boolean>;
    complete(options: CompletionOptions): Promise<CompletionResult>;
    private parseResponse;
    private post;
    private streamRequest;
}
//# sourceMappingURL=openrouter.d.ts.map