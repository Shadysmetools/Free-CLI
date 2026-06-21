# Permissions / Control Layer — Design (P1.2)

**Date:** 2026-06-21
**Sub-project:** #2 (CLI hardening) → P1.2
**Status:** Approved, ready for implementation plan

## Problem

coderaw's agent loop executes every tool call with no gate. A P0 acceptance run
showed the local Qwen-7B model **editing a file unprompted / off-task**. As coderaw
grows toward full laptop control (shell) and browser control, ungated execution is a
real hazard — a hallucinating 7B model can run destructive commands or write outside
the project with nothing in the way.

This layer is the "unrestricted but user-controlled" surface. It must:

1. Stop coderaw before **consequential** actions and show the user *exactly* what it
   intends — so the human catches the weak model's mistakes (a correctness checkpoint,
   not only a safety gate).
2. Stay out of the way for safe work (no nagging).
3. Be controlled by **rules the user owns**, not rigid named modes.
4. Gate future power (MCP / browser / OS tools) automatically, by construction.

## Decisions (locked with user)

- **No named modes** (no "careful"/"unrestricted" toggle). Control is via a rules file.
- **Default-permissive**: safe, in-project work runs silently.
- **Ask threshold = "consequential actions"**: confirm (with full preview) before any
  shell command, any `git commit`, and anything destructive or outside the project root.
  In-project `write_file`/`edit_file` run silently but are logged.
- **Anything not explicitly known-safe is treated as consequential** → future-proofs
  MCP / browser / OS tools.
- Enter = **approve** on a normal prompt, **skip** on a red `warn`-severity prompt.
- Confirm prompt offers session-allow `[a]` and persist-to-rules `[A]`.

## Architecture (Approach A: single gate at the choke point)

All tool calls already flow through one place: `src/agent/core.ts` (~line 205), which
branches to `memory_search` / `mcpClient.callTool` / `executeTool`. We insert ONE gate
call before that branch. This covers built-in **and** MCP **and** all future tools with
no per-tool wiring.

New module `src/permissions/`:

```
src/permissions/
  classify.ts   # pure: (toolName, args, cwd, rules) -> Verdict
  rules.ts      # load + merge + match the rules file (glob-ish)
  gate.ts       # orchestrates: classify -> (block | ask via prompt | silent), returns GateResult
  prompt.ts     # the inquirer-based confirm UI + preview renderers
  types.ts      # Verdict, Rules, GateResult, GateContext
  index.ts      # re-exports; the single `gate()` entry used by core.ts
```

### 1. Classifier — `classify.ts` (pure function)

```ts
type Decision = 'silent' | 'ask' | 'block';
type Severity = 'normal' | 'warn';
interface Verdict { decision: Decision; severity: Severity; reasons: string[]; }
function classify(toolName: string, args: Record<string, unknown>, cwd: string, rules: Rules): Verdict;
```

Default buckets (applied **after** rules; see precedence):

- **silent**: `read_file`, `search_files`, `list_files`, `git_status`, `git_diff`,
  `git_log`, `memory_search`; plus `write_file` / `edit_file` whose resolved target path
  is **inside** the project root.
- **ask**: `run_command` (all), `git_commit`, any write/edit/delete resolving **outside**
  the project root, and **any tool not on the known-safe list** (MCP, unknown, future
  browser/OS tools).
- **warn** (still `ask`, but loud red banner): the action matches a destructive pattern
  (`rm -rf`, `del /s`, `rmdir /s`, `format`, disk-wipe, `:>` redirects to system paths)
  OR resolves outside the project root.

Project root = the cwd at launch (overridable via `permissions.projectRoot`).
Path classification resolves args (`path`, command `cwd`) against the root using
`path.resolve` + a robust `isInside(root, target)` check (handles Windows drive letters,
`..`, UNC, case-insensitive compare on win32).

`run_command` is always `ask` regardless of content; destructive **string patterns** only
raise severity to `warn` (we do NOT need a full shell parser — every command already asks).

