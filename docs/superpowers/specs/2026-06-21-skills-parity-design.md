# Skills Parity — Design Spec

**Date:** 2026-06-21
**Sub-project:** #4, slice 3 of 6 — first-class skills (Skill tool + `/skill` + NL router activation + progressive disclosure + bundled resources)
**Status:** Approved design (brainstorming complete; 3 forks resolved with the user).

> #4 order: 4a web-tools ✅ · 4b research ✅ (p4a) · matcher+router ✅ (p4b) → **THIS (skills parity)** → hooks → graphify. RAG/memory adopt the matcher in a fast-follow.

---

## 1. Purpose

Make skills **first-class and invocable**, at parity with Claude Code, while staying reliable on a local 7B:
- The model can **deliberately invoke** a skill via a `Skill` tool (loads its full body on demand).
- The user can activate one explicitly with **`/skill <name>`**.
- Plain text **routes** to a skill through the NL router (slice 2) and actually **activates** it.
- **Progressive disclosure**: the system prompt advertises only `name: description`; bodies load only on activation.
- **Bundled resources**: a skill folder may carry extra files the body references and the agent reads on demand.

## 2. Decisions locked (brainstorming)

- **Disclosure model:** `Skill` tool + advertise-all catalog. Bodies load on explicit activation (tool / `/skill` / router); a thin matcher-based auto-detect stays as a safety-net fallback (top-1).
- **Bundled resources:** convention only — the SKILL.md body references sibling files (`references/`, `scripts/`, …); the agent reads them with the existing gated `read_file`. No manifest, no loader tool (YAGNI).
- **Match backend:** adopt the slice-2 hybrid matcher (`src/match/`) for skill detection, replacing keyword `includes`. Auto-detect runs **BM25-only** (no per-message embedding call → stays fast); router/`/skill` resolve by name.
- **Conservative:** activation never errors the turn; unknown skill name → helpful message; matcher failure → keyword fallback.

## 3. Existing seams (verified)

| Need | Existing | File:line |
|---|---|---|
| Skills load/parse (name/description/body, builtin→project→user) | `SkillsManager.loadAll()`, `list()`, `get(name)`, `enable/disable`, `createSkill()` | `src/skills/index.ts` |
| Keyword auto-detect (to replace) | `detectRelevant(msg)` (keyword `includes`, top-2) + `getSkillContext(msg)` (injects bodies) | `src/skills/index.ts:129,157` |
| Skill injection point (per message) | `const skillCtx = skills.getSkillContext(userMessage)` → system message | `src/agent/core.ts:151` |
| Hybrid matcher | `hybridSearch(query, docs, opts?)`; `MatchDoc={id,text}`; BM25-only when no `embed` | `src/match/hybrid.ts` |
| Built-in tools + dispatcher | `TOOLS: Tool[]`; `executeTool(name,args,cwd,…)` switch; cross-module tools reached via require + a runtime holder (`spawn_agent`) | `src/agent/tools.ts:36,318,331` |
| Runtime-holder pattern to mirror | `setWorkflowRuntime/getWorkflowRuntime/clearWorkflowRuntime` (module singleton) | `src/workflow/runtime.ts` |
| Permission classification | `KNOWN_SAFE` set (read-only/in-project safe-silent) | `src/permissions/classify.ts` |
| System-prompt builder (block object) | `buildSystem()` composes blocks incl. `personaContext: persona.buildSystemBlock()` | `src/cli.ts:125-137` |
| Router skill route (to activate) | router returns `{kind:'skill', target}` → cli.ts currently falls through to passive detection | `src/cli.ts` router block (~258) |
| `/skills` (plural) command | list / info / add | `src/cli.ts:494` |
| Skills help | `/skills` lines | `src/ui/terminal.ts:139-141` |

## 4. Modules

### A. `SkillsManager` (`src/skills/index.ts`)

