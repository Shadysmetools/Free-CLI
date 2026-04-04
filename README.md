# ⚡ coderaw

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0--beta-orange?style=for-the-badge" alt="version"/>
  <img src="https://img.shields.io/badge/status-beta%20%F0%9F%9A%A7-yellow?style=for-the-badge" alt="beta"/>
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="license"/>
  <img src="https://img.shields.io/badge/contributions-welcome-brightgreen?style=for-the-badge" alt="contributions welcome"/>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=for-the-badge&logo=node.js" alt="node"/>
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?style=for-the-badge&logo=typescript" alt="typescript"/>
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=for-the-badge" alt="platforms"/>
</p>

<p align="center">
  <b>Free AI coding CLI — works with any model.</b><br/>
  Ollama (local) · Groq (free tier) · Gemini · Claude · GPT · OpenRouter
</p>

---

## 🆓 100% Free to Use

coderaw works with completely free AI providers — no credit card needed!

| Provider | Models | Cost | Setup |
|----------|--------|------|-------|
| **OpenRouter** | 28+ free models (Qwen, Llama, etc.) | Free | Get key at openrouter.ai |
| **Groq** | Llama 3.3 70B, Whisper (transcription) | Free | Get key at groq.com |
| **Ollama** | Any local model | Free | Install ollama.com |
| **Google** | Gemini 2.5 Flash | Free tier | Get key at ai.google.dev |

OpenRouter is recommended — it auto-picks the best available free model!  
Groq is best for voice transcription (free Whisper API).

---

## ✨ Features

| # | Feature | Command |
|---|---------|---------|
| 1 | 🤖 **Multi-provider AI** | `--provider ollama`, `--provider groq`, etc. |
| 2 | 💬 **Interactive REPL** | `coderaw` or `cr` or `kcc` |
| 3 | 🔍 **Code reviewer** | `/review [file]` |
| 4 | 🤖 **Sub-agent orchestration** | `/plan <task>`, `/agents list` |
| 5 | 🖼️ **Multimodal input** | `--image`, `--video`, `--voice` |
| 6 | 🎤 **Live voice commands** | `/voice` |
| 7 | 🌐 **REST API server** | `coderaw serve --port 3333` |
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
npm install -g coderaw
coderaw                      # start interactive session
# Also works as: cr  or  kcc
```

### Install from source

```bash
git clone https://github.com/Shadysmetools/Free-CLI.git
cd Free-CLI
npm install
npm run build
npm link                     # makes `coderaw`, `cr`, and `kcc` available globally
coderaw --help
```

---

## 📦 Installation

### Requirements

- **Node.js** ≥ 18
- One or more AI providers (see [Provider Setup](#-provider-setup))

### From npm

```bash
npm install -g coderaw
```

### From source

```bash
git clone https://github.com/Shadysmetools/Free-CLI.git
cd Free-CLI
npm install
npm run build          # compiles TypeScript → dist/
npm link               # optional: installs coderaw/cr/kcc globally
```

### First run

```bash
coderaw                # auto-detects provider (Ollama if running, else prompts)
coderaw setup          # interactive setup wizard
```

---

## 🤖 Provider Setup

### OpenRouter (Recommended — 28+ free models)

```bash
export OPENROUTER_API_KEY="sk-or-..."
coderaw --provider openrouter --model openrouter/auto
# openrouter/auto automatically picks the best available free model!
```

**Best free models on OpenRouter:**
- `meta-llama/llama-3.3-70b-instruct:free` — Best overall
- `deepseek/deepseek-r1:free` — Best reasoning
- `mistral/devstral-2:free` — Best for coding
- `google/gemma-3-27b-it:free` — Google's free
- `openrouter/auto` — Auto-pick best free model

### Groq (Free — Best for voice transcription)

```bash
export GROQ_API_KEY="gsk_..."
coderaw --provider groq --model llama-3.3-70b-versatile
# Groq also provides free Whisper API for voice transcription!
```

### Ollama (Free, Local)

```bash
# Install Ollama: https://ollama.ai
ollama pull llama3.1        # or any model
coderaw --provider ollama --model llama3.1
```

### Google Gemini

```bash
export GOOGLE_API_KEY="AIza..."
coderaw --provider google --model gemini-2.0-flash
```

### Anthropic Claude

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
coderaw --provider anthropic --model claude-3-5-sonnet-20241022
```

### OpenAI / GPT

```bash
export OPENAI_API_KEY="sk-..."
coderaw --provider openai --model gpt-4o
```

### Persist your default provider

```bash
# Type /model openrouter:openrouter/auto to save as default
```

