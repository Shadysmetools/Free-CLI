import { Tool } from '../providers/index';
type ToolRegistry = Map<string, {
    serverName: string;
    tool: MCPTool;
}>;
/**
 * Register a server's tools into the shared registry, skipping any name that
 * would shadow a built-in tool or one already provided by another server.
 * Pure + exported for testing. Returns the skipped names with a reason.
 */
export declare function registerTools(registry: ToolRegistry, serverName: string, tools: MCPTool[], reserved?: Set<string>): {
    registered: string[];
    skipped: Array<{
        name: string;
        reason: string;
    }>;
};
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
export {};
//# sourceMappingURL=client.d.ts.map