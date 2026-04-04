# ⚡ knowcap-code

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge" alt="version"/>
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="license"/>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=for-the-badge&logo=node.js" alt="node"/>
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?style=for-the-badge&logo=typescript" alt="typescript"/>
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=for-the-badge" alt="platforms"/>
</p>

<p align="center">
  <b>Free AI coding assistant that works like Claude Code — but with <i>any</i> model.</b><br/>
  Ollama (local) · Groq (free tier) · Gemini · Claude · GPT · OpenRouter
</p>

---

## ✨ Features

| # | Feature | Command |
|---|---------|---------|
| 1 | 🤖 **Multi-provider AI** | `--provider ollama`, `--provider groq`, etc. |
| 2 | 💬 **Interactive REPL** | `kcc` |
| 3 | 🔍 **Code reviewer** | `/review [file]` |
| 4 | 🤖 **Sub-agent orchestration** | `/plan <task>`, `/agents list` |
| 5 | 🖼️ **Multimodal input** | `--image`, `--video`, `--voice` |
| 6 | 🎤 **Live voice commands** | `/voice` |
| 7 | 🌐 **REST API server** | `kcc serve --port 3333` |
| 8 | 🔌 **Plugin / extension system** | `/skills add <name>` |
| 9 | 🤖 **Custom bot creation** | `/agents create` |
| 10 | 📚 **Agentic RAG** | `/rag index`, `/rag search` |
| 11 | 📄 **PDF generation** | `generate_pdf` tool |
| 12 | 📊 **Excel generation** | `generate_excel` tool |
| 13 | 🧜 **Mermaid diagrams** | `/diagram`, `/architecture` |
| 14 | 🎨 **Image generation** | `/image <prompt>` |
| 15 | 🌍 **Persona / dialect system** | `/persona set egyptian` |
| 16 | 👤 **User profile** | `/profile show` |
| 17 | 📜 **Persistent history** | `/history`, `/history load` |
| 18 | 🧠 **Project memory** | `memory_save`, `memory_search` |
| 19 | 🔗 **MCP protocol** | Connects to any MCP server |
| 20 | 🔌 **OpenClaw integration** | Sends tasks to OpenClaw agents |
| 21 | 🎙️ **Whisper transcription** | `--voice file.mp3` |
| 22 | 📊 **Token tracking** | `/tokens`, budget alerts |
| 23 | 🌿 **Git integration** | `/git`, `/diff`, `/undo` |
| 24 | ⚙️ **Project config** | `KNOWCAP.md`, `.knowcap/config.yaml` |

---

## 🚀 Quick Start

### Install globally from npm

```bash
npm install -g knowcap-code
kcc                          # start interactive session
```

### Install from source

```bash
git clone https://github.com/Shadysmetools/knowcap-code.git
cd knowcap-code
npm install
npm run build
npm link                     # makes `kcc` available globally
kcc --help
```

---

## 📦 Installation

### Requirements

