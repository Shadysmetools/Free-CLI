import { Settings } from '../config/settings';
export interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
}
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}
export interface Tool {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description?: string;
            enum?: string[];
            items?: {
                type: string;
            };
        }>;
        required?: string[];
    };
}
export interface CompletionOptions {
    messages: Message[];
    tools?: Tool[];
    stream?: boolean;
    onToken?: (token: string) => void;
}
export interface CompletionResult {
    content: string;
    tool_calls?: ToolCall[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
export interface Provider {
    name: string;
    model: string;
    complete(options: CompletionOptions): Promise<CompletionResult>;
    isAvailable(): Promise<boolean>;
}
export declare function createProvider(providerName: string, settings: Settings): Provider;
export declare const PROVIDER_LIST: readonly ["ollama", "groq", "anthropic", "openai", "google", "openrouter", "mistral"];
export type ProviderName = typeof PROVIDER_LIST[number];
export declare const FREE_PROVIDERS: readonly ["ollama", "groq", "google", "openrouter", "mistral"];
export declare const PROVIDER_INFO: Record<string, {
    description: string;
    requiresKey: boolean;
    free: boolean;
}>;
/**
 * Curated model lists per provider (for /models command and tab-completion).
 * Keep these up-to-date as providers release new models.
 * Last updated: 2026-04
 */
export declare const PROVIDER_MODELS: Record<string, Array<{
    id: string;
    label: string;
    free: boolean;
    recommended?: boolean;
}>>;
//# sourceMappingURL=index.d.ts.map