### 2. Rules — `rules.ts` (the control surface)

`permissions:` block in `%APPDATA%\coderaw\config.yaml`, with an optional per-project
`.coderaw/permissions.yaml` in the launch cwd **deep-merged over** the global block
(arrays concatenated, scalars overridden) so a repo can tighten or loosen.

```yaml
permissions:
  enabled: true
  projectRoot: auto          # 'auto' = launch cwd, or an absolute path
  allow:  ['npm test', 'npm run *', 'git status']   # auto-approve -> runs silent
  ask:    ['git push *']                              # force-ask even if normally silent
  deny:   ['rm -rf /*', 'format *']                  # hard block -> fails with a message
  unattended: deny           # 'deny' | 'allow' — behavior when no human is present
  confirmDefault: approve    # 'approve' | 'skip' — what Enter does on a normal prompt
```

Matching: each entry is a glob-ish pattern (`*` wildcard) tested against
the **match subject** for the tool:
- `run_command` → the command string
- `write_file`/`edit_file`/file ops → `"<tool> <resolvedPath>"` AND the bare path
- other tools → `"<tool>"` and `"<tool> <json-of-args>"`

**Precedence (first match wins): `deny` → `allow` → `ask` → default bucket.**

`enabled: false` short-circuits the whole layer to `silent` (escape hatch / parity with
today's behavior).

### 3. Gate — `gate.ts` (orchestrator)

```ts
interface GateContext {
  cwd: string;
  rules: Rules;
  isInteractive: boolean;         // process.stdout.isTTY && not headless
  confirm?: ConfirmFn;            // injectable for tests; defaults to prompt.ts
  sessionAllow: Set<string>;      // session [a] allowlist (per-run, in memory)
  persistAllow: (pattern: string) => void; // [A] -> append to global rules file
}
interface GateResult {
  allowed: boolean;
  reasonForModel?: string;        // when denied/skipped, fed back to the agent
  log?: string;                   // dim one-liner for the silent path
}
async function gate(toolName, args, ctx): Promise<GateResult>;
```

Behavior:
- Verdict `block` → `{ allowed:false, reasonForModel: "blocked by rule: <pattern>" }`.
- Verdict `silent` → `{ allowed:true, log: oneLiner(toolName,args) }`.
- Verdict `ask`:
  - session allowlist hit → allowed, silent.
  - **not interactive** (no TTY / unattended run): if `unattended:'allow'` → allowed;
    else `{ allowed:false, reasonForModel: "permission required; running unattended" }`.
  - interactive → call `confirm(preview)`; map the choice:
    - `y` approve once → allowed.
    - `a` approve + add pattern to `sessionAllow` → allowed, future calls silent.
    - `A` approve + `persistAllow(pattern)` (write to rules `allow:`) → allowed.
    - `n` skip → `{ allowed:false, reasonForModel: "user declined this action" }`.
    - `e` skip + reason → `{ allowed:false, reasonForModel: "user declined: <text>" }`.

### 4. Prompt + previews — `prompt.ts`

Reuses `inquirer` (already a dependency). Renders a preview by tool:
- `run_command` → literal command + resolved cwd; `warn` prepends a red ⚠ + reasons.
- `edit_file` (out-of-project) → unified diff of `old_text` → `new_text`.
- `write_file` (out-of-project) → path, byte size, first ~12 lines.
- `git_commit` → message + file list.
- MCP/unknown → tool name + pretty-printed args (truncated).

Choices rendered as a single-key list: `y / a / n / e` (+ `A` persist). Enter maps to
`confirmDefault` for `normal`, hard-defaults to `skip` for `warn`.

### 5. Integration — `core.ts`

Inside the tool-call loop, before the memory/MCP/built-in branch:

```ts
const g = await gate(toolName, toolArgs, gateCtx);
if (!g.allowed) {
  // push a ToolResult error back to the model so it adapts instead of looping
  toolResults.push({ tool_call_id, role:'tool', content: g.reasonForModel });
  continue;
}
if (g.log) renderSilentLog(g.log);   // dim one-liner for in-project writes/edits
// ...existing dispatch...
```

`gateCtx` is built once per `runAgent` from loaded settings (rules), TTY state, and a
fresh `sessionAllow` set. `AgentOptions` gains an optional `unattended?: boolean` (set by
future autonomous/headless callers) which forces `isInteractive=false`.

### 6. Config schema — `settings.ts`

Add to `Settings`:
```ts
permissions?: {
  enabled?: boolean;
  projectRoot?: string;          // 'auto' | absolute path
  allow?: string[];
  ask?: string[];
  deny?: string[];
  unattended?: 'deny' | 'allow';
  confirmDefault?: 'approve' | 'skip';
};
```
`DEFAULT_SETTINGS.permissions = { enabled: true, projectRoot: 'auto', allow: [], ask: [],
deny: [...sensible catastrophic patterns], unattended: 'deny', confirmDefault: 'approve' }`.
Default `deny` ships a tiny catastrophic set (e.g. `rm -rf /*`, `rm -rf ~`, `format *`,
`del /s /q C:\*`) — conservative; user can clear it.

### 7. Slash command — `/permissions`

`handleSlashCommand` gains `/permissions` (alias `/perms`): prints current rules, and
supports `allow <pattern>` / `deny <pattern>` / `ask <pattern>` to append a rule, and
`reload` to re-read the file. Small, additive; full editing stays in the YAML file.

### 8. Transparency for the silent path

In-project writes/edits print a dim one-liner: `~ edited ./src/foo.ts (+3 −1)` /
`~ wrote ./src/new.ts (42 lines)`. The agent can still edit without a prompt, but never
**invisibly** — directly mitigating the P0 rogue-edit finding.

## Error handling

- Rules file missing/invalid YAML → log a warning, fall back to `DEFAULT_SETTINGS`
  permissions (never crash, never silently disable the gate).
- `confirm()` throws / stdin closes mid-prompt → treat as **skip** (deny), reason
  "prompt unavailable".
- `persistAllow` write failure → still allow the action this once, warn that the rule
  wasn't saved.
- Path resolution failure (bad arg) → severity `warn`, decision `ask` (fail safe).

## Testing (vitest, TDD — red first)

- `classify.test.ts`: read→silent; in-project write/edit→silent; out-of-project
  write/edit→ask+warn; run_command→ask; `rm -rf` → warn; unknown/MCP tool→ask;
  rules `allow` makes a command silent; rules `deny` → block; precedence deny>allow>ask;
  Windows path edge cases (drive letters, `..`, case-insensitive root compare).
- `rules.test.ts`: glob matching (`npm *`, `git push *`), deep-merge global+project,
  `enabled:false` short-circuits, match-subject construction per tool.
- `gate.test.ts` (mocked `confirm`): approve→allowed; skip→`reasonForModel` set & not
  allowed; `a`→second identical call is silent (session allowlist); `A`→`persistAllow`
  called; unattended + `unattended:'deny'`→denied; unattended + `'allow'`→allowed;
  `block`→denied with reason.

Target: all new tests green **and** the existing 14 stay green. Build still excludes
`*.test.ts`.

## Out of scope (later sub-projects)

- The actual browser/OS tools (#6) — this layer only ensures they'll be gated.
- A full shell-command AST/policy engine (Approach C) — YAGNI; every command already asks.
- GUI / TUI rules editor — the YAML file + `/permissions` subcommand suffice.

## Files touched

- **New:** `src/permissions/{classify,rules,gate,prompt,types,index}.ts` + 3 test files.
- **Edited:** `src/agent/core.ts` (gate call), `src/config/settings.ts` (schema+defaults),
  `src/cli.ts` (`/permissions` command, pass `unattended` through), `src/agent/tools.ts`
  (only if a `deleteFile`/delete path needs classifying — verify during impl).