Or edit `~/.coderaw/settings.yaml`:

```yaml
defaultProvider: openrouter
providers:
  openrouter:
    apiKey: sk-or-...
    model: openrouter/auto
  groq:
    apiKey: gsk_...
    model: llama-3.3-70b-versatile
```

---

## 💻 Usage

### Interactive session

```bash
coderaw                          # Start REPL
cr                               # Short alias
kcc                              # Legacy alias (backwards compat)
coderaw --provider ollama        # Use Ollama
coderaw --model gemini-2.0-flash # Specific model
coderaw --cwd /path/to/project   # Set working directory
```

### One-shot query

```bash
coderaw "explain this function" < src/utils.ts
coderaw "write a Dockerfile for a Node.js app"
```

### With files (multimodal)

```bash
coderaw --image screenshot.png "what's wrong with this UI?"
coderaw --video demo.mp4 "summarize this demo"
coderaw --voice meeting.mp3 "transcribe and summarize"
```

### REST API server

```bash
coderaw serve --port 3333

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

coderaw can respond in different languages and dialects:

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

**Custom persona** — create `~/.coderaw/personas/mybot.yaml`:

```yaml
id: mybot
name: My Custom Bot
language: en
systemPrompt: "Respond like a senior DevOps engineer. Be terse and precise."
```

---

## 👤 User Profile

Your profile is stored at `~/.coderaw/profile.yaml` and injected into the system prompt so the AI knows who it's talking to.

```yaml
name: "Alex"
role: "Full Stack Developer"
company: "Acme Corp"
preferences:
  language: "TypeScript"
  style: "detailed explanations"
  review_strictness: "high"
  expertise: "senior"
projects:
  - name: my-app
    path: "~/my-app"
    stack: "React, Node.js, Supabase"
```

**Commands:**

```bash
/profile show
/profile set name Alex
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

Run coderaw as a background service:

```bash
coderaw serve --port 3333

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

**Create a custom skill** at `~/.coderaw/skills/my-skill/SKILL.md`:

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
# ~/.coderaw/mcp.yaml
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
coderaw --voice meeting.mp3             # transcribe + summarize
coderaw --voice recording.m4a           # any audio format
/voice                                  # live mic (requires whisper CLI)
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

Sessions are auto-saved to `~/.coderaw/history/`:

```bash
/history                   # list recent sessions
/history load abc123       # resume session by ID
/history export            # export as markdown
```

---

## ⚙️ Configuration

### Global settings (`~/.coderaw/settings.yaml`)

```yaml
defaultProvider: openrouter
budget: 500000

providers:
  openrouter:
    apiKey: sk-or-...
    model: openrouter/auto
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
coderaw/
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

1. Fork the repo: [github.com/Shadysmetools/Free-CLI](https://github.com/Shadysmetools/Free-CLI)
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
- Initial release as **coderaw** (rebranded from knowcap-code to Free-CLI)
- 24 features across 14 modules
- CLI commands: `coderaw`, `cr`, `kcc` (backwards compat)
- Config dir: `~/.coderaw/`
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

---

## 🚧 Beta — Help Us Improve!

coderaw is in **active beta**. We ship fast and fix faster.

### Found a bug? Have an idea?

- 🐛 **Report bugs:** [Open an issue](https://github.com/Shadysmetools/Free-CLI/issues/new?labels=bug&template=bug_report.md)
- 💡 **Request features:** [Open an issue](https://github.com/Shadysmetools/Free-CLI/issues/new?labels=enhancement&template=feature_request.md)
- 🔧 **Fix something:** Fork → Branch → PR (we review fast!)

### Areas We Need Help

| Area | What's Needed |
|------|--------------|
| 🐛 Bug fixes | SSL errors on some systems, rate limit handling |
| 🎨 UI/UX | Better terminal rendering, themes |
| 🤖 Providers | More LLM integrations, better streaming |
| 📄 Docs | Tutorials, examples, translations |
| 🧪 Testing | Unit tests, E2E tests |
| 🌍 i18n | More language personas |
| 📦 Packaging | Homebrew, apt, snap packages |

### Contributing

1. Fork the repo
2. Create your branch: `git checkout -b fix/my-fix`
3. Make changes + test: `npm run build && coderaw`
4. Commit: `git commit -m "fix: description"`
5. Push + open PR

We respond to all PRs and issues within 24 hours! 🚀

---

## 🙏 Star This Repo

If coderaw helped you, give us a ⭐ on GitHub — it helps others find us!

[![Star on GitHub](https://img.shields.io/github/stars/Shadysmetools/Free-CLI?style=social)](https://github.com/Shadysmetools/Free-CLI)
