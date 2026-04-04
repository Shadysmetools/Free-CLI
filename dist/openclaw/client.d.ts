/**
 * OpenClaw Gateway Client
 *
 * Communicates with a running OpenClaw gateway via:
 * 1. HTTP POST /tools/invoke — for sessions_list, sessions_history, sessions_send, agents_list
 * 2. Shell exec — for `openclaw gateway status`, `openclaw cron list`
 *
 * API reference: ~/.npm-global/lib/node_modules/openclaw/docs/gateway/tools-invoke-http-api.md
 *
 * Config (in ~/.coderaw/config.yaml):
 *   openclaw:
 *     url: "http://localhost:18789"
 *     token: "your-gateway-token"
 */
export interface OpenClawConfig {
    url: string;
    token?: string;
}
export interface SessionRow {
    key: string;
    kind: 'main' | 'group' | 'cron' | 'hook' | 'node' | 'other';
    channel: string;
    displayName?: string;
    updatedAt?: number;
    sessionId?: string;
    model?: string;
    contextTokens?: number;
    totalTokens?: number;
    messages?: MessageRow[];
}
export interface MessageRow {
    role: string;
    content: string;
    timestamp?: number;
}
export interface AgentRow {
    id: string;
    label?: string;
    model?: string;
    status?: string;
}
export interface CronJob {
    id: string;
    schedule?: string;
    label?: string;
    status?: string;
    lastRun?: string;
    nextRun?: string;
}
export interface GatewayStatus {
    running: boolean;
    version?: string;
    uptime?: string;
    raw: string;
}
export interface AgentStatusInfo {
    id: string;
    online: boolean;
    sessionCount: number;
    model?: string;
    lastActivity?: string;
}
export interface GatewayAgentsInfo {
    reachable: boolean;
    gatewayUrl: string;
    gatewayStatus: GatewayStatus;
    agents: AgentStatusInfo[];
}
export interface InvokeResult<T = unknown> {
    ok: boolean;
    result?: T;
    error?: string;
}
export declare class OpenClawClient {
    private config;
    constructor(config: OpenClawConfig);
    listSessions(opts?: {
        kinds?: string[];
        limit?: number;
        activeMinutes?: number;
        messageLimit?: number;
    }): Promise<SessionRow[]>;
    getSessionHistory(sessionKey: string, opts?: {
        limit?: number;
        includeTools?: boolean;
    }): Promise<MessageRow[]>;
    sendMessage(sessionKey: string, message: string, timeoutSeconds?: number): Promise<{
        runId?: string;
        status: string;
        reply?: string;
    }>;
    listAgents(): Promise<AgentRow[]>;
    getAgentStatus(agentId: string): Promise<SessionRow | null>;
    listCronJobs(): CronJob[];
    getGatewayStatus(): GatewayStatus;
    invoke<T = unknown>(tool: string, args: Record<string, unknown>): Promise<InvokeResult<T>>;
    /**
     * Fetch gateway reachability + agent list in one call.
     * Used in startup banner for non-blocking agent count display.
     */
    getAgentsStatus(): Promise<GatewayAgentsInfo>;
    /** Quick connectivity check — ping sessions_list */
    isReachable(): Promise<boolean>;
    formatSessionRow(s: SessionRow): string;
}
//# sourceMappingURL=client.d.ts.map