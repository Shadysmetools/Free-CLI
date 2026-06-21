# Workflow Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give coderaw its own multi-agent orchestration engine — sub-agent runner, parallel/pipeline primitives, a YAML DAG workflow engine, dynamic spawn tools, and an autonomous goal loop — all local-backed and gated by the existing permission layer.

**Architecture:** Layered. Layer 0 `runSubAgent` wraps the existing `runAgent` over a fresh conversation + scoped tool registry. Layer 1 `parallel`/`pipeline` are pure async combinators. Layer 2 loads/validates/executes YAML workflow DAGs over the runner. Layer 3a exposes `spawn_agent`/`run_parallel` tools via a module-level runtime holder; Layer 3b runs an autonomous plan→execute→**external-verify**→re-plan loop.

**Tech Stack:** TypeScript (Node ≥18), vitest 2.1, `yaml` 2.4, chalk 4. Reuses `src/agent/core.ts` (`runAgent`), `src/agent/conversation.ts`, `src/registry`, `src/providers`, `src/agents/roles.ts`, `src/agent/plan.ts`, `src/agent/tools.ts`, `src/permissions`, `src/config/settings.ts`, `src/ui/terminal.ts`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-21-workflow-engine-design.md` (authoritative).
- All new code lives under `src/workflow/`; tests co-located as `*.test.ts`.
- Build excludes `*.test.ts` (existing `tsconfig` behavior); `dist/` is committed (rebuild in final task).
- Test runner: `npx vitest run <file>` for one file, `npm test` for all. Build: `npm run build`.
- Every sub-agent runs through `runAgent`, so every sub-agent tool call passes the existing `gate()` — no separate permission path.
- **Verification is a SOUND EXTERNAL checker (exit code of a real command), never an LLM judging its own output** (spec §11 R1).
- Local concurrency default = 1 (Ollama single-GPU serializes); prefer a single shared model for local sub-agents.
- Sub-agents return final text only; keep per-agent tool sets minimal; tasks must be self-contained.
- Commit after every green task. Branch: `workflow-engine` (already created; spec already committed there).
- Reply/comments in English. Match existing file header-comment style (`/** … */` banner + section dividers).

**Existing signatures this plan builds on (verified):**
```ts
// src/providers/index.ts
interface Message { role:'user'|'assistant'|'system'|'tool'; content:string; tool_calls?:ToolCall[]; tool_call_id?:string; name?:string }
interface Tool { name:string; description:string; parameters:{ type:'object'; properties:Record<string,{type:string;description?:string;enum?:string[];items?:{type:string}}>; required?:string[] } }
interface CompletionOptions { messages:Message[]; tools?:Tool[]; stream?:boolean; onToken?:(t:string)=>void }
interface CompletionResult { content:string; tool_calls?:ToolCall[]; usage?:{prompt_tokens:number;completion_tokens:number;total_tokens:number} }
interface Provider { name:string; model:string; complete(o:CompletionOptions):Promise<CompletionResult>; isAvailable():Promise<boolean> }
function createProvider(name:string, settings:Settings):Provider
// src/agent/core.ts
function runAgent(provider:Provider, conversation:ConversationState, userMessage:string, options:AgentOptions):Promise<AgentResult>
//   AgentOptions = { cwd; stream; onToken?; maxIterations?; mcpClient?; registry?; memory?; skills?; tokenTracker?; permissions?; unattended?; sessionAllow? }
//   AgentResult = { content:string; footerLine?:string; usage?:{prompt_tokens;completion_tokens;total_tokens} }
// src/agent/conversation.ts
function createConversation(systemPrompt?:string):ConversationState   // ConversationState={messages:Message[];totalUsage;turnCount}
// src/registry/index.ts
class ToolRegistry { register(t:Tool,cat:ToolCategory,src?):void; registerMCPTools(t:Tool[]):void; list(cat?):RegisteredTool[]; getEnabled():Tool[]; get(n):RegisteredTool|undefined; enable(n):boolean; disable(n):boolean }
function createDefaultRegistry():ToolRegistry
// src/agents/roles.ts
interface AgentRole { id:string; name:string; icon:string; description:string; systemPrompt:string; allowedTools?:string[] }
const BUILTIN_ROLES:Record<string,AgentRole>; function getRole(id:string):AgentRole|undefined; function listRoles():AgentRole[]
// src/agent/plan.ts
interface PlanItem { content:string; status:'pending'|'in_progress'|'completed' }
function setPlan(items:PlanItem[]):void; function getPlan():PlanItem[]; function clearPlan():void
function planToSteps(items:PlanItem[]):PlanStep[]; function planSummary(items:PlanItem[]):string
// src/agent/tools.ts
interface ToolResult { content:string; isError?:boolean }
function executeTool(name:string, args:Record<string,unknown>, cwd:string):Promise<ToolResult>
// src/ui/terminal.ts
interface PlanStep { num:number; icon:string; role:string; description:string }
function printPlanBox(title:string, steps:PlanStep[], summary?:string):void
function printInfo(msg:string):void; function printError(msg:string):void
// src/config/settings.ts
interface Settings { defaultProvider:string; defaultModel:string; providers:Record<string,ProviderConfig>; budget?:number; permissions?:{…}; … }
function getDefaultSettings():Settings; function loadSettings():Settings
// src/permissions
type Rules; // shape used by gate(); has allow/ask/deny string arrays
```

---

### Task 1: Concurrency-limited `parallel` primitive

**Files:**
- Create: `src/workflow/primitives.ts`
- Test: `src/workflow/primitives.test.ts`

**Interfaces:**
- Produces: `pLimit(concurrency:number): <T>(fn:()=>Promise<T>)=>Promise<T>`; `parallel<T>(thunks:Array<()=>Promise<T>>, opts?:{concurrency?:number}): Promise<Array<T|null>>`
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**
```ts
// src/workflow/primitives.test.ts
import { describe, it, expect } from 'vitest';
import { pLimit, parallel } from './primitives';

const defer = (ms: number, v: unknown) => new Promise(r => setTimeout(() => r(v), ms));

