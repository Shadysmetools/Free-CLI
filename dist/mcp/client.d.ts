import { Tool } from '../providers/index';
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: Record<string, unknown>;
        required?: string[];
    };
}
export interface MCPServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
}
export interface MCPToolResult {
    content: string;
    isError?: boolean;
}
export declare class MCPClient {
    private servers;
    private toolRegistry;
    connectServer(name: string, config: MCPServerConfig): Promise<void>;
    getTools(): Promise<Tool[]>;
    hasTool(name: string): Promise<boolean>;
    callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult>;
    listServers(): string[];
    listTools(): Array<{
        server: string;
        name: string;
        description: string;
    }>;
    disconnectAll(): Promise<void>;
}
//# sourceMappingURL=client.d.ts.map