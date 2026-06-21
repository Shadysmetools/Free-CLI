# Research Mode (+ Web Tools) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give coderaw a `/research` deep-research capability (scope → search → fetch → cited synthesis) on the workflow engine, and wire `web_search`/`web_fetch` into the gated CLI agent.

**Architecture:** A pure structured search backend (Brave / DuckDuckGo-HTML / Instant-Answer fallback) feeds a programmatic research driver that composes the workflow-engine primitives (`runSubAgent`, `parallel`). Web tools are exposed to the main agent and classified as safe reads.

**Tech Stack:** TypeScript (Node ≥18), vitest 2.1, axios (existing dep), chalk 4. Reuses `src/bot/web_tools.ts`, `src/workflow/{runner,primitives}.ts`, `src/agents/roles.ts`, `src/permissions/classify.ts`, `src/agent/tools.ts`, `src/registry/index.ts`, `src/config/settings.ts`, `src/cli.ts`, `src/ui/terminal.ts`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-21-research-mode-design.md` (authoritative).
- Branch: `research-mode` (already created; spec committed at `582815c`). Main tree only — no worktrees.
- Test runner: `npx vitest run <file>` for one file; `npm test` for all. Build: `npm run build`. `dist/` is committed (rebuild in final task).
- No new npm deps (axios already present). Match existing header-comment style (`/** … */` banner + section dividers).
- Reuse `executeWebSearch`/`executeWebFetch` from `src/bot/web_tools.ts` — import, never duplicate. Do NOT add `api_call` to the CLI agent.
- `web_search`/`web_fetch` must classify as **safe-silent** (added to `KNOWN_SAFE`), not consequential.
- Driver and parsers must be **dependency-injected / pure** so tests need NO live network.
- Caps: default `maxQueries=5`, `maxSources=8`. Local concurrency from `settings.workflows.concurrency` (ollama→1).
- Commit after each green task. Reply/comments in English.

**Existing signatures this plan builds on (verified):**
```ts
// src/bot/web_tools.ts
interface ToolResult { content: string; isError?: boolean }
function executeWebSearch(query: string): Promise<ToolResult>            // returns formatted string
function executeWebFetch(url: string, maxChars?: number): Promise<ToolResult>
// src/workflow/runner.ts
interface SubAgentSpec { task:string; role?:string; systemPrompt?:string; tools?:string[]; maxIterations?:number; provider?:string; model?:string; validate?:(c:string)=>{ok:boolean;feedback?:string}; maxRetries?:number }
interface SubAgentResult { ok:boolean; content:string; role?:string; task:string; usage?:{prompt_tokens:number;completion_tokens:number;total_tokens:number}; error?:string }
interface RunnerContext { settings:Settings; defaultProviderName:string; parentRegistry:ToolRegistry; mcpClient?:any; memory?:any; skills?:any; tokenTracker?:any; permissions?:any; unattended?:boolean; sessionAllow?:Set<string>; cwd:string; providerFactory?:Function }
function runSubAgent(spec:SubAgentSpec, ctx:RunnerContext):Promise<SubAgentResult>
// src/workflow/primitives.ts
function parallel<T>(thunks:Array<()=>Promise<T>>, opts?:{concurrency?:number}):Promise<Array<T|null>>
// src/workflow/cli-helpers.ts
function buildRunnerContext(slashCtx:any):RunnerContext
// src/permissions/classify.ts
const KNOWN_SAFE = new Set(['read_file','search_files','list_files','git_status','git_diff','git_log','memory_search','memory_save'])
function classify(toolName:string, args:Record<string,unknown>, root:string, rules:Rules):Verdict  // Verdict.decision: 'silent'|'ask'|'block'
// src/agent/tools.ts
const TOOLS: Tool[]; function executeTool(name:string, args:Record<string,unknown>, cwd:string):Promise<ToolResult>
// src/registry/index.ts
type ToolCategory = 'file'|'shell'|'git'|'mcp'|'whisper'|'memory'|'document'|'visual'|'custom'  // ADD 'web'
function createDefaultRegistry():ToolRegistry
// src/agents/roles.ts
interface AgentRole { id:string; name:string; icon:string; description:string; systemPrompt:string; allowedTools?:string[] }
function getRole(id:string):AgentRole|undefined
// src/config/settings.ts
interface Settings { …; workflows?:{…} }; function getDefaultSettings():Settings
// src/cli.ts handleSlashCommand(input, ctx) switch; SlashCommandContext has settings/providerName/cwd/registry/mcpClient/memory/skills/tokenTracker/permissionRules/sessionAllow
// src/ui/terminal.ts: printInfo, printError, printSectionHeader, printHelp
```

---

### Task 1: Pure search-result parsers (`parseBraveJson`, `parseDdgHtml`)

**Files:**
- Create: `src/web/search.ts`
- Test: `src/web/search.test.ts`

**Interfaces:**
- Produces: `interface SearchResult { title:string; url:string; snippet?:string }`; `parseBraveJson(raw:unknown, limit:number): SearchResult[]`; `parseDdgHtml(html:string, limit:number): SearchResult[]`
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**
```ts
// src/web/search.test.ts
import { describe, it, expect } from 'vitest';
import { parseBraveJson, parseDdgHtml } from './search';

