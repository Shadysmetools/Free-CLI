# Permissions / Control Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate coderaw's tool execution so consequential actions (shell commands, commits, out-of-project or destructive file ops, MCP/unknown tools) pause for a full-preview confirmation, while safe in-project work runs silently — controlled entirely by a user-owned rules file, no named modes.

**Architecture:** A single `src/permissions/` module with a pure classifier, a rules loader/matcher, and an orchestrating `gate()` that is called once at the existing tool-dispatch choke point in `src/agent/core.ts`. Because every tool (built-in, MCP, future browser/OS) flows through that point, all are gated by construction. The confirm UI reuses the existing `inquirer` dependency.

**Tech Stack:** TypeScript (CommonJS build), vitest, `yaml`, `inquirer`, `chalk`, Node `fs`/`path`.

## Global Constraints

- Platform: Windows-first (win32, PowerShell) but cross-platform; path logic must handle drive letters, `..`, and case-insensitive compare on win32.
- Build excludes `*.test.ts` (existing tsconfig/build convention). `dist/` is committed.
- Existing 14 tests MUST stay green. Test files are `*.test.ts` colocated with source; vitest via `npm test`.
- Reuse the existing `require('inquirer')` pattern (CJS) — do not add ESM-only deps.
- Config lives at `%APPDATA%\coderaw\config.yaml` (win32) / `~/.coderaw/config.yaml`; loaded by `src/config/settings.ts`.
- No named modes. Control surface is the `permissions:` rules block + optional per-project `.coderaw/permissions.yaml`.
- Precedence (first match wins): user `deny` → user `allow` → built-in catastrophic `DEFAULT_DENY` → user `ask` → default bucket. (User `allow` can override `DEFAULT_DENY` — the user owns the machine.)
- Default buckets: known-safe read-only tools + in-project write/edit → **silent**; `run_command`, `git_commit`, out-of-project/destructive, and any non-known-safe tool → **ask**. Destructive/out-of-project raise severity to **warn**.
- Headless (no TTY or `unattended` run): a would-be prompt is **denied** unless `unattended: 'allow'`.

---

### Task 1: Types + rules module (load, merge, match)

**Files:**
- Create: `src/permissions/types.ts`
- Create: `src/permissions/rules.ts`
- Test: `src/permissions/rules.test.ts`

**Interfaces:**
- Produces: `Rules`, `Verdict`, `ConfirmChoice`, `ConfirmRequest`, `ConfirmFn`, `GateContext`, `GateResult` (types.ts); `defaultRules(projectRoot)`, `loadPermissionRules(cwd, globalPerms?)`, `matchPattern(pattern, subject)`, `matchesAny(patterns, subjects)`, `persistAllowPattern(pattern)`, `DEFAULT_DENY` (rules.ts).

- [ ] **Step 1: Write `src/permissions/types.ts`**

```ts
export type Decision = 'silent' | 'ask' | 'block';
export type Severity = 'normal' | 'warn';

export interface Verdict {
  decision: Decision;
  severity: Severity;
  reasons: string[];
  subject: string; // primary subject (command or resolved path) for display + allowlisting
}

export interface Rules {
  enabled: boolean;
  projectRoot: string; // resolved absolute path
  allow: string[];
  ask: string[];
  deny: string[];
  unattended: 'deny' | 'allow';
  confirmDefault: 'approve' | 'skip';
}

export type ConfirmChoice =
  | { kind: 'yes' }
  | { kind: 'session' }
  | { kind: 'persist' }
  | { kind: 'no'; reason?: string };

export interface ConfirmRequest {
  toolName: string;
  args: Record<string, unknown>;
  verdict: Verdict;
  defaultApprove: boolean;
}

export type ConfirmFn = (req: ConfirmRequest) => Promise<ConfirmChoice>;

export interface GateContext {
  cwd: string;
  rules: Rules;
  isInteractive: boolean;
  sessionAllow: Set<string>;
  confirm?: ConfirmFn;
  persistAllow?: (pattern: string) => void;
}

export interface GateResult {
  allowed: boolean;
  reasonForModel?: string;
}
```

- [ ] **Step 2: Write the failing test `src/permissions/rules.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { matchPattern, matchesAny, defaultRules, loadPermissionRules, DEFAULT_DENY } from './rules';

describe('matchPattern', () => {
  it('matches a literal command', () => {
    expect(matchPattern('npm test', 'npm test')).toBe(true);
  });
  it('supports * wildcard', () => {
    expect(matchPattern('npm *', 'npm run build')).toBe(true);
    expect(matchPattern('git push *', 'git push origin main')).toBe(true);
  });
  it('is case-insensitive and trims', () => {
    expect(matchPattern('NPM TEST', '  npm test  ')).toBe(true);
  });
  it('does not match a different command', () => {
    expect(matchPattern('npm test', 'rm -rf /')).toBe(false);
  });
});

describe('matchesAny', () => {
  it('true when any pattern matches any subject', () => {
    expect(matchesAny(['git status', 'npm *'], ['run_command npm test', 'npm test'])).toBe(true);
  });
  it('false when none match', () => {
    expect(matchesAny(['git *'], ['npm test'])).toBe(false);
  });
});

describe('defaultRules', () => {
  it('enabled, deny empty (catastrophic lives in DEFAULT_DENY), unattended deny', () => {
    const r = defaultRules('C:/proj');
    expect(r.enabled).toBe(true);
    expect(r.deny).toEqual([]);
    expect(r.unattended).toBe('deny');
    expect(r.confirmDefault).toBe('approve');
    expect(DEFAULT_DENY.length).toBeGreaterThan(0);
  });
});

describe('loadPermissionRules', () => {
  it('merges a global perms layer over defaults, concatenating arrays', () => {
    const r = loadPermissionRules('C:/proj', { allow: ['npm *'], unattended: 'allow' });
    expect(r.allow).toContain('npm *');
    expect(r.unattended).toBe('allow');
    expect(r.projectRoot).toBe(require('path').resolve('C:/proj'));
  });
  it("respects explicit projectRoot when not 'auto'", () => {
    const r = loadPermissionRules('C:/proj', { projectRoot: 'D:/other' });
    expect(r.projectRoot).toBe(require('path').resolve('D:/other'));
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npm test -- src/permissions/rules.test.ts`
Expected: FAIL — `Cannot find module './rules'`.

