# coderaw Workflow Engine — Design Spec

**Date:** 2026-06-21
**Sub-project:** #3 — coderaw's OWN multi-agent workflow / orchestration engine
**Status:** Approved design (brainstorming complete). Research-informed refinements pending the deep-research report (§11).

---

## 1. Purpose

Give coderaw its own multi-agent orchestration layer so it can do work that exceeds a single agent loop:

- **parallel** — fan out N independent sub-agents and collect their results.
- **pipeline** — feed an item through ordered stages (output of stage N → input of stage N+1).
- **dynamic / self-paced** — an orchestrator agent decides at runtime what sub-agents to spawn.
- **autonomous goal** — accept a high-level goal and pursue it via a plan → execute → verify loop until done or a budget/round cap is hit.

All modes are **local-backed** (Ollama / qwen2.5-coder:7b) or cloud, and every sub-agent's tool calls inherit the existing permission gate by construction.

## 2. Design principles

- **Reuse the seams, don't rewrite.** A sub-agent is just `runAgent()` driven over a fresh `ConversationState` with a custom system prompt and a filtered tool registry. No fork of the core loop.
- **Layered.** Each layer is independently unit-testable; higher layers compose lower ones. Drivers (dynamic, goal) are thin shells over the primitives.
- **Local-hardware honest.** One 8 GB GPU serializes inference; "parallel" defaults to concurrency 1 for Ollama. Cloud providers may go wider.
- **User-controlled, gated.** Sub-agent spawning is consequential and gated. Autonomous goals require a pre-authorized allow-list (per the brainstorming decision).
- **Weak-model resilient.** Small scoped tasks, minimal per-agent tool sets, structured-output validation, and failure isolation so one bad sub-agent can't crash a run. (Reliability detail finalized in §11 from research.)

## 3. Existing seams (verified against the codebase)

| Need | Existing API | File |
|---|---|---|
| Run an agent loop | `runAgent(provider, conversation, userMessage, options): Promise<AgentResult>` | `src/agent/core.ts:123` |
| Custom system prompt | `createConversation(systemPrompt?)` → first `system` message | `src/agent/conversation.ts:15` |
| Tool subsetting | `ToolRegistry` (`register`, `registerMCPTools`, `list`, `getEnabled`, `enable/disable`); `createDefaultRegistry()` | `src/registry/index.ts` |
| Resolve provider/model | `createProvider(name, settings): Provider` (reads `settings.providers[name].model`) | `src/providers/index.ts:67` |
| Agent roles | `AgentRole { id, name, icon, description, systemPrompt, allowedTools? }`; `getRole`, `listRoles`, `BUILTIN_ROLES` | `src/agents/roles.ts` |
| Plan / progress | `PlanItem { content, status }`; `setPlan/getPlan/clearPlan`, `normalizePlanItems`, `planToSteps`, `planSummary` (⚠ module-level singleton) | `src/agent/plan.ts` |
| Permission gate | `gate(toolName, args, gateCtx)` at the core.ts dispatch choke point; `Rules`, `persistAllowPattern` | `src/permissions`, `src/agent/core.ts` |
| Settings | `Settings` (+ `getDefaultSettings`, `loadSettings`, `deepMerge`); config at `%APPDATA%\coderaw\config.yaml` | `src/config/settings.ts` |
| Slash commands | `handleSlashCommand(input, ctx)` switch; `SlashCommandContext` carries `settings/provider/providerName/cwd/registry/mcpClient/permissionRules/sessionAllow/memory/skills/tokenTracker` | `src/cli.ts:327` |
| Progress UI | `printPlanBox(title, steps, summary?)`; `printToolCall/printToolResult/printError/printWarning/printInfo` | `src/ui/terminal.ts` |

**There is no pre-existing workflow / orchestration / sub-agent code** — clean greenfield on these seams.

## 4. Architecture (layers)

```
src/workflow/
  runner.ts        # Layer 0 — runSubAgent: one gated sub-agent run
  primitives.ts    # Layer 1 — parallel(), pipeline(), pLimit()
  schema.ts        # Layer 2 — WorkflowDef types + validateWorkflow()
  loader.ts        # Layer 2 — discover + parse YAML workflow files
  engine.ts        # Layer 2 — runWorkflow(): DAG executor + templating
  tools.ts         # Layer 3a — spawn_agent / run_parallel dynamic tools
  goal.ts          # Layer 3b — runGoal(): plan→execute→verify loop
  index.ts         # public surface
  *.test.ts        # co-located vitest specs
```

### Layer 0 — Sub-agent runner (`runner.ts`)

