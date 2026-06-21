/**
 * Layer 0 — the sub-agent runner.
 *
 * A sub-agent is just the existing runAgent() loop driven over a FRESH
 * conversation with a custom system prompt and a registry scoped to a minimal
 * tool set. Every tool the sub-agent calls passes the same gate() as the main
 * agent, so permissions are inherited by construction. The runner returns the
 * final assistant text only (summary-only return); it never throws.
 */
import { Provider } from '../providers/index';
import { Settings } from '../config/settings';
import { ToolRegistry } from '../registry/index';
export interface SubAgentSpec {
    task: string;
    role?: string;
    systemPrompt?: string;
    tools?: string[];
    maxIterations?: number;
    provider?: string;
    model?: string;
    validate?: (content: string) => {
        ok: boolean;
        feedback?: string;
    };
    maxRetries?: number;
}
export interface SubAgentResult {
    ok: boolean;
    content: string;
    role?: string;
    task: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    error?: string;
}
export interface RunnerContext {
    settings: Settings;
    defaultProviderName: string;
    parentRegistry: ToolRegistry;
    mcpClient?: any;
    memory?: any;
    skills?: any;
    tokenTracker?: any;
    permissions?: any;
    unattended?: boolean;
    sessionAllow?: Set<string>;
    cwd: string;
    providerFactory?: (name: string, settings: Settings) => Provider;
}
/** Build a registry containing only `allowed` tools (pulled from the parent's full list).
 *
 * Falls back to the built-in TOOLS constant for any name not found in the parent — this
 * handles environments (e.g. vitest ESM) where createDefaultRegistry()'s lazy require()
 * silently fails to populate the parent with file tools.
 */
export declare function buildScopedRegistry(parent: ToolRegistry, allowed?: string[]): ToolRegistry;
export declare function runSubAgent(spec: SubAgentSpec, ctx: RunnerContext): Promise<SubAgentResult>;
//# sourceMappingURL=runner.d.ts.map