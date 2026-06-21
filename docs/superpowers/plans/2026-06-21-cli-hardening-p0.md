# CLI Hardening P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make coderaw's agent loop reliable on any model — robust tool-call recovery + one-shot repair, streaming during tool turns, and fast correct ripgrep search.

**Architecture:** Keep the existing `Provider` interface and the `runAgent` loop. Harden three seams: (1) tool-call recovery is a pure, unit-tested function in `ollama.ts`; (2) a bounded repair retry lives in `core.ts`; (3) `search_files` shells out to a bundled `rg` binary with a graceful fallback. Add `vitest` as the test runner (none exists today).

**Tech Stack:** TypeScript 5.3 (CommonJS), Node ≥18 (dev on 24), vitest, `@vscode/ripgrep`.

## Global Constraints

- Node `>=18`; TypeScript `^5.3.3`; CommonJS output (no `"type":"module"`). Copy verbatim from `package.json`.
- Do NOT change the public `Provider` / `CompletionResult` / `Message` shapes in `src/providers/index.ts`.
- Tool-call `arguments` are stored as a **JSON string** internally (existing convention) — preserve it.
- Match existing style: 2-space indent, no semicolon removal, keep comments terse.
- Every commit message uses Conventional Commits (`feat:` / `fix:` / `test:` / `chore:`).

---

### Task 0: Add the vitest test harness

**Files:**
- Modify: `package.json` (devDependency + `test` script)
- Create: `vitest.config.ts`
- Create: `src/sanity.test.ts` (temporary, deleted at end of task)

