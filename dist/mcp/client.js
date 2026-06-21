"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPClient = void 0;
exports.registerTools = registerTools;
const child_process = __importStar(require("child_process"));
const tools_1 = require("../agent/tools");
/** Built-in tool names an MCP server must not silently shadow. */
const BUILTIN_TOOL_NAMES = new Set(tools_1.TOOLS.map(t => t.name));
/**
 * Register a server's tools into the shared registry, skipping any name that
 * would shadow a built-in tool or one already provided by another server.
 * Pure + exported for testing. Returns the skipped names with a reason.
 */
function registerTools(registry, serverName, tools, reserved = BUILTIN_TOOL_NAMES) {
    const registered = [];
    const skipped = [];
    for (const tool of tools) {
        if (reserved.has(tool.name)) {
            skipped.push({ name: tool.name, reason: 'shadows a built-in tool' });
        }
        else if (registry.has(tool.name)) {
            skipped.push({ name: tool.name, reason: `already provided by "${registry.get(tool.name).serverName}"` });
        }
        else {
            registry.set(tool.name, { serverName, tool });
            registered.push(tool.name);
        }
    }
    return { registered, skipped };
}
class MCPClient {
    constructor() {
        this.servers = new Map();
        this.toolRegistry = new Map();
    }
    async connectServer(name, config) {
        try {
            const server = new MCPServerProcess(name, config);
            await server.start();
            this.servers.set(name, server);
            // List tools, registering only non-colliding names
            const tools = await server.listTools();
            const { skipped } = registerTools(this.toolRegistry, name, tools);
            for (const s of skipped) {
                console.warn(`Warning: MCP tool "${s.name}" from "${name}" ${s.reason}; skipped.`);
            }
        }
        catch (err) {
            console.warn(`Warning: MCP server "${name}" failed to start: ${err.message}`);
        }
    }
    async getTools() {
        return Array.from(this.toolRegistry.values()).map(({ tool }) => ({
            name: tool.name,
            description: tool.description,
            parameters: {
                type: 'object',
                properties: Object.fromEntries(Object.entries(tool.inputSchema.properties || {}).map(([k, v]) => [
                    k,
                    { type: v.type || 'string', description: v.description },
                ])),
                required: tool.inputSchema.required,
            },
        }));
    }
    async hasTool(name) {
        return this.toolRegistry.has(name);
    }
    async callTool(name, args) {
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
    listServers() {
        return Array.from(this.servers.keys());
    }
    listTools() {
        return Array.from(this.toolRegistry.entries()).map(([name, { serverName, tool }]) => ({
            server: serverName,
            name,
            description: tool.description,
        }));
    }
    async disconnectAll() {
        for (const server of this.servers.values()) {
            await server.stop();
        }
        this.servers.clear();
        this.toolRegistry.clear();
    }
}
exports.MCPClient = MCPClient;
class MCPServerProcess {
    constructor(name, config) {
        this.name = name;
        this.config = config;
        this.proc = null;
        this.requestId = 0;
        this.pendingRequests = new Map();
        this.buffer = '';
    }
    async start() {
        return new Promise((resolve, reject) => {
            const env = { ...process.env, ...(this.config.env || {}) };
            this.proc = child_process.spawn(this.config.command, this.config.args || [], {
                env,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            this.proc.stdout?.on('data', (data) => {
                this.buffer += data.toString();
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const msg = JSON.parse(line);
                            if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
                                const pending = this.pendingRequests.get(msg.id);
                                this.pendingRequests.delete(msg.id);
                                if (msg.error) {
                                    pending.reject(new Error(msg.error.message || 'MCP error'));
                                }
                                else {
                                    pending.resolve(msg.result);
                                }
                            }
                        }
                        catch { /* ignore parse errors */ }
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
    async listTools() {
        const result = await this.sendRequest('tools/list', {});
        return result.tools || [];
    }
    async callTool(name, args) {
        try {
            const result = await this.sendRequest('tools/call', { name, arguments: args });
            const content = result.content?.map(c => c.text || '').join('\n') || '';
            return { content, isError: result.isError };
        }
        catch (err) {
            return { content: err.message, isError: true };
        }
    }
    sendRequest(method, params) {
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
    async stop() {
        this.proc?.kill();
        this.proc = null;
    }
}
//# sourceMappingURL=client.js.map