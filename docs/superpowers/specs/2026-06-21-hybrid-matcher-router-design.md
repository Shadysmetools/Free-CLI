# Hybrid Matcher + NL Intent Router — Design Spec

**Date:** 2026-06-21
**Sub-project:** #4, slice 2 of 6 — hybrid retrieval matcher (BM25 + semantic) + natural-language intent router
**Status:** Approved design (brainstorming complete).

> #4 order: 4a web-tools ✅ · 4b research ✅ (tag p4a) → **THIS (matcher+router)** → skills parity → hooks → graphify. RAG/memory adopt the matcher in a fast-follow; sqlite-vec persistence reserved for that.

---

## 1. Purpose

(1) A reusable **hybrid matcher** — true Okapi **BM25** keyword ranking fused (RRF) with **semantic** embeddings — and (2) a **natural-language intent router** on top, so plain text routes to research / goal / workflow / skill / chat **without needing `/`**. User intent: "I don't need to use `/` on every command — it can understand me if I just text," with proper BM25 + semantic + keyword matching under it.

## 2. Decisions locked (brainstorming)

- **Routing policy:** auto-run safe modes (research / skill / read-only workflow) on a confident match; **autonomous GOAL confirms first** (1 line); ambiguous / low-confidence → normal **chat**. Tunable + toggleable.
- **Scope this slice:** matcher + router + skill auto-detection. Leave `ragSearch`/memory on current scorers (adopt matcher in a fast-follow). sqlite-vec persistent store deferred to that follow-up.
- **Classification:** local heuristic + matcher (fast, offline, no per-message LLM cost); optional `llmAssist` 7B tie-breaker, **off by default**.
- **Conservative default:** when unsure → chat. The router must never break normal conversation.

## 3. Existing seams (verified)

| Need | Existing | File |
|---|---|---|
| Keyword retrieval + RRF fusion | `ragSearch(query,cwd,opts?): SearchResult[]`; RRF `1/(60+rank+1)`; keyword-TF **no IDF** | `src/rag/rerank.ts` (ragSearch ~261; RRF ~44; keyword ~86) |
| Skill detection (to improve) | `detectRelevant(msg)` + `getSkillContext(msg)` = keyword `includes` | `src/skills/index.ts:129,157` |
| Workflows list | `loadWorkflows(workflowDirs(cwd)): Map<name,WorkflowDef>` | `src/workflow/loader.ts` |
| Roles | `getRole(id)`, `listRoles()` | `src/agents/roles.ts` |
| Run modes | `runResearch(opts,ctx,deps?)`, `runGoal(opts,ctx,deps?)`, `runWorkflow(def,inputs,ctx,deps?)` | `src/research/index.ts`, `src/workflow/{goal,engine}.ts` |
| Build runner ctx | `buildRunnerContext(slashCtx)` | `src/workflow/cli-helpers.ts` |
| Ollama provider (add embed) | `OllamaProvider(model, baseUrl)`; `httpPost()` pattern (~209) — add `POST /api/embed` | `src/providers/ollama.ts` |
| Ollama base URL / settings | `settings.providers.ollama.baseUrl`; env `OLLAMA_BASE_URL` | `src/config/settings.ts`, `src/providers/index.ts:71` |
| **Router intercept** | non-slash branch AFTER `if (input.startsWith('/'))` (cli.ts ~251) → today goes straight to `runAgent`. `makeSlashCtx()` (~213) carries settings/conversation/provider/providerName/cwd/mcpClient/memory/skills/tokenTracker/registry/permissionRules/sessionAllow | `src/cli.ts:251,213` |
| sqlite-vec / better-sqlite3 | deps present, **UNUSED** | package.json |

## 4. Module A — `src/match/` (hybrid matcher)

### `bm25.ts` — pure Okapi BM25 (no deps)
```ts
export interface Scored { id: string; score: number }
export class BM25 {
  constructor(opts?: { k1?: number; b?: number });   // defaults k1=1.5, b=0.75
  add(id: string, text: string): void;               // tokenize + accumulate df/length
  search(query: string, topK?: number): Scored[];    // IDF * TF-saturation * length-norm, sorted desc
}
export function tokenize(text: string): string[];     // lowercase, split /[^a-z0-9]+/, drop very short + stopwords
```
True BM25: `idf = ln((N - df + 0.5)/(df + 0.5) + 1)`; `score += idf * (f*(k1+1)) / (f + k1*(1 - b + b*len/avglen))`. Replaces the no-IDF keyword scorer conceptually (this slice does not rewire ragSearch).

### `embeddings.ts` — semantic via Ollama
```ts
export interface EmbedOpts { baseUrl: string; model: string; httpPost?: (url:string, body:unknown) => Promise<unknown> }
export async function embed(texts: string[], opts: EmbedOpts): Promise<number[][] | null>;  // null on failure → callers degrade to BM25-only
export function cosine(a: number[], b: number[]): number;
```
POST `${baseUrl}/api/embed` `{ model, input: texts }` → `{ embeddings: number[][] }`. `httpPost` injectable for tests. Never throws — returns `null`.

### `hybrid.ts` — fuse BM25 + semantic via RRF
```ts
export interface MatchDoc { id: string; text: string }
export interface HybridOpts { topK?: number; embed?: (texts:string[]) => Promise<number[][]|null>; rrfK?: number }
export async function hybridSearch(query: string, docs: MatchDoc[], opts?: HybridOpts): Promise<Scored[]>;
```
BM25 over `docs`; if `embed` returns vectors, cosine-rank query vs doc vectors; **RRF-fuse** the two ranked lists (`1/(rrfK + rank)`, default rrfK=60), normalize 0–1. `embed` null/absent → BM25-only. In-memory cache (keyed by content hash) avoids re-embedding the same docs within a session. **sqlite-vec persistence is OUT of scope (fast-follow).**