**Interfaces:**
- Produces: a working `npm test` command that runs `*.test.ts` files under `src/`.

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest@^2`
Expected: `added` lines, exit 0.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Add the test script** — in `package.json` `"scripts"`, add:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 4: Write a sanity test** — `src/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
describe('sanity', () => {
  it('runs', () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 6: Delete the sanity test and commit**

Run: `rm src/sanity.test.ts`
```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest test harness"
```

---

### Task 1: Tool-call recovery v2 (prose-tolerant + multiple calls)

**Files:**
- Modify: `src/providers/ollama.ts` (export `recoverToolCallsFromText`; add `extractAllJsonObjects`; use it in the bare-text branch)
- Test: `src/providers/ollama.recovery.test.ts`

**Interfaces:**
- Consumes: existing `recoverToolCallsFromText(content: string): RecoveredToolCall[]` and `extractFirstJsonObject(text: string): string | null`.
- Produces: `export function recoverToolCallsFromText(...)` (now exported) handling leading prose and multiple bare JSON objects.

- [ ] **Step 1: Write the failing tests** — `src/providers/ollama.recovery.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { recoverToolCallsFromText } from './ollama';

const names = (r: ReturnType<typeof recoverToolCallsFromText>) => r.map(c => c.function.name);

describe('recoverToolCallsFromText', () => {
  it('recovers a bare object', () => {
    const r = recoverToolCallsFromText('{"name":"read_file","arguments":{"path":"a.ts"}}');
    expect(names(r)).toEqual(['read_file']);
    expect(JSON.parse(r[0].function.arguments)).toEqual({ path: 'a.ts' });
  });
  it('recovers from a ```json fence', () => {
    const r = recoverToolCallsFromText('```json\n{"name":"list_files","arguments":{}}\n```');
    expect(names(r)).toEqual(['list_files']);
  });
  it('recovers from <tool_call> tags', () => {
    const r = recoverToolCallsFromText('<tool_call>{"name":"git_status","arguments":{}}</tool_call>');
    expect(names(r)).toEqual(['git_status']);
  });
  it('tolerates leading prose', () => {
    const r = recoverToolCallsFromText('Sure! {"name":"read_file","arguments":{"path":"a"}}');
    expect(names(r)).toEqual(['read_file']);
  });
  it('recovers multiple bare calls', () => {
    const r = recoverToolCallsFromText('{"name":"a","arguments":{}} {"name":"b","arguments":{}}');
    expect(names(r)).toEqual(['a', 'b']);
  });
  it('returns [] for plain prose', () => {
    expect(recoverToolCallsFromText('The version is 1.0.0')).toEqual([]);
  });
  it('returns [] for malformed JSON', () => {
    expect(recoverToolCallsFromText('{"name":"read_file","arguments":{')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- ollama.recovery`
Expected: FAIL — `recoverToolCallsFromText` is not exported (import error) and/or "multiple bare calls" returns `['a']`.

- [ ] **Step 3: Export the function and add multi-object extraction** — in `src/providers/ollama.ts`:

Change `function recoverToolCallsFromText` to `export function recoverToolCallsFromText`.

Replace the bare-text branch:
```ts
  if (candidates.length === 0) {
    const firstBrace = text.search(/[[{]/);
    if (firstBrace >= 0) candidates.push(text.slice(firstBrace));
  }
```
with:
```ts
  if (candidates.length === 0) {
    candidates.push(...extractAllJsonObjects(text));
  }
```

Add this helper next to `extractFirstJsonObject`:
```ts
function extractAllJsonObjects(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  for (;;) {
    const obj = extractFirstJsonObject(rest);
    if (!obj) break;
    out.push(obj);
    const idx = rest.indexOf(obj);
    rest = rest.slice(idx + obj.length);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- ollama.recovery`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/providers/ollama.ts src/providers/ollama.recovery.test.ts
git commit -m "feat: recover prose-wrapped and multiple text tool calls"
```

---

### Task 2: One-shot repair when a tool call is malformed

**Files:**
- Modify: `src/agent/core.ts` (detect "looks like a botched tool call" and re-prompt once)
- Test: `src/agent/core.repair.test.ts`

**Interfaces:**
- Consumes: `runAgent(provider, conversation, userMessage, options)` from `src/agent/core.ts`; `createConversation` from `src/agent/conversation.ts`; the `Provider` interface from `src/providers/index.ts`.
- Produces: behavior — when an assistant turn has no `tool_calls` but its `content` looks like an attempted tool call (`looksLikeToolAttempt(content)` true), `runAgent` injects one corrective user message and loops once more before finishing. New exported helper `export function looksLikeToolAttempt(content: string): boolean`.

- [ ] **Step 1: Write the failing test** — `src/agent/core.repair.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { looksLikeToolAttempt } from './core';

describe('looksLikeToolAttempt', () => {
  it('true for a JSON object mentioning name+arguments', () => {
    expect(looksLikeToolAttempt('{"name":"read_file","arguments":{')).toBe(true);
  });
  it('true for a <tool_call> opener', () => {
    expect(looksLikeToolAttempt('<tool_call>{"name":')).toBe(true);
  });
  it('false for ordinary prose', () => {
    expect(looksLikeToolAttempt('The file contains a config object.')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- core.repair`
Expected: FAIL — `looksLikeToolAttempt` not exported.

- [ ] **Step 3: Implement the helper** — add to `src/agent/core.ts` (module scope):

```ts
/** Heuristic: the model tried to call a tool but emitted broken/partial JSON. */
export function looksLikeToolAttempt(content: string): boolean {
  const t = (content || '').trim();
  if (!t) return false;
  if (t.includes('<tool_call>')) return true;
  if (/"name"\s*:/.test(t) && /"(arguments|parameters)"\s*:/.test(t)) return true;
  return false;
}
```

- [ ] **Step 4: Wire the one-shot repair into the loop** — in `runAgent`, inside the `if (!result.tool_calls || result.tool_calls.length === 0)` block in `src/agent/core.ts`, replace:

```ts
    if (!result.tool_calls || result.tool_calls.length === 0) {
      addMessage(conversation, { role: 'assistant', content: result.content });
      break;
    }
```
with:
```ts
    if (!result.tool_calls || result.tool_calls.length === 0) {
      if (looksLikeToolAttempt(result.content) && !repairedOnce) {
        repairedOnce = true;
        addMessage(conversation, { role: 'assistant', content: result.content });
        addMessage(conversation, {
          role: 'user',
          content: 'Your previous tool call was not valid JSON. Resend ONLY the corrected tool call as a single JSON object {"name":..., "arguments":{...}} with no extra text.',
        });
        continue;
      }
      addMessage(conversation, { role: 'assistant', content: result.content });
      break;
    }
```

Declare the flag once, just before the `while (iterations < maxIterations)` loop:
```ts
  let repairedOnce = false;
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- core.repair`
Expected: 3 passed.

- [ ] **Step 6: Build to confirm the loop change type-checks**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/agent/core.ts src/agent/core.repair.test.ts
git commit -m "feat: one-shot repair re-prompt on malformed tool calls"
```

---

### Task 3: Stream tokens during tool turns

**Files:**
- Modify: `src/providers/ollama.ts` (`complete` gate + `streamComplete` recovers tool calls)

**Interfaces:**
- Consumes: existing `streamComplete(body, onToken)` and `recoverToolCallsFromText`.
- Produces: `complete()` streams when `onToken` is set even if `tools` are present; `streamComplete` returns `{ content, tool_calls, usage }` where `tool_calls` come from recovery over the accumulated stream.

- [ ] **Step 1: Write the failing test** — append to `src/providers/ollama.recovery.test.ts`:

```ts
import { recoverFromStreamedContent } from './ollama';

describe('recoverFromStreamedContent', () => {
  it('extracts tool calls from accumulated streamed text', () => {
    const acc = 'Working on it...\n{"name":"read_file","arguments":{"path":"x"}}';
    const r = recoverFromStreamedContent(acc);
    expect(r.tool_calls?.map(c => c.function.name)).toEqual(['read_file']);
    expect(r.content).toBe('');
  });
  it('keeps content when there is no tool call', () => {
    const r = recoverFromStreamedContent('just an answer');
    expect(r.tool_calls).toBeUndefined();
    expect(r.content).toBe('just an answer');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- ollama.recovery`
Expected: FAIL — `recoverFromStreamedContent` not exported.

- [ ] **Step 3: Add the helper** — in `src/providers/ollama.ts`:

```ts
export function recoverFromStreamedContent(content: string): { content: string; tool_calls?: RecoveredToolCall[] } {
  const recovered = recoverToolCallsFromText(content);
  if (recovered.length > 0) return { content: '', tool_calls: recovered };
  return { content };
}
```

- [ ] **Step 4: Use it in `streamComplete`** — in `src/providers/ollama.ts`, change the `res.on('end', ...)` resolve to recover tool calls:

```ts
        res.on('end', () => {
          const { content, tool_calls } = recoverFromStreamedContent(fullContent);
          resolve({
            content,
            tool_calls,
            usage: {
              prompt_tokens: totalPromptTokens,
              completion_tokens: totalCompletionTokens,
              total_tokens: totalPromptTokens + totalCompletionTokens,
            },
          });
        });
```

- [ ] **Step 5: Open the streaming gate for tool turns** — in `complete()`, change:

```ts
      stream: stream && !tools,
```
to:
```ts
      stream: stream && !!onToken,
```
and change the early streaming branch condition:
```ts
    if (stream && !tools && onToken) {
      return this.streamComplete(body, onToken);
    }
```
to:
```ts
    if (stream && onToken) {
      return this.streamComplete(body, onToken);
    }
```

- [ ] **Step 6: Run unit tests**

Run: `npm test -- ollama.recovery`
Expected: 9 passed.

- [ ] **Step 7: Build, then manual smoke (streaming + tool exec together)**

Run: `npm run build`
Then (Ollama running, qwen warm):
```bash
node dist/index.js --provider ollama --model qwen2.5-coder:7b "Read package.json and tell me the version."
```
Expected: tokens visible during the turn; `read_file` executes; final answer `1.0.0`.

- [ ] **Step 8: Commit**

```bash
git add src/providers/ollama.ts src/providers/ollama.recovery.test.ts
git commit -m "feat: stream tokens during tool-call turns for ollama"
```

---

### Task 4: ripgrep-backed search

**Files:**
- Modify: `package.json` (add `@vscode/ripgrep`)
- Modify: `src/agent/tools.ts` (`searchFiles` uses `rg`, falls back to current impl)
- Test: `src/agent/tools.search.test.ts`

**Interfaces:**
- Consumes: existing `executeTool('search_files', args, cwd)` from `src/agent/tools.ts`.
- Produces: `searchFiles` returns matches via ripgrep; new exported `export function rgPath(): string | null` resolving the bundled binary.

- [ ] **Step 1: Install ripgrep binary package**

Run: `npm install @vscode/ripgrep`
Expected: exit 0; downloads the `rg` binary.

- [ ] **Step 2: Write the failing test** — `src/agent/tools.search.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { executeTool } from './tools';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgtest-'));
  fs.writeFileSync(path.join(dir, 'a.ts'), 'const NEEDLE = 1;\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'no match here\n');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('search_files', () => {
  it('finds a pattern in the right file', async () => {
    const r = await executeTool('search_files', { pattern: 'NEEDLE', path: dir }, dir);
    expect(r.isError).not.toBe(true);
    expect(r.content).toMatch(/a\.ts/);
    expect(r.content).not.toMatch(/b\.txt/);
  });
  it('respects a file glob', async () => {
    const r = await executeTool('search_files', { pattern: 'match', path: dir, file_pattern: '*.txt' }, dir);
    expect(r.content).toMatch(/b\.txt/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- tools.search`
Expected: FAIL — current `findstr`/`grep` output format won't match, or behaves inconsistently in the sandbox.

- [ ] **Step 4: Implement rg-backed search** — in `src/agent/tools.ts`, add near the top:

```ts
export function rgPath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@vscode/ripgrep') as { rgPath: string }).rgPath;
  } catch { return null; }
}
```

Replace the body of `searchFiles` with:
```ts
function searchFiles(args: { pattern: string; path?: string; file_pattern?: string; case_sensitive?: string }, cwd: string): ToolResult {
  const searchPath = args.path ? resolvePath(args.path, cwd) : cwd;
  const caseSensitive = args.case_sensitive === 'true';
  const rg = rgPath();
  if (rg) {
    const cmd = [
      `"${rg}"`,
      '--line-number', '--no-heading', '--color', 'never',
      caseSensitive ? '--case-sensitive' : '--ignore-case',
      '--glob', '!node_modules', '--glob', '!.git', '--glob', '!dist',
      args.file_pattern ? `--glob "${args.file_pattern}"` : '',
      '--max-count', '50',
      `"${args.pattern.replace(/"/g, '\\"')}"`,
      `"${searchPath}"`,
    ].filter(Boolean).join(' ');
    try {
      const out = child_process.execSync(cmd, { encoding: 'utf-8', timeout: 15000, maxBuffer: 1024 * 1024 * 8 });
      return { content: out.trim() || 'No matches found' };
    } catch (err) {
      const out = (err as { stdout?: string }).stdout;
      return { content: (out && out.trim()) || 'No matches found' };
    }
  }
  return searchFilesFallback(args, cwd, searchPath, caseSensitive);
}
```

Rename the **existing** `searchFiles` body into a new function `searchFilesFallback(args, cwd, searchPath, caseSensitive)` (the old findstr/grep logic, taking the precomputed `searchPath`/`caseSensitive`).

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- tools.search`
Expected: 2 passed.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/agent/tools.ts src/agent/tools.search.test.ts
git commit -m "feat: ripgrep-backed search_files with fallback"
```

---

### Task 5: P0 acceptance — full unattended run

**Files:** none (verification only)

- [ ] **Step 1: Ensure Ollama is up and Qwen warm**

Run: `ollama ps` (expect `qwen2.5-coder:7b`, else `ollama run qwen2.5-coder:7b "hi"`).

- [ ] **Step 2: Run the acceptance task**

```bash
node dist/index.js --provider ollama --model qwen2.5-coder:7b "Search for the word TODO across this project, open the file with the most matches, and tell me how many there are. Use your tools."
```
Expected: live token streaming; `search_files` (ripgrep) runs; `read_file` runs; a coherent final answer; at most one self-repair line.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all passing.

- [ ] **Step 4: Tag the milestone**

```bash
git tag p0-hardening
git commit --allow-empty -m "chore: P0 hardening complete"
```

---

## Self-Review

**Spec coverage:**
- P0.1 tool-call robustness v2 → Task 1 (recovery) + Task 2 (repair). ✓
- P0.2 streaming-with-tools → Task 3. ✓
- P0.3 ripgrep search → Task 4. ✓
- P0 acceptance criteria → Task 5. ✓
- Test harness prerequisite (none existed) → Task 0. ✓
- P1/P2 are explicitly out of scope for this plan (separate plans later). ✓

**Placeholder scan:** No TBD/TODO-as-instruction; every code step has real code; commands have expected output. ✓

**Type consistency:** `recoverToolCallsFromText` / `RecoveredToolCall` / `extractFirstJsonObject` / `extractAllJsonObjects` / `recoverFromStreamedContent` / `looksLikeToolAttempt` / `rgPath` used consistently across tasks; `arguments` kept as JSON string throughout. ✓