Add / change:
```ts
/** One compact line per enabled skill for the system-prompt catalog. '' if none. */
getCatalog(): string;
// → "## Available Skills\nLoad full instructions with the `skill` tool or /skill <name>:\n- github — GitHub ops via gh CLI…\n- npm — …\n"

/** Look up + mark active; returns the skill (body included) or undefined. */
activate(name: string): Skill | undefined;

/** Matcher-based relevance (BM25-only over name+description). Async; never throws. */
detectRelevantHybrid(userMessage: string, deps?: { hybrid?: typeof import('../match/hybrid').hybridSearch }): Promise<Skill[]>;
// top-1; on matcher error → fall back to the existing keyword detectRelevant.

/** Async skill context for injection (top-1 body). '' when nothing relevant. */
getSkillContextAsync(userMessage: string): Promise<string>;
```
- `detectRelevantHybrid` builds `docs = enabled skills → {id:name, text:`${name} ${description}`}`, calls `hybridSearch(msg, docs, {topK:1})` (no `embed` → BM25-only), and maps the top hit back to its `Skill`. **Relevance gate = hit existence:** `hybridSearch` returns `[]` when no doc has a positive BM25 score, so a returned hit already means genuine keyword overlap (do NOT threshold on the returned score — it is RRF-normalized to 1.0 at the top, per the slice-2 design note). Disabled skills excluded.
- Keep the existing sync `detectRelevant`/`getSkillContext` (keyword) as the internal fallback; do not delete (other callers + the error path use them).
- `getCatalog` advertises **all enabled** skills (name + description only — never bodies).

### B. `Skill` tool (`src/agent/tools.ts`)

Add to `TOOLS`:
```ts
{
  name: 'skill',
  description: "Load the full instructions for a named skill from the Available Skills list. Call this when a listed skill is relevant before doing the task.",
  parameters: { type: 'object', properties: { name: { type: 'string', description: 'The skill name from the Available Skills list' } }, required: ['name'] },
}
```
Dispatcher case:
```ts
case 'skill': return loadSkill(args as { name: string });
```
`loadSkill({name})`:
- Resolve the `SkillsManager` via `getSkillsRuntime()` (Module C). If absent → `{content:'Skills are not available in this context.', isError:true}`.
- `const s = mgr.activate(name)`. Found → `{content: s.body}` (the body becomes a tool result the model now "has"). Not found → `{content:`Unknown skill "${name}". Available: ${mgr.list().map(x=>x.name).join(', ')}`, isError:true}`.

### C. `src/skills/runtime.ts` (new — mirrors `workflow/runtime.ts`)
```ts
import { SkillsManager } from './index';
let current: SkillsManager | null = null;
export function setSkillsRuntime(m: SkillsManager): void { current = m; }
export function getSkillsRuntime(): SkillsManager | null { return current; }
export function clearSkillsRuntime(): void { current = null; }
```
Set once at CLI startup (after `skills.loadAll()`), so the `skill` tool reaches the manager with no `core.ts`/`executeTool` signature change. (bot/server may set it too; if unset, the tool degrades gracefully.)

### D. Permissions (`src/permissions/classify.ts`)
Add `'skill'` to `KNOWN_SAFE` — read-only, in-project, safe-silent (loads local skill text; runs nothing). Deny rules still override.

### E. CLI wiring (`src/cli.ts`)
1. **Catalog in the system prompt:** add a `skillsCatalog: skills.getCatalog()` block to the `buildSystem()` block object and concatenate it (alongside `personaContext`). Rebuilt on `/skills add` and persona/system updates via the existing `onSystemUpdate`.
2. **Runtime holder:** after `skills.loadAll()` (~line 100), call `setSkillsRuntime(skills)`.
3. **Async auto-detect:** the per-message injection in `core.ts:151` becomes `await skills.getSkillContextAsync(userMessage)` (Module F).
4. **`/skill <name>` command** (new `case 'skill'` in `handleSlashCommand`, beside `/skills`):
   - `const r = activateSkill(ctx.skills, name, ctx.conversation)`; print `r.message`. No-arg → usage hint pointing at `/skills`.
5. **Router skill-route activation:** in the router intercept, when `decision.kind === 'skill' && decision.target`: print `→ activating skill <target>`, inject the matched skill body into the conversation (same path as `activateSkill`), then **fall through** to `runAgent` (NOT `continue`) so the agent runs with the skill active. Unknown/missing skill → fall through to plain chat.

Pure, testable helper:
```ts
// activates by injecting the skill body as a system message; returns a status + message
export function activateSkill(skills: SkillsManager, name: string, conversation: Conversation):
  { ok: boolean; message: string };
// ok=false + "Unknown skill …" when not found; ok=true + "Activated skill: <name>" otherwise.
// Injects `[Active Skill: <name>]\n<body>` as a system message when found.
```