describe('pLimit', () => {
  it('never runs more than `concurrency` thunks at once', async () => {
    let active = 0, peak = 0;
    const limit = pLimit(2);
    const make = () => limit(async () => { active++; peak = Math.max(peak, active); await defer(10, 0); active--; return 1; });
    await Promise.all(Array.from({ length: 6 }, make));
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('parallel', () => {
  it('returns results in input order', async () => {
    const out = await parallel([() => defer(20, 'a'), () => defer(5, 'b'), () => defer(10, 'c')], { concurrency: 3 });
    expect(out).toEqual(['a', 'b', 'c']);
  });
  it('maps a throwing thunk to null and never rejects', async () => {
    const out = await parallel([() => Promise.resolve('ok'), () => Promise.reject(new Error('boom'))], { concurrency: 2 });
    expect(out).toEqual(['ok', null]);
  });
  it('defaults concurrency to 1 when unspecified', async () => {
    let active = 0, peak = 0;
    const make = (v: number) => async () => { active++; peak = Math.max(peak, active); await defer(8, 0); active--; return v; };
    const out = await parallel([make(1), make(2), make(3)]);
    expect(peak).toBe(1);
    expect(out).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/primitives.test.ts`
Expected: FAIL — `Cannot find module './primitives'`.

- [ ] **Step 3: Write minimal implementation**
```ts
// src/workflow/primitives.ts
/**
 * Orchestration primitives — pure, dependency-free async combinators.
 *
 * parallel() runs thunks through a bounded queue (pLimit); a throwing thunk
 * resolves to null in its slot so a batch never rejects. Concurrency defaults
 * to 1 because the local Ollama backend serializes on a single GPU.
 */

/** A simple promise-concurrency limiter (no external dep). */
export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const max = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => { active--; if (queue.length > 0) queue.shift()!(); };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(next);
      };
      if (active < max) run();
      else queue.push(run);
    });
}

/** Run thunks concurrently (bounded). Throwing thunk → null. Order preserved. */
export async function parallel<T>(
  thunks: Array<() => Promise<T>>,
  opts: { concurrency?: number } = {},
): Promise<Array<T | null>> {
  const limit = pLimit(opts.concurrency ?? 1);
  return Promise.all(
    thunks.map(thunk => limit(async () => {
      try { return await thunk(); } catch { return null; }
    })),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workflow/primitives.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/workflow/primitives.ts src/workflow/primitives.test.ts
git commit -m "feat(workflow): concurrency-limited parallel primitive"
```

---

### Task 2: `pipeline` primitive

**Files:**
- Modify: `src/workflow/primitives.ts`
- Test: `src/workflow/primitives.test.ts` (append)

**Interfaces:**
- Produces: `pipeline<T>(items:T[], ...stages:Array<(prev:any, item:T, index:number)=>Promise<any>>): Promise<Array<any|null>>`
- Consumes: nothing.

- [ ] **Step 1: Write the failing test (append to primitives.test.ts)**
```ts
import { pipeline } from './primitives';

describe('pipeline', () => {
  it('flows each item through all stages independently', async () => {
    const out = await pipeline(
      [1, 2, 3],
      async (_prev, item) => item * 10,
      async (prev) => prev + 1,
    );
    expect(out).toEqual([11, 21, 31]);
  });
  it('passes prev / item / index to each stage', async () => {
    const seen: Array<[unknown, unknown, number]> = [];
    await pipeline(['x'], async (prev, item, i) => { seen.push([prev, item, i]); return 'y'; });
    expect(seen).toEqual([[undefined, 'x', 0]]);
  });
  it('drops an item to null when a stage throws and skips its later stages', async () => {
    let stage2Calls = 0;
    const out = await pipeline(
      [1, 2],
      async (_p, item) => { if (item === 2) throw new Error('bad'); return item; },
      async (prev) => { stage2Calls++; return prev + 100; },
    );
    expect(out).toEqual([101, null]);
    expect(stage2Calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/primitives.test.ts`
Expected: FAIL — `pipeline is not exported`.

- [ ] **Step 3: Write minimal implementation (append to primitives.ts)**
```ts
/**
 * Run each item through every stage independently (no barrier between stages):
 * item A may reach stage 3 while item B is still in stage 1. A stage that throws
 * drops that item to null and skips its remaining stages.
 */
export async function pipeline<T>(
  items: T[],
  ...stages: Array<(prev: any, item: T, index: number) => Promise<any>> // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<Array<any | null>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return Promise.all(items.map(async (item, index) => {
    let acc: unknown = undefined;
    try {
      for (const stage of stages) acc = await stage(acc, item, index);
      return acc;
    } catch {
      return null;
    }
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workflow/primitives.test.ts`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**
```bash
git add src/workflow/primitives.ts src/workflow/primitives.test.ts
git commit -m "feat(workflow): pipeline primitive (per-item independent stages)"
```

---

### Task 3: Sub-agent runner (`runSubAgent`) core

**Files:**
- Create: `src/workflow/runner.ts`
- Test: `src/workflow/runner.test.ts`

**Interfaces:**
- Consumes: `runAgent`, `createConversation`, `ToolRegistry`, `getRole`, `createProvider`, `Settings`, `Provider`, `Tool`.
- Produces:
```ts
interface SubAgentSpec { task:string; role?:string; systemPrompt?:string; tools?:string[]; maxIterations?:number; provider?:string; model?:string; validate?:(c:string)=>{ok:boolean;feedback?:string}; maxRetries?:number }
interface SubAgentResult { ok:boolean; content:string; role?:string; task:string; usage?:{prompt_tokens:number;completion_tokens:number;total_tokens:number}; error?:string }
interface RunnerContext { settings:Settings; defaultProviderName:string; parentRegistry:ToolRegistry; mcpClient?:any; memory?:any; skills?:any; tokenTracker?:any; permissions?:any; unattended?:boolean; sessionAllow?:Set<string>; cwd:string; providerFactory?:(name:string,settings:Settings)=>Provider }
function buildScopedRegistry(parent:ToolRegistry, allowed?:string[]):ToolRegistry
function runSubAgent(spec:SubAgentSpec, ctx:RunnerContext):Promise<SubAgentResult>
```

- [ ] **Step 1: Write the failing test**
```ts
// src/workflow/runner.test.ts
import { describe, it, expect } from 'vitest';
import { runSubAgent, buildScopedRegistry, RunnerContext } from './runner';
import { createDefaultRegistry } from '../registry/index';
import type { Provider, CompletionOptions, CompletionResult } from '../providers/index';
import { getDefaultSettings } from '../config/settings';

/** Fake provider: records the last CompletionOptions and returns a canned final answer (no tool calls). */
function fakeProvider(reply = 'done'): Provider & { last?: CompletionOptions } {
  const p: any = {
    name: 'fake', model: 'fake-1',
    async isAvailable() { return true; },
    async complete(o: CompletionOptions): Promise<CompletionResult> {
      p.last = o;
      return { content: reply, usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } };
    },
  };
  return p;
}

function baseCtx(provider: Provider): RunnerContext {
  return {
    settings: getDefaultSettings(),
    defaultProviderName: 'ollama',
    parentRegistry: createDefaultRegistry(),
    cwd: process.cwd(),
    providerFactory: () => provider,
  };
}

describe('buildScopedRegistry', () => {
  it('keeps only the allowed tools', () => {
    const parent = createDefaultRegistry();
    const scoped = buildScopedRegistry(parent, ['read_file', 'list_files']);
    const names = scoped.getEnabled().map(t => t.name).sort();
    expect(names).toEqual(['list_files', 'read_file']);
  });
  it('falls back to the parent enabled set when allowed is undefined', () => {
    const parent = createDefaultRegistry();
    const scoped = buildScopedRegistry(parent, undefined);
    expect(scoped.getEnabled().length).toBe(parent.getEnabled().length);
  });
});

describe('runSubAgent', () => {
  it('resolves a role system prompt and returns final text', async () => {
    const p = fakeProvider('architecture is good');
    const res = await runSubAgent({ role: 'architect', task: 'Design a thing' }, baseCtx(p));
    expect(res.ok).toBe(true);
    expect(res.content).toBe('architecture is good');
    expect(res.role).toBe('architect');
    // architect's systemPrompt was injected as the first system message
    expect(p.last!.messages[0].role).toBe('system');
    expect(p.last!.messages[0].content).toContain('senior software architect');
    // architect.allowedTools restricts the scoped tool list
    const toolNames = (p.last!.tools ?? []).map(t => t.name).sort();
    expect(toolNames).toEqual(['list_files', 'read_file', 'search_files']);
  });

  it('honors an inline systemPrompt + tools override', async () => {
    const p = fakeProvider();
    await runSubAgent({ systemPrompt: 'You are X.', tools: ['read_file'], task: 'go' }, baseCtx(p));
    expect(p.last!.messages[0].content).toBe('You are X.');
    expect((p.last!.tools ?? []).map(t => t.name)).toEqual(['read_file']);
  });

  it('returns ok:false on provider throw, never throwing', async () => {
    const p: any = { name: 'boom', model: 'x', async isAvailable() { return true; },
      async complete() { throw new Error('provider exploded'); } };
    const res = await runSubAgent({ task: 'go' }, baseCtx(p));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('provider exploded');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/runner.test.ts`
Expected: FAIL — `Cannot find module './runner'`.

- [ ] **Step 3: Write minimal implementation**
```ts
// src/workflow/runner.ts
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

/** Build a registry containing only `allowed` tools (pulled from the parent's full list). */
export function buildScopedRegistry(parent: ToolRegistry, allowed?: string[]): ToolRegistry {
  const scoped = new ToolRegistry();
  const all = parent.list();
  if (!allowed) {
    const enabledNames = new Set(parent.getEnabled().map(t => t.name));
    for (const t of all) if (enabledNames.has(t.name)) scoped.register(asTool(t), t.category, t.source);
    return scoped;
  }
  const wanted = new Set(allowed);
  for (const t of all) if (wanted.has(t.name)) scoped.register(asTool(t), t.category, t.source);
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

  try {
    const provider = resolveProvider(spec, ctx);
    const conv = createConversation(systemPrompt);
    const result = await runAgent(provider, conv, spec.task, {
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
    return { ok: true, content: result.content, role: spec.role, task: spec.task, usage: result.usage };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, content: msg, role: spec.role, task: spec.task, error: msg };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workflow/runner.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**
```bash
git add src/workflow/runner.ts src/workflow/runner.test.ts
git commit -m "feat(workflow): sub-agent runner with role resolution + scoped tools"
```

---

### Task 4: Runner guardrail + bounded retry

**Files:**
- Modify: `src/workflow/runner.ts` (`runSubAgent`)
- Test: `src/workflow/runner.test.ts` (append)

**Interfaces:**
- Consumes: `SubAgentSpec.validate`, `SubAgentSpec.maxRetries` (already declared in Task 3).
- Produces: retry behavior — failing `validate` re-prompts with feedback up to `maxRetries` (default 2); passing returns immediately.

- [ ] **Step 1: Write the failing test (append)**
```ts
describe('runSubAgent guardrail + retry', () => {
  it('retries with feedback until validate passes', async () => {
    let call = 0;
    const p: any = { name: 'fake', model: 'x', async isAvailable() { return true; },
      async complete() { call++; return { content: call < 3 ? 'bad' : 'good', usage: { prompt_tokens:1, completion_tokens:1, total_tokens:2 } }; } };
    const ctx = baseCtx(p);
    const res = await runSubAgent({
      task: 'produce good', maxRetries: 3,
      validate: (c) => ({ ok: c === 'good', feedback: 'must say good' }),
    }, ctx);
    expect(res.ok).toBe(true);
    expect(res.content).toBe('good');
    expect(call).toBe(3); // 1 initial + 2 retries
  });

  it('returns the last attempt (ok:false) when retries are exhausted', async () => {
    const p = fakeProvider('still bad');
    const res = await runSubAgent({
      task: 'go', maxRetries: 1,
      validate: () => ({ ok: false, feedback: 'nope' }),
    }, baseCtx(p));
    expect(res.ok).toBe(false);
    expect(res.content).toBe('still bad');
    expect(res.error).toContain('guardrail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/runner.test.ts -t guardrail`
Expected: FAIL — no retry yet (validate ignored; `call` is 1).

- [ ] **Step 3: Replace the try-block body of `runSubAgent`**

Replace the single `runAgent` call + return with a retry loop:
```ts
  const maxRetries = Math.max(0, spec.maxRetries ?? 2);
  try {
    const provider = resolveProvider(spec, ctx);
    let lastContent = '';
    let lastUsage: SubAgentResult['usage'];
    let feedback = '';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const conv = createConversation(systemPrompt);
      const task = feedback ? `${spec.task}\n\n[Revise — previous attempt failed validation: ${feedback}]` : spec.task;
      const result = await runAgent(provider, conv, task, {
        cwd: ctx.cwd, stream: false, maxIterations: spec.maxIterations ?? 6,
        registry: scoped, mcpClient: ctx.mcpClient, memory: ctx.memory, skills: ctx.skills,
        tokenTracker: ctx.tokenTracker, permissions: ctx.permissions, unattended: ctx.unattended, sessionAllow: ctx.sessionAllow,
      });
      lastContent = result.content; lastUsage = result.usage;
      if (!spec.validate) return { ok: true, content: lastContent, role: spec.role, task: spec.task, usage: lastUsage };
      const verdict = spec.validate(lastContent);
      if (verdict.ok) return { ok: true, content: lastContent, role: spec.role, task: spec.task, usage: lastUsage };
      feedback = verdict.feedback ?? 'output rejected by guardrail';
    }
    return { ok: false, content: lastContent, role: spec.role, task: spec.task, usage: lastUsage, error: `guardrail failed after ${maxRetries + 1} attempts` };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, content: msg, role: spec.role, task: spec.task, error: msg };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/workflow/runner.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**
```bash
git add src/workflow/runner.ts src/workflow/runner.test.ts
git commit -m "feat(workflow): programmatic guardrail + bounded retry for sub-agents"
```

---

### Task 5: Workflow schema + validation

**Files:**
- Create: `src/workflow/schema.ts`
- Test: `src/workflow/schema.test.ts`

**Interfaces:**
- Produces:
```ts
interface WorkflowStep { id:string; type:'agent'|'parallel'|'pipeline'; role?:string; task?:string; branches?:Array<{role?:string;task:string;tools?:string[]}>; stages?:Array<{role?:string;task:string;tools?:string[]}>; depends_on?:string[]; tools?:string[]; provider?:string; model?:string; maxIterations?:number }
interface WorkflowDef { name:string; description?:string; inputs?:string[]; steps:WorkflowStep[] }
function validateWorkflow(def:unknown): { ok:true; def:WorkflowDef } | { ok:false; errors:string[] }
function topoOrder(steps:WorkflowStep[]): string[][]   // dependency levels; throws on cycle
```

- [ ] **Step 1: Write the failing test**
```ts
// src/workflow/schema.test.ts
import { describe, it, expect } from 'vitest';
import { validateWorkflow, topoOrder } from './schema';

const good = {
  name: 'review-and-fix',
  inputs: ['path'],
  steps: [
    { id: 'find', type: 'agent', role: 'reviewer', task: 'Review {{path}}' },
    { id: 'fix', type: 'agent', role: 'coder', task: 'Fix {{steps.find.output}}', depends_on: ['find'] },
  ],
};

describe('validateWorkflow', () => {
  it('accepts a well-formed def', () => {
    const r = validateWorkflow(good);
    expect(r.ok).toBe(true);
  });
  it('rejects missing name / empty steps', () => {
    expect(validateWorkflow({ steps: [] }).ok).toBe(false);
    expect(validateWorkflow({ name: 'x', steps: [] }).ok).toBe(false);
  });
  it('rejects duplicate step ids', () => {
    const r = validateWorkflow({ name: 'x', steps: [{ id: 'a', type: 'agent', task: 't' }, { id: 'a', type: 'agent', task: 't' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/duplicate/i);
  });
  it('rejects an unknown depends_on target', () => {
    const r = validateWorkflow({ name: 'x', steps: [{ id: 'a', type: 'agent', task: 't', depends_on: ['ghost'] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/ghost/);
  });
  it('rejects a dependency cycle', () => {
    const r = validateWorkflow({ name: 'x', steps: [
      { id: 'a', type: 'agent', task: 't', depends_on: ['b'] },
      { id: 'b', type: 'agent', task: 't', depends_on: ['a'] },
    ]});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/cycle/i);
  });
});

describe('topoOrder', () => {
  it('groups independent steps into the same level', () => {
    const levels = topoOrder([
      { id: 'a', type: 'agent', task: 't' },
      { id: 'b', type: 'agent', task: 't' },
      { id: 'c', type: 'agent', task: 't', depends_on: ['a', 'b'] },
    ]);
    expect(levels[0].sort()).toEqual(['a', 'b']);
    expect(levels[1]).toEqual(['c']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/schema.test.ts`
Expected: FAIL — `Cannot find module './schema'`.

- [ ] **Step 3: Write minimal implementation**
```ts
// src/workflow/schema.ts
/**
 * Workflow definition types + validation. A workflow is a small DAG of steps;
 * validateWorkflow() guarantees shape, unique ids, resolvable dependencies, and
 * the absence of cycles BEFORE any agent runs. topoOrder() returns dependency
 * levels so the engine can run independent steps together.
 */

export interface WorkflowSubStep { role?: string; task: string; tools?: string[] }
export interface WorkflowStep {
  id: string;
  type: 'agent' | 'parallel' | 'pipeline';
  role?: string;
  task?: string;
  branches?: WorkflowSubStep[];
  stages?: WorkflowSubStep[];
  depends_on?: string[];
  tools?: string[];
  provider?: string;
  model?: string;
  maxIterations?: number;
}
export interface WorkflowDef { name: string; description?: string; inputs?: string[]; steps: WorkflowStep[] }

const TYPES = new Set(['agent', 'parallel', 'pipeline']);

export function validateWorkflow(def: unknown): { ok: true; def: WorkflowDef } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const d = def as Partial<WorkflowDef>;
  if (!d || typeof d !== 'object') return { ok: false, errors: ['workflow must be an object'] };
  if (typeof d.name !== 'string' || !d.name.trim()) errors.push('workflow.name is required');
  if (!Array.isArray(d.steps) || d.steps.length === 0) errors.push('workflow.steps must be a non-empty array');

  const ids = new Set<string>();
  if (Array.isArray(d.steps)) {
    for (const s of d.steps) {
      if (!s || typeof s.id !== 'string' || !s.id.trim()) { errors.push('every step needs a non-empty id'); continue; }
      if (ids.has(s.id)) errors.push(`duplicate step id: ${s.id}`);
      ids.add(s.id);
      if (!TYPES.has(s.type)) errors.push(`step ${s.id}: type must be agent|parallel|pipeline`);
      if (s.type === 'agent' && typeof s.task !== 'string') errors.push(`step ${s.id}: agent step needs a task`);
      if (s.type === 'parallel' && !Array.isArray(s.branches)) errors.push(`step ${s.id}: parallel step needs branches[]`);
      if (s.type === 'pipeline' && !Array.isArray(s.stages)) errors.push(`step ${s.id}: pipeline step needs stages[]`);
    }
    for (const s of d.steps) {
      for (const dep of s.depends_on ?? []) if (!ids.has(dep)) errors.push(`step ${s.id}: depends_on unknown step "${dep}"`);
    }
    if (errors.length === 0) {
      try { topoOrder(d.steps); } catch (e) { errors.push((e as Error).message); }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, def: d as WorkflowDef };
}

/** Kahn's algorithm → dependency levels. Throws "dependency cycle: …" if not a DAG. */
export function topoOrder(steps: WorkflowStep[]): string[][] {
  const indeg = new Map<string, number>();
  const deps = new Map<string, string[]>();
  for (const s of steps) { indeg.set(s.id, (s.depends_on ?? []).length); deps.set(s.id, s.depends_on ?? []); }
  const levels: string[][] = [];
  const done = new Set<string>();
  while (done.size < steps.length) {
    const ready = steps.filter(s => !done.has(s.id) && (deps.get(s.id) ?? []).every(d => done.has(d))).map(s => s.id);
    if (ready.length === 0) {
      const stuck = steps.filter(s => !done.has(s.id)).map(s => s.id).join(', ');
      throw new Error(`dependency cycle among steps: ${stuck}`);
    }
    levels.push(ready);
    for (const id of ready) done.add(id);
  }
  return levels;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workflow/schema.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**
```bash
git add src/workflow/schema.ts src/workflow/schema.test.ts
git commit -m "feat(workflow): workflow schema + DAG validation (cycle/dep checks)"
```

---

### Task 6: Workflow loader (YAML discovery)

**Files:**
- Create: `src/workflow/loader.ts`
- Test: `src/workflow/loader.test.ts`

**Interfaces:**
- Consumes: `validateWorkflow`, `WorkflowDef` (Task 5), `yaml`.
- Produces: `parseWorkflow(text:string): {ok:true;def:WorkflowDef}|{ok:false;errors:string[]}`; `loadWorkflows(dirs:string[]): Map<string,WorkflowDef>`; `workflowDirs(cwd:string):string[]`

- [ ] **Step 1: Write the failing test**
```ts
// src/workflow/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseWorkflow, loadWorkflows } from './loader';

describe('parseWorkflow', () => {
  it('parses valid YAML into a WorkflowDef', () => {
    const r = parseWorkflow('name: demo\nsteps:\n  - id: a\n    type: agent\n    task: hello');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.def.name).toBe('demo');
  });
  it('reports validation errors for bad YAML content', () => {
    const r = parseWorkflow('name: bad\nsteps: []');
    expect(r.ok).toBe(false);
  });
});

describe('loadWorkflows', () => {
  let dirA: string, dirB: string;
  beforeEach(() => {
    dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wfa-'));
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wfb-'));
    fs.writeFileSync(path.join(dirA, 'shared.yaml'), 'name: shared\nsteps:\n  - id: a\n    type: agent\n    task: from-A');
    fs.writeFileSync(path.join(dirB, 'shared.yaml'), 'name: shared\nsteps:\n  - id: a\n    type: agent\n    task: from-B');
    fs.writeFileSync(path.join(dirB, 'extra.yaml'), 'name: extra\nsteps:\n  - id: a\n    type: agent\n    task: t');
  });
  afterEach(() => { fs.rmSync(dirA, { recursive: true, force: true }); fs.rmSync(dirB, { recursive: true, force: true }); });

  it('loads all valid workflows; later dirs override earlier on name collision', () => {
    const map = loadWorkflows([dirA, dirB]); // dirB wins
    expect(map.size).toBe(2);
    expect(map.get('shared')!.steps[0].task).toBe('from-B');
    expect(map.has('extra')).toBe(true);
  });
  it('returns empty map for non-existent dirs', () => {
    expect(loadWorkflows(['/no/such/dir']).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/loader.test.ts`
Expected: FAIL — `Cannot find module './loader'`.

- [ ] **Step 3: Write minimal implementation**
```ts
// src/workflow/loader.ts
/**
 * Discover + parse YAML workflow files. Search order (later wins on name
 * collision): user dir (~/.coderaw/workflows or %APPDATA%\coderaw\workflows)
 * then the project dir (./.coderaw/workflows). Invalid files are skipped.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { validateWorkflow, WorkflowDef } from './schema';

export function parseWorkflow(text: string): { ok: true; def: WorkflowDef } | { ok: false; errors: string[] } {
  let raw: unknown;
  try { raw = yaml.parse(text); } catch (e) { return { ok: false, errors: [`YAML parse error: ${(e as Error).message}`] }; }
  return validateWorkflow(raw);
}

export function workflowDirs(cwd: string): string[] {
  const userBase = process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? os.homedir(), 'coderaw')
    : path.join(os.homedir(), '.coderaw');
  return [path.join(userBase, 'workflows'), path.join(cwd, '.coderaw', 'workflows')];
}

export function loadWorkflows(dirs: string[]): Map<string, WorkflowDef> {
  const map = new Map<string, WorkflowDef>();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.ya?ml$/i.test(file)) continue;
      try {
        const r = parseWorkflow(fs.readFileSync(path.join(dir, file), 'utf-8'));
        if (r.ok) map.set(r.def.name, r.def);
      } catch { /* skip unreadable file */ }
    }
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workflow/loader.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/workflow/loader.ts src/workflow/loader.test.ts
git commit -m "feat(workflow): YAML workflow loader with dir precedence"
```

---

### Task 7: Workflow engine (`runWorkflow`)

**Files:**
- Create: `src/workflow/engine.ts`
- Test: `src/workflow/engine.test.ts`

**Interfaces:**
- Consumes: `WorkflowDef`, `WorkflowStep`, `topoOrder` (Task 5); `parallel`, `pipeline` (Tasks 1-2); `runSubAgent`, `RunnerContext`, `SubAgentResult` (Task 3).
- Produces:
```ts
interface WorkflowRun { ok:boolean; outputs:Record<string,string>; steps:Array<{id:string;ok:boolean;output:string;error?:string}>; usage:{prompt_tokens:number;completion_tokens:number;total_tokens:number} }
function substitute(template:string, inputs:Record<string,string>, outputs:Record<string,string>): string
function runWorkflow(def:WorkflowDef, inputs:Record<string,string>, ctx:RunnerContext, deps?:{ runSubAgent?:typeof import('./runner').runSubAgent }): Promise<WorkflowRun>
```
Templating: `{{name}}` → inputs[name]; `{{steps.<id>.output}}` → outputs[id]. Unknown placeholder → left as-is is NOT allowed; substitute throws so the engine records the step failed.

- [ ] **Step 1: Write the failing test**
```ts
// src/workflow/engine.test.ts
import { describe, it, expect } from 'vitest';
import { runWorkflow, substitute } from './engine';
import type { SubAgentSpec, SubAgentResult, RunnerContext } from './runner';
import { getDefaultSettings } from '../config/settings';
import { createDefaultRegistry } from '../registry/index';

function ctx(): RunnerContext {
  return { settings: getDefaultSettings(), defaultProviderName: 'ollama', parentRegistry: createDefaultRegistry(), cwd: process.cwd() };
}

describe('substitute', () => {
  it('fills inputs and step outputs', () => {
    expect(substitute('a={{x}} b={{steps.s1.output}}', { x: '1' }, { s1: 'OUT' })).toBe('a=1 b=OUT');
  });
  it('throws on an unknown placeholder', () => {
    expect(() => substitute('{{ghost}}', {}, {})).toThrow(/ghost/);
  });
});

describe('runWorkflow', () => {
  // fake runSubAgent: echoes which task it received, records call order
  const order: string[] = [];
  const fakeRun = async (spec: SubAgentSpec): Promise<SubAgentResult> => {
    order.push(spec.task);
    return { ok: true, content: `[${spec.task}]`, task: spec.task, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  };

  it('runs steps in dependency order and passes outputs downstream', async () => {
    order.length = 0;
    const def = { name: 'w', inputs: ['path'], steps: [
      { id: 'find', type: 'agent' as const, role: 'reviewer', task: 'review {{path}}' },
      { id: 'fix', type: 'agent' as const, role: 'coder', task: 'fix {{steps.find.output}}', depends_on: ['find'] },
    ]};
    const run = await runWorkflow(def, { path: 'a.ts' }, ctx(), { runSubAgent: fakeRun });
    expect(run.ok).toBe(true);
    expect(run.outputs.find).toBe('[review a.ts]');
    expect(run.outputs.fix).toBe('[fix [review a.ts]]');
    expect(order).toEqual(['review a.ts', 'fix [review a.ts]']);
    expect(run.usage.total_tokens).toBe(4);
  });

  it('isolates failure: a failed step skips its dependents but independents still run', async () => {
    const failing = async (spec: SubAgentSpec): Promise<SubAgentResult> =>
      spec.task === 'boom'
        ? { ok: false, content: 'err', task: spec.task, error: 'boom' }
        : { ok: true, content: `[${spec.task}]`, task: spec.task };
    const def = { name: 'w', steps: [
      { id: 'a', type: 'agent' as const, task: 'boom' },
      { id: 'b', type: 'agent' as const, task: 'fine' },
      { id: 'c', type: 'agent' as const, task: 'needs-a {{steps.a.output}}', depends_on: ['a'] },
    ]};
    const run = await runWorkflow(def, {}, ctx(), { runSubAgent: failing });
    expect(run.ok).toBe(false);
    expect(run.steps.find(s => s.id === 'b')!.ok).toBe(true);
    expect(run.steps.find(s => s.id === 'c')!.ok).toBe(false); // skipped because dep a failed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/engine.test.ts`
Expected: FAIL — `Cannot find module './engine'`.

- [ ] **Step 3: Write minimal implementation**
```ts
// src/workflow/engine.ts
/**
 * Layer 2 — the DAG executor. Runs validated workflow steps in dependency order
 * (independent steps together via parallel()), substitutes {{inputs}} and
 * {{steps.id.output}} into each task, and isolates failures: a failed step's
 * dependents are skipped while independent branches continue.
 */
import { WorkflowDef, WorkflowStep, topoOrder } from './schema';
import { parallel, pipeline } from './primitives';
import { runSubAgent as realRunSubAgent, RunnerContext, SubAgentResult, SubAgentSpec } from './runner';

export interface WorkflowRun {
  ok: boolean;
  outputs: Record<string, string>;
  steps: Array<{ id: string; ok: boolean; output: string; error?: string }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

export function substitute(template: string, inputs: Record<string, string>, outputs: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (_m, expr: string) => {
    const stepMatch = /^steps\.([A-Za-z0-9_-]+)\.output$/.exec(expr);
    if (stepMatch) {
      if (!(stepMatch[1] in outputs)) throw new Error(`unknown step output placeholder: {{${expr}}}`);
      return outputs[stepMatch[1]];
    }
    if (!(expr in inputs)) throw new Error(`unknown placeholder: {{${expr}}}`);
    return inputs[expr];
  });
}

function concurrencyFor(ctx: RunnerContext): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wf = (ctx.settings as any).workflows;
  const isOllama = ctx.defaultProviderName === 'ollama';
  return (isOllama ? wf?.concurrency?.ollama : wf?.concurrency?.default) ?? (isOllama ? 1 : 4);
}

export async function runWorkflow(
  def: WorkflowDef,
  inputs: Record<string, string>,
  ctx: RunnerContext,
  deps: { runSubAgent?: (s: SubAgentSpec, c: RunnerContext) => Promise<SubAgentResult> } = {},
): Promise<WorkflowRun> {
  const runSubAgent = deps.runSubAgent ?? realRunSubAgent;
  const byId = new Map(def.steps.map(s => [s.id, s]));
  const outputs: Record<string, string> = {};
  const stepResults: WorkflowRun['steps'] = [];
  const failed = new Set<string>();
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const conc = concurrencyFor(ctx);

  const addUsage = (u?: SubAgentResult['usage']) => {
    if (!u) return; usage.prompt_tokens += u.prompt_tokens; usage.completion_tokens += u.completion_tokens; usage.total_tokens += u.total_tokens;
  };

  const runOneStep = async (step: WorkflowStep): Promise<void> => {
    // Skip if any dependency failed.
    if ((step.depends_on ?? []).some(d => failed.has(d))) {
      failed.add(step.id);
      stepResults.push({ id: step.id, ok: false, output: '', error: `skipped: dependency failed` });
      outputs[step.id] = '';
      return;
    }
    try {
      if (step.type === 'agent') {
        const task = substitute(step.task ?? '', inputs, outputs);
        const res = await runSubAgent({ task, role: step.role, tools: step.tools, provider: step.provider, model: step.model, maxIterations: step.maxIterations }, ctx);
        addUsage(res.usage);
        outputs[step.id] = res.content;
        if (!res.ok) failed.add(step.id);
        stepResults.push({ id: step.id, ok: res.ok, output: res.content, error: res.error });
      } else if (step.type === 'parallel') {
        const results = await parallel((step.branches ?? []).map(b => () =>
          runSubAgent({ task: substitute(b.task, inputs, outputs), role: b.role, tools: b.tools, provider: step.provider, model: step.model }, ctx)), { concurrency: conc });
        results.forEach(r => addUsage(r?.usage));
        const ok = results.every(r => r?.ok);
        const output = results.map(r => r?.content ?? '[failed]').join('\n---\n');
        outputs[step.id] = output;
        if (!ok) failed.add(step.id);
        stepResults.push({ id: step.id, ok, output });
      } else { // pipeline
        const stages = step.stages ?? [];
        const out = await pipeline([0],
          ...stages.map((stg) => async (prev: unknown) => {
            const task = substitute(stg.task, inputs, { ...outputs, __prev: String(prev ?? '') }).replace(/\{\{\s*prev\s*\}\}/g, String(prev ?? ''));
            const res = await runSubAgent({ task, role: stg.role, tools: stg.tools, provider: step.provider, model: step.model }, ctx);
            addUsage(res.usage);
            if (!res.ok) throw new Error(res.error ?? 'stage failed');
            return res.content;
          }),
        );
        const content = String(out[0] ?? '');
        const ok = out[0] !== null;
        outputs[step.id] = content;
        if (!ok) failed.add(step.id);
        stepResults.push({ id: step.id, ok, output: content });
      }
    } catch (err) {
      failed.add(step.id);
      outputs[step.id] = '';
      stepResults.push({ id: step.id, ok: false, output: '', error: (err as Error).message });
    }
  };

  for (const level of topoOrder(def.steps)) {
    await parallel(level.map(id => () => runOneStep(byId.get(id)!)), { concurrency: conc });
  }

  return { ok: failed.size === 0, outputs, steps: stepResults, usage };
}
```
> Note: `{{prev}}` is a pipeline-only convenience referencing the previous stage's output; the dummy `__prev` key keeps `substitute` from throwing on it before the explicit `.replace`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workflow/engine.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/workflow/engine.ts src/workflow/engine.test.ts
git commit -m "feat(workflow): DAG engine — topo execution, templating, failure isolation"
```

---

### Task 8: Add `orchestrator` + `verifier` roles

**Files:**
- Modify: `src/agents/roles.ts` (add two entries to `BUILTIN_ROLES`)
- Test: `src/agents/roles.workflow.test.ts`

**Interfaces:**
- Produces: `getRole('orchestrator')` and `getRole('verifier')` resolve with the expected `allowedTools`.

- [ ] **Step 1: Write the failing test**
```ts
// src/agents/roles.workflow.test.ts
import { describe, it, expect } from 'vitest';
import { getRole } from './roles';

describe('workflow roles', () => {
  it('orchestrator exists and can spawn sub-agents', () => {
    const r = getRole('orchestrator');
    expect(r).toBeDefined();
    expect(r!.allowedTools).toContain('spawn_agent');
    expect(r!.allowedTools).toContain('run_parallel');
    expect(r!.systemPrompt).toMatch(/self-contained/i);
  });
  it('verifier exists and is read+run only (last-resort judge)', () => {
    const r = getRole('verifier');
    expect(r).toBeDefined();
    expect(r!.allowedTools).toContain('run_command');
    expect(r!.allowedTools).not.toContain('write_file');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/roles.workflow.test.ts`
Expected: FAIL — roles undefined.

- [ ] **Step 3: Add the two roles inside `BUILTIN_ROLES`** (before the closing `};`)
```ts
  orchestrator: {
    id: 'orchestrator',
    name: 'Orchestrator',
    icon: '🪄',
    description: 'Decompose a task and delegate to sub-agents',
    allowedTools: ['spawn_agent', 'run_parallel', 'read_file', 'list_files', 'search_files'],
    systemPrompt: `You are an orchestrator. You break a task into focused sub-tasks and delegate them to sub-agents via the spawn_agent and run_parallel tools.

Rules:
- Default to doing the work yourself with a single focused effort. Only delegate when sub-tasks are genuinely independent or the task is too large for one pass — naive fan-out usually does NOT beat one well-scoped agent.
- Use run_parallel ONLY for sub-tasks that do not depend on each other. For dependent work, spawn_agent sequentially and feed each result into the next task.
- Each sub-agent has its OWN isolated context and CANNOT see this conversation. Every task you send MUST be self-contained: include all file paths, prior findings, and context the sub-agent needs.
- Give each sub-agent the smallest tool set that lets it finish.
- After sub-agents return, synthesize their results into a single answer for the user.`,
  },

  verifier: {
    id: 'verifier',
    name: 'Verifier',
    icon: '✅',
    description: 'Last-resort judgement when no sound external check exists',
    allowedTools: ['read_file', 'list_files', 'search_files', 'run_command', 'git_diff', 'git_status'],
    systemPrompt: `You are a verifier of LAST RESORT, used only when no sound external check (tests, type-checker, compiler, linter) can decide whether a task is complete.

Prefer to run an objective command (tests, build, type-check) and judge by its exit status. Only fall back to reading the code and giving an opinion when no such command exists. Never claim success without concrete evidence. Answer with a clear PASS or FAIL and one sentence of justification, citing the evidence you used.`,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agents/roles.workflow.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add src/agents/roles.ts src/agents/roles.workflow.test.ts
git commit -m "feat(workflow): add orchestrator + verifier built-in roles"
```

---

### Task 9: Dynamic tools (`spawn_agent`, `run_parallel`) + runtime holder

**Files:**
- Create: `src/workflow/runtime.ts`
- Create: `src/workflow/tools.ts`
- Modify: `src/agent/tools.ts` (add 2 cases to `executeTool`)
- Test: `src/workflow/tools.test.ts`

**Interfaces:**
- Consumes: `runSubAgent`, `RunnerContext` (Task 3); `parallel` (Task 1); `Provider`, `Tool`, `ToolResult`.
- Produces:
```ts
// runtime.ts
function setWorkflowRuntime(ctx:RunnerContext):void; function getWorkflowRuntime():RunnerContext|null; function clearWorkflowRuntime():void
// tools.ts
const WORKFLOW_TOOLS: Tool[]   // spawn_agent, run_parallel
function registerWorkflowTools(registry:ToolRegistry):void
function executeWorkflowTool(name:string, args:Record<string,unknown>, cwd:string): Promise<ToolResult>
```

- [ ] **Step 1: Write the failing test**
```ts
// src/workflow/tools.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setWorkflowRuntime, getWorkflowRuntime, clearWorkflowRuntime } from './runtime';
import { registerWorkflowTools, executeWorkflowTool, WORKFLOW_TOOLS } from './tools';
import { ToolRegistry } from '../registry/index';
import { getDefaultSettings } from '../config/settings';
import type { Provider, CompletionOptions, CompletionResult } from '../providers/index';

function fakeProvider(reply: string): Provider {
  return { name: 'fake', model: 'x', async isAvailable() { return true; },
    async complete(_o: CompletionOptions): Promise<CompletionResult> { return { content: reply, usage: { prompt_tokens:1, completion_tokens:1, total_tokens:2 } }; } };
}

describe('workflow runtime + dynamic tools', () => {
  beforeEach(() => clearWorkflowRuntime());

  it('registers spawn_agent and run_parallel as custom tools', () => {
    const reg = new ToolRegistry();
    registerWorkflowTools(reg);
    const names = reg.list().map(t => t.name);
    expect(names).toContain('spawn_agent');
    expect(names).toContain('run_parallel');
    expect(WORKFLOW_TOOLS.length).toBe(2);
  });

  it('spawn_agent errors cleanly when no runtime is set', async () => {
    const res = await executeWorkflowTool('spawn_agent', { role: 'coder', task: 't' }, process.cwd());
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/runtime/i);
  });

  it('spawn_agent runs a sub-agent via the active runtime', async () => {
    setWorkflowRuntime({
      settings: getDefaultSettings(), defaultProviderName: 'ollama',
      parentRegistry: (() => { const r = new ToolRegistry(); return r; })(),
      cwd: process.cwd(), providerFactory: () => fakeProvider('sub-agent says hi'),
    });
    const res = await executeWorkflowTool('spawn_agent', { role: 'coder', task: 'do it' }, process.cwd());
    expect(res.isError).toBeFalsy();
    expect(res.content).toBe('sub-agent says hi');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/tools.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3a: Create `src/workflow/runtime.ts`**
```ts
// src/workflow/runtime.ts
/**
 * Module-level holder for the orchestration context the dynamic spawn tools
 * (spawn_agent / run_parallel) read at call time. The CLI sets it before each
 * interactive turn; cleared otherwise. Same singleton pattern as agent/plan.ts.
 */
import { RunnerContext } from './runner';

let current: RunnerContext | null = null;
export function setWorkflowRuntime(ctx: RunnerContext): void { current = ctx; }
export function getWorkflowRuntime(): RunnerContext | null { return current; }
export function clearWorkflowRuntime(): void { current = null; }
```

- [ ] **Step 3b: Create `src/workflow/tools.ts`**
```ts
// src/workflow/tools.ts
/**
 * Layer 3a — dynamic orchestration tools. These let the main agent decompose
 * work at runtime. Execution reads the active RunnerContext from runtime.ts and
 * delegates to runSubAgent. They are gated like any tool (consequential) via the
 * core.ts gate() choke point before executeTool dispatches here.
 */
import { Tool } from '../providers/index';
import { ToolRegistry } from '../registry/index';
import { ToolResult } from '../agent/tools';
import { parallel } from './primitives';
import { runSubAgent } from './runner';
import { getWorkflowRuntime } from './runtime';

export const WORKFLOW_TOOLS: Tool[] = [
  {
    name: 'spawn_agent',
    description: 'Delegate a self-contained sub-task to a fresh sub-agent (its own context + minimal tools). The task string MUST include all context the sub-agent needs. Returns the sub-agent\'s final answer.',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Sub-agent role id (e.g. coder, reviewer, architect, tester, documenter)' },
        task: { type: 'string', description: 'Self-contained instruction with ALL needed context' },
        tools: { type: 'array', description: 'Optional minimal tool-name allow-list for the sub-agent', items: { type: 'string' } },
      },
      required: ['task'],
    },
  },
  {
    name: 'run_parallel',
    description: 'Run several INDEPENDENT sub-tasks concurrently (bounded; local backend serializes). Each task must be self-contained. Returns the joined results.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'List of { role?, task } objects — must be mutually independent',
          items: { type: 'object' },
        },
      },
      required: ['tasks'],
    },
  },
];

export function registerWorkflowTools(registry: ToolRegistry): void {
  for (const t of WORKFLOW_TOOLS) registry.register(t, 'custom', 'custom');
}

export async function executeWorkflowTool(name: string, args: Record<string, unknown>, _cwd: string): Promise<ToolResult> {
  const ctx = getWorkflowRuntime();
  if (!ctx) return { content: 'Orchestration unavailable: no active workflow runtime.', isError: true };

  if (name === 'spawn_agent') {
    const res = await runSubAgent({ role: args.role as string | undefined, task: String(args.task ?? ''), tools: args.tools as string[] | undefined }, ctx);
    return { content: res.content, isError: !res.ok };
  }
  if (name === 'run_parallel') {
    const tasks = Array.isArray(args.tasks) ? (args.tasks as Array<{ role?: string; task: string }>) : [];
    if (tasks.length === 0) return { content: 'run_parallel: tasks[] is required and must be non-empty.', isError: true };
    const conc = ctx.defaultProviderName === 'ollama' ? 1 : 4;
    const results = await parallel(tasks.map(t => () => runSubAgent({ role: t.role, task: t.task }, ctx)), { concurrency: conc });
    const joined = results.map((r, i) => `### Sub-agent ${i + 1}${r?.role ? ` (${r.role})` : ''}\n${r?.content ?? '[failed]'}`).join('\n\n');
    return { content: joined, isError: results.some(r => !r || !r.ok) };
  }
  return { content: `Unknown workflow tool: ${name}`, isError: true };
}
```

- [ ] **Step 3c: Wire dispatch in `src/agent/tools.ts` `executeTool` switch**

Add these cases just before `default:` (line ~320). Use lazy `require` to avoid the import cycle (`tools.ts` → `workflow/tools.ts` → `workflow/runner.ts` → `agent/core.ts` → `agent/tools.ts`):
```ts
      case 'spawn_agent':
      case 'run_parallel': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { executeWorkflowTool } = require('../workflow/tools') as typeof import('../workflow/tools');
        return executeWorkflowTool(name, args, cwd);
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workflow/tools.test.ts`
Expected: PASS (3 tests). Also run `npx vitest run src/agent` to confirm no regression in existing agent tests.

- [ ] **Step 5: Commit**
```bash
git add src/workflow/runtime.ts src/workflow/tools.ts src/agent/tools.ts src/workflow/tools.test.ts
git commit -m "feat(workflow): dynamic spawn_agent/run_parallel tools + runtime holder"
```

---

### Task 10: Autonomous goal loop (`runGoal`)

**Files:**
- Create: `src/workflow/goal.ts`
- Test: `src/workflow/goal.test.ts`

**Interfaces:**
- Consumes: `runSubAgent`, `RunnerContext` (Task 3); `PlanItem`, `setPlan`, `planToSteps`, `planSummary` (plan.ts); `printPlanBox`, `printInfo` (terminal.ts); `executeTool` (tools.ts).
- Produces:
```ts
interface GoalOptions { goal:string; allow:string[]; verifyCommand?:string; maxRounds?:number; budgetUsd?:number }
interface GoalResult { ok:boolean; rounds:number; plan:PlanItem[]; summary:string; usage:{prompt_tokens:number;completion_tokens:number;total_tokens:number}; stoppedBy:'verified'|'maxRounds'|'budget'|'error' }
interface GoalDeps { runSubAgent?; verify?:(cmd:string,cwd:string)=>Promise<{passed:boolean;output:string}>; detectVerifyCommand?:(cwd:string)=>string|null; render?:boolean }
function parsePlan(text:string): PlanItem[]
function runGoal(opts:GoalOptions, ctx:RunnerContext, deps?:GoalDeps): Promise<GoalResult>
```

- [ ] **Step 1: Write the failing test**
```ts
// src/workflow/goal.test.ts
import { describe, it, expect } from 'vitest';
import { runGoal, parsePlan } from './goal';
import type { SubAgentSpec, SubAgentResult, RunnerContext } from './runner';
import { getDefaultSettings } from '../config/settings';
import { createDefaultRegistry } from '../registry/index';

function ctx(): RunnerContext {
  return { settings: getDefaultSettings(), defaultProviderName: 'ollama', parentRegistry: createDefaultRegistry(), cwd: process.cwd() };
}

describe('parsePlan', () => {
  it('parses a JSON array of items', () => {
    expect(parsePlan('[{"content":"do a"},{"content":"do b"}]').map(i => i.content)).toEqual(['do a', 'do b']);
  });
  it('falls back to numbered/bulleted lines', () => {
    expect(parsePlan('1. first\n2. second\n- third').map(i => i.content)).toEqual(['first', 'second', 'third']);
  });
});

describe('runGoal', () => {
  it('stops when the EXTERNAL verifier passes (no LLM self-judge)', async () => {
    let verifyCalls = 0;
    const planner = async (): Promise<SubAgentResult> => ({ ok: true, content: '1. step one', task: 'plan', usage: { prompt_tokens:1, completion_tokens:1, total_tokens:2 } });
    const run = async (spec: SubAgentSpec): Promise<SubAgentResult> =>
      spec.role === 'planner' ? planner() : { ok: true, content: 'did it', task: spec.task, usage: { prompt_tokens:1, completion_tokens:1, total_tokens:2 } };
    const res = await runGoal(
      { goal: 'make tests pass', allow: ['run_command'], verifyCommand: 'npm test' },
      ctx(),
      { runSubAgent: run, render: false, verify: async () => { verifyCalls++; return { passed: true, output: 'ok' }; } },
    );
    expect(res.ok).toBe(true);
    expect(res.stoppedBy).toBe('verified');
    expect(verifyCalls).toBe(1);
  });

  it('re-plans only after a verify failure and stops at maxRounds', async () => {
    let verifyCalls = 0, planCalls = 0;
    const run = async (spec: SubAgentSpec): Promise<SubAgentResult> => {
      if (spec.role === 'planner') planCalls++;
      return { ok: true, content: spec.role === 'planner' ? '1. step' : 'work', task: spec.task };
    };
    const res = await runGoal(
      { goal: 'g', allow: [], verifyCommand: 'npm test', maxRounds: 2 },
      ctx(),
      { runSubAgent: run, render: false, verify: async () => { verifyCalls++; return { passed: false, output: 'fail' }; } },
    );
    expect(res.stoppedBy).toBe('maxRounds');
    expect(res.rounds).toBe(2);
    expect(planCalls).toBe(2);     // re-planned each failing round
    expect(verifyCalls).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/goal.test.ts`
Expected: FAIL — `Cannot find module './goal'`.

- [ ] **Step 3: Write minimal implementation**
```ts
// src/workflow/goal.ts
/**
 * Layer 3b — the autonomous goal loop: plan -> execute -> VERIFY (sound external
 * check) -> re-plan. Verification runs a real command (tests/tsc/lint) and reads
 * its exit status; the generating model never judges its own output. The loop
 * stops on a passing external check, a maxRounds cap, or a budget cap, and only
 * re-plans AFTER a verification failure (difficulty-gated critique).
 */
import * as fs from 'fs';
import * as path from 'path';
import { RunnerContext, SubAgentSpec, SubAgentResult, runSubAgent as realRunSubAgent } from './runner';
import { PlanItem, setPlan, planToSteps, planSummary } from '../agent/plan';
import { printPlanBox, printInfo } from '../ui/terminal';
import { executeTool } from '../agent/tools';

export interface GoalOptions { goal: string; allow: string[]; verifyCommand?: string; maxRounds?: number; budgetUsd?: number }
export interface GoalResult {
  ok: boolean; rounds: number; plan: PlanItem[]; summary: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  stoppedBy: 'verified' | 'maxRounds' | 'budget' | 'error';
}
export interface GoalDeps {
  runSubAgent?: (s: SubAgentSpec, c: RunnerContext) => Promise<SubAgentResult>;
  verify?: (cmd: string, cwd: string) => Promise<{ passed: boolean; output: string }>;
  detectVerifyCommand?: (cwd: string) => string | null;
  render?: boolean;
}

/** Parse a planner's free text into plan items: JSON array first, else numbered/bulleted lines. */
export function parsePlan(text: string): PlanItem[] {
  const t = text.trim();
  try {
    const arr = JSON.parse(t);
    if (Array.isArray(arr)) return arr.map(x => ({ content: String(x.content ?? x).trim(), status: 'pending' as const })).filter(i => i.content);
  } catch { /* fall through */ }
  return t.split('\n')
    .map(l => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(l => l.length > 0)
    .map(content => ({ content, status: 'pending' as const }));
}

/** Default external verifier: run the command via run_command, pass = non-error exit. */
async function defaultVerify(cmd: string, cwd: string): Promise<{ passed: boolean; output: string }> {
  const res = await executeTool('run_command', { command: cmd }, cwd);
  return { passed: !res.isError, output: res.content };
}

/** Auto-detect a sound verify command from the project. */
function defaultDetect(cwd: string): string | null {
  const pkg = path.join(cwd, 'package.json');
  if (fs.existsSync(pkg)) {
    try { if (JSON.parse(fs.readFileSync(pkg, 'utf-8')).scripts?.test) return 'npm test'; } catch { /* ignore */ }
  }
  if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) return 'npx tsc --noEmit';
  return null;
}

export async function runGoal(opts: GoalOptions, ctx: RunnerContext, deps: GoalDeps = {}): Promise<GoalResult> {
  const runSubAgent = deps.runSubAgent ?? realRunSubAgent;
  const verify = deps.verify ?? defaultVerify;
  const detect = deps.detectVerifyCommand ?? defaultDetect;
  const render = deps.render !== false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wf = (ctx.settings as any).workflows;
  const maxRounds = opts.maxRounds ?? wf?.goal?.maxRounds ?? 5;
  const budgetUsd = opts.budgetUsd ?? wf?.goal?.budgetUsd ?? ctx.settings.budget;
  const verifyCommand = opts.verifyCommand ?? detect(ctx.cwd) ?? null;

  // Pre-authorized allow-list for this goal: extend the gate's session allow set.
  const sessionAllow = new Set<string>(ctx.sessionAllow ?? []);
  for (const a of opts.allow) sessionAllow.add(a);
  const goalCtx: RunnerContext = { ...ctx, sessionAllow };

  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const addUsage = (u?: SubAgentResult['usage']) => { if (u) { usage.prompt_tokens += u.prompt_tokens; usage.completion_tokens += u.completion_tokens; usage.total_tokens += u.total_tokens; } };
  // Local (ollama) is free; nominal cloud rate keeps the budget guard meaningful.
  const costUsd = () => (goalCtx.defaultProviderName === 'ollama' ? 0 : usage.total_tokens / 1000 * 0.001);

  let plan: PlanItem[] = [];
  let stoppedBy: GoalResult['stoppedBy'] = 'maxRounds';
  let rounds = 0;
  let feedback = '';

  for (rounds = 1; rounds <= maxRounds; rounds++) {
    // 1) PLAN (or re-plan with verifier feedback)
    const planTask = `Goal: ${opts.goal}\n\nProduce a short ordered list of concrete steps to achieve this goal.${feedback ? `\n\nThe previous attempt FAILED verification:\n${feedback}\nRevise the plan to fix it.` : ''}\nReturn a numbered list, one step per line.`;
    const planRes = await runSubAgent({ role: 'planner', task: planTask }, goalCtx);
    addUsage(planRes.usage);
    plan = parsePlan(planRes.content);
    if (render) { setPlan(plan); printPlanBox(`🎯 Goal (round ${rounds})`, planToSteps(plan), planSummary(plan)); }

    // 2) EXECUTE each step
    for (let i = 0; i < plan.length; i++) {
      plan[i] = { ...plan[i], status: 'in_progress' };
      if (render) { setPlan(plan); }
      const stepTask = `Goal: ${opts.goal}\nStep ${i + 1} of ${plan.length}: ${plan[i].content}\n\nComplete ONLY this step.`;
      const r = await runSubAgent({ role: 'coder', task: stepTask }, goalCtx);
      addUsage(r.usage);
      plan[i] = { ...plan[i], status: 'completed' };
      if (render) { setPlan(plan); printPlanBox(`🎯 Goal (round ${rounds})`, planToSteps(plan), planSummary(plan)); }
      if (budgetUsd != null && costUsd() >= budgetUsd) {
        return { ok: false, rounds, plan, summary: `Stopped: budget $${budgetUsd} reached.`, usage, stoppedBy: 'budget' };
      }
    }

    // 3) VERIFY — sound external check (NOT an LLM judging its own work)
    if (!verifyCommand) {
      // No sound external check available → cannot self-confirm; stop and report.
      stoppedBy = 'maxRounds';
      if (render) printInfo('No external verify command found; cannot confirm completion objectively.');
      break;
    }
    if (render) printInfo(`Verifying: ${verifyCommand}`);
    const v = await verify(verifyCommand, goalCtx.cwd);
    if (v.passed) { stoppedBy = 'verified'; break; }
    feedback = v.output.slice(0, 800);

    if (budgetUsd != null && costUsd() >= budgetUsd) { stoppedBy = 'budget'; break; }
  }
  if (rounds > maxRounds) rounds = maxRounds;

  const ok = stoppedBy === 'verified';
  return {
    ok, rounds, plan, usage, stoppedBy,
    summary: ok ? `Goal verified after ${rounds} round(s) via "${verifyCommand}".` : `Goal not verified (stopped by ${stoppedBy}) after ${rounds} round(s).`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workflow/goal.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/workflow/goal.ts src/workflow/goal.test.ts
git commit -m "feat(workflow): autonomous goal loop with sound external verification"
```

---

### Task 11: Settings — `workflows` config block

**Files:**
- Modify: `src/config/settings.ts` (`Settings` interface + `DEFAULT_SETTINGS`)
- Test: `src/config/settings.workflow.test.ts`

**Interfaces:**
- Produces: `Settings.workflows?: { concurrency?:{ollama?:number;default?:number}; defaultRole?:string; goal?:{maxRounds?:number;budgetUsd?:number} }` with defaults `{concurrency:{ollama:1,default:4}, goal:{maxRounds:5}}`.

- [ ] **Step 1: Write the failing test**
```ts
// src/config/settings.workflow.test.ts
import { describe, it, expect } from 'vitest';
import { getDefaultSettings } from './settings';

describe('settings.workflows defaults', () => {
  it('provides workflow concurrency + goal defaults', () => {
    const s = getDefaultSettings();
    expect(s.workflows?.concurrency?.ollama).toBe(1);
    expect(s.workflows?.concurrency?.default).toBe(4);
    expect(s.workflows?.goal?.maxRounds).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/settings.workflow.test.ts`
Expected: FAIL — `workflows` undefined.

- [ ] **Step 3: Add to `Settings` interface** (after `permissions?: {...}`)
```ts
  workflows?: {
    concurrency?: { ollama?: number; default?: number };
    defaultRole?: string;
    goal?: { maxRounds?: number; budgetUsd?: number };
  };
```
And add to `DEFAULT_SETTINGS` (after the `permissions` block):
```ts
  workflows: {
    concurrency: { ollama: 1, default: 4 },
    goal: { maxRounds: 5 },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/settings.workflow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/config/settings.ts src/config/settings.workflow.test.ts
git commit -m "feat(workflow): settings.workflows config block + defaults"
```

---

### Task 12: CLI wiring — `/workflow`, `/workflows`, `/goal` + barrel + runtime

**Files:**
- Create: `src/workflow/index.ts` (barrel)
- Create: `src/workflow/cli-helpers.ts` (pure arg parsing — unit-testable)
- Modify: `src/cli.ts` (`handleSlashCommand` cases; register tools; set runtime; help)
- Test: `src/workflow/cli-helpers.test.ts`

**Interfaces:**
- Produces:
```ts
// cli-helpers.ts
function parseInputArgs(args:string[]): { name:string; inputs:Record<string,string> }   // ["wfname","--input","k=v","--input","a=b"] → {name, inputs}
function buildRunnerContext(ctx:any): RunnerContext   // map SlashCommandContext → RunnerContext
// index.ts re-exports runner, primitives, schema, loader, engine, tools, runtime, goal
```

- [ ] **Step 1: Write the failing test (pure helper only)**
```ts
// src/workflow/cli-helpers.test.ts
import { describe, it, expect } from 'vitest';
import { parseInputArgs } from './cli-helpers';

describe('parseInputArgs', () => {
  it('extracts workflow name + --input k=v pairs', () => {
    const r = parseInputArgs(['review-and-fix', '--input', 'path=src/a.ts', '--input', 'mode=strict']);
    expect(r.name).toBe('review-and-fix');
    expect(r.inputs).toEqual({ path: 'src/a.ts', mode: 'strict' });
  });
  it('handles a name with no inputs', () => {
    expect(parseInputArgs(['demo'])).toEqual({ name: 'demo', inputs: {} });
  });
  it('supports key=value with = in the value', () => {
    expect(parseInputArgs(['w', '--input', 'q=a=b']).inputs).toEqual({ q: 'a=b' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/cli-helpers.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3a: Create `src/workflow/cli-helpers.ts`**
```ts
// src/workflow/cli-helpers.ts
/** Pure helpers for the workflow slash commands (kept out of cli.ts so they're unit-testable). */
import { RunnerContext } from './runner';

export function parseInputArgs(args: string[]): { name: string; inputs: Record<string, string> } {
  const name = args[0] ?? '';
  const inputs: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      const eq = args[i + 1].indexOf('=');
      if (eq > 0) inputs[args[i + 1].slice(0, eq)] = args[i + 1].slice(eq + 1);
      i++;
    }
  }
  return { name, inputs };
}

/** Map the CLI's SlashCommandContext to a RunnerContext for the engine/runner. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildRunnerContext(ctx: any): RunnerContext {
  return {
    settings: ctx.settings,
    defaultProviderName: ctx.providerName,
    parentRegistry: ctx.registry,
    mcpClient: ctx.mcpClient,
    memory: ctx.memory,
    skills: ctx.skills,
    tokenTracker: ctx.tokenTracker,
    permissions: ctx.permissionRules,
    sessionAllow: ctx.sessionAllow,
    cwd: ctx.cwd,
  };
}
```

- [ ] **Step 3b: Create `src/workflow/index.ts` (barrel)**
```ts
// src/workflow/index.ts — public surface of the workflow engine
export * from './primitives';
export * from './runner';
export * from './schema';
export * from './loader';
export * from './engine';
export * from './tools';
export * from './runtime';
export * from './goal';
export * from './cli-helpers';
```

- [ ] **Step 3c: Wire `src/cli.ts`** — add imports at top:
```ts
import { loadWorkflows, workflowDirs, runWorkflow, runGoal, registerWorkflowTools, setWorkflowRuntime, parseInputArgs, buildRunnerContext } from './workflow/index';
```
Register the dynamic tools where the registry is built (search for `createDefaultRegistry(` in cli.ts and add right after it): `registerWorkflowTools(registry);`
Set the runtime before the main interactive `runAgent` call (search for the `await runAgent(` invocation in the chat loop; immediately before it add): `setWorkflowRuntime(buildRunnerContext(makeSlashCtx()));`
Add these cases to the `handleSlashCommand` switch (before `default:`):
```ts
    case 'workflows': {
      const map = loadWorkflows(workflowDirs(ctx.cwd));
      if (map.size === 0) { printInfo('No workflows found. Add YAML files to .coderaw/workflows/.'); break; }
      printSectionHeader('🧩 Available Workflows');
      for (const [name, def] of map) console.log(`  ${chalk.bold(name.padEnd(20))} ${chalk.dim(def.description ?? `${def.steps.length} steps`)}`);
      break;
    }
    case 'workflow': {
      const { name, inputs } = parseInputArgs(args);
      if (!name) { printError('Usage: /workflow <name> [--input k=v ...]'); break; }
      const def = loadWorkflows(workflowDirs(ctx.cwd)).get(name);
      if (!def) { printError(`Workflow not found: ${name}. Try /workflows.`); break; }
      printInfo(`Running workflow: ${name}`);
      const run = await runWorkflow(def, inputs, buildRunnerContext(ctx));
      for (const s of run.steps) console.log(`  ${s.ok ? chalk.green('✓') : chalk.red('✗')} ${chalk.bold(s.id)}${s.error ? chalk.red(` — ${s.error}`) : ''}`);
      console.log(`\n${run.ok ? chalk.green('Workflow complete.') : chalk.yellow('Workflow finished with failures.')} ${chalk.dim(`(${run.usage.total_tokens} tokens)`)}`);
      const last = run.steps[run.steps.length - 1];
      if (last?.output) { printSectionHeader(`Output: ${last.id}`); console.log(last.output); }
      break;
    }
    case 'goal': {
      const goalText = args.join(' ').trim();
      if (!goalText) { printError('Usage: /goal "<what you want accomplished>"'); break; }
      // Pre-authorized allow-list confirmation (the permissions design: user owns the rules).
      const detected = (() => { try { return require('fs').existsSync(require('path').join(ctx.cwd, 'package.json')); } catch { return false; } })();
      const allowList = ['run_command', 'read_file', 'write_file', 'edit_file', 'search_files', 'list_files'];
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const inq = require('inquirer') as any;
      console.log(`\n  ${chalk.bold('Goal:')} ${goalText}`);
      console.log(`  ${chalk.bold('Pre-authorized tools for this run:')} ${allowList.join(', ')}`);
      console.log(`  ${chalk.bold('Verification:')} ${detected ? 'npm test (auto-detected)' : 'auto-detect / none'}`);
      const { go } = await inq.prompt([{ type: 'confirm', name: 'go', message: 'Run this autonomous goal with the above permissions?', default: false }]);
      if (!go) { printInfo('Cancelled.'); break; }
      const res = await runGoal({ goal: goalText, allow: allowList }, buildRunnerContext(ctx));
      console.log(`\n  ${res.ok ? chalk.green('✓ ' + res.summary) : chalk.yellow('• ' + res.summary)} ${chalk.dim(`(${res.usage.total_tokens} tokens, stopped: ${res.stoppedBy})`)}`);
      break;
    }
```
Add to `printHelp()` (the help text block): `/workflow <name>`, `/workflows`, `/goal "<text>"` lines.

- [ ] **Step 4: Run helper test + full suite**

Run: `npx vitest run src/workflow/cli-helpers.test.ts` → PASS (3 tests).
Run: `npm test` → all workflow + existing suites green.

- [ ] **Step 5: Commit**
```bash
git add src/workflow/index.ts src/workflow/cli-helpers.ts src/workflow/cli-helpers.test.ts src/cli.ts
git commit -m "feat(workflow): wire /workflow, /workflows, /goal slash commands + barrel"
```

---

### Task 13: Build, full test, example workflow, live smoke test

**Files:**
- Create: `src/skills/builtins/../` not needed; Create example: `.coderaw/workflows/review-and-fix.yaml` (project-local example, committed)
- Modify: `dist/` (rebuilt — committed per repo convention)

- [ ] **Step 1: Typecheck + build**

Run: `npm run build`
Expected: `tsc` exits 0 (no type errors); `dist/` regenerated. If `tsc` flags the lazy `require` in `tools.ts`, confirm the `as typeof import(...)` cast is present.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all green — previous 131 + new workflow tests (~30). Note the total in the commit message.

- [ ] **Step 3: Add a committed example workflow**
```yaml
# .coderaw/workflows/review-and-fix.yaml
name: review-and-fix
description: Review a file, then apply the suggested fixes.
inputs: [path]
steps:
  - id: find
    type: agent
    role: reviewer
    task: "Review the file {{path}} and list concrete, specific issues to fix. Be precise."
  - id: fix
    type: agent
    role: coder
    task: "Apply these fixes to {{path}}. Make the minimal change for each:\n{{steps.find.output}}"
    depends_on: [find]
```

- [ ] **Step 4: Live smoke test (manual, Ollama must be running)**

Run (a non-interactive engine smoke via a tiny script, then delete it):
```bash
node -e "(async()=>{const {runWorkflow,loadWorkflows,workflowDirs}=require('./dist/workflow/index');const {loadSettings}=require('./dist/config/settings');const {createDefaultRegistry}=require('./dist/registry/index');const {registerWorkflowTools}=require('./dist/workflow/index');const s=loadSettings();const reg=createDefaultRegistry();registerWorkflowTools(reg);const def=loadWorkflows(workflowDirs(process.cwd())).get('review-and-fix');const run=await runWorkflow(def,{path:'package.json'},{settings:s,defaultProviderName:s.defaultProvider,parentRegistry:reg,cwd:process.cwd(),permissions:s.permissions});console.log('OK?',run.ok,'steps',run.steps.map(x=>x.id+':'+x.ok));})().catch(e=>{console.error(e);process.exit(1)});"
```
Expected: prints `OK? true steps [ 'find:true', 'fix:true' ]` (or at minimum `find:true`), proving the engine drives the local model end-to-end. (Interactive `/goal` / `/workflow` can also be tried in a real `coderaw` session.)

- [ ] **Step 5: Commit + tag**
```bash
git add .coderaw/workflows/review-and-fix.yaml dist
git commit -m "build(workflow): rebuild dist + example workflow; engine smoke-tested vs Qwen-7B

Sub-project #3 complete: sub-agent runner, parallel/pipeline primitives, YAML DAG
engine, dynamic spawn tools, autonomous goal loop with sound external verification.
NN tests green."
git tag p3-workflow-engine
```
(Do NOT merge to main or push yet — present results to the user first per the finishing-a-development-branch flow.)

---

## Self-Review

**1. Spec coverage:**
- §4 Layer 0 runner → Tasks 3-4 ✓ · Layer 1 primitives → Tasks 1-2 ✓ · Layer 2 schema/loader/engine → Tasks 5-7 ✓ · Layer 3a dynamic tools → Task 9 ✓ · Layer 3b goal → Task 10 ✓
- §5 config → Task 11 ✓ · §6 surfaces (`/workflow`,`/workflows`,`/goal`, spawn tools) → Tasks 9, 12 ✓
- §7 error handling → null-on-throw (T1-2), runner ok:false (T3), cycle/dep/placeholder (T5, T7), goal caps (T10) ✓
- §8 testing → each task is TDD; live smoke → Task 13 ✓
- §11 R1 external verifier → Task 10 ✓ · R3 ollama=1 → Tasks 7, 11 ✓ · R5 minimal tools/self-contained → Tasks 3, 8 (orchestrator prompt) ✓ · R6 guardrail+retry → Task 4 ✓ · R7 difficulty-gated re-plan → Task 10 (re-plan only after verify fail) ✓
- §9 build order → Tasks ordered primitives→runner→schema→loader→engine→roles→tools→goal→settings→cli→build ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. The only intentional deferrals are documented spec open-questions (NUM_PARALLEL ceiling tuning) handled by a conservative default, not left as code placeholders.

**3. Type consistency:** `SubAgentSpec`/`SubAgentResult`/`RunnerContext` defined in Task 3, consumed unchanged in Tasks 4, 7, 9, 10, 12. `WorkflowDef`/`WorkflowStep`/`topoOrder` defined Task 5, consumed Tasks 6, 7. `runSubAgent(spec, ctx)` signature stable across engine/goal/tools dependency-injection points. `ToolResult {content, isError?}` matches existing `executeTool`. `setWorkflowRuntime(ctx)` (Task 9) ↔ `buildRunnerContext`→`setWorkflowRuntime` (Task 12) consistent. `GoalOptions.allow` ↔ goal allow-list wiring consistent.
