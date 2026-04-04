<div align="center">

# ⚡ knowcap-code

### Free AI Coding Assistant — Claude Code Alternative

[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![Providers](https://img.shields.io/badge/AI_Providers-6-purple)](#providers)
[![Free](https://img.shields.io/badge/Cost-100%25_Free-brightgreen)](#free-providers)

**Works like Claude Code — reads/writes/edits files, runs commands, understands your codebase — but free with any model.**

[Quick Start](#quick-start) · [Providers](#providers) · [Slash Commands](#slash-commands) · [Memory](#memory-system) · [Skills](#skills-system) · [Token Tracking](#token-tracking) · [OpenClaw](#openclaw-integration)

</div>

---

```
┌─────────────────────────────────────────┐
│  ⚡ knowcap-code  free AI coding agent   │
│  ollama · groq · gemini · claude · gpt  │
└─────────────────────────────────────────┘

🎯 5 skills available (debug, docker, git-workflow, github, npm)
Provider: groq/llama-3.3-70b-versatile | Type /help for commands

› Create a REST API endpoint for user authentication

AI  ›
I'll create an auth endpoint. Let me check your project structure first...

┌─ ⚙ list_files
│ src/ routes/ middleware/ package.json
└─

┌─ ⚙ write_file
│ ✓ Created src/routes/auth.ts (87 lines)
└─

[groq/llama-3.3-70b-versatile · 1,432 in / 387 out · free]
```

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🆓 **100% Free** | Ollama (local), Groq free tier, Gemini free tier, OpenRouter free models |
| 🔑 **BYOK** | Bring your own key for Anthropic, OpenAI |
| 📁 **File Operations** | Read, write, edit with precise text replacement |
| 🐚 **Shell Commands** | Run tests, builds, installs, any command |
| 🔀 **Git Integration** | Status, diff, commit from natural language |
| 🔌 **MCP Support** | Model Context Protocol — connect any external tool |
| 🎙️ **Whisper Transcription** | Local or Groq free API |
| 🧠 **Memory System** | `MEMORY.md` project memory, session logs, search |
| 🎯 **Skills System** | Auto-detected expertise loaded per-message |
| 📊 **Token Tracking** | Per-message cost, session totals, budget alerts |
| 🔧 **Tool Registry** | Enable/disable tools, categories, MCP auto-register |
| 🐾 **OpenClaw Integration** | Manage agents, sessions, cron from the CLI |
| 🧙 **Smart Setup** | Auto-detects providers, zero config if Ollama running |
| ↩️ **Undo** | Revert any file change |
| 🌊 **Streaming** | Token-by-token output |
| 🌍 **Cross-Platform** | macOS, Linux, Windows |

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 18+** | Required |
| **npm / yarn / pnpm** | Any package manager |
| **Ollama** | Optional — for free local AI |
| **Python 3** | Optional — for local Whisper transcription |
| **ffmpeg** | Optional — for video frame extraction |
| **git** | Optional — for git tools |

---

## Quick Start

### Option 1 — npm (global install)

```bash
npm install -g knowcap-code
kcc
```

On first run, knowcap-code **auto-detects** what's available and starts immediately — no config needed if Ollama is running or you have API keys set.

### Option 2 — From Source

```bash
# 1. Clone
git clone https://github.com/Smetools/knowcap-code.git
cd knowcap-code

# 2. Install dependencies
npm install

# 3. Build
npm run build

# 4. Link globally (optional)
npm link

# 5. Run
kcc
# or: node dist/index.js
```

### Option 3 — npx (no install)

```bash
npx knowcap-code
```

---

## Smart First-Run Setup

On the **first run**, knowcap-code auto-detects providers:

```
⚡ Welcome to knowcap-code!

🔍 Detecting AI providers...
   ✅ Ollama (local, free) — qwen2.5-coder:7b ready
   ❌ Groq (free cloud, fast) — no GROQ_API_KEY set
   ❌ Google Gemini (free tier) — no GOOGLE_API_KEY set

✅ Ready to go! Using Ollama (free, local).
   Type your first message or /help for commands.
```

**If nothing is found**, it shows a guided menu:

```
📋 Quick Setup — choose a provider:

  1. 🆓 Ollama — local, free, private
  2. 🆓 Groq — free cloud, ultra-fast
  3. 🆓 Google Gemini — free tier
  4. 💰 Anthropic Claude — BYOK
  5. 💰 OpenAI GPT — BYOK
  6. ⏭  Skip

  Choice [1]:
```

Re-run setup anytime: `kcc setup`

---

## Providers

### Free Providers (No Credit Card)

| Provider | Setup | Speed | Best For |
|----------|-------|-------|----------|
| **Ollama** | Install locally | Fast (local) | Privacy, offline, no limits |
| **Groq** | Free API key | Very fast | Quick tasks, free cloud |
| **Google Gemini** | Free API key | Fast | Large context, multimodal |
| **OpenRouter** | Free API key | Varies | Access many free models |

### BYOK Providers

| Provider | Key Env Var | Best Model |
|----------|------------|------------|
| **Anthropic** | `ANTHROPIC_API_KEY` | claude-3-5-haiku (cheap), claude-sonnet (smart) |
| **OpenAI** | `OPENAI_API_KEY` | gpt-4o-mini (cheap), gpt-4o (smart) |

### Setup Examples

#### Ollama (Free, Local)

```bash
# 1. Install Ollama
curl -fsSL https://ollama.com/install.sh | sh
# Windows: https://ollama.com/download

# 2. Pull a coding model
ollama pull qwen2.5-coder:7b      # 4.7GB, great for code
ollama pull llama3.1:8b           # 4.7GB, general purpose
ollama pull deepseek-coder-v2:16b # 9GB, excellent for code

# 3. Run kcc — it auto-detects Ollama
kcc
```

#### Groq (Free Cloud)

```bash
# Get free key: https://console.groq.com (no credit card)
export GROQ_API_KEY=gsk_xxx
kcc --provider groq
```

#### Google Gemini (Free Tier)

```bash
# Get free key: https://aistudio.google.com
export GOOGLE_API_KEY=AIza_xxx
kcc --provider google
```

#### Anthropic Claude

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
kcc --provider anthropic
```

#### OpenAI

```bash
export OPENAI_API_KEY=sk-xxx
kcc --provider openai
```

### Switching Models

```bash
# In session
› /model groq:llama-3.3-70b-versatile
› /model anthropic:claude-3-5-sonnet-20241022
› /model ollama:deepseek-coder-v2:16b

# From command line
kcc --provider groq --model llama-3.3-70b-versatile
kcc --provider anthropic --model claude-3-opus-20240229
```

---

## Slash Commands

### Conversation

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model [provider:model]` | Switch AI provider/model |
| `/clear` | Clear conversation history |
| `/compact` | Summarize history to save tokens |
| `/exit` | Exit session |

### Code

| Command | Description |
|---------|-------------|
| `/review [file]` | Code review with AI |
| `/test` | Run project tests |
| `/diff [file]` | Show git diff (color-coded) |
| `/git <args>` | Run any git command |
| `/undo` | Undo last file change |
| `/init` | Create KNOWCAP.md memory file |

### Memory System

| Command | Description |
|---------|-------------|
| `/memory` | Show MEMORY.md contents |
| `/memory search <query>` | Search across all memory files |
| `/memory save <note>` | Save a note to MEMORY.md |
| `/memory clear` | Clear MEMORY.md (with confirmation) |
| `/memory today` | View today's session log |

### Skills System

| Command | Description |
|---------|-------------|
| `/skills` | List all available skills |
| `/skills info <name>` | Show skill details and instructions |
| `/skills add <name>` | Create a new custom skill |

### Token Tracking

| Command | Description |
|---------|-------------|
| `/cost` | Full session cost breakdown |
| `/stats` | Alias for `/cost` |
| `/tokens` | Compact token summary |
| `/budget <amount>` | Set USD budget limit |

### Tool Registry

| Command | Description |
|---------|-------------|
| `/tools` | List all tools by category |
| `/tools info <name>` | Show tool details and parameters |
| `/tools enable <name>` | Enable a disabled tool |
| `/tools disable <name>` | Disable a tool |

### OpenClaw Gateway

| Command | Description |
|---------|-------------|
| `/openclaw status` | Gateway health + connected agents |
| `/openclaw agents` | List all configured agents |
| `/openclaw sessions` | Active sessions |
| `/openclaw send <session> <msg>` | Send message to an agent |
| `/openclaw history <session>` | View session transcript |
| `/openclaw cron` | List cron jobs |

### Other

| Command | Description |
|---------|-------------|
| `/transcribe <file>` | Transcribe audio/video with Whisper |
| `/mcp` | List MCP servers and tools |
| `/config` | Show/edit configuration |

---

## Memory System

knowcap-code uses a `MEMORY.md` file (inspired by Claude Code's `CLAUDE.md`) to give the AI persistent project context.

### How It Works

```
your-project/
├── MEMORY.md          ← Project memory (commit this!)
├── memory/
│   ├── 2026-04-01.md  ← Session logs (auto-generated, .gitignore)
│   └── 2026-04-04.md
└── src/
```

- **`MEMORY.md`** — Human-written project context, version-controlled
- **`memory/YYYY-MM-DD.md`** — AI-written session logs, not committed
- **`~/.knowcap-code/MEMORY.md`** — Personal user-level memory

### Memory File Format

```markdown
# MEMORY.md

## Decisions
- [2026-04-04] Use pnpm instead of npm for this project
- [2026-04-04] Auth uses JWT with 24h expiry

## Context
- Tech stack: Next.js 14, Supabase, TypeScript
- Tests: Vitest, run with `pnpm test`
- Deploy: Vercel, auto-deploy on main push

## Workflows
- Build: `pnpm build`
- Test: `pnpm test`
- Lint: `pnpm lint`

## Todo
- [ ] Fix the auth refresh token bug
- [x] Set up CI pipeline
```

### Load Limit

Memory files are loaded at session start with a **200-line / 25KB limit** (matching Claude Code's CLAUDE.md behavior). Use concise, high-value notes.

### Usage

```bash
# In session
› /memory save "Use pnpm for this project"
✓ Saved to MEMORY.md

› /memory search auth
  MEMORY.md:5  - [2026-04-04] Auth uses JWT with 24h expiry

› /memory
📋 MEMORY.md
[shows full contents]
```

The AI also uses `memory_save` and `memory_search` tools automatically when it discovers something important.

---

## Skills System

Skills are auto-detected expertise that get injected into the AI's context when relevant.

### Built-in Skills

| Skill | Triggers On |
|-------|-------------|
| `github` | PR, issue, CI, workflow, gh CLI |
| `docker` | container, Dockerfile, compose |
| `npm` | package.json, node_modules, install |
| `debug` | error, bug, crash, exception |
| `git-workflow` | rebase, cherry-pick, bisect, stash |

### Custom Skills

```bash
# Create a skill for your project
› /skills add supabase

# Edit skills/supabase/SKILL.md
```

**SKILL.md format** (YAML frontmatter + instructions):

```markdown
---
name: supabase
description: "Supabase database operations, RLS policies, edge functions, and auth."
---

# Supabase Skill

## When to Use
- Database queries, migrations, or schema changes
- RLS (Row Level Security) policies
- Supabase Auth, Edge Functions, Storage

## Instructions
1. Use the Supabase client: `import { supabase } from '@/lib/supabase'`
2. Always use parameterized queries, never string concat
3. Check RLS policies when queries return empty unexpectedly
...
```

### Skill Sources

Skills are loaded from (later sources override earlier):
1. `dist/skills/builtins/` — Built-in skills (ship with knowcap-code)
2. `<project>/skills/` — Project-specific skills (commit these!)
3. `~/.knowcap-code/skills/` — Personal skills (all projects)

---

## Token Tracking

knowcap-code tracks token usage and cost per response and for the full session.

### Per-Response Footer

```
[groq/llama-3.3-70b-versatile · 1,234 in / 567 out · free]
[anthropic/claude-3-5-haiku · 2,341 in / 891 out · $0.0102]
```

### `/cost` Command

```
  Token Usage & Cost
  ────────────────────────────────────────
  Total cost:            $0.55
  Total duration (API):  6m 19.7s
  Total duration (wall): 6h 33m 10.2s
  Total tokens:          45,231 in / 12,847 out
  Turns:                 23

  By model:
    anthropic/claude-3-5-haiku-20241022          43,210 in / 12,100 out · $0.52 (20 calls)
    groq/llama-3.3-70b-versatile                  2,021 in / 747 out · free (3 calls)
```

### Budget Alerts

```bash
# Set a session budget
› /budget 1.00
✓ Budget set to $1.00 per session

# Warning when approaching
⚠  Approaching budget limit: $0.82 of $1.00 (82%)
```

### Pricing Table

| Provider | Input (per 1M) | Output (per 1M) |
|----------|---------------|-----------------|
| Ollama | FREE | FREE |
| Groq (free tier) | FREE | FREE |
| Gemini 2.0 Flash | $0.10 | $0.40 |
| Gemini 2.5 Flash | $0.15 | $0.60 |
| Claude Haiku 3.5 | $0.80 | $4.00 |
| Claude Sonnet 4.6 | $3.00 | $15.00 |
| GPT-4o Mini | $0.15 | $0.60 |
| GPT-4o | $2.50 | $10.00 |

---

## Tool Registry

All tools are managed through a central registry.

### Built-in Tools

| Category | Tools |
|----------|-------|
| 📄 **File** | `read_file`, `write_file`, `edit_file`, `search_files`, `list_files` |
| ⚡ **Shell** | `run_command` |
| 🌿 **Git** | `git_status`, `git_diff`, `git_commit`, `git_log` |
| 🧠 **Memory** | `memory_search`, `memory_save` |
| 🔌 **MCP** | Auto-registered from MCP servers |

### `/tools` Output

```
🔧 Tool Registry
────────────────

  📄 File Tools
  ✓ read_file              Read the contents of a file...
  ✓ write_file             Create or overwrite a file...
  ✓ edit_file              Edit a file with precise replacement...

  ⚡ Shell Tools
  ✓ run_command            Execute a shell command...

  🌿 Git Tools
  ✓ git_status             Show git status...
```

### Enable / Disable Tools

```bash
› /tools disable run_command    # Restrict shell access
✗ Disabled: run_command

› /tools enable run_command     # Re-enable
✓ Enabled: run_command
```

---

## OpenClaw Integration

Connect knowcap-code to a running [OpenClaw](https://github.com/openclaw/openclaw) gateway to manage your AI agents directly from the CLI.

### Setup

Add to `~/.knowcap-code/config.yaml`:

```yaml
openclaw:
  url: "http://localhost:18789"
  token: "your-gateway-token"  # optional if auth is disabled
```

Or set via config command:

```bash
› /config set openclaw.url http://localhost:18789
› /config set openclaw.token your-token
```

### `/openclaw status`

```
🤖 OpenClaw Gateway
─────────────────────────────────

  Gateway:  ✅ running  http://localhost:18789
  Version:  2026.3.8
  HTTP API: ✓ reachable

  Agents: 3 online / 4 total

  🟢 main              · claude-sonnet-4-6 (2 sessions) · 5m ago
  🟢 knowcap-team      · claude-sonnet-4-6 (1 session) · 12m ago
  🟢 bilal             · groq/llama-3.3-70b (0 sessions) · 3h ago
  🔴 wiso              (0 sessions) · 2d ago
```

### Startup Banner (when configured)

```
🤖 OpenClaw: http://localhost:18789 — 4 agents (3 online)
```

### API

The client uses OpenClaw's `/tools/invoke` HTTP endpoint to call tools:
- `sessions_list` — list sessions
- `sessions_history` — get transcripts
- `sessions_send` — message an agent

---

## MCP (Model Context Protocol)

Connect external tools and services via MCP servers.

### Configuration

Add to `~/.knowcap-code/config.yaml`:

```yaml
mcp:
  servers:
    github:
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_PERSONAL_ACCESS_TOKEN: "your-pat"
    
    supabase:
      command: npx
      args: ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref=your-ref"]
    
    filesystem:
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allow"]
```

MCP tools are automatically registered in the tool registry and available to the AI.

---

## Whisper Transcription

Transcribe audio/video files directly from the CLI.

### Setup

**Option A: Groq Whisper (free, no install)**

```bash
export GROQ_API_KEY=your-key
kcc transcribe meeting.mp4
```

**Option B: Local Whisper (requires Python)**

```bash
pip install openai-whisper
kcc transcribe meeting.mp4
```

### Usage

```bash
# Transcribe a file
› /transcribe recording.m4a

# From command line
kcc --transcribe ./meeting.mp4
```

Supports: MP3, WAV, M4A, OGG, WebM, MP4, MKV

---

## Project Memory File (KNOWCAP.md)

Create a `KNOWCAP.md` or `CLAUDE.md` in your project root for AI context:

```bash
› /init
✓ Created KNOWCAP.md
```

This file is automatically loaded at session start and injected into the system prompt. Commit it to share context with your team.

---

## Configuration

Config file: `~/.knowcap-code/config.yaml` (Unix) / `%APPDATA%\knowcap-code\config.yaml` (Windows)

```yaml
defaultProvider: groq
defaultModel: llama-3.3-70b-versatile

providers:
  groq:
    apiKey: gsk_xxx
    model: llama-3.3-70b-versatile
  anthropic:
    apiKey: sk-ant-xxx
    model: claude-3-5-haiku-20241022
  ollama:
    baseUrl: http://localhost:11434
    model: qwen2.5-coder:7b

ui:
  color: true
  markdown: true
  streamingOutput: true

whisper:
  model: base        # tiny | base | small | medium | large

openclaw:
  url: http://localhost:18789
  token: your-token  # optional

budget: 5.00         # USD session budget limit
```

---

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| **macOS** | ✅ Fully supported | Intel + Apple Silicon |
| **Linux** | ✅ Fully supported | Ubuntu, Debian, Arch, etc. |
| **Windows** | ✅ Supported | cmd.exe, PowerShell, WSL |

**Platform notes:**
- Config: `~/.knowcap-code/` on Unix, `%APPDATA%\knowcap-code\` on Windows
- Shell: `/bin/sh` on Unix, `cmd.exe` on Windows (configurable)
- All paths use `path.join()` — no hardcoded separators

---

## Architecture

```
knowcap-code/
├── src/
│   ├── agent/
│   │   ├── core.ts          ← Agent loop (tools, streaming, memory injection)
│   │   ├── tools.ts         ← Built-in tool implementations
│   │   └── conversation.ts  ← Message history + system prompt builder
│   ├── config/
│   │   ├── settings.ts      ← Config file loading (YAML)
│   │   └── project.ts       ← KNOWCAP.md / CLAUDE.md project memory
│   ├── memory/
│   │   └── index.ts         ← Memory system (MEMORY.md + session logs)
│   ├── mcp/
│   │   ├── client.ts        ← MCP stdio client
│   │   └── config.ts        ← MCP server setup from config
│   ├── openclaw/
│   │   └── client.ts        ← OpenClaw gateway HTTP client
│   ├── providers/
│   │   ├── index.ts         ← Provider interface + factory
│   │   ├── anthropic.ts     ← Anthropic Claude
│   │   ├── google.ts        ← Gemini
│   │   ├── groq.ts          ← Groq
│   │   ├── ollama.ts        ← Ollama (local)
│   │   ├── openai.ts        ← OpenAI
│   │   └── openrouter.ts    ← OpenRouter
│   ├── registry/
│   │   └── index.ts         ← Tool registry (categories, enable/disable)
│   ├── setup/
│   │   └── wizard.ts        ← First-run setup + provider auto-detection
│   ├── skills/
│   │   ├── index.ts         ← Skills manager (YAML frontmatter, auto-detect)
│   │   └── builtins/        ← Built-in skills (github, docker, npm, debug, git-workflow)
│   ├── tracking/
│   │   └── tokens.ts        ← Token + cost tracking
│   ├── ui/
│   │   ├── terminal.ts      ← Banner, colors, spinner, box output
│   │   └── markdown.ts      ← Markdown rendering for terminal
│   ├── whisper/
│   │   └── transcribe.ts    ← Whisper local + Groq API
│   ├── cli.ts               ← REPL + slash command handler
│   └── index.ts             ← Entry point + arg parsing
├── skills/                  ← Project-level custom skills
├── MEMORY.md                ← Project memory (create with /init)
└── KNOWCAP.md               ← Project context (create with /init)
```

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

Built with ❤️ by [Knowcap](https://knowcap.ai) · Inspired by [Claude Code](https://claude.ai/code) + [OpenClaw](https://github.com/openclaw/openclaw)

</div>
