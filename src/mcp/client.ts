import * as child_process from 'child_process';
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

export class MCPClient {
  private servers: Map<string, MCPServerProcess> = new Map();
  private toolRegistry: Map<string, { serverName: string; tool: MCPTool }> = new Map();

  async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    try {
      const server = new MCPServerProcess(name, config);
      await server.start();
      this.servers.set(name, server);

      // List tools
      const tools = await server.listTools();
      for (const tool of tools) {
        this.toolRegistry.set(tool.name, { serverName: name, tool });
      }
    } catch (err) {
      console.warn(`Warning: MCP server "${name}" failed to start: ${(err as Error).message}`);
    }
  }

  async getTools(): Promise<Tool[]> {
    return Array.from(this.toolRegistry.values()).map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(tool.inputSchema.properties || {}).map(([k, v]) => [
            k,
            { type: (v as { type?: string }).type || 'string', description: (v as { description?: string }).description },
          ])
        ),
        required: tool.inputSchema.required,
      },
    }));
  }

  async hasTool(name: string): Promise<boolean> {
    return this.toolRegistry.has(name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const entry = this.toolRegistry.get(name);
    if (!entry) {
      return { content: `MCP tool not found: ${name}`, isError: true };
    }
    const server = this.servers.get(entry.serverName);
    if (!server) {
      return { content: `MCP server not connected: ${entry.serverName}`, isError: true };
    }
    return server.callTool(name, args);
  }

  listServers(): string[] {
    return Array.from(this.servers.keys());
  }

  listTools(): Array<{ server: string; name: string; description: string }> {
    return Array.from(this.toolRegistry.entries()).map(([name, { serverName, tool }]) => ({
      server: serverName,
      name,
      description: tool.description,
    }));
  }

  async disconnectAll(): Promise<void> {
    for (const server of this.servers.values()) {
      await server.stop();
    }
    this.servers.clear();
    this.toolRegistry.clear();
  }
}

class MCPServerProcess {
  private proc: child_process.ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: (val: unknown) => void; reject: (err: Error) => void }> = new Map();
  private buffer = '';

  constructor(
    private name: string,
    private config: MCPServerConfig
  ) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...(this.config.env || {}) };

      this.proc = child_process.spawn(this.config.command, this.config.args || [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.proc.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) {
            try {
              const msg = JSON.parse(line) as {
                id?: number;
                result?: unknown;
                error?: { message?: string };
              };
              if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
                const pending = this.pendingRequests.get(msg.id)!;
                this.pendingRequests.delete(msg.id);
                if (msg.error) {
                  pending.reject(new Error(msg.error.message || 'MCP error'));
                } else {
                  pending.resolve(msg.result);
                }
              }
            } catch { /* ignore parse errors */ }
          }
        }
      });

      this.proc.on('error', reject);
      this.proc.on('spawn', () => {
        // Send initialize
        this.sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'coderaw', version: '1.0.0' },
        }).then(() => resolve()).catch(reject);
      });

      setTimeout(() => reject(new Error('MCP server startup timeout')), 5000);
    });
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.sendRequest('tools/list', {}) as { tools?: MCPTool[] };
    return result.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    try {
      const result = await this.sendRequest('tools/call', { name, arguments: args }) as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };
      const content = result.content?.map(c => c.text || '').join('\n') || '';
      return { content, isError: result.isError };
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.pendingRequests.set(id, { resolve, reject });
      this.proc?.stdin?.write(msg);
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 10000);
    });
  }

  async stop(): Promise<void> {
    this.proc?.kill();
    this.proc = null;
  }
}