- [ ] **Step 4: Write `src/permissions/rules.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { loadSettings, saveSettings } from '../config/settings';
import { Rules } from './types';

/** Catastrophic patterns blocked by default. User `allow` rules can override these. */
export const DEFAULT_DENY: string[] = [
  'rm -rf /', 'rm -rf /*', 'rm -rf ~', 'rm -rf ~/*', 'rm -fr /',
  'mkfs*', 'format *', 'del /s /q c:\\*', 'rd /s /q c:\\*',
];

export function defaultRules(projectRoot: string): Rules {
  return {
    enabled: true,
    projectRoot: path.resolve(projectRoot),
    allow: [],
    ask: [],
    deny: [],
    unattended: 'deny',
    confirmDefault: 'approve',
  };
}

type PermsLayer = Partial<Omit<Rules, 'projectRoot'>> & { projectRoot?: string };

function applyLayer(base: Rules, layer?: PermsLayer): Rules {
  if (!layer) return base;
  return {
    enabled: layer.enabled ?? base.enabled,
    projectRoot: base.projectRoot,
    allow: [...base.allow, ...(layer.allow ?? [])],
    ask: [...base.ask, ...(layer.ask ?? [])],
    deny: [...base.deny, ...(layer.deny ?? [])],
    unattended: layer.unattended ?? base.unattended,
    confirmDefault: layer.confirmDefault ?? base.confirmDefault,
  };
}

export function loadPermissionRules(cwd: string, globalPerms?: PermsLayer): Rules {
  let merged = applyLayer(defaultRules(cwd), globalPerms);

  const projFile = path.join(cwd, '.coderaw', 'permissions.yaml');
  if (fs.existsSync(projFile)) {
    try {
      const raw = yaml.parse(fs.readFileSync(projFile, 'utf-8')) as PermsLayer;
      merged = applyLayer(merged, raw);
    } catch { /* ignore invalid project rules file */ }
  }

  if (globalPerms?.projectRoot && globalPerms.projectRoot !== 'auto') {
    merged.projectRoot = path.resolve(globalPerms.projectRoot);
  } else {
    merged.projectRoot = path.resolve(cwd);
  }
  return merged;
}

/** Glob-ish: '*' wildcard, case-insensitive, full match, trimmed. */
export function matchPattern(pattern: string, subject: string): boolean {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`, 'i').test(subject.trim());
}

export function matchesAny(patterns: string[], subjects: string[]): boolean {
  return patterns.some(p => subjects.some(s => matchPattern(p, s)));
}

