import { Message } from '../providers/index';
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}
export interface ConversationState {
    messages: Message[];
    totalUsage: TokenUsage;
    turnCount: number;
}
export declare function createConversation(systemPrompt?: string): ConversationState;
export declare function addMessage(state: ConversationState, message: Message): void;
export declare function addUsage(state: ConversationState, usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}): void;
export declare function compactConversation(state: ConversationState): string;
export declare function clearConversation(state: ConversationState): void;
export declare function getConversationStats(state: ConversationState): string;
export interface SystemPromptOptions {
    cwd: string;
    projectMemory?: string | null;
    memoryContext?: string;
    skillContext?: string;
    profileContext?: string;
    personaContext?: string;
    skillsCatalog?: string;
}
export declare function buildSystemPrompt(projectMemoryOrOptions: string | null | SystemPromptOptions, cwd?: string): string;
//# sourceMappingURL=conversation.d.ts.map