## 5. Module B — `src/router/` (NL intent router)

```ts
export type Intent = 'research' | 'goal' | 'workflow' | 'skill' | 'chat';
export interface RouteDecision { kind: Intent; target?: string; confidence: number; reason: string }
export interface RouterContext {
  skills: Array<{ name: string; description: string }>;
  workflows: Array<{ name: string; description?: string }>;
  threshold: number;                 // settings.router.confidenceThreshold
}
export interface RouterDeps { hybrid?: typeof import('../match/hybrid').hybridSearch }
export async function classifyIntent(text: string, ctx: RouterContext, deps?: RouterDeps): Promise<RouteDecision>;
```

Layered (cheap → expensive), all local:
1. **Chat guard** — empty / very short / ends in `?` with no research verb / looks like a code paste (has `{`,`;`,`=>`, fenced block) → `{kind:'chat'}` early. Never hijack normal usage.
2. **Intent signals** — regex/keyword sets: research (`research|look up|find out|search the web|what'?s the latest|latest on`), goal (`build|implement|make .* work|achieve|keep going until|autonomously|do everything`). Produce a candidate `{kind, confidence}`.
3. **Named-item match** — `hybridSearch(text, [...workflows, ...skills mapped to MatchDoc{id:name, text:name+' '+description}])`; a top hit ≥ threshold → `{kind:'workflow'|'skill', target:name, confidence:score}`.
4. **Fuse + threshold** — pick the highest-confidence candidate ≥ `threshold`; else `{kind:'chat'}`.
`classifyIntent` never throws (internal try/catch → `chat`).

## 6. Routing behavior (cli.ts wiring)

In `src/cli.ts`, in the non-slash input branch (~line 251), **before** the current `runAgent` call, only when `settings.router?.enabled !== false`:
```
route = await classifyIntent(input, routerCtx)
print dim "→ routing to <kind> (<reason>)" when kind !== 'chat'
switch route.kind:
  chat     → fall through to runAgent (unchanged)
  research → runResearch({question: input}, buildRunnerContext(ctx))  [auto-run]
  skill    → inject matched skill body (skills.getSkillContext or the matched skill) + runAgent  [auto-run]
  workflow → runWorkflow(loaded[target], {}, buildRunnerContext(ctx))  [auto-run; engine gate covers tool safety]
  goal     → if settings.router.confirmGoal !== false: inquirer 1-line confirm; on yes runGoal({goal: input, allow: <default safe set>}, ctx)
```
Low confidence or any error → chat. The router NEVER blocks input.

`routerCtx` built from `skills.list()` + `loadWorkflows(workflowDirs(cwd))` + `settings.router.confidenceThreshold`.

## 7. Config + surface

```ts
settings.router = { enabled: true, confidenceThreshold: 0.6, confirmGoal: true, autoRunSafe: true, llmAssist: false };
settings.providers.ollama.embeddingsModel = 'nomic-embed-text';   // ProviderConfig gains embeddingsModel?
```
`/router on|off|status` slash command. Embeddings model needs a one-time `ollama pull nomic-embed-text`; absent → graceful BM25-only.

## 8. Error handling

Embeddings unavailable/throw → `embed` returns null → BM25-only. `classifyIntent` throw → `chat`. Router disabled in config → skip entirely (today's behavior). Goal route always confirmable. No sqlite-vec dependency in this slice (so no native-module risk).

## 9. Testing (vitest TDD)

- **bm25** — IDF correctness (rare term outranks common); TF saturation; length-norm; `tokenize` drops stopwords/short tokens; empty corpus/query.
- **embeddings** — injected `httpPost` → vectors; `cosine` (orthogonal=0, identical=1); error → `null`.
- **hybrid** — injected `embed`: BM25+semantic RRF fusion changes ranking vs BM25-only; `embed`→null falls back to BM25-only; cache avoids double-embedding (spy call count).
- **classifyIntent** — injected `hybrid` + sample skills/workflows: research verb→research; goal verb→goal (confirm path is cli-level); strong workflow/skill name match→that target; bare question→chat; below-threshold→chat; throw→chat.
- **settings.router** defaults; **/router** toggle helper (pure).
- **Live smoke** — `ollama pull nomic-embed-text`; type plain text variants and confirm correct routing vs chat; confirm a goal route asks before running; confirm BM25-only path when embed model absent.

## 10. Build order (for the plan)

1. `bm25.ts` (+tests). 2. `embeddings.ts` (+tests). 3. `OllamaProvider.embed()` wrapper (+test). 4. `hybrid.ts` (+tests). 5. `classifyIntent` in `router/router.ts` (+tests). 6. `settings.router` + `embeddingsModel` (+test). 7. cli.ts wiring + `/router` + help + `router/index.ts` barrel + a pure cli-helper if useful (+test). 8. build, full vitest, live smoke (pull nomic-embed-text), rebuild dist, commit, tag `p4b-hybrid-router`.

## 11. File layout

`src/match/{bm25,embeddings,hybrid}.ts` (+ `*.test.ts`); `src/router/{router,index}.ts` (+ tests); `embed()` in `src/providers/ollama.ts`; `settings.router`+`embeddingsModel` in `src/config/settings.ts`; router wiring + `/router` in `src/cli.ts`; help in `src/ui/terminal.ts`.

## 12. Out of scope (YAGNI / fast-follow)

sqlite-vec persistent vector store; rewiring `ragSearch`/memory to the hybrid matcher; skills-parity (`Skill` tool / `/skill <name>`) — router *routes to* skills via current injection; full per-message LLM classifier (only an optional off-by-default tie-breaker). Hooks + graphify are separate later slices.