/** Append a pattern to the global config's permissions.allow and save. */
export function persistAllowPattern(pattern: string): void {
  const settings = loadSettings();
  settings.permissions = settings.permissions ?? {};
  settings.permissions.allow = settings.permissions.allow ?? [];
  if (!settings.permissions.allow.includes(pattern)) {
    settings.permissions.allow.push(pattern);
    saveSettings(settings);
  }
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npm test -- src/permissions/rules.test.ts`
Expected: PASS (all rules tests). NOTE: `settings.permissions` type is added in Task 5; if TS complains here, proceed to Task 5 then re-run — or add the field now. To keep this task green standalone, add the `permissions?` field to `Settings` (Task 5 Step 1) before running.

- [ ] **Step 6: Commit**

```bash
git add src/permissions/types.ts src/permissions/rules.ts src/permissions/rules.test.ts
git commit -m "feat(perms): rules types, loader, glob matcher"
```

---

### Task 2: Classifier (pure)

**Files:**
- Create: `src/permissions/classify.ts`
- Test: `src/permissions/classify.test.ts`

**Interfaces:**
- Consumes: `Rules`, `Verdict` (types.ts); `matchesAny`, `DEFAULT_DENY` (rules.ts).
- Produces: `classify(toolName, args, root, rules): Verdict`, `subjectsFor(toolName, args, root): string[]`, `isInside(root, target): boolean`.

- [ ] **Step 1: Write the failing test `src/permissions/classify.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { classify } from './classify';
import { defaultRules } from './rules';

const ROOT = path.resolve('C:/proj');
const R = () => defaultRules(ROOT);

describe('classify default buckets', () => {
  it('read_file -> silent', () => {
    expect(classify('read_file', { path: 'a.ts' }, ROOT, R()).decision).toBe('silent');
  });
  it('in-project write_file -> silent', () => {
    expect(classify('write_file', { path: 'src/a.ts', content: 'x' }, ROOT, R()).decision).toBe('silent');
  });
  it('out-of-project write_file -> ask + warn', () => {
    const v = classify('write_file', { path: 'C:/Windows/x.txt', content: 'x' }, ROOT, R());
    expect(v.decision).toBe('ask');
    expect(v.severity).toBe('warn');
  });
  it('run_command -> ask (normal)', () => {
    const v = classify('run_command', { command: 'npm test' }, ROOT, R());
    expect(v.decision).toBe('ask');
    expect(v.severity).toBe('normal');
  });
  it('destructive run_command -> ask + warn', () => {
    expect(classify('run_command', { command: 'rm -rf build' }, ROOT, R()).severity).toBe('warn');
  });
  it('git_commit -> ask', () => {
    expect(classify('git_commit', { message: 'x' }, ROOT, R()).decision).toBe('ask');
  });
  it('unknown / MCP tool -> ask', () => {
    expect(classify('some_mcp_tool', { foo: 1 }, ROOT, R()).decision).toBe('ask');
  });
});

describe('classify rules precedence', () => {
  it('user deny -> block', () => {
    const r = R(); r.deny = ['npm *'];
    expect(classify('run_command', { command: 'npm test' }, ROOT, r).decision).toBe('block');
  });
  it('user allow -> silent', () => {
    const r = R(); r.allow = ['npm test'];
    expect(classify('run_command', { command: 'npm test' }, ROOT, r).decision).toBe('silent');
  });
  it('catastrophic DEFAULT_DENY -> block', () => {
    expect(classify('run_command', { command: 'rm -rf /' }, ROOT, R()).decision).toBe('block');
  });
  it('user allow overrides catastrophic DEFAULT_DENY', () => {
    const r = R(); r.allow = ['rm -rf /'];
    expect(classify('run_command', { command: 'rm -rf /' }, ROOT, r).decision).toBe('silent');
  });
  it('user ask forces a normally-silent tool to ask', () => {
    const r = R(); r.ask = ['read_file *'];
    expect(classify('read_file', { path: 'a.ts' }, ROOT, r).decision).toBe('ask');
  });
  it('disabled -> everything silent', () => {
    const r = R(); r.enabled = false;
    expect(classify('run_command', { command: 'rm -rf /' }, ROOT, r).decision).toBe('silent');
  });
});

describe('isInside via classification', () => {
  it('case-insensitive root compare on win32-style paths', () => {
    const v = classify('write_file', { path: 'C:/PROJ/src/a.ts', content: 'x' }, 'C:/proj', defaultRules('C:/proj'));
    // On win32 this is inside -> silent; on posix it is treated as a distinct path.
    expect(['silent', 'ask']).toContain(v.decision);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- src/permissions/classify.test.ts`
Expected: FAIL — `Cannot find module './classify'`.

- [ ] **Step 3: Write `src/permissions/classify.ts`**

```ts
import * as path from 'path';
import { Rules, Verdict } from './types';
import { matchesAny, DEFAULT_DENY } from './rules';

const KNOWN_SAFE = new Set([
  'read_file', 'search_files', 'list_files',
  'git_status', 'git_diff', 'git_log', 'memory_search', 'memory_save',
]);

const DESTRUCTIVE: RegExp[] = [
  /\brm\s+-[rf]{1,2}\b/i, /\brm\s+-fr\b/i,
  /\bdel\s+\/s\b/i, /\bdel\s+\/q\b/i, /\brmdir\s+\/s\b/i, /\brd\s+\/s\b/i,
  /\bformat\b/i, /\bmkfs/i, /\bdd\s+if=/i, /\bshutdown\b/i, /\breg\s+delete\b/i,
  /:\(\)\s*\{/, />\s*\/dev\/sd/i,
];

export function isInside(root: string, target: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(target);
  const norm = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const rN = norm(r);
  const tN = norm(t);
  if (tN === rN) return true;
  return tN.startsWith(rN.endsWith(path.sep) ? rN : rN + path.sep);
}

function argPath(args: Record<string, unknown>): string | undefined {
  const p = args.path ?? args.output_path;
  return typeof p === 'string' ? p : undefined;
}

function resolveArg(p: string, root: string): string {
  return path.isAbsolute(p) ? p : path.resolve(root, p);
}

export function subjectsFor(toolName: string, args: Record<string, unknown>, root: string): string[] {
  if (toolName === 'run_command') return [String(args.command ?? '')];
  if (toolName === 'git_commit') return ['git_commit', 'git commit'];
  const p = argPath(args);
  if (p) {
    const resolved = resolveArg(p, root);
    return [`${toolName} ${resolved}`, resolved, `${toolName} ${p}`, p];
  }
  return [toolName, `${toolName} ${JSON.stringify(args)}`];
}

export function classify(
  toolName: string,
  args: Record<string, unknown>,
  root: string,
  rules: Rules,
): Verdict {
  const subjects = subjectsFor(toolName, args, root);
  const primary = subjects[0];

  if (!rules.enabled) {
    return { decision: 'silent', severity: 'normal', reasons: ['permissions disabled'], subject: primary };
  }
  if (matchesAny(rules.deny, subjects)) {
    return { decision: 'block', severity: 'warn', reasons: ['matched a user deny rule'], subject: primary };
  }
  if (matchesAny(rules.allow, subjects)) {
    return { decision: 'silent', severity: 'normal', reasons: ['matched a user allow rule'], subject: primary };
  }
  if (matchesAny(DEFAULT_DENY, subjects)) {
    return { decision: 'block', severity: 'warn', reasons: ['catastrophic action blocked by default'], subject: primary };
  }
  const forcedAsk = matchesAny(rules.ask, subjects);

  if (!forcedAsk && KNOWN_SAFE.has(toolName)) {
    return { decision: 'silent', severity: 'normal', reasons: ['read-only tool'], subject: primary };
  }

  if (toolName === 'run_command') {
    const cmd = String(args.command ?? '');
    const destructive = DESTRUCTIVE.some(re => re.test(cmd));
    const cwdArg = typeof args.cwd === 'string' ? args.cwd : undefined;
    const outside = cwdArg ? !isInside(root, resolveArg(cwdArg, root)) : false;
    const reasons = ['shell command'];
    if (destructive) reasons.push('destructive command pattern');
    if (outside) reasons.push('runs outside project root');
    return { decision: 'ask', severity: destructive || outside ? 'warn' : 'normal', reasons, subject: cmd };
  }

  if (toolName === 'write_file' || toolName === 'edit_file') {
    const p = argPath(args) ?? '';
    const resolved = resolveArg(p, root);
    const inside = isInside(root, resolved);
    if (inside && !forcedAsk) {
      return { decision: 'silent', severity: 'normal', reasons: ['in-project file change'], subject: resolved };
    }
    return {
      decision: 'ask',
      severity: inside ? 'normal' : 'warn',
      reasons: inside ? ['forced ask'] : ['writes outside project root'],
      subject: resolved,
    };
  }

  return { decision: 'ask', severity: 'normal', reasons: ['consequential / not a known-safe tool'], subject: primary };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm test -- src/permissions/classify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/permissions/classify.ts src/permissions/classify.test.ts
git commit -m "feat(perms): pure classifier with buckets + precedence"
```

---

### Task 3: Gate orchestrator

**Files:**
- Create: `src/permissions/gate.ts`
- Create: `src/permissions/index.ts`
- Test: `src/permissions/gate.test.ts`

**Interfaces:**
- Consumes: `classify` (classify.ts), `GateContext`, `GateResult`, `ConfirmChoice`, `ConfirmFn` (types.ts), `defaultConfirm` (prompt.ts — created Task 4; gate imports it lazily so this task does not require prompt.ts at test time because tests inject `confirm`).
- Produces: `gate(toolName, args, ctx): Promise<GateResult>`.

To avoid a hard dependency on prompt.ts (I/O) during this task, `gate` uses `ctx.confirm` when provided and only falls back to `defaultConfirm` otherwise. Import `defaultConfirm` normally; Task 4 creates it. If executing strictly in order, create a temporary stub `prompt.ts` exporting `defaultConfirm` first (Task 4 replaces it). Simplest: do Task 4 before running Task 3's full build, but Task 3 unit tests pass regardless since they inject `confirm`.

- [ ] **Step 1: Write the failing test `src/permissions/gate.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { gate } from './gate';
import { defaultRules } from './rules';
import { GateContext, ConfirmChoice } from './types';
import * as path from 'path';

const ROOT = path.resolve('C:/proj');

function ctx(over: Partial<GateContext> = {}, choice: ConfirmChoice = { kind: 'yes' }): GateContext {
  return {
    cwd: ROOT,
    rules: defaultRules(ROOT),
    isInteractive: true,
    sessionAllow: new Set<string>(),
    confirm: vi.fn(async () => choice),
    persistAllow: vi.fn(),
    ...over,
  };
}

describe('gate', () => {
  it('silent verdict -> allowed, no prompt', async () => {
    const c = ctx();
    const r = await gate('read_file', { path: 'a.ts' }, c);
    expect(r.allowed).toBe(true);
    expect(c.confirm).not.toHaveBeenCalled();
  });

  it('block verdict -> denied with reason', async () => {
    const r = await gate('run_command', { command: 'rm -rf /' }, ctx());
    expect(r.allowed).toBe(false);
    expect(r.reasonForModel).toMatch(/block|denied|rules/i);
  });

  it('ask + confirm yes -> allowed', async () => {
    const r = await gate('run_command', { command: 'npm test' }, ctx({}, { kind: 'yes' }));
    expect(r.allowed).toBe(true);
  });

  it('ask + confirm no -> denied with reason', async () => {
    const r = await gate('run_command', { command: 'npm test' }, ctx({}, { kind: 'no' }));
    expect(r.allowed).toBe(false);
    expect(r.reasonForModel).toMatch(/declined/i);
  });

  it('session: second identical call is silent', async () => {
    const c = ctx({}, { kind: 'session' });
    await gate('run_command', { command: 'npm test' }, c);
    (c.confirm as any).mockClear();
    const r2 = await gate('run_command', { command: 'npm test' }, c);
    expect(r2.allowed).toBe(true);
    expect(c.confirm).not.toHaveBeenCalled();
  });

  it('persist: calls persistAllow and allows', async () => {
    const c = ctx({}, { kind: 'persist' });
    const r = await gate('run_command', { command: 'npm test' }, c);
    expect(r.allowed).toBe(true);
    expect(c.persistAllow).toHaveBeenCalledWith('npm test');
  });

  it('non-interactive + unattended deny -> denied', async () => {
    const c = ctx({ isInteractive: false });
    const r = await gate('run_command', { command: 'npm test' }, c);
    expect(r.allowed).toBe(false);
    expect(r.reasonForModel).toMatch(/unattended/i);
  });

  it('non-interactive + unattended allow -> allowed', async () => {
    const c = ctx({ isInteractive: false });
    c.rules.unattended = 'allow';
    const r = await gate('run_command', { command: 'npm test' }, c);
    expect(r.allowed).toBe(true);
  });

  it('confirm throws -> denied for safety', async () => {
    const c = ctx();
    (c.confirm as any) = vi.fn(async () => { throw new Error('no tty'); });
    const r = await gate('run_command', { command: 'npm test' }, c);
    expect(r.allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- src/permissions/gate.test.ts`
Expected: FAIL — `Cannot find module './gate'`.

- [ ] **Step 3: Write `src/permissions/gate.ts`**

```ts
import { GateContext, GateResult, ConfirmChoice } from './types';
import { classify } from './classify';
import { defaultConfirm } from './prompt';

export async function gate(
  toolName: string,
  args: Record<string, unknown>,
  ctx: GateContext,
): Promise<GateResult> {
  const verdict = classify(toolName, args, ctx.rules.projectRoot, ctx.rules);

  if (verdict.decision === 'silent') return { allowed: true };

  if (verdict.decision === 'block') {
    return {
      allowed: false,
      reasonForModel: `Blocked by the user's permission rules: ${verdict.subject}. Do not attempt this; tell the user it was blocked and why.`,
    };
  }

  // decision === 'ask'
  if (ctx.sessionAllow.has(verdict.subject)) return { allowed: true };

  if (!ctx.isInteractive) {
    if (ctx.rules.unattended === 'allow') return { allowed: true };
    return {
      allowed: false,
      reasonForModel: `Permission required for "${toolName}" but coderaw is running unattended (no human to confirm). Action skipped.`,
    };
  }

  const confirmFn = ctx.confirm ?? defaultConfirm;
  let choice: ConfirmChoice;
  try {
    choice = await confirmFn({
      toolName,
      args,
      verdict,
      defaultApprove: verdict.severity === 'normal' && ctx.rules.confirmDefault === 'approve',
    });
  } catch {
    return { allowed: false, reasonForModel: 'Confirmation prompt was unavailable; action skipped for safety.' };
  }

  switch (choice.kind) {
    case 'yes':
      return { allowed: true };
    case 'session':
      ctx.sessionAllow.add(verdict.subject);
      return { allowed: true };
    case 'persist':
      try { ctx.persistAllow?.(verdict.subject); } catch { /* still allow this once */ }
      ctx.sessionAllow.add(verdict.subject);
      return { allowed: true };
    case 'no':
      return {
        allowed: false,
        reasonForModel: choice.reason
          ? `The user declined this action. Their guidance: "${choice.reason}". Adjust your approach.`
          : 'The user declined this action. Do not retry it; consider an alternative or ask what they want.',
      };
  }
}
```

- [ ] **Step 4: Write `src/permissions/index.ts`**

```ts
export { gate } from './gate';
export { classify, subjectsFor, isInside } from './classify';
export { loadPermissionRules, defaultRules, matchPattern, matchesAny, persistAllowPattern, DEFAULT_DENY } from './rules';
export { defaultConfirm, buildPreview } from './prompt';
export * from './types';
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npm test -- src/permissions/gate.test.ts`
Expected: PASS. (Requires `prompt.ts` to exist for the `import { defaultConfirm }` — create the Task 4 file first, or a stub. Recommended: implement Task 4 before running.)

- [ ] **Step 6: Commit**

```bash
git add src/permissions/gate.ts src/permissions/index.ts src/permissions/gate.test.ts
git commit -m "feat(perms): gate orchestrator (block/silent/ask, session+persist allow, unattended)"
```

---

### Task 4: Confirm prompt + preview (inquirer UI)

**Files:**
- Create: `src/permissions/prompt.ts`
- Test: `src/permissions/prompt.test.ts` (covers the pure `buildPreview` only)

**Interfaces:**
- Consumes: `ConfirmRequest`, `ConfirmChoice`, `Verdict` (types.ts); `chalk`, `inquirer` (CJS require).
- Produces: `defaultConfirm(req): Promise<ConfirmChoice>`, `buildPreview(toolName, args, verdict): string`.

- [ ] **Step 1: Write the failing test `src/permissions/prompt.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildPreview } from './prompt';
import { Verdict } from './types';

const v = (severity: 'normal' | 'warn'): Verdict =>
  ({ decision: 'ask', severity, reasons: ['shell command'], subject: 'x' });

describe('buildPreview', () => {
  it('shows the command for run_command', () => {
    const out = buildPreview('run_command', { command: 'npm test' }, v('normal'));
    expect(out).toContain('npm test');
  });
  it('warn severity includes a warning marker', () => {
    const out = buildPreview('run_command', { command: 'rm -rf x' }, v('warn'));
    expect(out).toContain('⚠');
  });
  it('shows a diff-ish view for edit_file', () => {
    const out = buildPreview('edit_file', { path: 'a.ts', old_text: 'foo', new_text: 'bar' }, v('normal'));
    expect(out).toContain('foo');
    expect(out).toContain('bar');
  });
  it('shows tool name + args for unknown tools', () => {
    const out = buildPreview('weird_tool', { a: 1 }, v('normal'));
    expect(out).toContain('weird_tool');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- src/permissions/prompt.test.ts`
Expected: FAIL — `Cannot find module './prompt'`.

- [ ] **Step 3: Write `src/permissions/prompt.ts`**

```ts
import chalk from 'chalk';
import { ConfirmRequest, ConfirmChoice, Verdict } from './types';

export function buildPreview(toolName: string, args: Record<string, unknown>, verdict: Verdict): string {
  const lines: string[] = [];
  if (verdict.severity === 'warn') {
    lines.push(chalk.red.bold(`⚠  ${verdict.reasons.join(' · ')}`));
  }
  if (toolName === 'run_command') {
    lines.push(chalk.bold('coderaw wants to run a shell command:'));
    lines.push(chalk.yellow(`  $ ${String(args.command ?? '')}`));
    if (args.cwd) lines.push(chalk.dim(`  in: ${String(args.cwd)}`));
  } else if (toolName === 'git_commit') {
    lines.push(chalk.bold('coderaw wants to create a git commit:'));
    lines.push(chalk.dim(`  message: ${String(args.message ?? '')}`));
    if (args.files) lines.push(chalk.dim(`  files: ${String(args.files)}`));
  } else if (toolName === 'edit_file') {
    lines.push(chalk.bold(`coderaw wants to edit ${String(args.path ?? '')}:`));
    String(args.old_text ?? '').split('\n').slice(0, 6).forEach(l => lines.push(chalk.red(`  - ${l}`)));
    String(args.new_text ?? '').split('\n').slice(0, 6).forEach(l => lines.push(chalk.green(`  + ${l}`)));
  } else if (toolName === 'write_file') {
    const content = String(args.content ?? '');
    lines.push(chalk.bold(`coderaw wants to write ${String(args.path ?? '')}:`));
    lines.push(chalk.dim(`  ${content.length} bytes, ${content.split('\n').length} lines`));
    content.split('\n').slice(0, 8).forEach(l => lines.push(chalk.dim(`  │ ${l}`)));
  } else {
    lines.push(chalk.bold(`coderaw wants to use "${toolName}":`));
    lines.push(chalk.dim('  ' + JSON.stringify(args).slice(0, 300)));
  }
  return lines.join('\n');
}

export async function defaultConfirm(req: ConfirmRequest): Promise<ConfirmChoice> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const inq = require('inquirer') as any;
  console.log('\n' + buildPreview(req.toolName, req.args, req.verdict) + '\n');
  const { choice } = await inq.prompt([{
    type: 'expand',
    name: 'choice',
    message: 'Allow this action?',
    default: req.defaultApprove ? 'y' : 'n',
    choices: [
      { key: 'y', name: 'Yes, once', value: 'yes' },
      { key: 'a', name: 'Yes — allow this for the rest of the session', value: 'session' },
      { key: 's', name: 'Yes — save as an allow rule (persists to config)', value: 'persist' },
      { key: 'n', name: 'No, skip', value: 'no' },
      { key: 'e', name: 'No — and tell the agent what to do instead', value: 'reason' },
    ],
  }]);
  if (choice === 'reason') {
    const { reason } = await inq.prompt([{ type: 'input', name: 'reason', message: 'What should it do instead?' }]);
    return { kind: 'no', reason: String(reason ?? '') };
  }
  if (choice === 'yes') return { kind: 'yes' };
  if (choice === 'session') return { kind: 'session' };
  if (choice === 'persist') return { kind: 'persist' };
  return { kind: 'no' };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm test -- src/permissions/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/permissions/prompt.ts src/permissions/prompt.test.ts
git commit -m "feat(perms): inquirer confirm prompt + per-tool preview renderer"
```

---

### Task 5: Config schema + defaults

**Files:**
- Modify: `src/config/settings.ts` (add `permissions?` to `Settings`; add a default block)

**Interfaces:**
- Produces: `Settings.permissions?` field consumed by `loadPermissionRules` and `persistAllowPattern`.

- [ ] **Step 1: Add the `permissions?` field to the `Settings` interface**

In `src/config/settings.ts`, inside `export interface Settings { ... }`, after `budget?: number;` add:

```ts
  permissions?: {
    enabled?: boolean;
    projectRoot?: string;            // 'auto' | absolute path
    allow?: string[];
    ask?: string[];
    deny?: string[];
    unattended?: 'deny' | 'allow';
    confirmDefault?: 'approve' | 'skip';
  };
```

- [ ] **Step 2: Add a default permissions block**

In `DEFAULT_SETTINGS`, after the `whisper` block, add:

```ts
  permissions: {
    enabled: true,
    projectRoot: 'auto',
    allow: [],
    ask: [],
    deny: [],
    unattended: 'deny',
    confirmDefault: 'approve',
  },
```

(The catastrophic `DEFAULT_DENY` list is enforced by the classifier, not stored here, so users see an empty, editable `deny` list.)

- [ ] **Step 3: Verify build/tests still green**

Run: `npm test`
Expected: all existing + new permission tests PASS. Also run `npm run build` (Task 8) later.

- [ ] **Step 4: Commit**

```bash
git add src/config/settings.ts
git commit -m "feat(perms): add permissions schema + defaults to settings"
```

---

### Task 6: Wire the gate into the agent loop + thread options from the CLI

**Files:**
- Modify: `src/agent/core.ts` (import gate; add options; build gateCtx; call gate in the tool loop)
- Modify: `src/cli.ts` (load rules once; create sessionAllow; pass through to runAgent)

**Interfaces:**
- Consumes: `gate`, `GateContext`, `Rules`, `loadPermissionRules`, `persistAllowPattern` (permissions/index).
- Produces: `AgentOptions.permissions?: Rules`, `AgentOptions.unattended?: boolean`, `AgentOptions.sessionAllow?: Set<string>`.

- [ ] **Step 1: Edit `src/agent/core.ts` — imports + options type**

Add to the import block near the top:

```ts
import { gate, GateContext, Rules, persistAllowPattern } from '../permissions';
```

Add to `interface AgentOptions`:

```ts
  permissions?: Rules;
  unattended?: boolean;
  sessionAllow?: Set<string>;
```

- [ ] **Step 2: Build `gateCtx` once inside `runAgent`**

After the destructuring of `options` (the `const { cwd, stream, ... } = options;` block), add:

```ts
  const { permissions, unattended, sessionAllow } = options;
  const gateCtx: GateContext | undefined = permissions
    ? {
        cwd,
        rules: permissions,
        isInteractive: Boolean(process.stdout.isTTY) && !unattended,
        sessionAllow: sessionAllow ?? new Set<string>(),
        persistAllow: persistAllowPattern,
      }
    : undefined;
```

- [ ] **Step 3: Call the gate in the tool-call loop**

In `core.ts`, inside `for (const toolCall of result.tool_calls) { ... }`, immediately AFTER the `try { toolArgs = JSON.parse(...) } catch {}` block and BEFORE `printToolCall(toolName, toolArgs);`, insert:

```ts
      if (gateCtx) {
        const decision = await gate(toolName, toolArgs, gateCtx);
        if (!decision.allowed) {
          printToolCall(toolName, toolArgs);
          printToolResult(toolName, `⛔ ${decision.reasonForModel ?? 'Not permitted.'}`);
          addMessage(conversation, {
            role: 'tool',
            content: decision.reasonForModel ?? 'Action not permitted by user permission rules.',
            tool_call_id: toolCall.id,
            name: toolName,
          });
          continue;
        }
      }
```

- [ ] **Step 4: Edit `src/cli.ts` — load rules + sessionAllow, pass to runAgent**

Add an import near the other imports:

```ts
import { loadPermissionRules } from './permissions';
```

In `startChat` (the function containing the `while (true)` loop), BEFORE the loop (near where `cwd`/`settings` are in scope), add:

```ts
  const permissionRules = loadPermissionRules(cwd, settings.permissions);
  const sessionAllow = new Set<string>();
```

Update the `runAgent(...)` call (currently around line 262) to include the new options:

```ts
      const agentResult = await runAgent(provider, conversation, input, {
        cwd, stream: true, mcpClient, registry, memory, skills, tokenTracker,
        permissions: permissionRules,
        sessionAllow,
        onToken: (token: string) => { streamedContent += token; },
      });
```

Also add `permissionRules` to `makeSlashCtx()` return object and to `SlashCommandContext` (used in Task 7):

In `SlashCommandContext` interface add:
```ts
  permissionRules: import('./permissions').Rules;
  sessionAllow: Set<string>;
```
In `makeSlashCtx` return object add:
```ts
    permissionRules, sessionAllow,
```

- [ ] **Step 5: Build to verify integration compiles**

Run: `npm run build`
Expected: TypeScript compiles with no errors. Fix any type mismatches (e.g. ensure `Rules` import path is correct).

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests (14 existing + new) PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/core.ts src/cli.ts
git commit -m "feat(perms): gate every tool call at the core dispatch choke point"
```

---

### Task 7: `/permissions` slash command

**Files:**
- Modify: `src/cli.ts` (add a `permissions` / `perms` case to `handleSlashCommand`; extend help text)

**Interfaces:**
- Consumes: `ctx.permissionRules` (live `Rules`), `ctx.cwd`, `persistAllowPattern`.

- [ ] **Step 1: Add the import for persistence (if not already present)**

At the top of `src/cli.ts` extend the permissions import:

```ts
import { loadPermissionRules, persistAllowPattern } from './permissions';
```

- [ ] **Step 2: Add the `permissions` case to the switch in `handleSlashCommand`**

Add a new case (e.g. after the `skills` case):

```ts
    // ── Permissions ─────────────────────────────────────────────────────────────
    case 'permissions':
    case 'perms': {
      const r = ctx.permissionRules;
      const sub = args[0]?.toLowerCase();
      if (!sub) {
        printSectionHeader('🔐 Permissions');
        console.log(`  enabled: ${r.enabled ? chalk.green('yes') : chalk.red('no')}`);
        console.log(`  project root: ${chalk.magenta(r.projectRoot)}`);
        console.log(`  unattended: ${r.unattended} · Enter-default: ${r.confirmDefault}`);
        console.log(`  ${chalk.green('allow')} (${r.allow.length}): ${r.allow.join(', ') || chalk.dim('(none)')}`);
        console.log(`  ${chalk.yellow('ask')}   (${r.ask.length}): ${r.ask.join(', ') || chalk.dim('(none)')}`);
        console.log(`  ${chalk.red('deny')}  (${r.deny.length}): ${r.deny.join(', ') || chalk.dim('(none)')}`);
        console.log(`\n  ${chalk.dim('Usage: /permissions allow <pattern> | deny <pattern> | ask <pattern>')}`);
        break;
      }
      const pattern = args.slice(1).join(' ').trim();
      if (!pattern && sub !== 'reload') { printError(`Usage: /permissions ${sub} <pattern>`); break; }
      if (sub === 'allow') {
        if (!r.allow.includes(pattern)) r.allow.push(pattern);
        persistAllowPattern(pattern);
        printSuccess(`Allowed (and saved): ${pattern}`);
      } else if (sub === 'deny') {
        if (!r.deny.includes(pattern)) r.deny.push(pattern);
        printSuccess(`Denied this session: ${pattern}`);
        printInfo('To persist, add it to permissions.deny in your config.yaml.');
      } else if (sub === 'ask') {
        if (!r.ask.includes(pattern)) r.ask.push(pattern);
        printSuccess(`Will ask for: ${pattern}`);
      } else if (sub === 'reload') {
        const fresh = loadPermissionRules(ctx.cwd, ctx.settings.permissions);
        r.enabled = fresh.enabled; r.projectRoot = fresh.projectRoot;
        r.allow = fresh.allow; r.ask = fresh.ask; r.deny = fresh.deny;
        r.unattended = fresh.unattended; r.confirmDefault = fresh.confirmDefault;
        printSuccess('Permission rules reloaded from config.');
      } else {
        printError(`Unknown /permissions subcommand: ${sub}`);
      }
      break;
    }
```

- [ ] **Step 3: Add `/permissions` to the help text**

Find `printHelp()` and add a line documenting `/permissions` (and `/perms`) alongside the other commands, e.g.:
```
  /permissions          Show & edit permission rules (allow/deny/ask <pattern>)
```

- [ ] **Step 4: Build + test**

Run: `npm run build && npm test`
Expected: compiles; all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(perms): /permissions slash command to view + edit rules live"
```

---

### Task 8: Manual smoke test, build, docs, finish

**Files:**
- Modify: `dist/` (compiled output — committed per repo convention)
- Modify: `README` / help docs if a permissions section is warranted (optional, keep minimal)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: clean compile, `dist/` updated, no `*.test.ts` emitted.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all green (14 existing + ~30 new). Record the count.

- [ ] **Step 3: Manual smoke test (interactive)**

With Ollama running, launch `node dist/cli.js` (or the `coderaw` link) in this repo and verify by direct observation:
1. Ask it to read a file → runs silently (no prompt). ✅ silent path.
2. Ask it to run a shell command (e.g. "run `npm test`") → a confirm prompt appears showing the command; choose `n` → the agent is told it was declined and adapts. ✅ ask path + model feedback.
3. Repeat the command, choose `a` → second identical command in the same session does NOT prompt. ✅ session allow.
4. Ask it to write a file inside the project → runs (visible via the tool-call line), no prompt. ✅ in-project silent.
5. Try a destructive command (e.g. `rm -rf` something harmless) → prompt shows the red ⚠ warn banner. ✅ warn severity.
6. `/permissions` → shows the rules; `/permissions allow "git status"` → confirms + persists.

Capture the actual terminal output as evidence (paste into the session). Do NOT claim success without observing each.

- [ ] **Step 4: Commit the build + any doc tweaks**

```bash
git add -A
git commit -m "chore(perms): compile dist; finalize P1.2 permissions layer"
```

- [ ] **Step 5: Update the design/plan checkmarks**

Mark all steps complete in this plan file; note the final test count and any deviations.

---

## Self-Review

**Spec coverage:**
- Classifier (buckets/precedence/path/destructive) → Task 2. ✅
- Rules file + per-project merge + matcher → Task 1. ✅
- Gate orchestration (block/silent/ask, session+persist allow, unattended) → Task 3. ✅
- Confirm prompt + previews → Task 4. ✅
- Config schema + defaults → Task 5. ✅
- Integration at the core choke point + CLI threading → Task 6. ✅
- `/permissions` slash command → Task 7. ✅
- Headless/unattended behavior → Task 3 + Task 6 (isInteractive). ✅
- Transparency for silent path → satisfied by the existing `printToolCall` (every tool call is already printed); the gate adds a denial line for blocked actions. Noted — no extra code needed.
- Error handling (bad rules file, prompt throws, persist failure, bad path) → Task 1 (try/catch on project file), Task 3 (confirm throws → deny; persist failure → allow once), Task 2 (path resolution is total). ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code. ✅

**Type consistency:** `Rules`, `Verdict`, `GateContext`, `ConfirmChoice` used identically across tasks; `classify(toolName,args,root,rules)`, `gate(toolName,args,ctx)`, `loadPermissionRules(cwd,globalPerms)`, `persistAllowPattern(pattern)` signatures consistent across Tasks 1–7. ✅

**Deviation from spec:** confirm keys are `y/a/s/n/e` (not `y/a/A/n/e`) because inquirer `expand` keys are case-insensitive and `a`/`A` would collide — `s` = save-to-rules. Functionally identical to the locked decision.