```ts
export interface SubAgentSpec {
  task: string;               // SELF-CONTAINED instruction (sub-agent has isolated context — pass ALL needed context here)
  role?: string;              // BUILTIN_ROLES id → systemPrompt + allowedTools
  systemPrompt?: string;      // overrides role's prompt
  tools?: string[];           // overrides role's allowedTools (subset of parent) — keep MINIMAL (weak-model tool-overload)
  maxIterations?: number;     // default 6
  provider?: string;          // default = parent providerName
  model?: string;             // overrides settings.providers[provider].model (⚠ avoid for ollama — see §11 single-model rule)
  validate?: (content: string) => { ok: boolean; feedback?: string };  // PROGRAMMATIC guardrail (NOT an LLM judge)
  maxRetries?: number;        // re-prompt with guardrail feedback on failure; default 2
}

export interface SubAgentResult {
  ok: boolean;
  content: string;            // final assistant text (or error message if !ok)
  role?: string;
  task: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: string;
}

export interface RunnerContext {
  settings: Settings;
  parentRegistry: ToolRegistry;     // source of tool definitions (incl. MCP)
  mcpClient?: MCPClient;
  memory?: MemoryManager;
  skills?: SkillsManager;
  tokenTracker?: TokenTracker;
  permissions?: Rules;
  unattended?: boolean;
  sessionAllow?: Set<string>;
  cwd: string;
}

export async function runSubAgent(spec: SubAgentSpec, ctx: RunnerContext): Promise<SubAgentResult>;
```

