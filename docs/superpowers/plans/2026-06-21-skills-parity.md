# Skills Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make skills first-class and invocable in coderaw (parity with Claude Code) — a `Skill` tool, `/skill <name>`, NL-router activation, progressive disclosure (advertise name+description, load bodies on demand), and a bundled-resource convention.

**Architecture:** `SkillsManager` gains a compact `getCatalog()` (system-prompt advertisement), `activate()`, and a matcher-based `detectRelevantHybrid()`/`getSkillContextAsync()` (BM25-only, keyword fallback). A new `skill` built-in tool loads a body on demand, reaching the manager through a module-level runtime holder (`src/skills/runtime.ts`, mirroring `workflow/runtime.ts`). A pure `activateSkill()` helper injects a skill body into the conversation; the CLI wires it into `/skill`, the router's skill route, the system-prompt catalog, and the (now async) per-message auto-detect.

**Tech Stack:** TypeScript, vitest (TDD). Reuses the slice-2 matcher (`src/match/hybrid.ts`). No new runtime dependencies.

## Global Constraints

- **No new runtime dependencies.** Reuse `src/match/` (BM25-only for auto-detect — no per-message embedding call).
- **Progressive disclosure:** the system prompt advertises only `name — description`; skill **bodies** load only on activation (tool / `/skill` / router / auto-detect top-1).
- **Never break the turn:** `loadSkill` unknown/no-runtime → `isError` tool result (never throws); `activateSkill` unknown → `{ok:false}` + message, no conversation mutation; `detectRelevantHybrid`/`getSkillContextAsync` catch matcher errors → keyword fallback → `''`.
- **Relevance gate = hit existence:** `hybridSearch` returns `[]` when no doc has a positive BM25 score, so a returned hit already means real keyword overlap. Do NOT threshold on the returned (RRF-normalized) score.
- **Auto-detect caps at top-1.** Keep the existing keyword `detectRelevant`/`getSkillContext` as the internal fallback (do not delete).
- **No worktrees** — fresh agent in the MAIN tree (`E:\Shady'sPC\UNrestricted AI\Free-CLI`, branch `skills-parity`). Build excludes `*.test.ts`; `dist/` committed and rebuilt at the end.
- Conventional-commit messages. Run `npx vitest run` (full suite, 244 pre-exist) green before each commit.
- Tool result shape is `{ content: string; isError?: boolean }`.

---

## File Structure

- `src/skills/index.ts` — MODIFY: add `getCatalog()`, `activate()`, `detectRelevantHybrid()`, `getSkillContextAsync()`. Keep keyword `detectRelevant`/`getSkillContext` as fallback.
- `src/skills/runtime.ts` — CREATE: module-level `SkillsManager` holder (set/get/clear).
- `src/skills/activate.ts` — CREATE: pure `activateSkill(skills, name, conversation)` helper.
- `src/agent/tools.ts` — MODIFY: add the `skill` tool def + `loadSkill()` + dispatcher case.
- `src/permissions/classify.ts` — MODIFY: add `'skill'` to `KNOWN_SAFE`.
- `src/agent/conversation.ts` — MODIFY: add `skillsCatalog?` to `SystemPromptOptions` + append it in `buildSystemPrompt`.
- `src/agent/core.ts` — MODIFY: `await skills.getSkillContextAsync(userMessage)` for injection.
- `src/cli.ts` — MODIFY: `setSkillsRuntime(skills)`, `skillsCatalog` in `buildSystem`, `/skill` case, router skill-route activation, import `activateSkill`.
- `src/ui/terminal.ts` — MODIFY: `/skill` help line.
- `src/skills/builtins/*/SKILL.md` + `skillTemplate` — light touch: a bundled-resource convention note.

Tests sit next to each source file as `*.test.ts`.

---

### Task 1: `SkillsManager.getCatalog()` + `activate()`

**Files:**
- Modify: `src/skills/index.ts`
- Test: `src/skills/catalog.test.ts`

