# Research Mode (+ Web Tools) — Design Spec

**Date:** 2026-06-21
**Sub-project:** #4, slice 1 of 5 — research mode + web-tools foundation
**Status:** Approved design (brainstorming complete).

> Slice of #4 ("skills parity + graphify + context-mode + research mode"). Remaining slices, in order: 4c skills parity → 4d context-mode/RAG (direction: both — local Ollama+sqlite-vec RAG and/or context-mode MCP, decided at 4d) → 4e graphify.

---

## 1. Purpose

Give coderaw a deep-research capability: ask a question, it fans out web searches, fetches sources, and synthesizes a **cited** report — built on the workflow engine (#3). Also wire the existing web tools into the CLI agent so the model can search/fetch ad-hoc in normal chat, sub-agents, workflows, and goals.

## 2. Scope

- **4a — Web tools into the CLI agent:** expose `web_search` + `web_fetch` (currently bot-only) to the main agent, gated as safe reads.
- **4b — Research driver:** a programmatic `/research` flow over the workflow-engine primitives: scope → search → fetch → synthesize (cited report).
- **Out of scope (YAGNI):** `api_call` (mutates remote state — defer); a multi-vote adversarial verification stage (no sound external checker for web claims; a 7B is a poor self-judge — see #3 research §11 R1); browser automation (that's #6).

## 3. Existing seams (verified against the codebase)

| Need | Existing API | File |
|---|---|---|
| Web search (formatted string) | `executeWebSearch(query): Promise<ToolResult>` (Brave if `BRAVE_SEARCH_KEY`, else DuckDuckGo Instant Answer) | `src/bot/web_tools.ts:28` |
| Web fetch (HTML→text, 8 KB cap) | `executeWebFetch(url, maxChars=8000): Promise<ToolResult>` | `src/bot/web_tools.ts:151` |
| Tool defs | `WEB_TOOL_DEFS` (web_search, web_fetch, api_call) | `src/bot/web_tools.ts:327` |
| `ToolResult` | `{ content: string; isError?: boolean }` | `src/agent/tools.ts:13` |
| Add a built-in tool | `TOOLS[]` + `executeTool` switch + `createDefaultRegistry()` | `src/agent/tools.ts:35,298`; `src/registry/index.ts:187` |
| Sub-agent run | `runSubAgent(spec, ctx): Promise<SubAgentResult>` ({ ok, content, usage?, … }) | `src/workflow/runner.ts` |
| Bounded concurrency | `parallel(thunks, {concurrency})` (null-on-throw) | `src/workflow/primitives.ts` |
| Runner context | `RunnerContext` ({ settings, defaultProviderName, parentRegistry, …, cwd, providerFactory? }) | `src/workflow/runner.ts` |
| Build a runner ctx from CLI | `buildRunnerContext(slashCtx)` | `src/workflow/cli-helpers.ts` |
| Permission classify (safe vs consequential) | classifier + `gate()` | `src/permissions/classify.ts`, `src/permissions/gate.ts` |
| Slash command dispatch | `handleSlashCommand` switch; `SlashCommandContext` | `src/cli.ts:327` |
| Print helpers | `printInfo/printError/printSectionHeader` | `src/ui/terminal.ts` |
| HTTP client | `axios` (dep) | — |

`executeWebSearch` returns a **human-formatted string** and DDG Instant Answer rarely yields result links — fine for the agent tool, insufficient for the driver, which needs **structured** results (see §5).

## 4. Part 4a — Web tools into the CLI agent

1. Add `web_search` and `web_fetch` defs to `TOOLS` in `src/agent/tools.ts` (copy the two relevant entries from `WEB_TOOL_DEFS`; do **not** add `api_call`).
2. In `executeTool`, add cases delegating to the existing implementations (import from `../bot/web_tools` — reuse, don't duplicate):
   - `case 'web_search': return executeWebSearch(String(args.query ?? ''));`
   - `case 'web_fetch': return executeWebFetch(String(args.url ?? ''), typeof args.max_chars === 'number' ? args.max_chars : 8000);`
3. Register both in `createDefaultRegistry()` under a new `ToolCategory` `'web'` (add `'web'` to the `ToolCategory` union + a label in `categoryLabel`).
4. **Permissions:** classify `web_search` and `web_fetch` as **known-safe (silent)**, alongside `read_file`/`search_files`/`list_files`. They are read-only network fetches. Implement by adding both names to the classifier's safe-read/allowlist set. Rationale: keeps research runs (many calls) from prompting per call; the user owns the rules file and may move them to `ask`/`deny`. (`api_call`, if ever added, stays consequential.)

## 5. Structured search backend

Add to `src/bot/web_tools.ts` (or a new `src/web/search.ts`):

```ts
export interface SearchResult { title: string; url: string; snippet?: string }
export async function webSearchStructured(query: string, limit = 6): Promise<SearchResult[]>
```

Backend selection with graceful degradation (never throws — returns `[]` on failure):
1. **Brave** if `BRAVE_SEARCH_KEY` — parse `web.results[]` → `{title, url, snippet=description}`.
2. else **DuckDuckGo HTML** (`https://html.duckduckgo.com/html/?q=<q>`) — POST/GET, parse result anchors (`a.result__a` href + text; href may be a DDG redirect `//duckduckgo.com/l/?uddg=<encoded>` → decode to the real URL) → `{title, url, snippet}`.
3. else **Instant Answer** fallback — map `RelatedTopics`/`Results` `{Text, FirstURL}` → `{title:Text, url:FirstURL}` (thin, but never crashes).

The agent-facing `web_search` tool keeps returning the existing formatted string; refactor `executeWebSearch` to call `webSearchStructured` and format its results (preserving today's output shape so the agent tool is unchanged in behavior). DDG-HTML parsing is regex-based (no new dep); isolate it in a pure, unit-testable `parseDdgHtml(html): SearchResult[]` and `parseBraveJson(json): SearchResult[]`.

## 6. Part 4b — Research driver

New module `src/research/index.ts`. A **programmatic** driver (dynamic fan-out → not a static YAML workflow), composing workflow-engine primitives + the web helpers. Mirrors the deep-research harness pattern (deterministic search/fetch + LLM scope/synthesize).

```ts
export interface ResearchOptions { question: string; maxQueries?: number; maxSources?: number; provider?: string; model?: string }
export interface ResearchResult {
  ok: boolean;
  question: string;
  queries: string[];
  sources: Array<{ title: string; url: string }>;
  report: string;            // cited markdown
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  stoppedBy: 'done' | 'no_sources' | 'error';
}
export interface ResearchDeps {           // dependency-injected for tests
  runSubAgent?: typeof import('../workflow/runner').runSubAgent;
  search?: (q: string, limit: number) => Promise<SearchResult[]>;
  fetch?: (url: string, maxChars?: number) => Promise<{ url: string; text: string }>;
  render?: boolean;
}
export function parseQueries(text: string): string[];   // JSON array first, else numbered/bulleted lines (cap to maxQueries)
export async function runResearch(opts: ResearchOptions, ctx: RunnerContext, deps?: ResearchDeps): Promise<ResearchResult>;
```

Stages:
1. **Scope** — `runSubAgent({ role: 'researcher', task: <decompose prompt>, validate })` returns a JSON array of **3–5** focused search queries; `parseQueries` parses (JSON-first, line fallback); the `validate` guardrail retries if it yields zero queries. Capped at `maxQueries` (default 5).
2. **Search** — `parallel(queries.map(q => () => deps.search(q, perQueryLimit)), { concurrency })` (concurrency from `settings.workflows.concurrency`, ollama→1). Flatten + **dedup by URL**, keep the top `maxSources` (default 8).
3. **Fetch** — `parallel(sources.map(s => () => deps.fetch(s.url, 8000)), { concurrency })`; drop failures (null-on-throw). If **zero** sources fetched → return `{ ok:false, stoppedBy:'no_sources', report: "No sources retrieved (are you online? is a search backend available?)" }` (never a hallucinated report).
4. **Synthesize** — `runSubAgent({ role: 'researcher', task: <synthesis prompt with the fetched chunks + their URLs> })`. Prompt instructs: write a structured markdown report, **cite each load-bearing claim with its source URL**, and flag uncertainty / gaps. Content per source already truncated at 8 KB; the driver further caps total synthesis input to stay within the local context window (e.g. concatenate up to N chars, noting how many sources were included).

Add a built-in **`researcher` role** to `src/agents/roles.ts` (allowedTools: `web_search`, `web_fetch`, `read_file` — minimal) with a prompt geared to query decomposition and cited synthesis. The driver passes explicit `systemPrompt`/`task` per stage, but the role provides the default + the agent-mode persona.

## 7. Config

Extend `Settings.workflows` (or a sibling `research` block) — minimal:
```ts
research?: { maxQueries?: number; maxSources?: number };   // defaults 5 / 8
```
Applied in `getDefaultSettings`. Synthesis model defaults to the active provider; `opts.provider/model` override per run.

## 8. Surfaces

- `/research "<question>"` — runs `runResearch`; prints a live progress summary (queries found, sources fetched) via `printInfo`, prints the report, and **writes it to `./research-<slug>.md`** (slug = sanitized question). Wired as a new `case 'research'` in `handleSlashCommand`, building the `RunnerContext` via `buildRunnerContext(ctx)`.
- `web_search` / `web_fetch` tools available to the agent in normal chat and to all sub-agents/workflows/goals (registered in the default registry).
- Help text updated (`printHelp`).

## 9. Error handling

- Search/fetch failures isolate per item via `parallel()` null-on-throw; failed queries/sources are skipped, research continues.
- All-search-fail / zero-sources → explicit `stoppedBy:'no_sources'` message, never a fabricated report.
- Scope step producing no parseable queries → guardrail retry, then fall back to using the raw question as a single query.
- Structured search helper never throws (returns `[]`); `web_fetch` already returns `{isError:true}` on failure.

## 10. Testing (vitest TDD)

- **`parseBraveJson` / `parseDdgHtml`** — canned Brave JSON + canned DDG-HTML fixtures → assert extracted `{title,url}[]`; DDG redirect-URL decoding; never-throw on malformed/empty.
- **`webSearchStructured`** — backend selection by `BRAVE_SEARCH_KEY` presence (inject a fake fetcher); returns `[]` on network error.
- **`parseQueries`** — JSON array, numbered/bulleted lines, empty → `[]`, cap to `maxQueries`.
- **`runResearch`** — dependency-injected fake `runSubAgent` + fake `search`/`fetch`: assert scope→search→fetch→synthesize order, URL dedup, `maxQueries`/`maxSources` caps respected, the zero-sources path returns `stoppedBy:'no_sources'` (no synthesis call), usage accumulation. No live network.
- **Permissions** — assert `web_search`/`web_fetch` classify as allowed-silent (not consequential).
- **`researcher` role** — `getRole('researcher')` resolves with the minimal `allowedTools`.
- **Live smoke** (manual, needs internet) — one real `/research "<question>"` end-to-end producing a cited `./research-*.md`.

## 11. Build order (for the plan)

1. `parseBraveJson` + `parseDdgHtml` + `webSearchStructured` (+ tests) in `web_tools.ts` (or `src/web/search.ts`); refactor `executeWebSearch` to use it.
2. Wire `web_search`/`web_fetch` into `TOOLS` + `executeTool` + `createDefaultRegistry` (`'web'` category) (+ tests).
3. Permissions: classify `web_search`/`web_fetch` as safe-silent (+ test).
4. `researcher` role in `roles.ts` (+ test).
5. `parseQueries` (+ tests).
6. `runResearch` driver (+ tests, dependency-injected).
7. `settings.research` block + defaults (+ test).
8. `/research` slash command + help wiring.
9. Build, full vitest, live smoke (`/research`), rebuild dist, commit, tag.

## 12. File layout

`src/research/index.ts` (+ `index.test.ts`); structured search helper + parsers in `src/bot/web_tools.ts` (co-located tests `src/bot/web_tools.test.ts`) — kept there to avoid moving the bot's import; web-tool wiring in `src/agent/tools.ts` + `src/registry/index.ts`; classifier change in `src/permissions/classify.ts`; `researcher` role in `src/agents/roles.ts`; `/research` in `src/cli.ts`; help in `src/ui/terminal.ts`.

## 13. Notes / caveats

- **Search quality:** best with `BRAVE_SEARCH_KEY` (real ranked results). The free DDG-HTML scrape gives real result links but is HTML-shape-dependent (parser isolated + tested so it's easy to fix if DDG changes markup). Instant-Answer is a thin last resort.
- **Online requirement:** research needs internet for search/fetch; the synthesizing model may be local (Qwen) or cloud — "online when online." Offline → `no_sources`.
- **Weak-model fit:** small bounded fan-out (≤5 queries, ≤8 sources), truncated inputs, structured scope output, single citation-disciplined synthesis (no fragile multi-agent verification).
