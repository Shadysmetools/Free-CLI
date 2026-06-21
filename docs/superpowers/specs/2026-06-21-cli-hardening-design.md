# coderaw — Sub-project #2: CLI Hardening (Design Spec)

- **Date:** 2026-06-21
- **Status:** Scope approved by user. P0 to be implemented first.
- **Repo:** `Free-CLI` (internal name `coderaw`)

## Context
coderaw is a working multi-provider AI coding agent (~9.5k LOC). Sub-project #1 (local runtime) is **done**: it drives a local Ollama model (Qwen2.5-Coder) through an agentic tool loop, verified offline end-to-end. This spec hardens the core so the agent is **reliable across local *and* cloud models** — the prerequisite for the advanced capabilities the user wants (dynamic workflows, autonomous goals, multi-agent orchestration, research), all of which collapse on a flaky tool loop.

## Goal
Make coderaw's agent loop reliable, observable, and safe on any model, and complete the user-controlled provider/control surface.

## Non-goals (handled by later sub-projects)
- Orchestration engine / dynamic workflows / autonomous goals → **#3**
- graphify + context-mode integration, research mode → **#4**
- First-class sub-agent spawning → **#5**

## Scope & priorities

### P0 — Reliability (build first)

**P0.1 Tool-call robustness v2** — `src/providers/ollama.ts`, `src/agent/core.ts`
- Generalize the recovery shim already added: bare object, array, ```json fence, `<tool_call>` tags (done) + tolerate leading/trailing prose and multiple calls in one message.
- Validate the recovered tool name against the registry; unknown name → return a structured error message to the model instead of failing the turn.
- **Repair loop:** on JSON parse failure or invalid call, re-prompt **once** ("resend ONLY valid JSON for the tool call"); hard-cap at 1 repair to prevent loops.
- Acceptance: qwen2.5-coder:7b, gemma3:12b, and llama3.1 each complete a 3-step task (read → edit → run) unattended; a deliberately malformed call triggers exactly one repair, then proceeds.

**P0.2 Streaming-with-tools** — `src/providers/ollama.ts`
- Remove the `stream && !tools` gate so tokens stream even when tools are present (currently every agentic turn is silent until done).
- Accumulate streamed content; at stream end run tool-call recovery on the accumulated text + any native `tool_calls`.
- Acceptance: tokens appear live during agentic turns; tool calls still detected and executed.

**P0.3 ripgrep search** — `src/agent/tools.ts`, `package.json`
- Add `@vscode/ripgrep` (ships the `rg` binary cross-platform). Replace the `searchFiles` findstr/grep shell-out with `rg`.
- Respect `pattern`, `path`, `file_pattern` (glob), `case_sensitive`; exclude `node_modules`/`.git`/`dist`; cap results.
- Fall back to the current implementation if `rg` is unavailable.
- Acceptance: correct, fast results on Windows; globs honored; no findstr quirks.

### P1 — Control & parity
- **P1.1 Custom / OpenAI-compatible provider** (user's "any API key") — `src/providers/custom.ts`: base URL + API key + model, OpenAI chat-completions shape; register in `providers/index.ts` + settings. *Pull-forward candidate — small, high value.*
- **P1.2 Permissions / control layer** (user's "unrestricted + I control it") — confirm-before-write/run, allowlist, and a `careful` ↔ `unrestricted` mode toggle in settings; gate `run_command` / `write_file` / `edit_file`. This is the explicit user-control surface.
- **P1.3 Plan / TODO tool + plan mode** — a `todo_write`-style tool the agent uses to track multi-step work, surfaced in the UI.
- **P1.4 Token-aware context management** — replace the crude char-truncation trimmer in `core.ts` with token-aware compaction + a `/compact` summary.

### P2 — Toolset breadth
- `glob` tool, multi-file read, `web_fetch` + `web_search` (offline-toggleable; feeds #4 research), reliable apply-patch, MCP client verify/harden (client already exists).

## Risks & mitigations
- Local model tool-calling stays imperfect even with repair → repair loop + clear errors; recommend cloud model for hard autonomous runs (the "local AND online" design exists for exactly this).
- `@vscode/ripgrep` adds a binary dependency → acceptable; fallback retained.
- Streaming + tool-recovery interaction is subtle → test across all three models.

## P0 acceptance (the build target)
A scripted multi-step task — *"find all TODOs, open the file with the most, add a comment above the first one, run `npm run build`"* — completes **unattended on local Qwen**, with live token streaming, correct ripgrep search, and at most one self-repair.