**Interfaces:**
- Consumes: existing `SkillsManager` (`loadAll`, `list`, `get`, `disable`, the private `skills` Map).
- Produces: `getCatalog(): string`; `activate(name: string): Skill | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// src/skills/catalog.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillsManager } from './index';

// Loads the real builtin skills (src/skills/builtins/*) — github, npm, docker, debug, git-workflow.
function loaded(): SkillsManager {
  const m = new SkillsManager(process.cwd());
  m.loadAll();
  return m;
}

describe('SkillsManager.getCatalog', () => {
  it('lists name — description lines for enabled skills, no bodies', () => {
    const m = loaded();
    const cat = m.getCatalog();
    expect(cat).toContain('## Available Skills');
    expect(cat).toContain('- github —');           // a stable builtin name
    expect(cat).toContain('skill'); // mentions how to load (the `skill` tool / /skill)
    // bodies are markdown headings inside SKILL.md; the catalog must not inline them:
    const github = m.get('github')!;
    const firstBodyLine = github.body.split('\n').find(l => l.trim().length > 0) ?? 'BODYLINE';
    expect(cat).not.toContain(firstBodyLine);
  });

  it('excludes a disabled skill', () => {
    const m = loaded();
    m.disable('github');
    expect(m.getCatalog()).not.toContain('- github —');
  });
});

describe('SkillsManager.activate', () => {
  it('returns the skill (with body) for a known name', () => {
    const s = loaded().activate('github');
    expect(s).toBeDefined();
    expect(s!.name).toBe('github');
    expect(s!.body.length).toBeGreaterThan(0);
  });
  it('returns undefined for an unknown name', () => {
    expect(loaded().activate('does-not-exist')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/skills/catalog.test.ts`
Expected: FAIL — `getCatalog`/`activate` are not functions.

- [ ] **Step 3: Write minimal implementation**

In `src/skills/index.ts`, add these two methods to the `SkillsManager` class (e.g. just after `get()`):

```ts
  /** Compact catalog (name — description) of enabled skills for the system prompt. '' when none. */
  getCatalog(): string {
    const enabled = this.list().filter(s => s.enabled);
    if (enabled.length === 0) return '';
    const lines = enabled.map(s => `- ${s.name} — ${s.description}`).join('\n');
    return `\n\n## Available Skills\nLoad a skill's full instructions with the \`skill\` tool (or /skill <name>) when one is relevant:\n${lines}\n`;
  }

  /** Look up + ensure enabled; returns the skill (with body) or undefined for an unknown name. */
  activate(name: string): Skill | undefined {
    const s = this.skills.get(name);
    if (!s) return undefined;
    s.enabled = true;
    return s;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/skills/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/skills/index.ts src/skills/catalog.test.ts
git commit -m "feat(skills): getCatalog() advertisement + activate()"
```

---

### Task 2: matcher-based `detectRelevantHybrid()` + `getSkillContextAsync()`

**Files:**
- Modify: `src/skills/index.ts`
- Test: `src/skills/detect-hybrid.test.ts`

**Interfaces:**
- Consumes: `hybridSearch` from `../match/hybrid` (slice 2); existing keyword `detectRelevant(userMessage): Skill[]`.
- Produces: `detectRelevantHybrid(userMessage: string, deps?: { hybrid?: typeof import('../match/hybrid').hybridSearch }): Promise<Skill[]>`; `getSkillContextAsync(userMessage: string): Promise<string>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/skills/detect-hybrid.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SkillsManager } from './index';

function loaded(): SkillsManager {
  const m = new SkillsManager(process.cwd());
  m.loadAll();
  return m;
}

describe('detectRelevantHybrid', () => {
  it('returns the top-matched skill from the injected hybrid', async () => {
    const m = loaded();
    const hybrid = vi.fn(async () => [{ id: 'github', score: 1 }]);
    const res = await m.detectRelevantHybrid('open a pull request', { hybrid });
    expect(res.map(s => s.name)).toEqual(['github']);
    expect(hybrid).toHaveBeenCalled();
  });

  it('returns [] when the hybrid finds nothing', async () => {
    const m = loaded();
    const hybrid = vi.fn(async () => []);
    expect(await m.detectRelevantHybrid('zzz', { hybrid })).toEqual([]);
  });

  it('falls back to keyword detect (top-1) when the hybrid throws', async () => {
    const m = loaded();
    const hybrid = vi.fn(async () => { throw new Error('matcher boom'); });
    const res = await m.detectRelevantHybrid('help me with a github pull request', { hybrid });
    // keyword detectRelevant matches "github"; fallback is sliced to 1
    expect(res.length).toBeLessThanOrEqual(1);
    if (res.length) expect(res[0].name).toBe('github');
  });
});