Behavior:
1. Resolve role via `getRole(spec.role)`; `systemPrompt`/`tools` from spec override the role's.
2. Build a **scoped registry**: a fresh `ToolRegistry`; register only the allowed tools, pulled from `ctx.parentRegistry.list()` (so it inherits built-in + MCP tool defs). If no allow-list resolves, reuse the parent's enabled set.
3. Resolve provider via `createProvider(provider, settingsForSpec)` where `settingsForSpec` is a shallow clone with `providers[provider].model = spec.model` when `model` is set.
4. `const conv = createConversation(systemPrompt)`.
5. `await runAgent(provider, conv, spec.task, { cwd, stream: false, maxIterations, registry: scoped, mcpClient, memory, skills, tokenTracker, permissions, unattended, sessionAllow })`. Returns the **final assistant text only** (summary-only return — intermediate tool noise stays in the sub-agent's own conversation, per the Claude Code isolation model).
6. **Guardrail + bounded retry** (CrewAI pattern): if `spec.validate` is provided and returns `{ ok: false, feedback }`, re-prompt the same sub-agent with the feedback appended to its task, up to `maxRetries` times. The guardrail is a **plain function**, never an LLM judge (LLM self-validation is unsound — §11).
7. Wrap in try/catch → on throw return `{ ok: false, content: msg, error: msg }`. Never throws.

Gating: because the call goes through `runAgent`, every tool the sub-agent invokes passes the same `gate()` choke point — no separate permission path.

### Layer 1 — Primitives (`primitives.ts`) — pure, no LLM

```ts
export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T>;

export async function parallel<T>(
  thunks: Array<() => Promise<T>>,
  opts?: { concurrency?: number },
): Promise<Array<T | null>>;   // throwing thunk → null slot; never rejects the batch

export async function pipeline<T>(
  items: T[],
  ...stages: Array<(prev: any, item: T, index: number) => Promise<any>>
): Promise<Array<any | null>>; // each item flows all stages independently; throwing stage → null
```

- `parallel` runs thunks through a bounded queue (`pLimit`). Concurrency defaults from config: **ollama = 1**, others = 4.
- `pipeline` mirrors Claude-Code Workflow semantics: no barrier between stages — item A can be in stage 3 while item B is in stage 1. A stage throwing drops that item to `null` and skips its remaining stages.
- Fully testable with fake async thunks (assert concurrency cap respected, null-on-throw, pipeline independence/ordering). No provider needed.

### Layer 2 — Static workflow engine (`schema.ts`, `loader.ts`, `engine.ts`)

YAML workflow files in `~/.coderaw/workflows/<name>.yaml` and project `./.coderaw/workflows/<name>.yaml` (project wins), discovered like skills.

```yaml
name: review-and-fix
description: Review a file then apply the fixes.
inputs: [path]
steps:
  - id: find
    type: agent            # agent | parallel | pipeline
    role: reviewer
    task: "Review {{path}} and list concrete findings."
  - id: fix
    type: agent
    role: coder
    task: "Apply these fixes to {{path}}:\n{{steps.find.output}}"
    depends_on: [find]
```

```ts
export interface WorkflowStep {
  id: string;
  type: 'agent' | 'parallel' | 'pipeline';
  role?: string;
  task?: string;                       // for type:agent
  branches?: WorkflowStep[];           // for type:parallel
  stages?: WorkflowStep[];             // for type:pipeline
  depends_on?: string[];
  tools?: string[];
  provider?: string;
  model?: string;
  maxIterations?: number;
}
export interface WorkflowDef {
  name: string;
  description?: string;
  inputs?: string[];
  steps: WorkflowStep[];
}
export interface WorkflowRun {
  ok: boolean;
  outputs: Record<string, string>;     // stepId → output text
  steps: Array<{ id: string; ok: boolean; output: string; error?: string }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export function validateWorkflow(def: unknown): { ok: true; def: WorkflowDef } | { ok: false; errors: string[] };
export async function runWorkflow(def: WorkflowDef, inputs: Record<string,string>, ctx: RunnerContext): Promise<WorkflowRun>;
```

Engine behavior:
1. **Validate on load** — schema shape, unique step ids, every `depends_on` references a known id, no dependency cycles (topological sort; error before any agent runs).
2. **Templating** — substitute `{{inputName}}` (from `inputs`) and `{{steps.<id>.output}}` (from completed step outputs) in each `task` string. Unknown placeholder → validation error.
3. **Execution** — topo-order; steps with satisfied dependencies and no mutual dependency run together via `parallel()`. `type:agent` → one `runSubAgent`. `type:parallel` → its `branches` via `parallel()`. `type:pipeline` → its `stages` via `pipeline()`.
4. **Failure isolation** — a failed step is recorded (`ok:false`) and its dependents are skipped (output empty + flagged); the run continues for independent branches; `WorkflowRun.ok` is the AND of required steps.

Invoked by `/workflow <name> [--input k=v ...]`; `/workflows` lists discovered defs.

### Layer 3a — Dynamic orchestration tools (`tools.ts`)

Two tools registered into the **main** agent's registry (category `custom`) so the model self-paces decomposition:

- `spawn_agent({ role, task, tools? })` → runs one `runSubAgent`, returns its `content`.
- `run_parallel({ tasks: [{ role, task }] })` → fans out via `parallel()`, returns a joined/structured result.

A new built-in role **`orchestrator`** (added to `roles.ts`) instructs the model how/when to delegate. These tools are classified **consequential** (confirm-on by default) since they spend tokens and act; covered by the existing classifier's "not known-safe ⇒ consequential" rule.

### Layer 3b — Autonomous goal driver (`goal.ts`)

```ts
export interface GoalOptions {
  goal: string;
  allow: string[];            // PRE-AUTHORIZED tool/pattern grants for this goal only
  verifyCommand?: string;     // SOUND external verifier (e.g. "npm test", "tsc --noEmit"); auto-detected if omitted
  maxRounds?: number;         // default settings.workflows.goal.maxRounds ?? 5
  budgetUsd?: number;         // default settings.workflows.goal.budgetUsd ?? settings.budget
}
export interface GoalResult {
  ok: boolean; rounds: number; plan: PlanItem[];
  summary: string; usage: {...}; stoppedBy: 'verified' | 'maxRounds' | 'budget' | 'error';
}
export async function runGoal(opts: GoalOptions, ctx: RunnerContext): Promise<GoalResult>;
```

Loop:
1. **Plan** — a `planner`-role sub-agent decomposes the goal into a local `PlanItem[]` (own array instance; mirrored into the global plan via `setPlan` only for `printPlanBox` display to dodge the singleton-collision risk under nesting).
2. **Execute** — run plan items via `runSubAgent` (sequential by default; parallel only for explicitly independent items). Update item status live; redraw the plan box.
3. **Verify (SOUND EXTERNAL — not LLM-as-judge).** Run `verifyCommand` (auto-detected from the project: test script / `tsc --noEmit` / lint / build) via the gated `run_command` tool and read its **exit code** as the binary pass/fail signal. This is the single most important correctness lever: LLM self-verification causes measured performance *collapse*, whereas a sound external verifier + re-prompt produces gains (§11). On **fail**, append the verifier output (binary signal is enough — detailed critique adds little) to the re-plan prompt and loop. Only when **no sound external check exists** for a criterion does the loop fall back to a separate `verifier`-role sub-agent, explicitly flagged as low-confidence and never judging its own generator's output in the same round.
4. **Stop** when the external verifier passes, or `maxRounds` reached, or accumulated usage exceeds `budgetUsd` — return a partial-result summary + `stoppedBy` either way. (Premature termination and no/incomplete verification are the top empirical failure modes — §11 — so the loop never declares "done" without a passing external check or an explicit cap hit.)

**Permissions:** `runGoal` receives `allow: string[]`; these are layered into the `Rules`/`sessionAllow` the gate consults for the goal's duration. Anything outside the allow-list still blocks (interactive) or denies (unattended). `/goal "<text>"` first prints the proposed plan + the exact allow-list it needs and asks the user to confirm before the loop runs.

## 5. Config (`settings.workflows`)

Extend `Settings` with an optional block (defaults applied in `getDefaultSettings`):

```ts
workflows?: {
  concurrency?: { ollama?: number; default?: number };   // {ollama:1, default:4}
  defaultRole?: string;                                   // fallback role for step with none
  goal?: { maxRounds?: number; budgetUsd?: number };      // {maxRounds:5}
};
```

## 6. Surfaces / UX

- `/workflow <name> [--input k=v]` — run a saved YAML workflow.
- `/workflows` — list discovered workflows (builtin + user + project).
- `/goal "<text>"` — autonomous goal: show plan + needed allow-list → confirm → run.
- `spawn_agent` / `run_parallel` tools — available to the agent for dynamic mode.
- Live progress: `printPlanBox` for goal/workflow step status; per-step start/finish + usage via `printInfo`/`printToolResult`.

## 7. Error handling

- Sub-agent error → captured `SubAgentResult.ok=false`; never crashes the orchestrator.
- `parallel`/`pipeline` → null-on-throw; batch never rejects.
- Engine → cycle / unknown-dependency / unknown-placeholder caught at validate time with a clear message before any agent runs.
- Goal loop → hard stop on `maxRounds` / `budgetUsd`; returns partial summary + `stoppedBy`.

## 8. Testing strategy (vitest TDD)

- **primitives.test.ts** — `pLimit` concurrency cap; `parallel` null-on-throw + order; `pipeline` per-item independence + stage-throw isolation. Pure, fake thunks.
- **runner.test.ts** — fake `Provider` (stub `complete`): role→systemPrompt resolution, tool subsetting (scoped registry contains only allowed), model/provider override, maxIterations passthrough, throw→`ok:false`, gate context passed through, **guardrail+retry** (failing `validate` re-prompts with feedback up to `maxRetries`, then returns the last attempt; passing `validate` returns immediately), summary-only return.
- **schema.test.ts / loader.test.ts** — validate good/bad defs; cycle + unknown-dep + unknown-placeholder errors; YAML discovery precedence (project > user).
- **engine.test.ts** — injected fake runner: topo order, parallel grouping of independent steps, `{{}}` templating, failure isolation (dependent skipped, independent continues).
- **goal.test.ts** — fake planner provider + **stubbed external verifier** (inject a `verify(): Promise<{passed, output}>` whose result we control via the mocked `run_command` exit code): plan→execute→verify→re-plan loop driven by the *external* signal (not an LLM judge); re-plan fires only after a verify *failure* (R7); stop on external-pass / maxRounds / budget; `stoppedBy` correct; allow-list wired into the gate.
- **Live smoke test** (manual, end of build) — a tiny 2-step YAML workflow run against Qwen-7B, plus a trivial `/goal`, as in prior sub-projects.

## 9. Build order (for the implementation plan)

1. `primitives.ts` (+ tests) — no deps.
2. `runner.ts` (+ tests) — depends on primitives types only.
3. `schema.ts` + `loader.ts` (+ tests).
4. `engine.ts` (+ tests) — depends on runner + primitives + schema.
5. `roles.ts` additions: `orchestrator`, `verifier`.
6. `tools.ts` (+ tests) — dynamic spawn tools; register into default registry.
7. `goal.ts` (+ tests).
8. `settings.ts` — add `workflows` block + defaults.
9. `cli.ts` — wire `/workflow`, `/workflows`, `/goal`; help text.
10. Build (exclude `*.test.ts`), full vitest run, live smoke test.

## 10. Out of scope (YAGNI for this build)

- JS-script workflow harness (rejected — needs a sandboxed evaluator; a 7B can't author it).
- Distributed / multi-machine orchestration.
- Persisting workflow run history to disk (beyond in-memory `WorkflowRun`).
- A web/TUI dashboard for live runs (the plan box suffices).

## 11. Research-informed refinements (applied)

Deep-research report `wf_14ffc82b-a3c` (6 angles, 29 sources, 23/25 claims verified). The findings below are folded into the design above; the interface changes they drove are marked inline (Layer 0 `validate`/`maxRetries`, Layer 3b external verifier, `verifyCommand`).

**R1 — Verification must be a SOUND EXTERNAL checker, never the generating LLM (highest-impact change).** GPT-4 self-critiquing its own answers caused *performance collapse* across multiple reasoning domains; a sound external verifier produced gains, and the effect is *more* severe for weak models. → The goal loop's verify stage runs real checks (test runner / `tsc` / linter / build) via gated `run_command` and uses the exit code as a binary pass/fail; LLM judgment is a flagged last-resort only where no sound check exists. The *content* of a critique barely matters — binary pass/fail + re-prompt retains most of the benefit. (arxiv 2402.08115; snorkel.ai self-critique-paradox)

**R2 — "No/Incomplete Verification" and "Premature Termination" are top empirical MAS failure modes** (task-verification = a distinct failure cluster; ~44% of verification failures are missing/incomplete checks; analysis of 150 traces, κ=0.88). → The loop never declares done without a passing external check or an explicit `maxRounds`/budget stop; `stoppedBy` is always reported. (arxiv 2503.13657, "Why Do Multi-Agent LLM Systems Fail?")

**R3 — Single-GPU concurrency is the binding constraint (validates ollama=1 default).** `OLLAMA_NUM_PARALLEL` defaults to **1**; raising it multiplies KV-cache VRAM (RAM scales by `NUM_PARALLEL × CONTEXT_LENGTH`), and on 8 GB two distinct ~7B Q4 models cannot co-reside — different-model sub-agents *serialize* via queue → unload → reload, not parallelize. Even an A100-40 GB topped out at `NUM_PARALLEL=32`, so the 8 GB ceiling is ~1–2. → Treat local "parallel" as a **small bounded request queue** (`concurrency.ollama=1`), and **prefer a single shared model** for all local sub-agents (avoid per-spec `model` overrides on ollama — they thrash). Cloud providers may use higher concurrency / per-agent models. (docs.ollama.com/faq; Red Hat ollama-vs-vllm benchmark) — *Refuted and NOT designed around: "Ollama defaults to max 4 parallel" (0-3) and "throughput strictly flat with concurrency" (1-2).*

**R4 — Fan-out is opt-in, not a default win.** Naive multi-agent systems frequently fail to beat a single well-scoped agent under equal token budgets; gains concentrate in weak-model / hard-task regimes. → coderaw defaults to a single well-scoped agent; the engine fans out only for *provably independent* work (static `parallel`/`branches`) or when the orchestrator explicitly judges it worthwhile. The `orchestrator` role prompt encodes this rule. (arxiv 2503.13657; anthropic building-effective-agents)

**R5 — Sub-agent isolation + minimal tool sets + self-contained task.** Each sub-agent gets its own context window, custom system prompt, a *restricted minimal* tool set, and returns **only a summary** (default `last_message`, not full history). Tool overload wrecks weak models (Llama-3.1-8B fails at 46 tools; 107 tools = total failure; trimming 40→13 gained accuracy + cut latency). Because the sub-agent can't see the main conversation, the orchestrator must pack **all needed context into `task`** (LangGraph handoff `task_description` pattern). → Roles keep tight `allowedTools`; `spawn_agent`/`run_parallel` tool descriptions and the `orchestrator` prompt mandate self-contained tasks. (code.claude.com/sub-agents; langgraph-supervisor; openai orchestrating_agents)

**R6 — Programmatic guardrails + bounded retry (CrewAI pattern).** Validate a sub-agent's output with a **function** guardrail `(content) → {ok, feedback}`; on failure send feedback back and retry up to N (CrewAI default 3). → Layer 0 `validate` + `maxRetries` (default 2). Guardrails are functions, never LLM judges (an LLM guardrail reintroduces the unsound self-verification of R1). (docs.crewai.com/concepts/tasks)

**R7 — Difficulty-gate self-critique.** Self-refine loops *degrade* easy/high-confidence tasks (one study: 98%→57% over 5 loops) but *rescue* hard/failing ones. → The goal loop only re-plans/critiques **after a verification failure** (i.e. when the model is demonstrably wrong), never speculatively on passing work. (snorkel.ai; corroborated by TACL 2406.01297, DeepMind 2310.01798)

**Reasoned default values** (no source gave exact numbers — these are defaults, tunable in config): `concurrency.ollama=1`, `concurrency.default=4`, `goal.maxRounds=5`, sub-agent `maxIterations=6`, `maxRetries=2`. Budget cap defaults to `settings.budget`.

**Open questions deferred (not blocking the build):** exact stable `NUM_PARALLEL` ceiling for qwen2.5-coder:7b on this RTX 4060 (we conservatively use 1); precise complexity threshold for single-agent→fan-out (left to the orchestrator's judgment + the user). These are tuning knobs, not architectural unknowns.
