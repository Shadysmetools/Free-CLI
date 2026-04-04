import { Provider, CompletionOptions, CompletionResult } from './index';
export declare class OllamaProvider implements Provider {
    model: string;
    private baseUrl;
    name: string;
    constructor(model: string, baseUrl?: string);
    isAvailable(): Promise<boolean>;
    complete(options: CompletionOptions): Promise<CompletionResult>;
    private streamComplete;
    private httpGet;
    private httpPost;
}
//# sourceMappingURL=ollama.d.ts.map