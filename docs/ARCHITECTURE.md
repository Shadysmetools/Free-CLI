# knowcap-code — Architecture Overview

> AI-powered coding CLI with multi-provider fallback, tool registry, and sub-agent orchestration.

---

## Table of Contents
1. [High-Level Architecture](#high-level-architecture)
2. [Data Flow](#data-flow)
3. [Component Reference](#component-reference)
4. [Provider Fallback Chain](#provider-fallback-chain)
5. [Tool Registry](#tool-registry)
6. [Sub-Agent System](#sub-agent-system)

---

## High-Level Architecture

The diagram below (`architecture.mmd`) shows the six major layers of knowcap-code and how they interconnect.

```
┌─────────────────────────────────────────────────────────────────┐
│                        knowcap-code CLI                          │
│                                                                   │
│  [Input Layer] ──► [Core Engine] ──► [Output Layer]              │
│                         │                                         │
│                    ┌────┴────┐                                    │
│             [Providers]  [Tools]                                  │
│                    └────┬────┘                                    │
│                  [Sub-Agent System]                               │
│                  [Features / RAG]                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Diagram files
| File | Description |
|------|-------------|
| `architecture.mmd` | High-level architecture (Mermaid flowchart) |
| `dataflow.mmd` | Data flow from user input to final output |
| `architecture.png` | Rendered PNG (dark theme) |
| `dataflow.png` | Rendered PNG (dark theme) |

---

## Data Flow

```
User Input
    │
    ▼
Input Layer ──── (text / voice / slash commands / CLI flags)
    │
    ▼
Core Engine ──── runAgent loop
    │               ├── Skill Detector
    │               ├── Conversation Manager
    │               └── Memory System (MEMORY.md)
    │
    ├──────────────► Provider Selection (auto-fallback)
    │                   OpenRouter → Groq → Ollama → Gemini / Claude / GPT
    │                           │
    │                           ▼
    │                    AI Response (streamed)
    │                           │
    ◄──────────────────────────┘
    │
    ├──────────────► Tool Execution
    │                   File · Shell · Git · Memory · Output
    │                           │
    ◄──────────────────────────┘
    │
    ├──────────────► Sub-Agent Orchestrator (complex tasks)
    │                           │
    ◄──────────────────────────┘
    │
    ▼
Output Layer ──── Terminal UI · Code Boxes · PDF · Excel · Diagrams
    │
    ▼
  User ✅
```

---

## Component Reference

### 🎤 Input Layer
| Component | Description |
|-----------|-------------|
| Chat Input Box | Bordered terminal UI for natural language queries |
| Slash Commands | `/help`, `/plan`, `/review`, `/debug`, `/test`, `/document` |
| CLI Flags | `--provider`, `--model`, `--voice`, `--persona` |
| Voice Input | Whisper-based STT → transcribed to text |

### ⚙️ Core Engine
| Component | Description |
|-----------|-------------|
| `runAgent` Loop | Main agentic loop — processes messages, dispatches tools |
| Conversation Manager | Maintains multi-turn context window |
| Skill Detector | Auto-detects task type to route to correct provider/tool |
| Memory System | Persistent `MEMORY.md` — facts, preferences, history |
| Token Tracker | Counts tokens per request, enforces budget |

### 🤖 AI Providers
See [Provider Fallback Chain](#provider-fallback-chain).

### 🛠️ Tool Registry
See [Tool Registry](#tool-registry).

### 🤝 Sub-Agent System
See [Sub-Agent System](#sub-agent-system).

### ✨ Features
| Feature | Description |
|---------|-------------|
| Persona System | 10 language/dialect personas (formal, casual, regional) |
| User Profile + History | Persisted user preferences and conversation history |
| Agentic RAG + Reranking | Retrieval-augmented generation with semantic reranking |
| MCP Protocol Client | Model Context Protocol for external tool integration |
| Plugin System | Extensible plugin loader for custom tools |
| REST API Server | HTTP API for external integrations |

### 📤 Output Layer
| Output | Description |
|--------|-------------|
| Terminal UI | `chalk`-powered bordered boxes with color coding |
| Code Boxes | Syntax-highlighted code blocks with language detection |
| PDF Generation | Styled, paginated PDF reports |
| Excel Generation | Formatted multi-sheet Excel workbooks |
| Mermaid Diagrams | Auto-generated architecture/flow diagrams |

---

## Provider Fallback Chain

knowcap-code automatically falls back across providers if one fails or rate-limits:

```
1. OpenRouter   (free, default)    ← tried first
2. Groq         (free tier)        ← fallback #2
3. Ollama       (local, offline)   ← fallback #3
4. Google Gemini                   ← fallback #4
5. Anthropic Claude                ← fallback #5
6. OpenAI GPT                      ← fallback #6
```

Configure with `--provider <name>` or `KC_PROVIDER=<name>` env var.

---

## Tool Registry

18 tools across 5 categories:

| Category | Tools |
|----------|-------|
| **File** | `read`, `write`, `edit`, `search`, `list` |
| **Shell** | `run_command` |
| **Git** | `status`, `diff`, `commit`, `log` |
| **Memory** | `save`, `search` |
| **Output** | `pdf`, `excel`, `diagram`, `image` |

---

## Sub-Agent System

For complex tasks, the Orchestrator spawns specialized sub-agents:

| Role | Responsibility |
|------|---------------|
| **Architect** | System design, structure planning |
| **Coder** | Implementation, boilerplate generation |
| **Reviewer** | Code review, best practices |
| **Tester** | Test generation, coverage analysis |
| **Debugger** | Error analysis, fix suggestions |
| **Documenter** | Docs, README, JSDoc generation |

Trigger with `/plan <task>` to enter planning mode before implementation.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js / TypeScript |
| Terminal UI | `chalk`, `blessed`, bordered boxes |
| PDF | `pdfkit` or `puppeteer` |
| Excel | `exceljs` |
| Diagrams | `mermaid` / `mmdc` |
| Voice | OpenAI Whisper (local CLI) |
| Memory | Markdown flat-file (`MEMORY.md`) |
| Protocols | MCP (Model Context Protocol) |

---

*Generated by knowcap-code architecture subagent — 2026-04-04*
