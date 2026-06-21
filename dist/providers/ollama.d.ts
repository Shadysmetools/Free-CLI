import { Provider, CompletionOptions, CompletionResult } from './index';
export declare class OllamaProvider implements Provider {
    model: string;
    private baseUrl;
    name: string;
    constructor(model: string, baseUrl?: string);
    isAvailable(): Promise<boolean>;
    complete(options: CompletionOptions): Promise<CompletionResult>;
    /** Semantic embeddings via Ollama /api/embed. Reuses the tested match/embeddings logic. */
    embed(texts: string[], model: string): Promise<number[][] | null>;
    private streamComplete;
    private httpGet;
    private httpPost;
}
interface RecoveredToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}
/**
 * Recover tool calls a model emitted as JSON text in `content`. Handles bare
 * objects, arrays, ```json fences, and <tool_call>…</tool_call> wrappers.
 */
export declare function recoverToolCallsFromText(content: string): RecoveredToolCall[];
/** Split accumulated streamed content into final text vs recovered tool calls. */
export declare function recoverFromStreamedContent(content: string): {
    content: string;
    tool_calls?: RecoveredToolCall[];
};
export {};
//# sourceMappingURL=ollama.d.ts.map