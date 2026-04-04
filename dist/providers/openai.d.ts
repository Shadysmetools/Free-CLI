import { Provider, CompletionOptions, CompletionResult } from './index';
export declare class OpenAIProvider implements Provider {
    model: string;
    private apiKey?;
    name: string;
    private hostname;
    private basePath;
    constructor(model?: string, apiKey?: string | undefined, baseUrl?: string);
    isAvailable(): Promise<boolean>;
    complete(options: CompletionOptions): Promise<CompletionResult>;
    private parseResponse;
    private post;
    private streamRequest;
}
//# sourceMappingURL=openai.d.ts.map