describe('parseBraveJson', () => {
  it('extracts title/url/snippet from Brave web.results', () => {
    const raw = { web: { results: [
      { title: 'TS Handbook', url: 'https://ts.dev/h', description: 'docs' },
      { title: 'Vitest', url: 'https://vitest.dev', description: 'testing' },
    ]}};
    expect(parseBraveJson(raw, 5)).toEqual([
      { title: 'TS Handbook', url: 'https://ts.dev/h', snippet: 'docs' },
      { title: 'Vitest', url: 'https://vitest.dev', snippet: 'testing' },
    ]);
  });
  it('caps at limit and never throws on malformed input', () => {
    expect(parseBraveJson({ web: { results: [{title:'a',url:'u1'},{title:'b',url:'u2'}] } }, 1).length).toBe(1);
    expect(parseBraveJson(null, 5)).toEqual([]);
    expect(parseBraveJson({}, 5)).toEqual([]);
  });
});

describe('parseDdgHtml', () => {
  const html = `
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=x">Example A</a>
    <a class="result__snippet">Snippet A</a>
    <a class="result__a" href="https://direct.example.org/b">Direct B</a>`;
  it('extracts results and decodes DDG redirect (uddg) hrefs', () => {
    const out = parseDdgHtml(html, 5);
    expect(out[0]).toEqual({ title: 'Example A', url: 'https://example.com/a', snippet: 'Snippet A' });
    expect(out[1].url).toBe('https://direct.example.org/b');
    expect(out[1].title).toBe('Direct B');
  });
  it('caps at limit; empty/garbage → []', () => {
    expect(parseDdgHtml(html, 1).length).toBe(1);
    expect(parseDdgHtml('', 5)).toEqual([]);
    expect(parseDdgHtml('<div>no results</div>', 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/search.test.ts`
Expected: FAIL — `Cannot find module './search'`.

- [ ] **Step 3: Write minimal implementation**
```ts
// src/web/search.ts
/**
 * Structured web search — parsers + backend selection.
 *
 * Parsers are pure and regex-based (no new deps). webSearchStructured (added in
 * a later task) picks a backend (Brave → DuckDuckGo HTML → Instant Answer) and
 * never throws — it returns [] on any failure so the research driver degrades
 * gracefully offline or when a backend is unavailable.
 */
export interface SearchResult { title: string; url: string; snippet?: string }

/** Strip tags + decode the few entities that appear in DDG titles/snippets. */
function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBraveJson(raw: unknown, limit: number): SearchResult[] {
  const results = (raw as { web?: { results?: unknown[] } })?.web?.results;
  if (!Array.isArray(results)) return [];
  const out: SearchResult[] = [];
  for (const r of results) {
    const o = r as { title?: unknown; url?: unknown; description?: unknown };
    if (typeof o?.title === 'string' && typeof o?.url === 'string') {
      out.push({ title: o.title, url: o.url, ...(typeof o.description === 'string' ? { snippet: o.description } : {}) });
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Decode a DuckDuckGo redirect href (//duckduckgo.com/l/?uddg=<encoded>) to the real URL. */
function resolveDdgHref(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) { try { return decodeURIComponent(m[1]); } catch { /* fall through */ } }
  if (href.startsWith('//')) return 'https:' + href;
  return href;
}

export function parseDdgHtml(html: string, limit: number): SearchResult[] {
  if (!html) return [];
  const out: SearchResult[] = [];
  // Result anchors: <a class="result__a" href="...">title</a>
  const anchorRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(clean(sm[1]));
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = anchorRe.exec(html)) !== null) {
    const url = resolveDdgHref(m[1]);
    const title = clean(m[2]);
    if (!title || !/^https?:\/\//i.test(url)) { i++; continue; }
    out.push({ title, url, ...(snippets[i] ? { snippet: snippets[i] } : {}) });
    i++;
    if (out.length >= limit) break;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/web/search.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/web/search.ts src/web/search.test.ts
git commit -m "feat(research): pure Brave/DDG-HTML search result parsers"
```

---

### Task 2: `webSearchStructured` backend selection + refactor `executeWebSearch`

**Files:**
- Modify: `src/web/search.ts` (add `webSearchStructured`)
- Modify: `src/bot/web_tools.ts` (refactor `executeWebSearch` to format `webSearchStructured` output; keep the same output shape)
- Test: `src/web/search.test.ts` (append)

**Interfaces:**
- Consumes: `parseBraveJson`, `parseDdgHtml`, `SearchResult` (Task 1).
- Produces: `webSearchStructured(query:string, limit?:number, deps?:{ httpGet?:(url:string,headers?:Record<string,string>)=>Promise<{data:unknown}> }): Promise<SearchResult[]>`

- [ ] **Step 1: Write the failing test (append to search.test.ts)**
```ts
import { webSearchStructured } from './search';

describe('webSearchStructured', () => {
  const braveData = { web: { results: [{ title: 'B', url: 'https://b.com', description: 'd' }] } };
  const ddgHtml = '<a class="result__a" href="https://d.com/x">DDG X</a>';

  it('uses Brave when BRAVE_SEARCH_KEY is set', async () => {
    const prev = process.env.BRAVE_SEARCH_KEY;
    process.env.BRAVE_SEARCH_KEY = 'k';
    const out = await webSearchStructured('q', 5, { httpGet: async () => ({ data: braveData }) });
    if (prev === undefined) delete process.env.BRAVE_SEARCH_KEY; else process.env.BRAVE_SEARCH_KEY = prev;
    expect(out).toEqual([{ title: 'B', url: 'https://b.com', snippet: 'd' }]);
  });

  it('falls back to DDG HTML when no key', async () => {
    const prev = process.env.BRAVE_SEARCH_KEY;
    delete process.env.BRAVE_SEARCH_KEY;
    const out = await webSearchStructured('q', 5, { httpGet: async () => ({ data: ddgHtml }) });
    if (prev !== undefined) process.env.BRAVE_SEARCH_KEY = prev;
    expect(out).toEqual([{ title: 'DDG X', url: 'https://d.com/x' }]);
  });

  it('returns [] (never throws) on http error', async () => {
    const out = await webSearchStructured('q', 5, { httpGet: async () => { throw new Error('net'); } });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/search.test.ts -t webSearchStructured`
Expected: FAIL — `webSearchStructured is not exported`.

- [ ] **Step 3: Write minimal implementation (append to `src/web/search.ts`)**
```ts
import axios from 'axios';

export interface SearchDeps {
  httpGet?: (url: string, headers?: Record<string, string>) => Promise<{ data: unknown }>;
}

const UA = 'Mozilla/5.0 (compatible; coderaw/1.0; +https://github.com/Shadysmetools/Free-CLI)';

/** Structured web search with graceful degradation. Never throws → [] on failure. */
export async function webSearchStructured(query: string, limit = 6, deps: SearchDeps = {}): Promise<SearchResult[]> {
  const q = (query ?? '').trim();
  if (!q) return [];
  const httpGet = deps.httpGet ?? (async (url, headers) => {
    const r = await axios.get(url, { timeout: 12000, headers: { 'User-Agent': UA, ...(headers ?? {}) }, responseType: 'json' as const });
    return { data: r.data };
  });
  try {
    const braveKey = process.env.BRAVE_SEARCH_KEY;
    if (braveKey) {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${limit}`;
      const { data } = await httpGet(url, { Accept: 'application/json', 'X-Subscription-Token': braveKey });
      const parsed = parseBraveJson(data, limit);
      if (parsed.length) return parsed;
    }
    // DuckDuckGo HTML (free, real result links). responseType text — axios returns the raw HTML string.
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const { data } = await httpGet(ddgUrl);
    const html = typeof data === 'string' ? data : '';
    return parseDdgHtml(html, limit);
  } catch {
    return [];
  }
}
```
> Note: the default `httpGet` requests JSON for Brave; for the DDG branch axios will still return the body — if your axios default coerces, the `typeof data === 'string'` guard keeps `parseDdgHtml` safe. The injected `httpGet` in tests returns the value directly.

- [ ] **Step 4: Refactor `executeWebSearch` in `src/bot/web_tools.ts`**

Replace the body of `executeWebSearch` so it formats `webSearchStructured` output (preserving the existing emoji header shape so the bot + agent tool behavior is unchanged). Keep the old DDG/Brave helper functions in the file (harmless) OR delete them if unused after this change — leave them to minimize churn.
```ts
import { webSearchStructured } from '../web/search';
// ...
export async function executeWebSearch(query: string): Promise<ToolResult> {
  if (!query?.trim()) return { content: 'Error: query is required', isError: true };
  const results = await webSearchStructured(query, 5);
  if (results.length === 0) {
    return { content: `🔍 Web Search: "${query}"\n\nNo results found. Try: https://duckduckgo.com/?q=${encodeURIComponent(query)}` };
  }
  const parts = [`🔍 Web Search: "${query}"\n`];
  for (const r of results) {
    parts.push(`📄 **${r.title}**`);
    if (r.snippet) parts.push(`   ${r.snippet}`);
    parts.push(`   🔗 ${r.url}`);
    parts.push('');
  }
  return { content: parts.join('\n') };
}
```

- [ ] **Step 5: Run tests + commit**

Run: `npx vitest run src/web/search.test.ts` → PASS (7 tests). Run `npx vitest run src/bot` if any bot tests exist (no failure).
```bash
git add src/web/search.ts src/web/search.test.ts src/bot/web_tools.ts
git commit -m "feat(research): webSearchStructured backend selection; executeWebSearch uses it"
```

---

### Task 3: Wire `web_search` + `web_fetch` into the CLI agent

**Files:**
- Modify: `src/agent/tools.ts` (`TOOLS` + `executeTool`)
- Modify: `src/registry/index.ts` (`ToolCategory` union, `categoryLabel`, `categoryOrder`, `createDefaultRegistry`)
- Test: `src/agent/tools.web.test.ts`

**Interfaces:**
- Consumes: `executeWebSearch`, `executeWebFetch` (`src/bot/web_tools.ts`).
- Produces: `web_search` + `web_fetch` registered tools (category `'web'`); `executeTool('web_search'|'web_fetch', …)` works.

- [ ] **Step 1: Write the failing test**
```ts
// src/agent/tools.web.test.ts
import { describe, it, expect } from 'vitest';
import { TOOLS } from './tools';
import { createDefaultRegistry } from '../registry/index';

describe('web tools wiring', () => {
  it('web_search and web_fetch are in TOOLS', () => {
    const names = TOOLS.map(t => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
    expect(names).not.toContain('api_call'); // explicitly excluded
  });
  it('default registry exposes them under the web category', () => {
    const reg = createDefaultRegistry();
    const names = reg.getEnabled().map(t => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
    expect(reg.get('web_search')!.category).toBe('web');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agent/tools.web.test.ts`
Expected: FAIL — web tools not registered.

- [ ] **Step 3a: Add tool defs + dispatch in `src/agent/tools.ts`**

Add an import near the top: `import { executeWebSearch, executeWebFetch } from '../bot/web_tools';`
Add to the `TOOLS` array (before its closing `]`):
```ts
  {
    name: 'web_search',
    description: 'Search the web for current information, docs, or any topic. Returns titles, snippets, and URLs.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'The search query. Be specific.' } }, required: ['query'] },
  },
  {
    name: 'web_fetch',
    description: 'Fetch a URL and return its readable text (HTML stripped). Use to read docs, articles, or pages.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full http(s) URL' }, max_chars: { type: 'number', description: 'Max chars to return (default 8000)' } }, required: ['url'] },
  },
```
Add cases to the `executeTool` switch (before `default:`):
```ts
      case 'web_search': return executeWebSearch(String(args.query ?? ''));
      case 'web_fetch': return executeWebFetch(String(args.url ?? ''), typeof args.max_chars === 'number' ? (args.max_chars as number) : 8000);
```

- [ ] **Step 3b: Add the `web` category in `src/registry/index.ts`**

- Extend the union: `export type ToolCategory = 'file' | 'shell' | 'git' | 'mcp' | 'whisper' | 'memory' | 'document' | 'visual' | 'web' | 'custom';`
- In `categoryLabel`'s `labels` record add: `web: '🌐 Web Tools',`
- In `formatList`'s `categoryOrder` array add `'web'` (e.g. before `'mcp'`).
- In `createDefaultRegistry()`, after the visual tools block, add:
```ts
  // Web tools
  for (const name of ['web_search', 'web_fetch']) {
    const tool = getBuiltinTool(name);
    if (tool) registry.register(tool, 'web');
  }
```

- [ ] **Step 4: Run test + regression**

Run: `npx vitest run src/agent/tools.web.test.ts` → PASS (2 tests).
Run: `npx vitest run src/agent src/registry` → existing tests still green.

- [ ] **Step 5: Commit**
```bash
git add src/agent/tools.ts src/registry/index.ts src/agent/tools.web.test.ts
git commit -m "feat(research): expose web_search/web_fetch to the CLI agent (web category)"
```

---

### Task 4: Classify `web_search`/`web_fetch` as safe-silent

**Files:**
- Modify: `src/permissions/classify.ts` (`KNOWN_SAFE`)
- Test: `src/permissions/classify.web.test.ts`

**Interfaces:**
- Consumes: `classify`, `Rules` shape.
- Produces: `classify('web_search'|'web_fetch', …)` → `decision: 'silent'`.

- [ ] **Step 1: Write the failing test**
```ts
// src/permissions/classify.web.test.ts
import { describe, it, expect } from 'vitest';
import { classify } from './classify';
import type { Rules } from './types';

const rules: Rules = { enabled: true, projectRoot: process.cwd(), allow: [], ask: [], deny: [], unattended: 'deny', confirmDefault: 'approve' } as Rules;

describe('web tools permission classification', () => {
  it('web_search is silent (safe read)', () => {
    expect(classify('web_search', { query: 'x' }, process.cwd(), rules).decision).toBe('silent');
  });
  it('web_fetch is silent (safe read)', () => {
    expect(classify('web_fetch', { url: 'https://x.com' }, process.cwd(), rules).decision).toBe('silent');
  });
  it('a user deny rule still blocks web_fetch', () => {
    const denied = { ...rules, deny: ['web_fetch'] } as Rules;
    expect(classify('web_fetch', { url: 'https://x.com' }, process.cwd(), denied).decision).toBe('block');
  });
});
```
> Note: confirm the exact `Rules` shape from `src/permissions/types.ts` and adjust the literal if fields differ; the test must construct a valid enabled Rules object.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/permissions/classify.web.test.ts`
Expected: FAIL — web tools currently classify as `'ask'`.

- [ ] **Step 3: Add to `KNOWN_SAFE`**

In `src/permissions/classify.ts`, extend the `KNOWN_SAFE` set:
```ts
const KNOWN_SAFE = new Set([
  'read_file', 'search_files', 'list_files',
  'git_status', 'git_diff', 'git_log', 'memory_search', 'memory_save',
  'web_search', 'web_fetch',
]);
```

- [ ] **Step 4: Run test + regression**

Run: `npx vitest run src/permissions/classify.web.test.ts` → PASS (3 tests).
Run: `npx vitest run src/permissions` → existing permission tests green.

- [ ] **Step 5: Commit**
```bash
git add src/permissions/classify.ts src/permissions/classify.web.test.ts
git commit -m "feat(research): classify web_search/web_fetch as safe-silent reads"
```

---

### Task 5: Add the `researcher` role

**Files:**
- Modify: `src/agents/roles.ts` (add to `BUILTIN_ROLES`)
- Test: `src/agents/roles.research.test.ts`

**Interfaces:**
- Produces: `getRole('researcher')` resolves with `allowedTools` including `web_search`, `web_fetch`.

- [ ] **Step 1: Write the failing test**
```ts
// src/agents/roles.research.test.ts
import { describe, it, expect } from 'vitest';
import { getRole } from './roles';

describe('researcher role', () => {
  it('exists with minimal web tools', () => {
    const r = getRole('researcher');
    expect(r).toBeDefined();
    expect(r!.allowedTools).toContain('web_search');
    expect(r!.allowedTools).toContain('web_fetch');
    expect(r!.systemPrompt).toMatch(/cite/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/roles.research.test.ts`
Expected: FAIL — role undefined.

- [ ] **Step 3: Add the role inside `BUILTIN_ROLES`** (before the closing `};`)
```ts
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    icon: '🔬',
    description: 'Decompose a question and synthesize cited findings from sources',
    allowedTools: ['web_search', 'web_fetch', 'read_file'],
    systemPrompt: `You are a research specialist. You break a question into focused search queries, then synthesize findings from fetched sources into a clear, accurate report.

Rules:
- When asked to decompose, output ONLY a JSON array of 3-5 concise, specific search-query strings — no prose.
- When asked to synthesize, write a structured markdown report. CITE every load-bearing claim with the source URL it came from, inline like (source: <url>).
- Use ONLY the provided source material; do not invent facts. If the sources do not answer part of the question, say so explicitly and flag the gap.
- Be concise and well-organized (short sections, bullets where useful).`,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agents/roles.research.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**
```bash
git add src/agents/roles.ts src/agents/roles.research.test.ts
git commit -m "feat(research): add researcher built-in role"
```

---

### Task 6: `parseQueries` helper

**Files:**
- Create: `src/research/index.ts` (start the module with `parseQueries`)
- Test: `src/research/index.test.ts`

**Interfaces:**
- Produces: `parseQueries(text:string, cap?:number): string[]` (JSON array of strings/`{query|content}` first, else numbered/bulleted lines; trims; drops empties; caps).

- [ ] **Step 1: Write the failing test**
```ts
// src/research/index.test.ts
import { describe, it, expect } from 'vitest';
import { parseQueries } from './index';

describe('parseQueries', () => {
  it('parses a JSON array of strings', () => {
    expect(parseQueries('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  });
  it('parses a JSON array of {query} objects', () => {
    expect(parseQueries('[{"query":"x"},{"query":"y"}]')).toEqual(['x', 'y']);
  });
  it('falls back to numbered/bulleted lines', () => {
    expect(parseQueries('1. first\n2. second\n- third')).toEqual(['first', 'second', 'third']);
  });
  it('caps and handles empties', () => {
    expect(parseQueries('["a","b","c"]', 2)).toEqual(['a', 'b']);
    expect(parseQueries('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/research/index.test.ts`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Write minimal implementation**
```ts
// src/research/index.ts
/**
 * Research mode — a programmatic deep-research driver on the workflow engine:
 * scope (decompose) -> search -> fetch -> cited synthesis. Search/fetch are
 * deterministic; scope/synthesis are sub-agents. Everything network-touching is
 * dependency-injected so the driver is fully unit-testable offline.
 */

/** Parse a scope sub-agent's output into a list of search queries. */
export function parseQueries(text: string, cap = 5): string[] {
  const t = (text ?? '').trim();
  if (!t) return [];
  try {
    const arr = JSON.parse(t);
    if (Array.isArray(arr)) {
      const out = arr
        .map((x) => (typeof x === 'string' ? x : (x && typeof x === 'object' ? String((x as any).query ?? (x as any).content ?? '') : '')))
        .map((s) => s.trim())
        .filter(Boolean);
      if (out.length) return out.slice(0, cap);
    }
  } catch { /* fall through to line parsing */ }
  return t.split('\n')
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, cap);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/research/index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/research/index.ts src/research/index.test.ts
git commit -m "feat(research): parseQueries helper"
```

---

### Task 7: `runResearch` driver

**Files:**
- Modify: `src/research/index.ts` (add types + `runResearch`)
- Test: `src/research/index.test.ts` (append)

**Interfaces:**
- Consumes: `parseQueries` (Task 6); `runSubAgent`/`SubAgentResult`/`RunnerContext` (`../workflow/runner`); `parallel` (`../workflow/primitives`); `webSearchStructured`/`SearchResult` (`../web/search`); `executeWebFetch` (`../bot/web_tools`).
- Produces:
```ts
interface ResearchOptions { question:string; maxQueries?:number; maxSources?:number; provider?:string; model?:string }
interface ResearchResult { ok:boolean; question:string; queries:string[]; sources:Array<{title:string;url:string}>; report:string; usage:{prompt_tokens:number;completion_tokens:number;total_tokens:number}; stoppedBy:'done'|'no_sources'|'error' }
interface ResearchDeps { runSubAgent?:Function; search?:(q:string,limit:number)=>Promise<SearchResult[]>; fetch?:(url:string,maxChars?:number)=>Promise<{url:string;text:string}>; render?:boolean }
function runResearch(opts:ResearchOptions, ctx:RunnerContext, deps?:ResearchDeps):Promise<ResearchResult>
```

- [ ] **Step 1: Write the failing test (append)**
```ts
import { runResearch } from './index';
import type { SubAgentSpec, SubAgentResult, RunnerContext } from '../workflow/runner';
import { getDefaultSettings } from '../config/settings';
import { createDefaultRegistry } from '../registry/index';

function ctx(): RunnerContext {
  return { settings: getDefaultSettings(), defaultProviderName: 'ollama', parentRegistry: createDefaultRegistry(), cwd: process.cwd() };
}

describe('runResearch', () => {
  const run = async (spec: SubAgentSpec): Promise<SubAgentResult> =>
    spec.task.includes('decompose') || spec.task.toLowerCase().includes('search-quer')
      ? { ok: true, content: '["q1","q2"]', task: spec.task, usage: { prompt_tokens:1, completion_tokens:1, total_tokens:2 } }
      : { ok: true, content: '# Report\nFinding (source: https://a.com/1)', task: spec.task, usage: { prompt_tokens:1, completion_tokens:1, total_tokens:2 } };

  it('scopes, searches, fetches, synthesizes a cited report; dedups + caps sources', async () => {
    const fetched: string[] = [];
    const res = await runResearch({ question: 'what is X?', maxSources: 2 }, ctx(), {
      runSubAgent: run,
      search: async (q) => ([{ title: 't', url: 'https://a.com/1' }, { title: 't2', url: 'https://a.com/1' }, { title: 't3', url: `https://a.com/${q}` }]),
      fetch: async (url) => { fetched.push(url); return { url, text: `content of ${url}` }; },
      render: false,
    });
    expect(res.ok).toBe(true);
    expect(res.stoppedBy).toBe('done');
    expect(res.queries).toEqual(['q1', 'q2']);
    expect(new Set(fetched).size).toBe(fetched.length);   // deduped
    expect(res.sources.length).toBeLessThanOrEqual(2);     // maxSources cap
    expect(res.report).toContain('source:');
    expect(res.usage.total_tokens).toBeGreaterThan(0);
  });

  it('returns no_sources (no synthesis) when nothing is fetched', async () => {
    let synth = 0;
    const res = await runResearch({ question: 'q' }, ctx(), {
      runSubAgent: async (s: SubAgentSpec) => { if (!s.task.includes('decompose') && !s.task.toLowerCase().includes('search-quer')) synth++; return { ok:true, content:'["q1"]', task:s.task }; },
      search: async () => [{ title: 't', url: 'https://x.com' }],
      fetch: async () => { throw new Error('offline'); },
      render: false,
    });
    expect(res.stoppedBy).toBe('no_sources');
    expect(synth).toBe(0); // synthesis never called
    expect(res.report).toMatch(/no sources/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/research/index.test.ts -t runResearch`
Expected: FAIL — `runResearch is not exported`.

- [ ] **Step 3: Write minimal implementation (append to `src/research/index.ts`)**
```ts
import { runSubAgent as realRunSubAgent, RunnerContext, SubAgentResult, SubAgentSpec } from '../workflow/runner';
import { parallel } from '../workflow/primitives';
import { webSearchStructured, SearchResult } from '../web/search';
import { executeWebFetch } from '../bot/web_tools';
import { printInfo } from '../ui/terminal';

export interface ResearchOptions { question: string; maxQueries?: number; maxSources?: number; provider?: string; model?: string }
export interface ResearchResult {
  ok: boolean; question: string; queries: string[];
  sources: Array<{ title: string; url: string }>;
  report: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  stoppedBy: 'done' | 'no_sources' | 'error';
}
export interface ResearchDeps {
  runSubAgent?: (s: SubAgentSpec, c: RunnerContext) => Promise<SubAgentResult>;
  search?: (q: string, limit: number) => Promise<SearchResult[]>;
  fetch?: (url: string, maxChars?: number) => Promise<{ url: string; text: string }>;
  render?: boolean;
}

const defaultFetch = async (url: string, maxChars = 8000): Promise<{ url: string; text: string }> => {
  const r = await executeWebFetch(url, maxChars);
  if (r.isError) throw new Error(r.content);
  return { url, text: r.content };
};

export async function runResearch(opts: ResearchOptions, ctx: RunnerContext, deps: ResearchDeps = {}): Promise<ResearchResult> {
  const runSubAgent = deps.runSubAgent ?? realRunSubAgent;
  const search = deps.search ?? ((q: string, limit: number) => webSearchStructured(q, limit));
  const fetch = deps.fetch ?? defaultFetch;
  const render = deps.render !== false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wf = (ctx.settings as any).workflows;
  const research = (ctx.settings as any).research; // eslint-disable-line @typescript-eslint/no-explicit-any
  const maxQueries = opts.maxQueries ?? research?.maxQueries ?? 5;
  const maxSources = opts.maxSources ?? research?.maxSources ?? 8;
  const conc = (ctx.defaultProviderName === 'ollama' ? wf?.concurrency?.ollama : wf?.concurrency?.default) ?? (ctx.defaultProviderName === 'ollama' ? 1 : 4);
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const addUsage = (u?: SubAgentResult['usage']) => { if (u) { usage.prompt_tokens += u.prompt_tokens; usage.completion_tokens += u.completion_tokens; usage.total_tokens += u.total_tokens; } };
  const subSpec = (task: string, validate?: SubAgentSpec['validate']): SubAgentSpec =>
    ({ role: 'researcher', task, provider: opts.provider, model: opts.model, validate });

  // 1) SCOPE
  if (render) printInfo(`Scoping research: ${opts.question}`);
  const scope = await runSubAgent(subSpec(
    `Decompose this question into ${maxQueries} focused web search-query strings. Question: ${opts.question}\nReturn ONLY a JSON array of strings.`,
    (c) => ({ ok: parseQueries(c, maxQueries).length > 0, feedback: 'return a JSON array of 3-5 query strings' }),
  ), ctx);
  addUsage(scope.usage);
  let queries = parseQueries(scope.content, maxQueries);
  if (queries.length === 0) queries = [opts.question]; // fallback: search the raw question
  if (render) printInfo(`Queries: ${queries.join(' | ')}`);

  // 2) SEARCH (parallel) → dedup by URL → cap
  const searchLists = await parallel(queries.map((q) => () => search(q, Math.max(3, Math.ceil(maxSources / queries.length) + 2))), { concurrency: conc });
  const seen = new Set<string>();
  const sources: SearchResult[] = [];
  for (const list of searchLists) {
    for (const r of list ?? []) {
      if (r?.url && !seen.has(r.url)) { seen.add(r.url); sources.push(r); }
      if (sources.length >= maxSources) break;
    }
    if (sources.length >= maxSources) break;
  }
  if (render) printInfo(`Found ${sources.length} unique sources; fetching…`);

  // 3) FETCH (parallel, drop failures)
  const fetched = (await parallel(sources.map((s) => () => fetch(s.url, 8000)), { concurrency: conc })).filter(Boolean) as Array<{ url: string; text: string }>;
  if (fetched.length === 0) {
    return { ok: false, question: opts.question, queries, sources: sources.map(s => ({ title: s.title, url: s.url })), report: 'No sources retrieved (are you online? is a search backend available?).', usage, stoppedBy: 'no_sources' };
  }

  // 4) SYNTHESIZE (cap total input to stay within the local context window)
  const MAX_INPUT = 14000;
  let budget = MAX_INPUT;
  const chunks: string[] = [];
  for (const f of fetched) {
    const piece = `SOURCE: ${f.url}\n${f.text}\n`;
    if (budget - piece.length < 0) break;
    chunks.push(piece); budget -= piece.length;
  }
  if (render) printInfo(`Synthesizing from ${chunks.length} sources…`);
  const synth = await runSubAgent(subSpec(
    `Write a cited markdown report answering: "${opts.question}".\nUse ONLY the sources below; cite each load-bearing claim with its source URL inline like (source: <url>). Flag gaps the sources don't cover.\n\n${chunks.join('\n---\n')}`,
  ), ctx);
  addUsage(synth.usage);

  return {
    ok: synth.ok,
    question: opts.question,
    queries,
    sources: fetched.map((f) => ({ title: sources.find(s => s.url === f.url)?.title ?? f.url, url: f.url })),
    report: synth.content,
    usage,
    stoppedBy: synth.ok ? 'done' : 'error',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/research/index.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**
```bash
git add src/research/index.ts src/research/index.test.ts
git commit -m "feat(research): runResearch driver (scope→search→fetch→cited synthesis)"
```

---

### Task 8: `settings.research` config block

**Files:**
- Modify: `src/config/settings.ts` (`Settings` interface + `DEFAULT_SETTINGS`)
- Test: `src/config/settings.research.test.ts`

**Interfaces:**
- Produces: `Settings.research?: { maxQueries?:number; maxSources?:number }`, default `{ maxQueries:5, maxSources:8 }`.

- [ ] **Step 1: Write the failing test**
```ts
// src/config/settings.research.test.ts
import { describe, it, expect } from 'vitest';
import { getDefaultSettings } from './settings';

describe('settings.research defaults', () => {
  it('provides research defaults', () => {
    const s = getDefaultSettings() as any;
    expect(s.research.maxQueries).toBe(5);
    expect(s.research.maxSources).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/settings.research.test.ts`
Expected: FAIL — `research` undefined.

- [ ] **Step 3: Add to `Settings` interface + `DEFAULT_SETTINGS`**

In the `Settings` interface (after `workflows?`):
```ts
  research?: { maxQueries?: number; maxSources?: number };
```
In `DEFAULT_SETTINGS` (after the `workflows` block):
```ts
  research: { maxQueries: 5, maxSources: 8 },
```

- [ ] **Step 4: Run test + regression**

Run: `npx vitest run src/config/settings.research.test.ts` → PASS.
Run: `npx vitest run src/config` → existing settings tests green.

- [ ] **Step 5: Commit**
```bash
git add src/config/settings.ts src/config/settings.research.test.ts
git commit -m "feat(research): settings.research defaults (maxQueries/maxSources)"
```

---

### Task 9: `/research` slash command + help

**Files:**
- Modify: `src/cli.ts` (`handleSlashCommand` + import)
- Modify: `src/ui/terminal.ts` (`printHelp`)
- Test: `src/research/slug.test.ts`

**Interfaces:**
- Consumes: `runResearch` (Task 7), `buildRunnerContext` (`../workflow/cli-helpers`).
- Produces: `slugify(s:string): string` (exported from `src/research/index.ts`) + a `/research` command that writes `./research-<slug>.md`.

- [ ] **Step 1: Write the failing test (pure slug helper)**
```ts
// src/research/slug.test.ts
import { describe, it, expect } from 'vitest';
import { slugify } from './index';

describe('slugify', () => {
  it('lowercases, replaces non-alphanumerics with hyphens, trims, caps length', () => {
    expect(slugify('What is TypeScript??')).toBe('what-is-typescript');
    expect(slugify('  a/b c  ')).toBe('a-b-c');
    expect(slugify('x'.repeat(80)).length).toBeLessThanOrEqual(50);
  });
  it('never produces an empty string', () => {
    expect(slugify('???').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/research/slug.test.ts`
Expected: FAIL — `slugify is not exported`.

- [ ] **Step 3a: Add `slugify` to `src/research/index.ts`**
```ts
/** URL/file-safe slug for a research question. Never empty. */
export function slugify(s: string): string {
  const base = (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '');
  return base || 'research';
}
```

- [ ] **Step 3b: Wire `/research` in `src/cli.ts`**

Add to the workflow import line (or a new import): `import { runResearch, slugify } from './research/index';` (and ensure `buildRunnerContext` is imported — it already is from `./workflow/index`).
Add a case to `handleSlashCommand` (before `default:`):
```ts
    case 'research': {
      const question = args.join(' ').replace(/^["']|["']$/g, '').trim();
      if (!question) { printError('Usage: /research "<question>"'); break; }
      printInfo(`Researching: ${question}`);
      const res = await runResearch({ question }, buildRunnerContext(ctx));
      if (res.stoppedBy === 'no_sources') { printError(res.report); break; }
      printSectionHeader(`🔬 Research: ${question}`);
      console.log(res.report);
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const file = path.join(ctx.cwd, `research-${slugify(question)}.md`);
      const header = `# Research: ${question}\n\n_Queries: ${res.queries.join('; ')}_\n_Sources:_\n${res.sources.map(s => `- [${s.title}](${s.url})`).join('\n')}\n\n---\n\n`;
      fs.writeFileSync(file, header + res.report, 'utf-8');
      printInfo(`Saved → ${file}  (${res.usage.total_tokens} tokens, ${res.sources.length} sources)`);
      break;
    }
```
(Match the actual print-helper names in cli.ts — `printSectionHeader`/`printInfo`/`printError` are used elsewhere in the file.)

- [ ] **Step 3c: Add `/research` to help** in `src/ui/terminal.ts` `printHelp` (near the workflow commands added in #3): a line for `/research "<question>"  Deep research: web search → fetch → cited report`.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/research/slug.test.ts` → PASS (2 tests).
Run: `npm run build` → `tsc` exits 0 (confirms the cli.ts wiring typechecks). Fix any type errors against the real cli.ts before committing.

- [ ] **Step 5: Commit**
```bash
git add src/cli.ts src/ui/terminal.ts src/research/index.ts src/research/slug.test.ts
git commit -m "feat(research): /research slash command + slug + help"
```

---

### Task 10: Build, full test, live smoke, dist rebuild

**Files:**
- Modify: `dist/` (rebuilt — committed per repo convention)

- [ ] **Step 1: Typecheck + build**

Run: `npm run build`
Expected: `tsc` exits 0; `dist/` regenerated. If type errors, STOP and report BLOCKED.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all green — previous 178 + new research/web tests (~20). Note the total.

- [ ] **Step 3: Live smoke test (ATTEMPT — needs internet; do not block on a network failure)**

Run a non-interactive driver smoke (then nothing to delete):
```bash
node -e "(async()=>{const {runResearch}=require('./dist/research/index');const {loadSettings}=require('./dist/config/settings');const {createDefaultRegistry}=require('./dist/registry/index');const s=loadSettings();const ctx={settings:s,defaultProviderName:s.defaultProvider,parentRegistry:createDefaultRegistry(),cwd:process.cwd(),permissions:s.permissions};const r=await runResearch({question:'what is the vitest testing framework?',maxQueries:2,maxSources:3},ctx,{render:true});console.log('stoppedBy=',r.stoppedBy,'sources=',r.sources.length,'reportLen=',r.report.length);})().catch(e=>{console.error('SMOKE-ERR',e.message);process.exit(0)});"
```
Expected (online + Ollama running): `stoppedBy= done sources= >=1 reportLen= >0`. If `no_sources` or a network/Ollama error, report it as a non-blocking note (the unit tests already prove the logic).

- [ ] **Step 4: Commit dist**
```bash
git add dist
git commit -m "build(research): rebuild dist for research mode + web tools"
```

- [ ] **Step 5: Tag**
```bash
git tag p4a-research-mode
```
(Do NOT merge or push yet — the controller runs the final whole-branch review first, then finishing-a-development-branch.)

---

## Self-Review

**1. Spec coverage:**
- §4 web tools into agent → Tasks 3 (+ reuse) ✓ · §4 permissions safe → Task 4 ✓
- §5 structured backend (parsers + selection + executeWebSearch refactor) → Tasks 1, 2 ✓
- §6 driver (scope/search/fetch/synthesize, dedup, caps, no_sources, researcher role) → Tasks 5, 6, 7 ✓
- §7 config → Task 8 ✓ · §8 surfaces (/research + file write + help) → Task 9 ✓
- §9 error handling → null-on-throw fetch drop + no_sources (T7), structured search never-throws (T2), scope guardrail+fallback (T7) ✓
- §10 testing → each task TDD; live smoke → Task 10 ✓
- §11 build order → Tasks ordered parsers→backend→wire→perms→role→parseQueries→driver→settings→cli→build ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. The Task 4 note to confirm the `Rules` literal shape and the Task 9 note to match print-helper names are verification reminders, not placeholders — the code given is complete and correct against the verified signatures.

**3. Type consistency:** `SearchResult {title,url,snippet?}` defined Task 1, consumed Tasks 2, 7. `webSearchStructured(query,limit,deps?)` Task 2 ↔ used as `search` default Task 7. `runSubAgent(spec,ctx)` + `SubAgentResult{ok,content,usage?}` consumed unchanged in Task 7. `parseQueries(text,cap?)` Task 6 ↔ Task 7. `ResearchResult.stoppedBy` values `'done'|'no_sources'|'error'` consistent across Task 7 and Task 9 usage. `slugify` Task 9. `ToolCategory` adds `'web'` (Task 3) used in the Task 3 registry test.
