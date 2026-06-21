/**
 * Layer 0 — the sub-agent runner.
 *
 * A sub-agent is just the existing runAgent() loop driven over a FRESH
 * conversation with a custom system prompt and a registry scoped to a minimal
 * tool set. Every tool the sub-agent calls passes the same gate() as the main
 * agent, so permissions are inherited by construction. The runner returns the
 * final assistant text only (summary-only return); it never throws.
 */
import { Provider, Tool } from '../providers/index';
import { Settings } from '../config/settings';
import { ToolRegistry } from '../registry/index';
import { TOOLS } from '../agent/tools';
import { createConversation } from '../agent/conversation';
import { runAgent } from '../agent/core';
import { getRole } from '../agents/roles';
import { createProvider } from '../providers/index';

export interface SubAgentSpec {
  task: string;
  role?: string;
  systemPrompt?: string;
  tools?: string[];
  maxIterations?: number;
  provider?: string;
  model?: string;
  validate?: (content: string) => { ok: boolean; feedback?: string };
  maxRetries?: number;
}

export interface SubAgentResult {
  ok: boolean;
  content: string;
  role?: string;
  task: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: string;
}

export interface RunnerContext {
  settings: Settings;
  defaultProviderName: string;
  parentRegistry: ToolRegistry;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mcpClient?: any; memory?: any; skills?: any; tokenTracker?: any; permissions?: any;
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
export function buildScopedRegistry(parent: ToolRegistry, allowed?: string[]): ToolRegistry {
  const scoped = new ToolRegistry();
  const all = parent.list();

  /** Look up a tool by name: parent first, then the builtin TOOLS array. */
  function resolve(name: string): { tool: Tool; category: string; source: string } | undefined {
    const found = all.find(t => t.name === name);
    if (found) return { tool: asTool(found), category: found.category, source: found.source };
    const builtin = TOOLS.find(t => t.name === name);
    if (builtin) return { tool: builtin, category: 'custom', source: 'builtin' };
    return undefined;
  }

  if (!allowed) {
    const enabledNames = new Set(parent.getEnabled().map(t => t.name));
    for (const t of all) {
      if (enabledNames.has(t.name)) {
        scoped.register(asTool(t), t.category, t.source);
      }
    }
    return scoped;
  }

  for (const name of allowed) {
    const r = resolve(name);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (r) scoped.register(r.tool, r.category as any, r.source as any);
  }
  return scoped;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asTool(t: any): Tool { return { name: t.name, description: t.description, parameters: t.parameters }; }

/** Resolve provider, applying a per-spec model override without mutating shared settings. */
function resolveProvider(spec: SubAgentSpec, ctx: RunnerContext): Provider {
  const name = spec.provider ?? ctx.defaultProviderName;
  const factory = ctx.providerFactory ?? createProvider;
  if (!spec.model) return factory(name, ctx.settings);
  const cloned: Settings = JSON.parse(JSON.stringify(ctx.settings));
  cloned.providers[name] = { ...(cloned.providers[name] ?? {}), model: spec.model };
  return factory(name, cloned);
}

export async function runSubAgent(spec: SubAgentSpec, ctx: RunnerContext): Promise<SubAgentResult> {
  const role = spec.role ? getRole(spec.role) : undefined;
  const systemPrompt = spec.systemPrompt ?? role?.systemPrompt ?? 'You are a focused coding sub-agent. Complete the task and report the result concisely.';
  const allowedTools = spec.tools ?? role?.allowedTools;
  const scoped = buildScopedRegistry(ctx.parentRegistry, allowedTools);

  const maxRetries = Math.max(0, spec.maxRetries ?? 2);
  try {
    const provider = resolveProvider(spec, ctx);
    let lastContent = '';
    let lastUsage: SubAgentResult['usage'];
    let feedback = '';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const conv = createConversation(systemPrompt);
      const task = feedback
        ? `${spec.task}\n\n[Revise — previous attempt failed validation: ${feedback}]`
        : spec.task;
      const result = await runAgent(provider, conv, task, {
        cwd: ctx.cwd,
        stream: false,
        maxIterations: spec.maxIterations ?? 6,
        registry: scoped,
        mcpClient: ctx.mcpClient,
        memory: ctx.memory,
        skills: ctx.skills,
        tokenTracker: ctx.tokenTracker,
        permissions: ctx.permissions,
        unattended: ctx.unattended,
        sessionAllow: ctx.sessionAllow,
      });
      lastContent = result.content;
      lastUsage = result.usage;
      // runAgent catches provider errors internally and returns { content: 'Error: <msg>' }
      // with no `usage` field, rather than throwing. Require BOTH conditions to avoid
      // mis-classifying a legitimate answer that begins with "Error: " as a failure.
      if (!result.usage && result.content.startsWith('Error: ')) {
        const msg = result.content.slice('Error: '.length);
        return { ok: false, content: result.content, role: spec.role, task: spec.task, error: msg };
      }
      if (!spec.validate) {
        return { ok: true, content: lastContent, role: spec.role, task: spec.task, usage: lastUsage };
      }
      const verdict = spec.validate(lastContent);
      if (verdict.ok) {
        return { ok: true, content: lastContent, role: spec.role, task: spec.task, usage: lastUsage };
      }
      feedback = verdict.feedback ?? 'output rejected by guardrail';
    }
    return { ok: false, content: lastContent, role: spec.role, task: spec.task, usage: lastUsage, error: `guardrail failed after ${maxRetries + 1} attempts` };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, content: msg, role: spec.role, task: spec.task, error: msg };
  }
}