describe('getSkillContextAsync', () => {
  it('injects the top-1 skill body when relevant', async () => {
    const m = loaded();
    const hybrid = vi.fn(async () => [{ id: 'github', score: 1 }]);
    const ctx = await m.getSkillContextAsync('open a pull request', { hybrid } as never);
    expect(ctx).toContain('## Active Skills');
    expect(ctx).toContain('### github');
  });
  it('returns "" when nothing is relevant', async () => {
    const m = loaded();
    const hybrid = vi.fn(async () => []);
    expect(await m.getSkillContextAsync('zzz', { hybrid } as never)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/skills/detect-hybrid.test.ts`
Expected: FAIL — `detectRelevantHybrid`/`getSkillContextAsync` not functions.

- [ ] **Step 3: Write minimal implementation**

In `src/skills/index.ts`, add the import at the top (with the other imports):

```ts
import { hybridSearch } from '../match/hybrid';
```

Add these methods to `SkillsManager` (e.g. after `getSkillContext()`). Note `getSkillContextAsync` accepts an optional `deps` purely so tests can inject the hybrid; production calls it with one argument.

```ts
  /** Matcher-based relevance (BM25-only, top-1). Async; never throws — keyword fallback on error. */
  async detectRelevantHybrid(
    userMessage: string,
    deps: { hybrid?: typeof hybridSearch } = {},
  ): Promise<Skill[]> {
    try {
      const hybrid = deps.hybrid ?? hybridSearch;
      const enabled = this.list().filter(s => s.enabled);
      if (enabled.length === 0) return [];
      const docs = enabled.map(s => ({ id: s.name, text: `${s.name} ${s.description}` }));
      const hits = await hybrid(userMessage, docs, { topK: 1 });
      const top = hits[0];
      if (!top) return [];
      const skill = this.skills.get(top.id);
      return skill ? [skill] : [];
    } catch {
      return this.detectRelevant(userMessage).slice(0, 1); // keyword fallback, top-1
    }
  }

  /** Async skill context (top-1 body) for system-prompt injection. '' when nothing relevant. */
  async getSkillContextAsync(
    userMessage: string,
    deps: { hybrid?: typeof hybridSearch } = {},
  ): Promise<string> {
    const relevant = await this.detectRelevantHybrid(userMessage, deps);
    if (relevant.length === 0) return '';
    let context = '\n\n## Active Skills\n';
    for (const skill of relevant) {
      context += `\n### ${skill.name}\n${skill.body}\n`;
    }
    return context;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/skills/detect-hybrid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/skills/index.ts src/skills/detect-hybrid.test.ts
git commit -m "feat(skills): matcher-based detectRelevantHybrid + getSkillContextAsync (BM25, keyword fallback)"
```

---

### Task 3: `src/skills/runtime.ts` holder

**Files:**
- Create: `src/skills/runtime.ts`
- Test: `src/skills/runtime.test.ts`

**Interfaces:**
- Consumes: `SkillsManager` from `./index`.
- Produces: `setSkillsRuntime(m: SkillsManager): void`; `getSkillsRuntime(): SkillsManager | null`; `clearSkillsRuntime(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// src/skills/runtime.test.ts
import { describe, it, expect } from 'vitest';
import { setSkillsRuntime, getSkillsRuntime, clearSkillsRuntime } from './runtime';
import { SkillsManager } from './index';

describe('skills runtime holder', () => {
  it('set → get → clear', () => {
    expect(getSkillsRuntime()).toBeNull();
    const m = new SkillsManager(process.cwd());
    setSkillsRuntime(m);
    expect(getSkillsRuntime()).toBe(m);
    clearSkillsRuntime();
    expect(getSkillsRuntime()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/skills/runtime.test.ts`
Expected: FAIL — cannot find module `./runtime`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/skills/runtime.ts
/**
 * Module-level holder for the SkillsManager so the `skill` tool can reach it at
 * call time without threading it through executeTool's signature. Same singleton
 * pattern as workflow/runtime.ts. The CLI sets it once after skills.loadAll().
 */
import { SkillsManager } from './index';

let current: SkillsManager | null = null;
export function setSkillsRuntime(m: SkillsManager): void { current = m; }
export function getSkillsRuntime(): SkillsManager | null { return current; }
export function clearSkillsRuntime(): void { current = null; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/skills/runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/skills/runtime.ts src/skills/runtime.test.ts
git commit -m "feat(skills): module-level SkillsManager runtime holder"
```

---

### Task 4: `skill` tool + `loadSkill()` dispatcher

**Files:**
- Modify: `src/agent/tools.ts`
- Test: `src/agent/tools.skill.test.ts`

**Interfaces:**
- Consumes: `getSkillsRuntime` from `../skills/runtime` (Task 3); `SkillsManager.activate`/`list` (Task 1).
- Produces: a `skill` entry in `TOOLS`; `export function loadSkill(args: { name: string }): { content: string; isError?: boolean }`; dispatcher `case 'skill'`.

- [ ] **Step 1: Write the failing test**

```ts
// src/agent/tools.skill.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSkill } from './tools';
import { setSkillsRuntime, clearSkillsRuntime } from '../skills/runtime';
import { SkillsManager } from '../skills/index';

describe('loadSkill (skill tool)', () => {
  beforeEach(() => {
    const m = new SkillsManager(process.cwd());
    m.loadAll();
    setSkillsRuntime(m);
  });
  afterEach(() => clearSkillsRuntime());

  it('returns the full body for a known skill', () => {
    const r = loadSkill({ name: 'github' });
    expect(r.isError).toBeFalsy();
    expect(r.content.length).toBeGreaterThan(0);
  });

  it('returns an isError result + available list for an unknown skill', () => {
    const r = loadSkill({ name: 'nope' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('Unknown skill');
    expect(r.content).toContain('github'); // lists what IS available
  });

  it('degrades gracefully when no runtime is set', () => {
    clearSkillsRuntime();
    const r = loadSkill({ name: 'github' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('not available');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agent/tools.skill.test.ts`
Expected: FAIL — `loadSkill` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/agent/tools.ts`, add the import near the top:

```ts
import { getSkillsRuntime } from '../skills/runtime';
```

Add a new entry to the `TOOLS` array (e.g. right after the `update_plan` entry):

```ts
  {
    name: 'skill',
    description: "Load the full instructions for a named skill from the Available Skills list. Call this when a listed skill is relevant before starting the task.",
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The skill name from the Available Skills list' } },
      required: ['name'],
    },
  },
```

Add the dispatcher case in `executeTool` (next to `update_plan`):

```ts
      case 'skill': return loadSkill(args as { name: string });
```

Add the implementation (module-scope, e.g. near `resolvePath`), exported for testing:

```ts
/** Load a skill's full body on demand. Reaches the SkillsManager via the runtime holder. */
export function loadSkill(args: { name: string }): { content: string; isError?: boolean } {
  const mgr = getSkillsRuntime();
  if (!mgr) return { content: 'Skills are not available in this context.', isError: true };
  const name = String(args.name ?? '');
  const s = mgr.activate(name);
  if (!s) return { content: `Unknown skill "${name}". Available: ${mgr.list().map(x => x.name).join(', ')}`, isError: true };
  return { content: s.body };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agent/tools.skill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.ts src/agent/tools.skill.test.ts
git commit -m "feat(agent): skill tool — load a skill body on demand via the runtime holder"
```

---

### Task 5: classify `skill` as safe-silent

**Files:**
- Modify: `src/permissions/classify.ts`
- Test: `src/permissions/classify.skill.test.ts`

**Interfaces:**
- Consumes: `classify(toolName, args, root, rules)` and the `Rules`/`Verdict` types.
- Produces: `'skill'` added to `KNOWN_SAFE`.

- [ ] **Step 1: Write the failing test**

```ts
// src/permissions/classify.skill.test.ts
import { describe, it, expect } from 'vitest';
import { classify } from './classify';

const root = process.cwd();
const baseRules = { enabled: true, allow: [] as string[], ask: [] as string[], deny: [] as string[] };

describe('classify — skill tool', () => {
  it('is silent (safe) by default', () => {
    const v = classify('skill', { name: 'github' }, root, baseRules as never);
    expect(v.decision).toBe('silent');
  });
  it('is still blocked by a user deny rule', () => {
    const v = classify('skill', { name: 'github' }, root, { ...baseRules, deny: ['skill'] } as never);
    expect(v.decision).toBe('block');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/permissions/classify.skill.test.ts`
Expected: FAIL — `skill` is not known-safe → first test gets `'ask'`.

- [ ] **Step 3: Write minimal implementation**

In `src/permissions/classify.ts`, add `'skill'` to the `KNOWN_SAFE` set:

```ts
const KNOWN_SAFE = new Set([
  'read_file', 'search_files', 'list_files',
  'git_status', 'git_diff', 'git_log', 'memory_search', 'memory_save',
  'web_search', 'web_fetch', 'skill',
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/permissions/classify.skill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/permissions/classify.ts src/permissions/classify.skill.test.ts
git commit -m "feat(permissions): classify the skill tool as safe-silent"
```

---

### Task 6: `activateSkill()` pure helper

**Files:**
- Create: `src/skills/activate.ts`
- Test: `src/skills/activate.test.ts`

**Interfaces:**
- Consumes: `SkillsManager.activate` (Task 1); the `Conversation` type from `../agent/conversation` (has `messages: Message[]`).
- Produces: `export function activateSkill(skills: SkillsManager, name: string, conversation: Conversation): { ok: boolean; message: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/skills/activate.test.ts
import { describe, it, expect } from 'vitest';
import { activateSkill } from './activate';
import { SkillsManager } from './index';
import type { Conversation } from '../agent/conversation';

function loaded(): SkillsManager {
  const m = new SkillsManager(process.cwd());
  m.loadAll();
  return m;
}
const fakeConv = (): Conversation => ({ messages: [] } as unknown as Conversation);

describe('activateSkill', () => {
  it('injects the skill body and reports success for a known skill', () => {
    const conv = fakeConv();
    const r = activateSkill(loaded(), 'github', conv);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('github');
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].role).toBe('system');
    expect(conv.messages[0].content).toContain('[Active Skill: github]');
  });

  it('reports failure and does not mutate the conversation for an unknown skill', () => {
    const conv = fakeConv();
    const r = activateSkill(loaded(), 'nope', conv);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Unknown skill');
    expect(conv.messages).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/skills/activate.test.ts`
Expected: FAIL — cannot find module `./activate`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/skills/activate.ts
/** Activate a skill by injecting its full body into the conversation as a system message. */
import { SkillsManager } from './index';
import { Conversation } from '../agent/conversation';

export function activateSkill(
  skills: SkillsManager,
  name: string,
  conversation: Conversation,
): { ok: boolean; message: string } {
  const s = skills.activate(name);
  if (!s) {
    return { ok: false, message: `Unknown skill "${name}". Try /skills to list available skills.` };
  }
  conversation.messages.push({ role: 'system', content: `[Active Skill: ${s.name}]\n${s.body}` });
  return { ok: true, message: `Activated skill: ${s.name}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/skills/activate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/skills/activate.ts src/skills/activate.test.ts
git commit -m "feat(skills): activateSkill() — inject a skill body into the conversation"
```

---

### Task 7: CLI wiring (catalog, runtime, async detect, `/skill`, router activation)

**Files:**
- Modify: `src/agent/conversation.ts` (add `skillsCatalog?` to `SystemPromptOptions` + append in `buildSystemPrompt`)
- Modify: `src/agent/core.ts:151` (await `getSkillContextAsync`)
- Modify: `src/cli.ts` (imports; `setSkillsRuntime`; `skillsCatalog` in `buildSystem`; `/skill` case; router skill-route activation)
- Modify: `src/ui/terminal.ts` (help line)
- Test: `src/agent/conversation.skillscatalog.test.ts`

**Interfaces:**
- Consumes: `getCatalog()` (Task 1), `getSkillContextAsync()` (Task 2), `setSkillsRuntime` (Task 3), `activateSkill` (Task 6).
- Produces: a `skillsCatalog` block in the system prompt; live `/skill` + router activation.

- [ ] **Step 1: Write the failing test** (the one pure, isolated seam — the catalog block in the prompt builder)

```ts
// src/agent/conversation.skillscatalog.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './conversation';

describe('buildSystemPrompt — skillsCatalog block', () => {
  it('appends the skills catalog when provided', () => {
    const prompt = buildSystemPrompt({ cwd: process.cwd(), skillsCatalog: '\n\n## Available Skills\n- github — gh ops\n' });
    expect(prompt).toContain('## Available Skills');
    expect(prompt).toContain('- github — gh ops');
  });
  it('omits it when not provided', () => {
    const prompt = buildSystemPrompt({ cwd: process.cwd() });
    expect(prompt).not.toContain('## Available Skills');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agent/conversation.skillscatalog.test.ts`
Expected: FAIL — `skillsCatalog` is not a recognized option / not appended.

- [ ] **Step 3: Write minimal implementation**

**(a) `src/agent/conversation.ts`** — add to the `SystemPromptOptions` interface (next to `personaContext?`):

```ts
  skillsCatalog?: string;               // from SkillsManager.getCatalog()
```

And append it in `buildSystemPrompt`, immediately after the persona block (after the `if (opts.personaContext) { prompt += opts.personaContext; }` block, ~line 159):

```ts
  // Available-skills catalog (name + description only; bodies load on demand)
  if (opts.skillsCatalog) {
    prompt += opts.skillsCatalog;
  }
```

**(b) `src/agent/core.ts:149-162`** — change the skill injection to the async matcher path:

```ts
  // ── Skill injection ───────────────────────────────────────────────────────
  if (skills) {
    const skillCtx = await skills.getSkillContextAsync(userMessage);
    if (skillCtx) {
      const systemIdx = conversation.messages.findIndex(m => m.role === 'system');
      const existing = systemIdx >= 0 ? conversation.messages[systemIdx].content : '';
      if (!existing.includes(skillCtx.slice(0, 40))) {
        addMessage(conversation, {
          role: 'system',
          content: `[Active Skills for this request]${skillCtx}`,
        });
      }
    }
  }
```

**(c) `src/cli.ts`** — add imports near the other `./skills` / `./router` imports:

```ts
import { setSkillsRuntime } from './skills/runtime';
import { activateSkill } from './skills/activate';
```

After `skills.loadAll();` (~line 100), register the runtime:

```ts
  setSkillsRuntime(skills);
```

In `buildSystem` (the `buildSystemPrompt({...})` call, ~line 126), add the catalog block:

```ts
    personaContext: persona.buildSystemBlock(),
    skillsCatalog: skills.getCatalog(),
```

In the router intercept, add a skill-route activation block. Insert it right before the trailing `// 'skill' or 'chat' → fall through to runAgent` comment (after the `goal` block):

```ts
        if (decision.kind === 'skill' && decision.target) {
          const r = activateSkill(skills, decision.target, conversation);
          if (r.ok) printInfo(r.message);
          // fall through to runAgent with the skill now active (do NOT continue)
        }
```

Add the `/skill` slash case in `handleSlashCommand` (beside `case 'skills'`):

```ts
    case 'skill': {
      const name = args[0];
      if (!name) { printError('Usage: /skill <name>   (list with /skills)'); break; }
      const r = activateSkill(ctx.skills, name, ctx.conversation);
      if (r.ok) printInfo(r.message); else printError(r.message);
      break;
    }
```

**(d) `src/ui/terminal.ts`** — add a help line after the `/skills add` line (~line 141):

```ts
  ${c.green('/skill')} <name>        Activate a skill (load its full instructions)
```

- [ ] **Step 4: Run the catalog test + tsc + full suite**

Run: `npx vitest run src/agent/conversation.skillscatalog.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: clean (this task touches multiple files — a type error breaks the build).

Run: `npx vitest run`
Expected: PASS — all prior tests + the new ones (~258+). If a pre-existing core test referenced the sync `getSkillContext`, update it to the async path and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/agent/conversation.ts src/agent/core.ts src/cli.ts src/ui/terminal.ts src/agent/conversation.skillscatalog.test.ts
git commit -m "feat(skills): wire catalog + runtime + async auto-detect + /skill + router activation"
```

---

### Task 8: Bundled-resource convention, build, full suite, live smoke, dist, tag

**Files:**
- Modify: `src/skills/index.ts` (`skillTemplate` — add a resources note)
- Modify: `dist/**` (rebuilt artifacts)

- [ ] **Step 1: Add the bundled-resource convention to the new-skill template**

In `src/skills/index.ts`, extend `skillTemplate(name)` with a `## Resources` section documenting the convention (sibling files read on demand):

```ts
function skillTemplate(name: string): string {
  return `---
name: ${name}
description: "Describe what this skill does and when to use it in one sentence."
---

# ${name}

## When to Use
List trigger conditions, keywords, or scenarios when this skill applies.

## Instructions
Step-by-step instructions for the AI when this skill is active.

## Resources
Bundle extra files in this skill's folder (e.g. references/notes.md, scripts/run.sh)
and point to them by relative path; the agent reads them on demand with read_file.

## Examples
\`\`\`bash
# Example commands or code
\`\`\`
`;
}
```

- [ ] **Step 2: Commit the template change**

```bash
git add src/skills/index.ts
git commit -m "docs(skills): document the bundled-resource convention in the new-skill template"
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: clean compile, `*.test.ts` excluded from `dist/`.

- [ ] **Step 4: Full test suite**

Run: `npx vitest run`
Expected: all green (~258+ tests).

- [ ] **Step 5: Live smoke (Ollama running)**

Run the linked CLI (`coderaw`) and verify:
- The system prompt advertises skills — type a message and confirm the model is aware of e.g. `github`/`npm` (or inspect `buildSystem()` output).
- `/skill github` → prints `Activated skill: github`; a follow-up question gets github-flavored help.
- `use the github skill to open a PR` → prints `→ activating skill (github)` then runs with it active.
- The model itself calls the `skill` tool when a listed skill clearly fits (e.g. "what's the gh command to view CI?").
- A made-up name `/skill nope` → friendly "Unknown skill" error; the turn still works.

Capture the activation lines as evidence.

- [ ] **Step 6: Rebuild dist + commit + tag**

```bash
npm run build
git add dist src
git commit -m "build(skills): rebuild dist for skills parity"
git tag p4c-skills-parity
```

- [ ] **Step 7: Merge to main + push**

```bash
git checkout main
git merge --no-ff skills-parity -m "merge: #4 slice 3 — skills parity (Skill tool + /skill + router activation + progressive disclosure)"
git push origin main
git push origin p4c-skills-parity
```

---

## Self-Review

**1. Spec coverage** (spec §§4–10 → tasks):
- §4A `getCatalog` + `activate` → Task 1 ✓; `detectRelevantHybrid` + `getSkillContextAsync` (matcher, keyword fallback) → Task 2 ✓
- §4B `skill` tool + `loadSkill` → Task 4 ✓
- §4C `src/skills/runtime.ts` holder → Task 3 ✓
- §4D permissions `KNOWN_SAFE += 'skill'` → Task 5 ✓
- §4E catalog in `buildSystem`, `setSkillsRuntime`, async `core.ts` detect, `/skill`, router skill-route activation → Task 7 ✓
- §4E `activateSkill` pure helper → Task 6 ✓ (placed in `src/skills/activate.ts` — cleaner single-responsibility module than the spec's "export from cli.ts"; same signature/behavior)
- §4G bundled-resource convention + template → Task 8 ✓
- §5 `/skill` surface + help → Task 7 ✓; no new `settings` block (per spec) ✓
- §6 error handling (loadSkill/activateSkill/detect never break the turn) → Tasks 2/4/6 ✓
- §7 testing (catalog/activate/detect/loadSkill/permissions/activateSkill/live smoke) → Tasks 1–8 ✓
- §8 build order (8 steps) → Tasks 1–8, in order ✓
- §10 out-of-scope (manifests, per-message embeddings, settings.skills, bot/server rewire) → not built ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — every code step is complete and runnable.

**3. Type consistency:** `Skill`/`SkillsManager` reused across tasks; `getCatalog()`/`activate()`/`detectRelevantHybrid()`/`getSkillContextAsync()` signatures match between Tasks 1–2 and their callers (Tasks 6/7); `loadSkill` + the tool-result shape `{content, isError?}` consistent (Task 4); `setSkillsRuntime`/`getSkillsRuntime` match between Task 3 and Tasks 4/7; `activateSkill(skills, name, conversation)` identical between Task 6 and the cli/`/skill`/router call sites (Task 7); `skillsCatalog?` option matches between Task 7's `conversation.ts` change and the `buildSystem` call.

**One intentional spec refinement:** `activateSkill` lives in its own module `src/skills/activate.ts` (not exported from `cli.ts` as §4E loosely suggested) — isolated, single-responsibility, trivially unit-testable. Same signature and behavior.