### F. `core.ts` async detect
Change the injection block (`core.ts:149-162`) to `const skillCtx = await skills.getSkillContextAsync(userMessage);` (the function is already `async`). Same dedupe/inject logic otherwise.

### G. Bundled resources (convention + template)
- No code path beyond docs. A skill folder may contain `references/`, `scripts/`, assets; the SKILL.md body references them by **relative path**; the agent reads them on demand with `read_file` (already gated). Document in the spec + a builtin example.
- `createSkill` template (`skillTemplate`) gains a commented `## Resources` section showing the convention (e.g. “See `references/example.md` (read it with read_file when needed)”).

## 5. Config + surface

- No new `settings` block required. (Auto-detect on/off can ride existing behavior; a `settings.skills.autoDetect?` toggle is **out of scope** unless trivial.)
- Slash commands: `/skill <name>` (activate). `/skills` (list/info/add) unchanged. Help line for `/skill` in `terminal.ts`.
- The `skill` tool is always registered (built-in). Bodies never enter context until loaded.

## 6. Error handling

- `loadSkill` unknown name / no runtime → `isError` tool result with the available list (never throws).
- `activateSkill` unknown name → `{ok:false}` + message; no conversation mutation.
- `detectRelevantHybrid` / `getSkillContextAsync` → matcher error caught → keyword fallback → `''` if nothing.
- Router skill route with a vanished skill → fall through to chat.
- `getCatalog()` with zero skills → `''` (no catalog block).

## 7. Testing (vitest TDD)

- **SkillsManager.getCatalog** — lists name+description for enabled skills; excludes disabled; bodies absent; `''` when empty.
- **SkillsManager.activate** — returns the skill for a known name (and the body); `undefined` for unknown.
- **detectRelevantHybrid** (injected `hybrid` stub + sample skills) — returns the top-matched skill; matcher throw → keyword fallback; async.
- **getSkillContextAsync** — injects the top-1 body; `''` when nothing relevant.
- **loadSkill** (Skill tool) — with a `setSkillsRuntime` manager: known name → `{content: body}`; unknown → `isError` + available list; no runtime → graceful `isError`.
- **permissions** — `classify('skill', …)` is safe-silent; a `deny` rule still blocks.
- **activateSkill** (pure) — known → `ok:true` + "Activated skill" + injects `[Active Skill: …]`; unknown → `ok:false`, no mutation.
- **Live smoke** — `/skill github` activates; the model calls the `skill` tool when a listed skill fits; `use the X skill` routes+activates via the router; catalog appears in the system prompt; a skill body referencing `references/…` gets read on demand.

## 8. Build order (for the plan)

1. `SkillsManager.getCatalog()` + `activate()` (+tests). 2. `detectRelevantHybrid()` + `getSkillContextAsync()` adopting the matcher, keyword fallback (+tests). 3. `src/skills/runtime.ts` holder (+test). 4. `skill` tool def + `loadSkill()` dispatcher (+tests). 5. permissions `KNOWN_SAFE += 'skill'` (+test). 6. `activateSkill()` pure helper (+test). 7. cli.ts wiring — `setSkillsRuntime`, catalog in `buildSystem`, `core.ts` await async detect, `/skill` case, router skill-route activation, help (+glue test). 8. build, full vitest, live smoke, rebuild dist, commit, tag `p4c-skills-parity`, merge main, push.

## 9. File layout

`src/skills/index.ts` (getCatalog/activate/detectRelevantHybrid/getSkillContextAsync) · `src/skills/runtime.ts` (new) · `src/agent/tools.ts` (`skill` tool + `loadSkill`) · `src/permissions/classify.ts` (KNOWN_SAFE) · `src/agent/core.ts` (await async detect) · `src/cli.ts` (`setSkillsRuntime`, catalog, `/skill`, router activation, `activateSkill` export) · `src/ui/terminal.ts` (`/skill` help) · builtin skill example + `skillTemplate` resources note. Tests next to each.

## 10. Out of scope (YAGNI / fast-follow)

Resource manifests / a dedicated resource-loader tool; per-message semantic embeddings for auto-detect (BM25-only is enough; the explicit paths cover semantic via the router); a `settings.skills` block; rewiring bot/server skill injection (they run through `core.ts`); skill versioning/marketplaces; converting graphify into a skill (its own later slice). Hooks remain the next separate slice.
