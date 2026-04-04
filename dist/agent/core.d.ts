import { Provider } from '../providers/index';
import { ConversationState } from './conversation';
import { MCPClient } from '../mcp/client';
export interface AgentOptions {
    cwd: string;
    stream: boolean;
    onToken?: (token: string) => void;
    maxIterations?: number;
    mcpClient?: MCPClient;
}
export interface AgentResult {
    content: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
export declare function runAgent(provider: Provider, conversation: ConversationState, userMessage: string, options: AgentOptions): Promise<AgentResult>;
//# sourceMappingURL=core.d.ts.map