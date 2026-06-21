# Hybrid Matcher + NL Intent Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable hybrid retrieval matcher (true Okapi BM25 fused via RRF with Ollama semantic embeddings) and a natural-language intent router so plain text routes to research / goal / workflow / skill / chat without needing `/`.

**Architecture:** Two new self-contained modules. `src/match/` is a pure, dependency-light matcher (`bm25` → `embeddings` → `hybrid`, fused by RRF, embeddings degrade to BM25-only on any failure). `src/router/` layers a local heuristic + the matcher into `classifyIntent`, which the CLI calls on every non-slash line before `runAgent`; confident safe matches auto-run, goals confirm first, everything else falls through to normal chat. The Ollama provider gains an `embed()` method; settings gain a `router` block and `embeddingsModel`.

**Tech Stack:** TypeScript, vitest (TDD), Node `http`/`https` (no new deps), Ollama `POST /api/embed` (`nomic-embed-text`).

## Global Constraints

- **No new runtime dependencies.** BM25 is pure TS; embeddings use Node `http`/`https`; sqlite-vec / better-sqlite3 stay UNUSED (deferred fast-follow).
- **Embeddings must never throw** — `embed()` returns `null` on any failure → callers degrade to BM25-only.
- **`classifyIntent` must never throw** — internal try/catch → `{kind:'chat'}`. The router must never break normal conversation.
- **No worktrees.** Build every task with a fresh agent in the MAIN tree (`E:\Shady'sPC\UNrestricted AI\Free-CLI`) — the `node_modules` junction gotcha wiped the repo last time.
- Build excludes `*.test.ts` (existing tsconfig). `dist/` is committed and rebuilt at the end.
- Conventional-commit messages. Run `npx vitest run` (full suite) green before each commit.
- Config dir is `%APPDATA%\coderaw` on Windows. Ollama must be running for the live smoke.
- Routing policy (locked): auto-run safe (research / skill / read-only workflow) on a confident match ≥ `confidenceThreshold` (0.6); **GOAL confirms first** (1-line); ambiguous / low-confidence / any error → **chat**.

---

## File Structure

- `src/match/bm25.ts` — pure Okapi BM25 + `tokenize`. One responsibility: keyword ranking.
- `src/match/embeddings.ts` — `embed(texts, opts)` (Ollama `/api/embed`, injectable `httpPost`, never throws) + `cosine`.
- `src/match/hybrid.ts` — `hybridSearch` RRF-fuses BM25 + semantic; in-memory embed cache + `clearEmbedCache`.
- `src/match/index.ts` — barrel re-exporting the three.
- `src/router/router.ts` — `classifyIntent` (layered local heuristic + matcher) + `applyRouterCommand` (pure `/router on|off|status` helper).
- `src/router/index.ts` — barrel.
- `src/providers/index.ts` — add optional `embed?()` to the `Provider` interface (MODIFY).
- `src/providers/ollama.ts` — add `embed()` method delegating to `match/embeddings` (MODIFY).
- `src/config/settings.ts` — add `settings.router` + `providers.*.embeddingsModel` (MODIFY).
- `src/cli.ts` — router intercept before `runAgent` (~line 251) + `/router` slash case (MODIFY).
- `src/ui/terminal.ts` — `/router` help line (MODIFY).

Tests sit next to each source file as `*.test.ts`.

---

### Task 1: BM25 keyword matcher

**Files:**
- Create: `src/match/bm25.ts`
- Test: `src/match/bm25.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface Scored { id: string; score: number }`; `class BM25 { constructor(opts?: { k1?: number; b?: number }); add(id: string, text: string): void; search(query: string, topK?: number): Scored[] }`; `function tokenize(text: string): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/match/bm25.test.ts
import { describe, it, expect } from 'vitest';
import { BM25, tokenize } from './bm25';

describe('tokenize', () => {
  it('lowercases, splits on non-alphanumerics, drops short tokens + stopwords', () => {
    expect(tokenize('The Quick a brown fox-jumps!')).toEqual(['quick', 'brown', 'fox', 'jumps']);
  });
  it('returns [] for empty/garbage input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('!! a to of')).toEqual([]);
  });
});

describe('BM25', () => {
  it('returns [] for empty corpus or empty query', () => {
    const bm = new BM25();
    expect(bm.search('anything')).toEqual([]);
    bm.add('d1', 'hello world');
    expect(bm.search('')).toEqual([]);
  });

  it('IDF: a rare query term outranks a common one', () => {
    const bm = new BM25();
    bm.add('rare', 'zebra alpha beta');      // 'zebra' appears in 1 doc
    bm.add('common1', 'alpha code review');
    bm.add('common2', 'alpha deploy build');
    bm.add('common3', 'alpha test suite');
    const top = bm.search('zebra alpha')[0];
    expect(top.id).toBe('rare');             // rare term dominates via IDF
  });

  it('TF: more occurrences of a query term scores higher', () => {
    const bm = new BM25();
    bm.add('once', 'login flow handler');
    bm.add('twice', 'login login flow handler');
    const res = bm.search('login');
    const once = res.find(r => r.id === 'once')!;
    const twice = res.find(r => r.id === 'twice')!;
    expect(twice.score).toBeGreaterThan(once.score);
  });

  it('length-norm: a shorter doc outranks a longer doc with the same term count', () => {
    const bm = new BM25();
    bm.add('short', 'deploy server');
    bm.add('long', 'deploy server ' + 'filler word here extra padding more tokens '.repeat(4));
    const res = bm.search('deploy');
    expect(res[0].id).toBe('short');
  });

  it('respects topK', () => {
    const bm = new BM25();
    for (let i = 0; i < 5; i++) bm.add('d' + i, 'deploy server number ' + i);
    expect(bm.search('deploy', 2).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/match/bm25.test.ts`
