import { Provider } from '../providers/index';
import { ConversationState } from './conversation';
import { fileChanges } from './tools';
import { MCPClient } from '../mcp/client';
import { ToolRegistry } from '../registry/index';
import { MemoryManager } from '../memory/index';
import { SkillsManager } from '../skills/index';
import { TokenTracker } from '../tracking/tokens';
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
export { fileChanges };
//# sourceMappingURL=core.d.ts.map