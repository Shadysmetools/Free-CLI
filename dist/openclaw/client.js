"use strict";
/**
 * OpenClaw Gateway Client
 *
 * Communicates with a running OpenClaw gateway via:
 * 1. HTTP POST /tools/invoke — for sessions_list, sessions_history, sessions_send, agents_list
 * 2. Shell exec — for `openclaw gateway status`, `openclaw cron list`
 *
 * API reference: ~/.npm-global/lib/node_modules/openclaw/docs/gateway/tools-invoke-http-api.md
 *
 * Config (in ~/.knowcap-code/config.yaml):
 *   openclaw:
 *     url: "http://localhost:18789"
 *     token: "your-gateway-token"
 */
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
exports.OpenClawClient = void 0;
const child_process = __importStar(require("child_process"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const url = __importStar(require("url"));
// ─── Client ──────────────────────────────────────────────────────────────────
class OpenClawClient {
    constructor(config) {
        this.config = {
            url: config.url.replace(/\/$/, ''), // strip trailing slash
            token: config.token,
        };
    }
    // ─── Sessions ──────────────────────────────────────────────────────────────
    async listSessions(opts = {}) {
        const result = await this.invoke('sessions_list', {
            kinds: opts.kinds,
            limit: opts.limit ?? 50,
            activeMinutes: opts.activeMinutes,
            messageLimit: opts.messageLimit ?? 0,
        });
        if (!result.ok)
            throw new Error(result.error ?? 'sessions_list failed');
        return result.result ?? [];
    }
    async getSessionHistory(sessionKey, opts = {}) {
        const result = await this.invoke('sessions_history', {
            sessionKey,
            limit: opts.limit ?? 50,
            includeTools: opts.includeTools ?? false,
        });
        if (!result.ok)
            throw new Error(result.error ?? 'sessions_history failed');
        return result.result ?? [];
    }
    async sendMessage(sessionKey, message, timeoutSeconds = 30) {
        const result = await this.invoke('sessions_send', {
            sessionKey,
            message,
            timeoutSeconds,
        });
        if (!result.ok)
            throw new Error(result.error ?? 'sessions_send failed');
        return result.result ?? { status: 'error' };
    }
    // ─── Agents ────────────────────────────────────────────────────────────────
    async listAgents() {
        const result = await this.invoke('agents_list', {});
        if (!result.ok) {
            // agents_list may not be in the default allow list — try via sessions
            // Fall back to parsing sessions to infer agent IDs
            const sessions = await this.listSessions({ kinds: ['main'] }).catch(() => []);
            const agentIds = new Set();
            for (const s of sessions) {
                const m = s.key.match(/^agent:([^:]+):/);
                if (m)
                    agentIds.add(m[1]);
            }
            return Array.from(agentIds).map(id => ({ id }));
        }
        return result.result ?? [];
    }
    async getAgentStatus(agentId) {
        const sessions = await this.listSessions({ kinds: ['main'] });
        return sessions.find(s => s.key === `agent:${agentId}:main`) ?? null;
    }
    // ─── Cron (via CLI) ────────────────────────────────────────────────────────
    listCronJobs() {
        try {
            const raw = child_process.execSync('openclaw cron list --json 2>/dev/null || openclaw cron list', {
                encoding: 'utf-8',
                timeout: 8000,
            });
            // Try JSON parse first
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed))
                    return parsed;
            }
            catch {
                // Return as raw text wrapped in a single "job"
                return [{ id: 'unknown', status: raw.trim() }];
            }
        }
        catch {
            return [];
        }
        return [];
    }
    // ─── Gateway Status (via CLI) ──────────────────────────────────────────────
    getGatewayStatus() {
        try {
            const raw = child_process.execSync('openclaw gateway status 2>&1', {
                encoding: 'utf-8',
                timeout: 8000,
            });
            const running = raw.includes('running') || raw.includes('Runtime: running');
            const versionMatch = raw.match(/v?(\d+\.\d+\.\d+)/);
            return {
                running,
                version: versionMatch?.[1],
                raw: raw.trim(),
            };
        }
        catch (err) {
            return {
                running: false,
                raw: err.message,
            };
        }
    }
    // ─── HTTP Invoke ───────────────────────────────────────────────────────────
    async invoke(tool, args) {
        const endpoint = `${this.config.url}/tools/invoke`;
        const body = JSON.stringify({ tool, args });
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body).toString(),
        };
        if (this.config.token) {
            headers['Authorization'] = `Bearer ${this.config.token}`;
        }
        return new Promise((resolve) => {
            const parsed = url.parse(endpoint);
            const lib = parsed.protocol === 'https:' ? https : http;
            const req = lib.request({
                hostname: parsed.hostname,
                port: parsed.port ? parseInt(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.path,
                method: 'POST',
                headers,
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk.toString(); });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.ok) {
                            resolve({ ok: true, result: json.result });
                        }
                        else {
                            resolve({ ok: false, error: json.error?.message ?? 'Request failed' });
                        }
                    }
                    catch {
                        resolve({ ok: false, error: `Invalid JSON response: ${data.slice(0, 200)}` });
                    }
                });
            });
            req.on('error', (err) => {
                resolve({ ok: false, error: `Connection failed: ${err.message}` });
            });
            req.setTimeout(10000, () => {
                req.destroy();
                resolve({ ok: false, error: 'Request timed out (10s)' });
            });
            req.write(body);
            req.end();
        });
    }
    // ─── Aggregate Status ──────────────────────────────────────────────────────
    /**
     * Fetch gateway reachability + agent list in one call.
     * Used in startup banner for non-blocking agent count display.
     */
    async getAgentsStatus() {
        const gatewayStatus = this.getGatewayStatus();
        const reachable = await this.isReachable();
        let agentStatusList = [];
        if (reachable) {
            try {
                // Get all sessions grouped by agent id
                const sessions = await this.listSessions({ kinds: ['main', 'group'] });
                const agentMap = new Map();
                for (const s of sessions) {
                    const m = s.key.match(/^agent:([^:]+):/);
                    const agentId = m ? m[1] : 'unknown';
                    const existing = agentMap.get(agentId) ?? { sessions: [] };
                    existing.sessions.push(s);
                    agentMap.set(agentId, existing);
                }
                // Consider "online" if there was activity in the last 24h
                const onlineThreshold = Date.now() - 24 * 60 * 60 * 1000;
                for (const [id, data] of agentMap) {
                    const latest = data.sessions.reduce((max, s) => Math.max(max, s.updatedAt ?? 0), 0);
                    const model = data.sessions.find(s => s.model)?.model;
                    agentStatusList.push({
                        id,
                        online: latest > onlineThreshold,
                        sessionCount: data.sessions.length,
                        model,
                        lastActivity: latest > 0 ? timeAgo(latest) : undefined,
                    });
                }
                // Sort: online first, then by id
                agentStatusList.sort((a, b) => {
                    if (a.online !== b.online)
                        return a.online ? -1 : 1;
                    return a.id.localeCompare(b.id);
                });
            }
            catch {
                // Non-fatal — return empty list
            }
        }
        return {
            reachable,
            gatewayUrl: this.config.url,
            gatewayStatus,
            agents: agentStatusList,
        };
    }
    // ─── Helpers ───────────────────────────────────────────────────────────────
    /** Quick connectivity check — ping sessions_list */
    async isReachable() {
        try {
            const result = await this.invoke('sessions_list', { limit: 1 });
            return result.ok;
        }
        catch {
            return false;
        }
    }
    formatSessionRow(s) {
        const name = s.displayName ?? s.key;
        const tokens = s.totalTokens ? ` · ${s.totalTokens.toLocaleString()} tokens` : '';
        const model = s.model ? ` · ${s.model}` : '';
        const ago = s.updatedAt ? ` · ${timeAgo(s.updatedAt)}` : '';
        return `${s.kind.padEnd(6)} ${name.padEnd(40)}${model}${tokens}${ago}`;
    }
}
exports.OpenClawClient = OpenClawClient;
// ─── Helpers ─────────────────────────────────────────────────────────────────
function timeAgo(ms) {
    const diff = Date.now() - ms;
    if (diff < 60000)
        return 'just now';
    if (diff < 3600000)
        return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000)
        return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
}
//# sourceMappingURL=client.js.map