Expected: FAIL — cannot find module `./bm25`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/match/bm25.ts
/** Pure Okapi BM25 keyword ranking — no dependencies. */

export interface Scored { id: string; score: number }

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on',
  'with', 'as', 'at', 'by', 'be', 'this', 'that', 'from', 'are', 'was',
]);

/** Lowercase, split on non-alphanumerics, drop very short tokens + stopwords. */
export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

interface Doc { id: string; tf: Map<string, number>; len: number }

export class BM25 {
  private k1: number;
  private b: number;
  private docs: Doc[] = [];
  private df = new Map<string, number>();
  private totalLen = 0;

  constructor(opts: { k1?: number; b?: number } = {}) {
    this.k1 = opts.k1 ?? 1.5;
    this.b = opts.b ?? 0.75;
  }

  add(id: string, text: string): void {
    const tokens = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.docs.push({ id, tf, len: tokens.length });
    this.totalLen += tokens.length;
  }

  search(query: string, topK = 10): Scored[] {
    const N = this.docs.length;
    if (N === 0) return [];
    const qTerms = Array.from(new Set(tokenize(query)));
    if (qTerms.length === 0) return [];
    const avg = this.totalLen / N || 1;

    const scored: Scored[] = this.docs.map(doc => {
      let score = 0;
      for (const term of qTerms) {
        const f = doc.tf.get(term);
        if (!f) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        score += idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * (doc.len / avg)));
      }
      return { id: doc.id, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/match/bm25.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/match/bm25.ts src/match/bm25.test.ts
git commit -m "feat(match): pure Okapi BM25 keyword matcher + tokenize"
```

---

### Task 2: Semantic embeddings (`embed` + `cosine`)

**Files:**
- Create: `src/match/embeddings.ts`
- Test: `src/match/embeddings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface EmbedOpts { baseUrl: string; model: string; httpPost?: (url: string, body: unknown) => Promise<unknown> }`; `function embed(texts: string[], opts: EmbedOpts): Promise<number[][] | null>`; `function cosine(a: number[], b: number[]): number`.

- [ ] **Step 1: Write the failing test**

```ts
// src/match/embeddings.test.ts
import { describe, it, expect, vi } from 'vitest';
import { embed, cosine } from './embeddings';

describe('cosine', () => {
  it('identical vectors → 1', () => { expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1); });
  it('orthogonal vectors → 0', () => { expect(cosine([1, 0], [0, 1])).toBeCloseTo(0); });
  it('opposite vectors → -1', () => { expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1); });
  it('mismatched length or zero vector → 0', () => {
    expect(cosine([1, 2], [1])).toBe(0);
    expect(cosine([0, 0], [0, 0])).toBe(0);
  });
});

describe('embed', () => {
  const opts = (httpPost: any) => ({ baseUrl: 'http://x', model: 'nomic-embed-text', httpPost });

  it('returns vectors from the injected httpPost', async () => {
    const httpPost = vi.fn().mockResolvedValue({ embeddings: [[1, 0], [0, 1]] });
    const res = await embed(['a', 'b'], opts(httpPost));
    expect(res).toEqual([[1, 0], [0, 1]]);
    expect(httpPost).toHaveBeenCalledWith('http://x/api/embed', { model: 'nomic-embed-text', input: ['a', 'b'] });
  });

  it('parses a JSON string body too', async () => {
    const httpPost = vi.fn().mockResolvedValue(JSON.stringify({ embeddings: [[1, 2, 3]] }));
    expect(await embed(['a'], opts(httpPost))).toEqual([[1, 2, 3]]);
  });

  it('returns null when httpPost throws', async () => {
    const httpPost = vi.fn().mockRejectedValue(new Error('connection refused'));
    expect(await embed(['a'], opts(httpPost))).toBeNull();
  });

  it('returns null when the embedding count does not match the input count', async () => {
    const httpPost = vi.fn().mockResolvedValue({ embeddings: [[1, 0]] });
    expect(await embed(['a', 'b'], opts(httpPost))).toBeNull();
  });

  it('returns [] for empty input without calling httpPost', async () => {
    const httpPost = vi.fn();
    expect(await embed([], opts(httpPost))).toEqual([]);
    expect(httpPost).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/match/embeddings.test.ts`
Expected: FAIL — cannot find module `./embeddings`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/match/embeddings.ts
/** Semantic embeddings via Ollama `/api/embed`. Never throws — returns null on failure. */
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface EmbedOpts {
  baseUrl: string;
  model: string;
  /** Injectable for tests; defaults to a real http/https POST. Returns raw body (string) or parsed object. */
  httpPost?: (url: string, body: unknown) => Promise<unknown>;
}

export async function embed(texts: string[], opts: EmbedOpts): Promise<number[][] | null> {
  if (!texts || texts.length === 0) return [];
  const post = opts.httpPost ?? defaultHttpPost;
  try {
    const url = `${opts.baseUrl.replace(/\/$/, '')}/api/embed`;
    const res = await post(url, { model: opts.model, input: texts });
    const data = (typeof res === 'string' ? JSON.parse(res) : res) as { embeddings?: number[][] };
    const embeddings = data?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) return null;
    return embeddings;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function defaultHttpPost(url: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => (data += c));
      res.on('end', () => {
        if ((res.statusCode || 200) >= 400) reject(new Error(`Embed error ${res.statusCode}: ${data}`));
        else resolve(data);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(Number(process.env.OLLAMA_TIMEOUT_MS) || 600_000, () => {
      req.destroy(new Error('Ollama embed request timed out.'));
    });
    req.write(bodyStr);
    req.end();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/match/embeddings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/match/embeddings.ts src/match/embeddings.test.ts
git commit -m "feat(match): Ollama semantic embeddings (embed/cosine), null-on-failure"
```

---

### Task 3: `OllamaProvider.embed()` + optional `Provider.embed`

**Files:**
- Modify: `src/providers/index.ts` (add optional `embed?` to the `Provider` interface)
- Modify: `src/providers/ollama.ts` (import `embed as embedTexts`, add `embed()` method)
- Test: `src/providers/ollama.embed.test.ts`

**Interfaces:**
- Consumes: `embed(texts, { baseUrl, model, httpPost })` from `../match/embeddings` (Task 2).
- Produces: `OllamaProvider.embed(texts: string[], model: string): Promise<number[][] | null>`; `Provider.embed?(texts: string[], model: string): Promise<number[][] | null>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/ollama.embed.test.ts
import { describe, it, expect } from 'vitest';
import { OllamaProvider } from './ollama';

describe('OllamaProvider.embed', () => {
  it('delegates to match/embeddings using the provider baseUrl + private httpPost', async () => {
    const p = new OllamaProvider('qwen2.5-coder:7b', 'http://localhost:11434');
    const calls: Array<{ url: string; body: unknown }> = [];
    // Override the private httpPost on the instance to avoid a real network call.
    (p as any).httpPost = async (url: string, body: object) => {
      calls.push({ url, body });
      return JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] });
    };
    const res = await p.embed(['hello'], 'nomic-embed-text');
    expect(res).toEqual([[0.1, 0.2, 0.3]]);
    expect(calls[0].url).toBe('http://localhost:11434/api/embed');
    expect(calls[0].body).toEqual({ model: 'nomic-embed-text', input: ['hello'] });
  });

  it('returns null when httpPost throws (model not pulled)', async () => {
    const p = new OllamaProvider('qwen2.5-coder:7b', 'http://localhost:11434');
    (p as any).httpPost = async () => { throw new Error('404 model not found'); };
    expect(await p.embed(['hello'], 'nomic-embed-text')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/ollama.embed.test.ts`
Expected: FAIL — `p.embed is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/providers/index.ts`, add to the `Provider` interface (alongside `complete`):

```ts
  /** Optional semantic embeddings (implemented by Ollama). Returns null on failure. */
  embed?(texts: string[], model: string): Promise<number[][] | null>;
```

In `src/providers/ollama.ts`, add the import at the top:

```ts
import { embed as embedTexts } from '../match/embeddings';
```

And add this method to the `OllamaProvider` class (e.g. directly after `complete()`):

```ts
  /** Semantic embeddings via Ollama /api/embed. Reuses the tested match/embeddings logic. */
  async embed(texts: string[], model: string): Promise<number[][] | null> {
    return embedTexts(texts, {
      baseUrl: this.baseUrl,
      model,
      // this.httpPost returns the raw body string; embedTexts JSON-parses it.
      httpPost: (url, body) => this.httpPost(url, body as object),
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/ollama.embed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/index.ts src/providers/ollama.ts src/providers/ollama.embed.test.ts
git commit -m "feat(providers): OllamaProvider.embed() + optional Provider.embed"
```

---

### Task 4: Hybrid matcher (RRF fusion + cache) + barrel

**Files:**
- Create: `src/match/hybrid.ts`
- Create: `src/match/index.ts`
- Test: `src/match/hybrid.test.ts`

**Interfaces:**
- Consumes: `BM25`, `Scored` from `./bm25` (Task 1); `cosine` from `./embeddings` (Task 2).
- Produces: `interface MatchDoc { id: string; text: string }`; `interface HybridOpts { topK?: number; embed?: (texts: string[]) => Promise<number[][] | null>; rrfK?: number }`; `function hybridSearch(query: string, docs: MatchDoc[], opts?: HybridOpts): Promise<Scored[]>`; `function clearEmbedCache(): void`. Barrel `src/match/index.ts` re-exports bm25 + embeddings + hybrid.

- [ ] **Step 1: Write the failing test**

```ts
// src/match/hybrid.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hybridSearch, clearEmbedCache } from './hybrid';

const DOCS = [
  { id: 'deploy', text: 'deploy the application to production server' },
  { id: 'review', text: 'review a pull request and leave comments' },
  { id: 'login', text: 'implement a user login authentication flow' },
];

beforeEach(() => clearEmbedCache());

describe('hybridSearch', () => {
  it('returns [] for empty docs', async () => {
    expect(await hybridSearch('anything', [])).toEqual([]);
  });

  it('BM25-only when no embed provided; scores normalized 0..1 desc', async () => {
    const res = await hybridSearch('deploy production', DOCS);
    expect(res[0].id).toBe('deploy');
    expect(res[0].score).toBeCloseTo(1); // top normalized to 1
    expect(res.every(r => r.score <= 1 && r.score >= 0)).toBe(true);
  });

  it('semantic ranking via RRF can change the order vs BM25-only', async () => {
    // Embeddings that make the query most similar to "review" even though BM25 favors "login".
    const vecByText: Record<string, number[]> = {
      'pr feedback': [0, 1, 0],
      'deploy the application to production server': [1, 0, 0],
      'review a pull request and leave comments': [0, 1, 0],
      'implement a user login authentication flow': [0, 0, 1],
    };
    const embed = vi.fn(async (texts: string[]) => texts.map(t => vecByText[t] ?? [0, 0, 0]));
    const res = await hybridSearch('pr feedback', DOCS, { embed });
    expect(res[0].id).toBe('review');
    expect(embed).toHaveBeenCalled();
  });

  it('falls back to BM25-only when embed returns null', async () => {
    const embed = vi.fn(async () => null);
    const res = await hybridSearch('deploy production', DOCS, { embed });
    expect(res[0].id).toBe('deploy');
  });

  it('caches embeddings: a repeated identical search does not re-embed', async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0]));
    await hybridSearch('deploy production', DOCS, { embed });
    const callsAfterFirst = embed.mock.calls.length;
    await hybridSearch('deploy production', DOCS, { embed });
    expect(embed.mock.calls.length).toBe(callsAfterFirst); // nothing new to embed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/match/hybrid.test.ts`
Expected: FAIL — cannot find module `./hybrid`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/match/hybrid.ts
/** Fuse BM25 keyword ranking with semantic embeddings via Reciprocal Rank Fusion. */
import { BM25, Scored } from './bm25';
import { cosine } from './embeddings';

export interface MatchDoc { id: string; text: string }
export interface HybridOpts {
  topK?: number;
  embed?: (texts: string[]) => Promise<number[][] | null>;
  rrfK?: number;
}

// Module-level in-memory cache (text → vector) to avoid re-embedding within a session.
const embedCache = new Map<string, number[]>();
export function clearEmbedCache(): void { embedCache.clear(); }

async function embedCached(
  embed: (texts: string[]) => Promise<number[][] | null>,
  texts: string[],
): Promise<number[][] | null> {
  const missing = texts.filter(t => !embedCache.has(t));
  if (missing.length > 0) {
    const vecs = await embed(missing);
    if (!vecs || vecs.length !== missing.length) return null;
    missing.forEach((t, i) => embedCache.set(t, vecs[i]));
  }
  return texts.map(t => embedCache.get(t)!);
}

export async function hybridSearch(query: string, docs: MatchDoc[], opts: HybridOpts = {}): Promise<Scored[]> {
  const topK = opts.topK ?? 10;
  const rrfK = opts.rrfK ?? 60;
  if (docs.length === 0) return [];

  // BM25 ranked list (over all docs so ranks are complete).
  const bm = new BM25();
  for (const d of docs) bm.add(d.id, d.text);
  const bmRanked = bm.search(query, docs.length);

  // Semantic ranked list (optional — degrade to BM25-only on any miss).
  let semRanked: Scored[] = [];
  if (opts.embed) {
    try {
      const vectors = await embedCached(opts.embed, [query, ...docs.map(d => d.text)]);
      if (vectors && vectors.length === docs.length + 1) {
        const qv = vectors[0];
        semRanked = docs
          .map((d, i) => ({ id: d.id, score: cosine(qv, vectors[i + 1]) }))
          .sort((a, b) => b.score - a.score);
      }
    } catch { /* degrade to BM25-only */ }
  }

  // RRF fuse: score += 1 / (rrfK + rank+1) for each list the id appears in.
  const rankIndex = (list: Scored[]) => {
    const m = new Map<string, number>();
    list.forEach((s, i) => m.set(s.id, i));
    return m;
  };
  const bmRank = rankIndex(bmRanked);
  const semRank = rankIndex(semRanked);
  const ids = new Set<string>([...bmRanked.map(s => s.id), ...semRanked.map(s => s.id)]);

  const fused: Scored[] = [];
  for (const id of ids) {
    let score = 0;
    if (bmRank.has(id)) score += 1 / (rrfK + bmRank.get(id)! + 1);
    if (semRank.has(id)) score += 1 / (rrfK + semRank.get(id)! + 1);
    fused.push({ id, score });
  }

  const max = Math.max(...fused.map(f => f.score), 1e-9);
  return fused
    .map(f => ({ id: f.id, score: f.score / max }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
```

```ts
// src/match/index.ts
export * from './bm25';
export * from './embeddings';
export * from './hybrid';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/match/hybrid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/match/hybrid.ts src/match/index.ts src/match/hybrid.test.ts
git commit -m "feat(match): hybrid BM25+semantic RRF fusion with embed cache + barrel"
```

---

### Task 5: NL intent router (`classifyIntent` + `applyRouterCommand`) + barrel

**Files:**
- Create: `src/router/router.ts`
- Create: `src/router/index.ts`
- Test: `src/router/router.test.ts`

**Interfaces:**
- Consumes: `hybridSearch` from `../match/hybrid` (Task 4); `Settings['router']` (Task 6 — but the helper only reads/writes a `router` object, so it is type-safe via the inline type here).
- Produces:
  - `type Intent = 'research' | 'goal' | 'workflow' | 'skill' | 'chat'`
  - `interface RouteDecision { kind: Intent; target?: string; confidence: number; reason: string }`
  - `interface RouterContext { skills: Array<{ name: string; description: string }>; workflows: Array<{ name: string; description?: string }>; threshold: number; embed?: (texts: string[]) => Promise<number[][] | null> }`
  - `interface RouterDeps { hybrid?: typeof import('../match/hybrid').hybridSearch }`
  - `function classifyIntent(text: string, ctx: RouterContext, deps?: RouterDeps): Promise<RouteDecision>`
  - `function applyRouterCommand(settings: { router?: { enabled?: boolean; confidenceThreshold?: number } }, arg?: string): { message: string; changed: boolean }`

- [ ] **Step 1: Write the failing test**

```ts
// src/router/router.test.ts
import { describe, it, expect, vi } from 'vitest';
import { classifyIntent, applyRouterCommand } from './router';

const ctx = {
  skills: [{ name: 'github', description: 'GitHub ops via gh CLI: issues, PRs, CI' }],
  workflows: [{ name: 'deploy-app', description: 'build, test and deploy the app' }],
  threshold: 0.6,
};
// Deterministic hybrid stub: returns a hit only when the query mentions the doc id.
const hybridStub = (target: string, score: number) =>
  vi.fn(async () => [{ id: target, score }]);

describe('classifyIntent — chat guard', () => {
  it('empty / whitespace → chat', async () => {
    expect((await classifyIntent('   ', ctx)).kind).toBe('chat');
  });
  it('a bare question with no research verb → chat', async () => {
    expect((await classifyIntent('what is a closure?', ctx)).kind).toBe('chat');
  });
  it('a code paste → chat', async () => {
    expect((await classifyIntent('const add = (a, b) => a + b;', ctx)).kind).toBe('chat');
  });
});

describe('classifyIntent — signals', () => {
  it('a research verb → research', async () => {
    const d = await classifyIntent('research the latest on rust async runtimes', ctx);
    expect(d.kind).toBe('research');
    expect(d.confidence).toBeGreaterThanOrEqual(0.6);
  });
  it('a goal verb → goal', async () => {
    const d = await classifyIntent('build a working login flow and keep going until tests pass', ctx);
    expect(d.kind).toBe('goal');
  });
});

describe('classifyIntent — named items via hybrid', () => {
  it('a strong workflow match → workflow target', async () => {
    const d = await classifyIntent('run the deploy-app pipeline', ctx, { hybrid: hybridStub('deploy-app', 0.9) });
    expect(d.kind).toBe('workflow');
    expect(d.target).toBe('deploy-app');
  });
  it('a strong skill match → skill target', async () => {
    const d = await classifyIntent('use the github skill to open a PR', ctx, { hybrid: hybridStub('github', 0.85) });
    expect(d.kind).toBe('skill');
    expect(d.target).toBe('github');
  });
  it('a below-threshold match → chat', async () => {
    const d = await classifyIntent('something only loosely related here', ctx, { hybrid: hybridStub('deploy-app', 0.3) });
    expect(d.kind).toBe('chat');
  });
});

describe('classifyIntent — never throws', () => {
  it('a throwing hybrid → chat', async () => {
    const hybrid = vi.fn(async () => { throw new Error('boom'); });
    expect((await classifyIntent('run the deploy-app pipeline', ctx, { hybrid })).kind).toBe('chat');
  });
});

describe('applyRouterCommand', () => {
  it('on/off mutate settings; status reports', () => {
    const s: any = { router: { enabled: true } };
    expect(applyRouterCommand(s, 'off').changed).toBe(true);
    expect(s.router.enabled).toBe(false);
    expect(applyRouterCommand(s, 'on').changed).toBe(true);
    expect(s.router.enabled).toBe(true);
    expect(applyRouterCommand(s, 'status').changed).toBe(false);
    expect(applyRouterCommand(s, 'status').message.toLowerCase()).toContain('on');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/router/router.test.ts`
Expected: FAIL — cannot find module `./router`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/router/router.ts
/** Natural-language intent router — layered local heuristic + hybrid matcher. Never throws. */
import { hybridSearch as realHybrid } from '../match/hybrid';

export type Intent = 'research' | 'goal' | 'workflow' | 'skill' | 'chat';

export interface RouteDecision { kind: Intent; target?: string; confidence: number; reason: string }

export interface RouterContext {
  skills: Array<{ name: string; description: string }>;
  workflows: Array<{ name: string; description?: string }>;
  threshold: number;
  /** Optional semantic embed for the hybrid named-item match; absent → BM25-only. */
  embed?: (texts: string[]) => Promise<number[][] | null>;
}

export interface RouterDeps { hybrid?: typeof realHybrid }

const RESEARCH_RE = /\b(research|look it up|look up|find out|search the web|google|what'?s the latest|latest on|investigate online)\b/i;
const GOAL_RE = /\b(keep going until|autonomously|do everything|pursue|accomplish|implement .* and|build .* and|make .* work)\b/i;
const GOAL_VERB_RE = /\b(build|implement|create|refactor|fix|add)\b/i;
const CODE_RE = /(=>|;\s*$|\{[\s\S]*\}|```|\bfunction\b|\bconst\b\s+\w+\s*=)/;

const RESEARCH_CONF = 0.75;
const GOAL_STRONG_CONF = 0.7;
const GOAL_WEAK_CONF = 0.62;

function chat(reason: string): RouteDecision { return { kind: 'chat', confidence: 1, reason }; }

export async function classifyIntent(text: string, ctx: RouterContext, deps: RouterDeps = {}): Promise<RouteDecision> {
  try {
    const t = (text || '').trim();

    // 1. Chat guard — never hijack normal usage.
    if (t.length < 3) return chat('empty or too short');
    if (CODE_RE.test(t)) return chat('looks like code');
    if (t.endsWith('?') && !RESEARCH_RE.test(t)) return chat('plain question');

    // 2. Intent signals (regex, local).
    const candidates: RouteDecision[] = [];
    if (RESEARCH_RE.test(t)) candidates.push({ kind: 'research', confidence: RESEARCH_CONF, reason: 'research verb' });
    if (GOAL_RE.test(t)) candidates.push({ kind: 'goal', confidence: GOAL_STRONG_CONF, reason: 'autonomous-goal phrasing' });
    else if (GOAL_VERB_RE.test(t)) candidates.push({ kind: 'goal', confidence: GOAL_WEAK_CONF, reason: 'build/implement verb' });

    // 3. Named-item match via hybrid over workflows + skills.
    const hybrid = deps.hybrid ?? realHybrid;
    const wfNames = new Set(ctx.workflows.map(w => w.name));
    const docs = [
      ...ctx.workflows.map(w => ({ id: w.name, text: `${w.name} ${w.description ?? ''}` })),
      ...ctx.skills.map(s => ({ id: s.name, text: `${s.name} ${s.description}` })),
    ];
    if (docs.length > 0) {
      const hits = await hybrid(t, docs, { embed: ctx.embed, topK: 1 });
      const top = hits[0];
      if (top && top.score >= ctx.threshold) {
        const kind: Intent = wfNames.has(top.id) ? 'workflow' : 'skill';
        candidates.push({ kind, target: top.id, confidence: top.score, reason: `matched ${kind} "${top.id}"` });
      }
    }

    // 4. Fuse + threshold: highest confidence ≥ threshold wins; tie → named-item (has target).
    const eligible = candidates.filter(c => c.confidence >= ctx.threshold);
    if (eligible.length === 0) return chat('no confident match');
    eligible.sort((a, b) => (b.confidence - a.confidence) || ((b.target ? 1 : 0) - (a.target ? 1 : 0)));
    return eligible[0];
  } catch {
    return chat('router error');
  }
}

/** Pure helper for the `/router on|off|status` slash command. Mutates settings.router in place. */
export function applyRouterCommand(
  settings: { router?: { enabled?: boolean; confidenceThreshold?: number } },
  arg?: string,
): { message: string; changed: boolean } {
  settings.router = settings.router ?? {};
  const a = (arg || '').toLowerCase();
  if (a === 'on') { settings.router.enabled = true; return { message: 'Router enabled.', changed: true }; }
  if (a === 'off') { settings.router.enabled = false; return { message: 'Router disabled.', changed: true }; }
  const state = settings.router.enabled === false ? 'off' : 'on';
  const thr = settings.router.confidenceThreshold ?? 0.6;
  return { message: `Router is ${state} (confidence threshold ${thr}). Usage: /router on|off|status`, changed: false };
}
```

```ts
// src/router/index.ts
export * from './router';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/router/router.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/router/router.ts src/router/index.ts src/router/router.test.ts
git commit -m "feat(router): classifyIntent NL intent router + /router toggle helper"
```

---

### Task 6: `settings.router` defaults + `embeddingsModel`

**Files:**
- Modify: `src/config/settings.ts`
- Test: `src/config/settings.router.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Settings['router']` shape `{ enabled?: boolean; confidenceThreshold?: number; confirmGoal?: boolean; autoRunSafe?: boolean; llmAssist?: boolean }`; `ProviderConfig.embeddingsModel?: string`; defaults wired in `DEFAULT_SETTINGS`.

- [ ] **Step 1: Write the failing test**

```ts
// src/config/settings.router.test.ts
import { describe, it, expect } from 'vitest';
import { getDefaultSettings } from './settings';

describe('settings.router defaults', () => {
  it('router is enabled with a 0.6 threshold and goal-confirm on', () => {
    const s = getDefaultSettings();
    expect(s.router).toBeDefined();
    expect(s.router!.enabled).toBe(true);
    expect(s.router!.confidenceThreshold).toBe(0.6);
    expect(s.router!.confirmGoal).toBe(true);
    expect(s.router!.autoRunSafe).toBe(true);
    expect(s.router!.llmAssist).toBe(false);
  });
  it('ollama provider defaults to the nomic-embed-text embeddings model', () => {
    const s = getDefaultSettings();
    expect(s.providers.ollama.embeddingsModel).toBe('nomic-embed-text');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/settings.router.test.ts`
Expected: FAIL — `s.router` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/config/settings.ts`:

Add `embeddingsModel` to `ProviderConfig`:

```ts
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  headers?: Record<string, string>;
  embeddingsModel?: string;   // Ollama semantic-embeddings model (e.g. nomic-embed-text)
}
```

Add `router` to the `Settings` interface (after `research?`):

```ts
  router?: {
    enabled?: boolean;
    confidenceThreshold?: number;
    confirmGoal?: boolean;
    autoRunSafe?: boolean;
    llmAssist?: boolean;
  };
```

In `DEFAULT_SETTINGS`, add `embeddingsModel` to the ollama provider:

```ts
    ollama: {
      baseUrl: 'http://localhost:11434',
      model: 'qwen2.5-coder:7b',
      embeddingsModel: 'nomic-embed-text',
    },
```

And add the `router` block (after `research: { ... }`):

```ts
  router: {
    enabled: true,
    confidenceThreshold: 0.6,
    confirmGoal: true,
    autoRunSafe: true,
    llmAssist: false,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/settings.router.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/settings.ts src/config/settings.router.test.ts
git commit -m "feat(config): settings.router defaults + ollama embeddingsModel"
```

---

### Task 7: CLI wiring (router intercept + `/router` + help)

**Files:**
- Modify: `src/cli.ts` (imports; router intercept before `runAgent` ~line 251; `/router` case in `handleSlashCommand`)
- Modify: `src/ui/terminal.ts` (help line)
- Test: `src/cli.router-glue.test.ts` (pure glue helpers only)

**Interfaces:**
- Consumes: `classifyIntent`, `applyRouterCommand` from `./router/index` (Task 5); `loadWorkflows`, `workflowDirs` from `./workflow/loader`; `runResearch`, `slugify` (already imported); `runGoal`, `runWorkflow`; `buildRunnerContext`; `saveSettings`; provider `embed?`.
- Produces: `function defaultGoalAllowList(): string[]`; `function routerNotice(d: { kind: string; target?: string; reason: string }): string` (exported pure helpers for testing the glue's deterministic parts).

- [ ] **Step 1: Write the failing test**

```ts
// src/cli.router-glue.test.ts
import { describe, it, expect } from 'vitest';
import { defaultGoalAllowList, routerNotice } from './cli';

describe('router glue helpers', () => {
  it('defaultGoalAllowList covers the standard safe tool set', () => {
    expect(defaultGoalAllowList()).toEqual(
      ['run_command', 'read_file', 'write_file', 'edit_file', 'search_files', 'list_files'],
    );
  });
  it('routerNotice renders kind + target + reason; never for chat callers', () => {
    expect(routerNotice({ kind: 'workflow', target: 'deploy-app', reason: 'matched workflow "deploy-app"' }))
      .toContain('deploy-app');
    expect(routerNotice({ kind: 'research', reason: 'research verb' })).toContain('research');
  });
});
```

> Note: `defaultGoalAllowList` and `routerNotice` must be exported from `cli.ts`. The imperative router block + `/router` case are integration glue verified by the live smoke (Task 8), not unit tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli.router-glue.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Write minimal implementation**

In `src/cli.ts`, add imports near the existing `runResearch` import (line ~43):

```ts
import { classifyIntent, applyRouterCommand } from './router/index';
import { loadWorkflows, workflowDirs } from './workflow/loader';
import { saveSettings } from './config/settings';
```

> If any of these (`loadWorkflows`/`workflowDirs`/`runWorkflow`/`saveSettings`) is already imported elsewhere in `cli.ts`, do not duplicate — reuse the existing import. Verify with a quick grep before adding.

Add the two exported pure helpers near the top-level helpers of `cli.ts` (module scope, not inside a function):

```ts
/** The pre-authorized safe tool set used when the router auto-pursues a goal. */
export function defaultGoalAllowList(): string[] {
  return ['run_command', 'read_file', 'write_file', 'edit_file', 'search_files', 'list_files'];
}

/** Dim one-line notice shown when the router takes a non-chat action. */
export function routerNotice(d: { kind: string; target?: string; reason: string }): string {
  return `→ routing to ${d.kind}${d.target ? ` (${d.target})` : ''} — ${d.reason}`;
}
```

Add the router intercept in the main chat loop, immediately AFTER the slash-command block and BEFORE `history.addMessage({ role: 'user', content: input })` (currently line ~256):

```ts
    // ── Natural-language intent routing (no slash needed) ───────────────────
    // The router NEVER blocks input: any error or low-confidence → normal chat.
    if (settings.router?.enabled !== false) {
      try {
        const ollamaEmbed = providerName === 'ollama' && typeof provider.embed === 'function'
          ? (texts: string[]) => provider.embed!(texts, settings.providers.ollama?.embeddingsModel || 'nomic-embed-text')
          : undefined;
        const routerCtx = {
          skills: skills.list().map(s => ({ name: s.name, description: s.description })),
          workflows: Array.from(loadWorkflows(workflowDirs(cwd)).values())
            .map(w => ({ name: w.name, description: (w as { description?: string }).description })),
          threshold: settings.router?.confidenceThreshold ?? 0.6,
          embed: ollamaEmbed,
        };
        const decision = await classifyIntent(input, routerCtx);
        if (decision.kind !== 'chat') {
          console.log(chalk.dim('  ' + routerNotice(decision)));
        }

        if (decision.kind === 'research') {
          history.addMessage({ role: 'user', content: input });
          const res = await runResearch({ question: input }, buildRunnerContext(makeSlashCtx()));
          if (res.stoppedBy === 'no_sources' || res.stoppedBy === 'error') {
            printError(res.report);
          } else {
            printSectionHeader('🔬 Research'); console.log(res.report);
            const file = path.join(cwd, `research-${slugify(input)}.md`);
            const header = `# Research: ${input}\n\n_Sources:_\n${res.sources.map(s => `- [${s.title}](${s.url})`).join('\n')}\n\n---\n\n`;
            fs.writeFileSync(file, header + res.report, 'utf-8');
            printInfo(`Saved → ${file}  (${res.usage.total_tokens} tokens, ${res.sources.length} sources)`);
          }
          continue;
        }

        if (decision.kind === 'workflow' && decision.target) {
          const def = loadWorkflows(workflowDirs(cwd)).get(decision.target);
          if (def) {
            history.addMessage({ role: 'user', content: input });
            const run = await runWorkflow(def, {}, buildRunnerContext(makeSlashCtx()));
            console.log(`\n${run.ok ? chalk.green('Workflow complete.') : chalk.yellow('Workflow finished with failures.')} ${chalk.dim(`(${run.usage.total_tokens} tokens)`)}`);
            const last = run.steps[run.steps.length - 1];
            if (last?.output) { printSectionHeader(`Output: ${last.id}`); console.log(last.output); }
            continue;
          }
          // target vanished → fall through to chat
        }

        if (decision.kind === 'goal') {
          let go = true;
          if (settings.router?.confirmGoal !== false) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
            const inq = require('inquirer') as any;
            ({ go } = await inq.prompt([{ type: 'confirm', name: 'go', message: `Pursue "${input}" as an autonomous goal?`, default: false }]));
          }
          if (go) {
            history.addMessage({ role: 'user', content: input });
            const res = await runGoal({ goal: input, allow: defaultGoalAllowList() }, buildRunnerContext(makeSlashCtx()));
            console.log(`\n  ${res.ok ? chalk.green('✓ ' + res.summary) : chalk.yellow('• ' + res.summary)} ${chalk.dim(`(${res.usage.total_tokens} tokens, stopped: ${res.stoppedBy})`)}`);
            continue;
          }
          // declined → fall through to normal chat
        }
        // 'skill' or 'chat' → fall through to runAgent (skill context auto-injected there)
      } catch { /* router must never break chat */ }
    }
```

> The existing `history.addMessage({ role: 'user', content: input })` at ~line 266 stays for the chat path. Because each handled route above adds the user message itself then `continue`s, the chat path runs that line exactly once.

Add the `/router` case in `handleSlashCommand`'s switch (next to the `research` case ~line 1617):

```ts
    // ── Router ──────────────────────────────────────────────────────────────────
    case 'router': {
      const { message, changed } = applyRouterCommand(ctx.settings, args[0]);
      if (changed) saveSettings(ctx.settings);
      printInfo(message);
      break;
    }
```

In `src/ui/terminal.ts`, add a help line after the `/research` line (~166):

```ts
  ${c.green('/router')} on|off|status   Natural-language routing (text → research/goal/workflow/skill)
```

- [ ] **Step 4: Run the glue test + full suite**

Run: `npx vitest run src/cli.router-glue.test.ts`
Expected: PASS.

Run: `npx vitest run`
Expected: PASS — all prior 202 tests + the new ones (target ≈ 225+).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/ui/terminal.ts src/cli.router-glue.test.ts
git commit -m "feat(router): wire NL router into cli.ts + /router command + help"
```

---

### Task 8: Build, full suite, live smoke, dist, tag

**Files:**
- Modify: `dist/**` (rebuilt artifacts)

- [ ] **Step 1: Typecheck + build**

Run: `npm run build`
Expected: clean compile, no TS errors, `*.test.ts` excluded from `dist/`.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all green (≈ 225+ tests).

- [ ] **Step 3: Pull the embeddings model (one-time)**

Run: `ollama pull nomic-embed-text`
Expected: model downloaded to `E:\ollama-models`.

- [ ] **Step 4: Live smoke (router routing vs chat)**

Confirm Ollama is running, then run the linked CLI (`coderaw`) and verify by typing plain text (no `/`):
- `research the latest on the Zig language` → prints `→ routing to research` and produces a cited report file.
- `run the <name-of-an-existing-workflow>` → prints `→ routing to workflow (<name>)` and runs it. (Use a workflow present in `.coderaw/workflows` or skip if none.)
- `build a small script that prints hello and keep going until it runs` → prints `→ routing to goal` and **asks to confirm** before running.
- `what does this function do?` → NO routing line; falls through to normal chat.
- `const x = () => 1` → NO routing line; normal chat.
- `/router off` → then plain text no longer routes (chat only); `/router on` restores; `/router status` reports state.
- BM25-only path: temporarily set `providers.ollama.embeddingsModel` to a non-existent model (or skip the pull) → routing still works (no crash; named-item match degrades to BM25-only).

Capture the routing lines as evidence.

- [ ] **Step 5: Rebuild dist + commit + tag**

```bash
npm run build
git add dist src
git commit -m "build(router): rebuild dist for hybrid matcher + NL intent router"
git tag p4b-hybrid-router
```

- [ ] **Step 6: Merge to main + push**

```bash
git checkout main
git merge --no-ff hybrid-router -m "merge: #4 slice 2 — hybrid matcher (BM25+semantic) + NL intent router"
git push origin main
git push origin p4b-hybrid-router
```

---

## Self-Review

**1. Spec coverage** (spec §§4–11 → tasks):
- §4 `bm25.ts` → Task 1 ✓ · `embeddings.ts` → Task 2 ✓ · `hybrid.ts` (RRF + cache, sqlite-vec OUT) → Task 4 ✓
- §5 `classifyIntent` layered (chat guard → signals → named-item → fuse) → Task 5 ✓
- §6 cli wiring (research/skill/workflow auto-run; goal confirm; low-conf→chat) → Task 7 ✓
- §7 `settings.router` + `embeddingsModel` + `/router` → Tasks 6 (config) + 7 (`/router`) ✓
- §8 error handling (embed→null, classify→chat, disabled→skip) → Tasks 2/4/5/7 ✓
- §9 tests (bm25/embeddings/hybrid/classifyIntent/settings/`/router`/live smoke) → Tasks 1–8 ✓
- §10 build order (8 steps) → Tasks 1–8, in order ✓
- §11 file layout → File Structure section ✓
- §12 out-of-scope (sqlite-vec, RAG/memory rewire, Skill tool, full LLM classifier) → not built; `embed?` provider hook + matcher are the only seams added ✓
- `OllamaProvider.embed()` (§10 step 3, §11) → Task 3 ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — every code step is complete and copy-paste runnable.

**3. Type consistency:** `Scored` (bm25) reused by hybrid; `MatchDoc`/`HybridOpts`/`hybridSearch` signatures match between Task 4 and the `RouterDeps.hybrid` type + the cli call in Task 7; `embed(texts, opts)` signature identical across Tasks 2/3/4; `RouteDecision`/`RouterContext` fields used in Task 7's `routerCtx` match Task 5's definitions (`skills`, `workflows`, `threshold`, `embed`); `applyRouterCommand` settings shape matches `settings.router` from Task 6; provider `embed?` optional method (Task 3) is what Task 7 duck-checks via `typeof provider.embed === 'function'`.

**One intentional spec extension:** `RouterContext.embed?` is added (spec §5 lists the three core fields) so the CLI can thread the Ollama-bound semantic embed into the named-item match; absent → BM25-only. Minimal and consistent with the slice's "BM25 + semantic under the router" purpose.
