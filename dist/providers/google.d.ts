import { Provider, CompletionOptions, CompletionResult } from './index';
export declare class GoogleProvider implements Provider {
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
//# sourceMappingURL=google.d.ts.map