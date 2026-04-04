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

import * as child_process from 'child_process';
import * as https from 'https';
import * as http from 'http';
import * as url from 'url';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OpenClawConfig {
  url: string;   // e.g. "http://localhost:18789"
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

// ─── Client ──────────────────────────────────────────────────────────────────

export class OpenClawClient {
  private config: OpenClawConfig;

  constructor(config: OpenClawConfig) {
    this.config = {
      url: config.url.replace(/\/$/, ''), // strip trailing slash
      token: config.token,
    };
  }

  // ─── Sessions ──────────────────────────────────────────────────────────────

  async listSessions(opts: {
    kinds?: string[];
    limit?: number;
    activeMinutes?: number;
    messageLimit?: number;
  } = {}): Promise<SessionRow[]> {
    const result = await this.invoke<SessionRow[]>('sessions_list', {
      kinds: opts.kinds,
      limit: opts.limit ?? 50,
      activeMinutes: opts.activeMinutes,
      messageLimit: opts.messageLimit ?? 0,
    });
    if (!result.ok) throw new Error(result.error ?? 'sessions_list failed');
    return result.result ?? [];
  }

  async getSessionHistory(sessionKey: string, opts: {
    limit?: number;
    includeTools?: boolean;
  } = {}): Promise<MessageRow[]> {
    const result = await this.invoke<MessageRow[]>('sessions_history', {
      sessionKey,
      limit: opts.limit ?? 50,
      includeTools: opts.includeTools ?? false,
    });
    if (!result.ok) throw new Error(result.error ?? 'sessions_history failed');
    return result.result ?? [];
  }

  async sendMessage(sessionKey: string, message: string, timeoutSeconds = 30): Promise<{ runId?: string; status: string; reply?: string }> {
    const result = await this.invoke<{ runId?: string; status: string; reply?: string }>('sessions_send', {
      sessionKey,
      message,
      timeoutSeconds,
    });
    if (!result.ok) throw new Error(result.error ?? 'sessions_send failed');
    return result.result ?? { status: 'error' };
  }

  // ─── Agents ────────────────────────────────────────────────────────────────

  async listAgents(): Promise<AgentRow[]> {
    const result = await this.invoke<AgentRow[]>('agents_list', {});
    if (!result.ok) {
      // agents_list may not be in the default allow list — try via sessions
      // Fall back to parsing sessions to infer agent IDs
      const sessions = await this.listSessions({ kinds: ['main'] }).catch(() => []);
      const agentIds = new Set<string>();
      for (const s of sessions) {
        const m = s.key.match(/^agent:([^:]+):/);
        if (m) agentIds.add(m[1]);
      }
      return Array.from(agentIds).map(id => ({ id }));
    }
    return result.result ?? [];
  }

  async getAgentStatus(agentId: string): Promise<SessionRow | null> {
    const sessions = await this.listSessions({ kinds: ['main'] });
    return sessions.find(s => s.key === `agent:${agentId}:main`) ?? null;
  }

  // ─── Cron (via CLI) ────────────────────────────────────────────────────────

  listCronJobs(): CronJob[] {
    try {
      const raw = child_process.execSync('openclaw cron list --json 2>/dev/null || openclaw cron list', {
        encoding: 'utf-8',
        timeout: 8000,
      });
      // Try JSON parse first
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) return parsed as CronJob[];
      } catch {
        // Return as raw text wrapped in a single "job"
        return [{ id: 'unknown', status: raw.trim() }];
      }
    } catch {
      return [];
    }
    return [];
  }

  // ─── Gateway Status (via CLI) ──────────────────────────────────────────────

  getGatewayStatus(): GatewayStatus {
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
    } catch (err) {
      return {
        running: false,
        raw: (err as Error).message,
      };
    }
  }

  // ─── HTTP Invoke ───────────────────────────────────────────────────────────

  async invoke<T = unknown>(tool: string, args: Record<string, unknown>): Promise<InvokeResult<T>> {
    const endpoint = `${this.config.url}/tools/invoke`;
    const body = JSON.stringify({ tool, args });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body).toString(),
    };
    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }

    return new Promise((resolve) => {
      const parsed = url.parse(endpoint);
      const lib = parsed.protocol === 'https:' ? https : http;

      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port ? parseInt(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.path,
          method: 'POST',
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => {
            try {
              const json = JSON.parse(data) as { ok: boolean; result?: T; error?: { message?: string } };
              if (json.ok) {
                resolve({ ok: true, result: json.result });
              } else {
                resolve({ ok: false, error: json.error?.message ?? 'Request failed' });
              }
            } catch {
              resolve({ ok: false, error: `Invalid JSON response: ${data.slice(0, 200)}` });
            }
          });
        }
      );

      req.on('error', (err: Error) => {
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
  async getAgentsStatus(): Promise<GatewayAgentsInfo> {
    const gatewayStatus = this.getGatewayStatus();
    const reachable = await this.isReachable();

    let agentStatusList: AgentStatusInfo[] = [];

    if (reachable) {
      try {
        // Get all sessions grouped by agent id
        const sessions = await this.listSessions({ kinds: ['main', 'group'] });
        const agentMap = new Map<string, { sessions: SessionRow[] }>();

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
          if (a.online !== b.online) return a.online ? -1 : 1;
          return a.id.localeCompare(b.id);
        });
      } catch {
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
  async isReachable(): Promise<boolean> {
    try {
      const result = await this.invoke('sessions_list', { limit: 1 });
      return result.ok;
    } catch {
      return false;
    }
  }

  formatSessionRow(s: SessionRow): string {
    const name = s.displayName ?? s.key;
    const tokens = s.totalTokens ? ` · ${s.totalTokens.toLocaleString()} tokens` : '';
    const model = s.model ? ` · ${s.model}` : '';
    const ago = s.updatedAt ? ` · ${timeAgo(s.updatedAt)}` : '';
    return `${s.kind.padEnd(6)} ${name.padEnd(40)}${model}${tokens}${ago}`;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
