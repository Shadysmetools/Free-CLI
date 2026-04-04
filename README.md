# ⚡ knowcap-code

> **Free AI coding assistant** — works like Claude Code but with any model

[![npm version](https://img.shields.io/npm/v/knowcap-code.svg)](https://www.npmjs.com/package/knowcap-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

A terminal-based AI coding agent that reads/writes/edits files, runs shell commands, and understands your entire codebase — just like Claude Code, but **100% free** with local models or BYOK.

```
╔══════════════════════════════════════╗
║  ⚡ knowcap-code  free AI coding agent  ║
╚══════════════════════════════════════╝

Provider: ollama/qwen2.5-coder:7b | Type /help for commands

› Create a REST API endpoint for user authentication in Express.js

AI  ›
I'll create a user authentication endpoint. Let me first check your project structure...

⚙  list_files
  └─ src/ routes/ middleware/ package.json ...

⚙  read_file {"path": "src/app.ts"}
  └─ File: src/app.ts ...

⚙  write_file {"path": "src/routes/auth.ts"}
  └─ ✓ Created src/routes/auth.ts (87 lines)
```

## ✨ Features

- 🆓 **100% Free** — Works with Ollama (local), Groq free tier, Gemini free tier, OpenRouter free models
- 🔑 **BYOK** — Bring your own API key for Anthropic, OpenAI, etc.
- 📁 **File operations** — Read, write, edit files with precise text replacement
- 🐚 **Shell commands** — Run tests, builds, installs, any command
- 🔀 **Git integration** — Status, diff, commit — all from natural language
- 🔌 **MCP support** — Model Context Protocol for unlimited extensibility
- 🎙️ **Whisper transcription** — Local or via Groq's free API
- ⌨️ **Slash commands** — `/help`, `/review`, `/test`, `/model`, `/compact`, and more
- 📋 **Project memory** — `KNOWCAP.md` file for project-specific context
- 🌊 **Streaming** — See AI responses as they're generated
- ↩️ **Undo** — Revert any file change with `/undo`

## 🚀 Quick Start

### Install

```bash
npm install -g knowcap-code
```

### Zero-Config (Ollama — completely free)

```bash
# 1. Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# 2. Pull a coding model
ollama pull qwen2.5-coder:7b

# 3. Run knowcap-code
knowcap-code
```

### Free Cloud (Groq — no credit card)

```bash
# Get a free key at https://console.groq.com
export GROQ_API_KEY=your_key_here

knowcap-code --provider groq
```

### Free Cloud (Google Gemini)

```bash
# Get a free key at https://aistudio.google.com
export GOOGLE_API_KEY=your_key_here

knowcap-code --provider google
```

## 📦 Installation

```bash
# npm
npm install -g knowcap-code

# Or use directly with npx
npx knowcap-code
```

**Requirements:** Node.js 18+

## 🤖 AI Providers

| Provider | Free? | Requires Key | Models |
|----------|-------|--------------|--------|
| **Ollama** | ✅ Always free | No | Qwen2.5-Coder, CodeLlama, DeepSeek-Coder, Llama3.2 |
| **Groq** | ✅ Free tier | Yes (free) | Llama-3.3-70b, DeepSeek-R1, Mixtral |
| **Google** | ✅ Free tier | Yes (free) | Gemini-2.0-Flash, Gemini-1.5-Flash |
| **OpenRouter** | ✅ Free models | Yes (free) | 50+ free models |
| **Anthropic** | 💳 BYOK | Yes (paid) | Claude-3.5-Haiku/Sonnet/Opus |
| **OpenAI** | 💳 BYOK | Yes (paid) | GPT-4o, GPT-4o-mini |

### Recommended free models

**For coding tasks:**
- `ollama/qwen2.5-coder:7b` — Best local coding model
- `groq/llama-3.3-70b-versatile` — Best free cloud model (very fast)
- `google/gemini-2.0-flash` — Good all-rounder, generous free tier

**For large codebases:**
- `groq/deepseek-r1-distill-llama-70b` — Great reasoning
- `openrouter/meta-llama/llama-3.3-70b-instruct:free` — Free via OpenRouter

## ⌨️ Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model [provider:model]` | Switch AI provider/model |
| `/review [file]` | Review code changes |
| `/test` | Run project tests |
| `/compact` | Compress conversation history |
| `/clear` | Clear conversation |
| `/config` | Show/edit configuration |
| `/transcribe <file>` | Transcribe audio/video |
| `/mcp` | List MCP servers and tools |
| `/git [args]` | Run git commands |
| `/diff [file]` | Show file diffs |
| `/undo` | Undo last file change |
| `/init` | Create KNOWCAP.md project memory |
| `/cost` | Show token usage stats |
| `/exit` | Exit |

## 🛠️ Built-in Tools

The AI can use these tools automatically:

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents (with line range support) |
| `write_file` | Create or overwrite files |
| `edit_file` | Precise text replacement |
| `search_files` | Grep across the codebase |
| `list_files` | List directory contents |
| `run_command` | Execute shell commands |
| `git_status` | Show git status |
| `git_diff` | Show git diffs |
| `git_commit` | Stage and commit changes |

## ⚙️ Configuration

Configuration is stored at `~/.knowcap-code/config.yaml`:

```yaml
defaultProvider: ollama
defaultModel: qwen2.5-coder:7b

providers:
  ollama:
    baseUrl: http://localhost:11434
    model: qwen2.5-coder:7b
  groq:
    apiKey: your_groq_key
    model: llama-3.3-70b-versatile
  anthropic:
    apiKey: your_anthropic_key
    model: claude-3-5-haiku-20241022
  openai:
    apiKey: your_openai_key
    model: gpt-4o-mini
  google:
    apiKey: your_google_key
    model: gemini-2.0-flash
  openrouter:
    apiKey: your_openrouter_key
    model: meta-llama/llama-3.3-70b-instruct:free

ui:
  color: true
  markdown: true
  streamingOutput: true

whisper:
  model: base   # tiny, base, small, medium, large
```

**Environment variables (override config):**
```bash
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GROQ_API_KEY=...
GOOGLE_API_KEY=...
OPENROUTER_API_KEY=...
OLLAMA_BASE_URL=http://localhost:11434
```

## 📋 Project Memory (KNOWCAP.md)

Create a `KNOWCAP.md` file in your project root to give the AI project-specific context:

```bash
# Initialize a template
knowcap-code /init
# Or inside the session:
/init
```

Example `KNOWCAP.md`:
```markdown
# My Project

## Tech Stack
- Node.js + TypeScript
- Express.js API
- PostgreSQL with Prisma ORM
- Jest for testing

## Code Style
- Use async/await (not callbacks)
- All functions should have TypeScript types
- Error handling with try/catch

## Key Commands
\`\`\`bash
npm run dev     # Start dev server
npm test        # Run tests
npm run build   # Build for production
\`\`\`
```

## 🔌 MCP (Model Context Protocol)

Connect external tools via MCP servers. Add to `~/.knowcap-code/config.yaml`:

```yaml
mcp:
  servers:
    filesystem:
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/projects"]
    
    github:
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_PERSONAL_ACCESS_TOKEN: your_token
    
    postgres:
      command: npx
      args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"]
    
    brave-search:
      command: npx
      args: ["-y", "@modelcontextprotocol/server-brave-search"]
      env:
        BRAVE_API_KEY: your_key
```

List connected servers and tools: `/mcp`

## 🎙️ Whisper Transcription

Transcribe audio/video files locally or via Groq's free API:

```bash
# Install local Whisper
pip install openai-whisper

# Then transcribe
/transcribe meeting.mp4
/transcribe interview.mp3
```

Or automatically via Groq (free, no local install needed):
```bash
export GROQ_API_KEY=your_key
/transcribe meeting.mp4  # Uses Groq Whisper API automatically
```

## 💻 Usage Examples

```bash
# Start interactive session
knowcap-code

# One-shot query
knowcap-code "explain this codebase"
knowcap-code "add error handling to src/api.ts"

# Use a specific provider
knowcap-code --provider groq --model llama-3.3-70b-versatile

# Use in a specific directory
knowcap-code --cwd /path/to/project
```

**Inside the session:**
```
› Show me all TypeScript files with TODO comments
› Refactor the authentication middleware to use JWT
› Add unit tests for the UserService class
› /review src/api.ts
› /git log --oneline -10
› /model anthropic:claude-3-5-sonnet-20241022
› /test
```

## 🏗️ Architecture

```
knowcap-code/
├── src/
│   ├── index.ts              # Entry point & CLI args
│   ├── cli.ts                # REPL loop & slash commands
│   ├── agent/
│   │   ├── core.ts           # Main agent loop (tool calling)
│   │   ├── tools.ts          # Built-in tools (file, shell, git)
│   │   └── conversation.ts   # Chat history management
│   ├── providers/
│   │   ├── index.ts          # Provider factory & interfaces
│   │   ├── ollama.ts         # Ollama (local, free)
│   │   ├── anthropic.ts      # Claude (BYOK)
│   │   ├── openai.ts         # GPT (BYOK, also OpenAI-compatible)
│   │   ├── google.ts         # Gemini (free tier)
│   │   ├── groq.ts           # Groq (free tier)
│   │   └── openrouter.ts     # OpenRouter (many free models)
│   ├── mcp/
│   │   ├── client.ts         # MCP client (JSON-RPC over stdio)
│   │   └── config.ts         # MCP server setup
│   ├── whisper/
│   │   └── transcribe.ts     # Local + Groq Whisper transcription
│   ├── ui/
│   │   ├── terminal.ts       # Colors, spinners, output formatting
│   │   └── markdown.ts       # Terminal markdown rendering
│   └── config/
│       ├── settings.ts       # User settings (~/.knowcap-code/)
│       └── project.ts        # Project config (KNOWCAP.md)
```

## 🤝 Contributing

Contributions welcome! This is open source.

```bash
git clone https://github.com/Smetools/knowcap-code
cd knowcap-code
npm install
npm run build
node dist/index.js
```

Areas for contribution:
- Additional AI providers
- Better terminal UI (syntax highlighting)
- More slash commands
- Test coverage
- VS Code extension
- Windows compatibility improvements

## 📄 License

MIT — free to use, modify, and distribute.

---

Built with ❤️ by [Knowcap](https://knowcap.ai) · [Report Issues](https://github.com/Smetools/knowcap-code/issues)
