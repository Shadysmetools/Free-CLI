import { Provider, Message } from '../providers/index';
import { ConversationState } from './conversation';
import { fileChanges } from './tools';
import { MCPClient } from '../mcp/client';
import { ToolRegistry } from '../registry/index';
import { MemoryManager } from '../memory/index';
import { SkillsManager } from '../skills/index';
import { TokenTracker } from '../tracking/tokens';
import { Rules } from '../permissions';
export interface AgentOptions {
    cwd: string;
    stream: boolean;
    onToken?: (token: string) => void;
    maxIterations?: number;
    mcpClient?: MCPClient;
    registry?: ToolRegistry;
    memory?: MemoryManager;
    skills?: SkillsManager;
    tokenTracker?: TokenTracker;
    permissions?: Rules;
    unattended?: boolean;
    sessionAllow?: Set<string>;
}
export interface AgentResult {
    content: string;
    /** Formatted dim footer line — print AFTER the response content */
    footerLine?: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
/** Heuristic: the model tried to call a tool but emitted broken/partial JSON. */
export declare function looksLikeToolAttempt(content: string): boolean;
/**
 * Trim a conversation to fit a character budget WITHOUT orphaning tool-result
 * messages. Providers (Anthropic/OpenAI/Groq) return 400 if a `tool` message is
 * not immediately preceded by the assistant message carrying its tool_calls, so
 * after trimming we drop any leading `tool` messages left at the front.
 */
export declare function trimMessages(messages: Message[], contextLimit: number, minKeep?: number): Message[];
export declare function runAgent(providerArg: Provider, conversation: ConversationState, userMessage: string, options: AgentOptions): Promise<AgentResult>;
export { fileChanges };
//# sourceMappingURL=core.d.ts.map