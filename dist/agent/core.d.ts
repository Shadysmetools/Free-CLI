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
 * Estimate the number of tokens in a piece of text.
 *
 * This is a deliberately dependency-free heuristic: most byte-pair tokenizers
 * (GPT/Claude/Llama families) average roughly 4 characters per token for typical
 * English + code, so ceil(chars / 4) is a good-enough budgeting proxy for a
 * local-first tool that must not reach for the network or a heavy tokenizer dep.
 * It intentionally OVER-estimates slightly (ceil) so we trim conservatively and
 * stay safely under real provider context windows.
 */
export declare function estimateTokens(text: string): number;
/**
 * Per-provider context budgets, expressed in ESTIMATED TOKENS (see
 * estimateTokens). These mirror each provider's real context window with a
 * safety margin reserved for the system prompt, tool schemas, and the model's
 * own completion. `trimMessages` is fed these via the estimateTokens measure.
 */
export declare const CONTEXT_TOKEN_LIMITS: Record<string, number>;
/**
 * Trim a conversation to fit a budget WITHOUT orphaning tool-result messages.
 * Providers (Anthropic/OpenAI/Groq) return 400 if a `tool` message is not
 * immediately preceded by the assistant message carrying its tool_calls, so
 * after trimming we drop any leading `tool` messages left at the front.
 *
 * The budget is measured by `measure`, which defaults to raw character length
 * (the original behaviour). Pass `estimateTokens` to budget by ESTIMATED TOKENS
 * instead — the agent loop does this so history is managed in token space.
 */
export declare function trimMessages(messages: Message[], contextLimit: number, minKeep?: number, measure?: (text: string) => number): Message[];
export declare function runAgent(providerArg: Provider, conversation: ConversationState, userMessage: string, options: AgentOptions): Promise<AgentResult>;
export { fileChanges };
//# sourceMappingURL=core.d.ts.map