- **Node.js** ≥ 18
- One or more AI providers (see [Provider Setup](#-provider-setup))

### From npm

```bash
npm install -g knowcap-code
```

### From source

```bash
git clone https://github.com/Shadysmetools/knowcap-code.git
cd knowcap-code
npm install
npm run build          # compiles TypeScript → dist/
npm link               # optional: installs kcc globally
```

### First run

```bash
kcc                    # auto-detects provider (Ollama if running, else prompts)
kcc setup              # interactive setup wizard
```

---

## 🤖 Provider Setup

### Ollama (Free, Local)

```bash
# Install Ollama: https://ollama.ai
ollama pull llama3.1        # or any model
kcc --provider ollama --model llama3.1
```

### Groq (Free Tier)

```bash
export GROQ_API_KEY="gsk_..."
kcc --provider groq --model llama-3.3-70b-versatile
```

### Google Gemini

```bash
export GOOGLE_API_KEY="AIza..."
kcc --provider google --model gemini-2.0-flash
```

### Anthropic Claude

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
kcc --provider anthropic --model claude-3-5-sonnet-20241022
```

### OpenAI / GPT

```bash
export OPENAI_API_KEY="sk-..."
kcc --provider openai --model gpt-4o
```

### OpenRouter (100+ models)

```bash
export OPENROUTER_API_KEY="sk-or-..."
kcc --provider openrouter --model anthropic/claude-3.5-sonnet
```

## Free OpenRouter Models

- `meta-llama/llama-3.3-70b-instruct:free` — Best overall
- `deepseek/deepseek-r1:free` — Best reasoning
- `mistral/devstral-2:free` — Best for coding
- `google/gemma-3-27b-it:free` — Google's free
- `openrouter/auto` — Auto-pick best free model

### Persist your default provider

```bash
kcc --provider groq --model llama-3.3-70b-versatile
# Type /model groq:llama-3.3-70b-versatile to save as default
```

Or edit `~/.knowcap-code/settings.yaml`:

```yaml
defaultProvider: groq
providers:
  groq:
    apiKey: gsk_...
    model: llama-3.3-70b-versatile
```

---

## 💻 Usage

### Interactive session

```bash
kcc                              # Start REPL
kcc --provider ollama            # Use Ollama
kcc --model gemini-2.0-flash     # Specific model
kcc --cwd /path/to/project       # Set working directory
```

### One-shot query

```bash
kcc "explain this function" < src/utils.ts
kcc "write a Dockerfile for a Node.js app"
```

### With files (multimodal)

```bash
kcc --image screenshot.png "what's wrong with this UI?"
kcc --video demo.mp4 "summarize this demo"
kcc --voice meeting.mp3 "transcribe and summarize"
```

### REST API server

```bash
kcc serve --port 3333

# Then call:
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "write a hello world in Go"}'
```

---

## 📖 Slash Command Reference

### Conversation

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model [provider:model]` | Switch AI model |
| `/clear` | Clear conversation |
| `/compact` | Summarize + compress history |
| `/exit` | Exit session |

### Code

| Command | Description |
|---------|-------------|
| `/review [file]` | Review code changes with AI |
| `/test` | Run project tests |
| `/diff [file]` | Show git diff |
| `/git [args]` | Run git commands |
| `/undo` | Undo last file change |
| `/init` | Create `KNOWCAP.md` memory file |

### Agents & Planning

| Command | Description |
|---------|-------------|
| `/plan <task>` | Break task into sub-agents |
| `/agents list` | List available agent roles |
| `/agents run <role> <task>` | Run a specific agent role |
| `/review` | Code reviewer agent |

### Multimodal

| Command | Description |
|---------|-------------|
| `/voice` | Start live mic recording |
| `/image <prompt>` | Generate an image |
| `/diagram <desc>` | Generate Mermaid diagram |
| `/architecture` | Generate architecture diagram |

### Memory & Knowledge

| Command | Description |
|---------|-------------|
| `/memory list` | List memory files |
| `/memory save` | Save a note |
| `/rag index [path]` | Index files for RAG |
| `/rag search <query>` | Search indexed knowledge |

### History

| Command | Description |
|---------|-------------|
| `/history` | List recent sessions |
| `/history load <id>` | Resume a past session |
| `/history export` | Export session as markdown |

### Persona

| Command | Description |
|---------|-------------|
| `/persona list` | List available personas |
| `/persona set <id>` | Switch language/dialect |
| `/persona info <id>` | View persona details |
| `/persona reset` | Reset to English |

### Profile

| Command | Description |
|---------|-------------|
| `/profile show` | Show your user profile |
| `/profile set name <name>` | Set your name |
| `/profile set role <role>` | Set your role |

### Skills & Plugins

| Command | Description |
|---------|-------------|
| `/skills list` | List available skills |
| `/skills info <name>` | Skill details |
| `/skills add <name>` | Add a skill |

### Tools & Tokens

| Command | Description |
|---------|-------------|
| `/tools list` | List all available tools |
| `/tokens` | Token usage stats |
| `/budget <amount>` | Set token budget |

### Settings

| Command | Description |
|---------|-------------|
| `/settings` | Show current settings |
| `/settings set <key> <val>` | Update a setting |
| `/setup` | Interactive setup wizard |

---

## 🌍 Persona / Language System

knowcap-code can respond in different languages and dialects:

```
/persona list

  🇬🇧  english      English ← default
  🇪🇬  egyptian     Egyptian Arabic (عامية مصرية)
  🔤  franco       Franco-Arab / Arabizi
  🇸🇦  saudi        Saudi Arabic (اللهجة السعودية)
  🇲🇦  moroccan     Moroccan Darija (الدارجة المغربية)
  🇫🇷  french       French (Français)
  🇪🇸  spanish      Spanish (Español)
  🇩🇪  german       German (Deutsch)
  🇧🇷  portuguese   Portuguese (Português)
```

**Switch persona:**

```bash
/persona set egyptian        # يرد بالعامية المصرية
/persona set franco          # yerd b el franco arabizi
/persona set french          # Répond en français
/persona reset               # back to English
```

**Custom persona** — create `~/.knowcap-code/personas/mybot.yaml`:

```yaml
id: mybot
name: My Custom Bot
language: en
systemPrompt: "Respond like a senior DevOps engineer. Be terse and precise."
```

---

## 👤 User Profile

Your profile is stored at `~/.knowcap-code/profile.yaml` and injected into the system prompt so the AI knows who it's talking to.

```yaml
name: "Shady"
role: "AI Product Manager"
company: "Knowcap"
preferences:
  language: "TypeScript"
  style: "detailed explanations"
  review_strictness: "high"
  expertise: "senior"
projects:
  - name: knowcap
    path: "~/knowcap"
    stack: "React, Node.js, Supabase"
```

**Commands:**

```bash
/profile show
/profile set name Shady
/profile set role "Senior Developer"
```

---

## 📚 Agentic RAG

Index your codebase or documents for semantic search:

```bash
/rag index ./src            # index source files
/rag index ./docs           # index docs
/rag search "authentication flow"
/rag search "database connection"
```

The RAG system uses embedding + BM25 reranking for accurate retrieval and injects relevant context into your conversation.

---

## 🧜 Diagrams

Generate Mermaid diagrams from descriptions:

```bash
/diagram "user authentication flow with JWT"
/architecture "microservices: API gateway, auth service, user service, database"
```

Output is rendered as Mermaid syntax (copy into any Mermaid viewer) or PNG if `@mermaid-js/mermaid-cli` is installed.

---

## 📄 PDF & Excel Generation

The AI can use built-in tools to generate files:

```
generate a PDF report of this sprint summary
generate an Excel spreadsheet with these metrics
```

Files are saved to your working directory.

---

## 🤖 Sub-agent Orchestration

Break complex tasks into parallel sub-agents:

```bash
/plan "refactor the authentication module, add tests, and update docs"

# Output:
# Agent 1: Refactor auth module
# Agent 2: Write unit tests
# Agent 3: Update documentation
```

```bash
/agents list               # see all built-in roles
/agents run reviewer "check src/auth.ts for security issues"
```

**Built-in roles:** architect, reviewer, debugger, tester, documenter, refactorer, security-auditor, performance-optimizer

---

## 🌐 REST API Server

Run knowcap-code as a background service:

```bash
kcc serve --port 3333

# POST /chat
curl -X POST http://localhost:3333/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "write a Go HTTP server", "provider": "groq"}'

# GET /health
curl http://localhost:3333/health

# GET /models
curl http://localhost:3333/models
```

Responses are streaming JSON by default.

---

## 🔌 Plugin / Extension System (Skills)

Skills are markdown + YAML files that give the AI specialized instructions.

**List built-in skills:**

```bash
/skills list
# debug, docker, git-workflow, github, npm, ...
```

**Load a skill:**

```bash
/skills add docker
# Now the AI knows all docker commands and best practices
```

**Create a custom skill** at `~/.knowcap-code/skills/my-skill/SKILL.md`:

```markdown
# My Skill

## When to Use
Use this skill when working with Kubernetes deployments.

## Instructions
Always check resource limits. Use Helm for complex deployments.
```

Then: `/skills add my-skill`

---

## 🔗 MCP (Model Context Protocol)

Connect to any MCP server for extended capabilities:

```yaml
# ~/.knowcap-code/mcp.yaml
servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home"]
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "ghp_..."
```

MCP tools are auto-discovered and registered into the tool registry.

---

## 🔌 OpenClaw Integration

Delegate tasks to OpenClaw agents:

```bash
# In settings.yaml:
openclaw:
  url: "http://localhost:18789"
  token: "your-token"
```

```bash
/openclaw send "research the latest TypeScript 5.5 features"
```

---

## 🎤 Whisper (Voice Transcription)

Transcribe voice files using local Whisper or Groq's Whisper API:

```bash
kcc --voice meeting.mp3             # transcribe + summarize
kcc --voice recording.m4a           # any audio format
/voice                              # live mic (requires whisper CLI)
```

**Setup Whisper:**

```bash
# macOS
brew install whisper.cpp

# Linux / Windows
pip install openai-whisper

# Or use Groq's free Whisper API (no install needed):
export GROQ_API_KEY="gsk_..."
```

---

## 📊 Token Tracking

```bash
/tokens                    # current session stats
/budget 100000             # set token budget (warns when near limit)
```

Token usage is tracked per-session and displayed in the status bar.

---

## 📜 Persistent History

Sessions are auto-saved to `~/.knowcap-code/history/`:

```bash
/history                   # list recent sessions
/history load abc123       # resume session by ID
/history export            # export as markdown
```

---

## ⚙️ Configuration

### Global settings (`~/.knowcap-code/settings.yaml`)

```yaml
defaultProvider: groq
budget: 500000

providers:
  ollama:
    baseUrl: http://localhost:11434
    model: llama3.1
  groq:
    apiKey: gsk_...
    model: llama-3.3-70b-versatile
  google:
    apiKey: AIza...
    model: gemini-2.0-flash
  anthropic:
    apiKey: sk-ant-...
    model: claude-3-5-sonnet-20241022
  openai:
    apiKey: sk-...
    model: gpt-4o

openclaw:
  url: http://localhost:18789
  token: your-token
```

### Project config (`./KNOWCAP.md`)

```markdown
# My Project

## Stack
- TypeScript, React, Node.js
- PostgreSQL via Supabase

## Conventions
- Use named exports
- Tests in __tests__/ folders
- ESLint + Prettier enforced
```

The AI reads this file at startup and follows your project conventions.

---

## 🖥️ Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| **macOS** (Apple Silicon / Intel) | ✅ Full | All features |
| **Linux** (Ubuntu, Debian, Fedora, Arch) | ✅ Full | All features |
| **Windows** (WSL2) | ✅ Full | Recommended via WSL2 |
| **Windows** (native) | ⚠️ Partial | Voice/Whisper may need manual setup |

---

## 🏗️ Architecture

```
knowcap-code/
├── src/
│   ├── agent/
│   │   ├── conversation.ts   # System prompt + message history
│   │   ├── core.ts           # Agent loop + tool execution
│   │   └── tools.ts          # File/shell/git tools
│   ├── agents/
│   │   └── roles.ts          # Built-in agent role definitions
│   ├── cli.ts                # REPL + slash command handling
│   ├── config/
│   │   ├── project.ts        # KNOWCAP.md loader
│   │   └── settings.ts       # Global settings
│   ├── diagrams/             # Mermaid + image generation
│   ├── history/              # Session persistence
│   ├── mcp/                  # MCP protocol client
│   ├── memory/               # Project memory (MEMORY.md)
│   ├── multimodal/           # Image/video/voice input
│   ├── openclaw/             # OpenClaw agent relay
│   ├── persona/              # Language/dialect system
│   ├── profile/              # User identity
│   ├── providers/            # AI provider adapters
│   ├── rag/                  # RAG indexing + reranking
│   ├── registry/             # Tool registry
│   ├── server/               # REST API server
│   ├── setup/                # Interactive wizard
│   ├── skills/               # Plugin skill system
│   ├── tracking/             # Token tracking
│   ├── ui/                   # Terminal UI (chalk, markdown)
│   └── whisper/              # Voice transcription
└── dist/                     # Compiled JS (after npm run build)
```

---

## 🤝 Contributing

1. Fork the repo: [github.com/Shadysmetools/knowcap-code](https://github.com/Shadysmetools/knowcap-code)
2. Clone your fork
3. Create a feature branch: `git checkout -b feat/my-feature`
4. Make changes, then build: `npm run build`
5. Test: `node dist/index.js --help`
6. Commit: `git commit -m "feat: description"`
7. Push and open a PR

### Adding a new provider

Create `src/providers/myprovider.ts` implementing the `Provider` interface, then register it in `src/providers/index.ts`.

### Adding a new built-in skill

Create `src/skills/builtins/my-skill/SKILL.md` with your skill instructions.

---

## 📋 Changelog

### v1.0.0
- Initial release
- 24 features across 14 modules
- Persona system: 9 languages/dialects
- MCP protocol support
- REST API server
- Sub-agent orchestration
- Multimodal (images, video, voice)
- Agentic RAG with reranking
- PDF + Excel generation
- OpenClaw integration
- Whisper transcription
- Comprehensive plugin system

---

## 📄 License

MIT © [Shadysmetools](https://github.com/Shadysmetools)

---

<p align="center">Made by <a href="https://github.com/Shadysmetools">Shadysmetools</a></p>
