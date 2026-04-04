"use strict";
/**
 * Memory Manager — models CLAUDE.md patterns from Claude Code
 *
 * Architecture:
 *   MEMORY.md       — human-written project memory (version-controlled)
 *   memory/          — AI-written session logs (date-based, not committed)
 *   ~/.knowcap-code/MEMORY.md — user-level memory (personal, all projects)
 *
 * Load limit: first 200 lines / 25KB (matching Claude Code's CLAUDE.md behavior)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const MAX_LINES = 200;
const MAX_BYTES = 25 * 1024; // 25KB
class MemoryManager {
    constructor(cwd) {
        this.projectMemoryFile = path.join(cwd, 'MEMORY.md');
        this.sessionDir = path.join(cwd, 'memory');
        this.userMemoryFile = path.join(os.homedir(), '.knowcap-code', 'MEMORY.md');
    }
    // ─── Read / Write ──────────────────────────────────────────────────────────
    /**
     * Load MEMORY.md — returns empty string if missing.
     * Enforces 200-line / 25KB limit (matching Claude Code's CLAUDE.md behavior).
     */
    load(full = false) {
        if (!fs.existsSync(this.projectMemoryFile))
            return '';
        const raw = fs.readFileSync(this.projectMemoryFile, 'utf-8');
        if (full)
            return raw;
        return this.truncate(raw);
    }
    /** Full raw content (for /memory command display) */
    loadFull() {
        if (!fs.existsSync(this.projectMemoryFile))
            return '';
        return fs.readFileSync(this.projectMemoryFile, 'utf-8');
    }
    /** User-level memory (personal, not project-specific) */
    loadUserMemory() {
        if (!fs.existsSync(this.userMemoryFile))
            return '';
        return this.truncate(fs.readFileSync(this.userMemoryFile, 'utf-8'));
    }
    /**
     * Save a note under a category heading in MEMORY.md.
     * Creates the file with the standard template if it doesn't exist.
     */
    save(note, category = 'Notes') {
        const date = new Date().toISOString().split('T')[0];
        let content = this.loadFull();
        if (!content) {
            content = this.defaultTemplate();
        }
        const sectionPattern = new RegExp(`(^## ${escapeRegex(category)}\\s*$)`, 'im');
        if (sectionPattern.test(content)) {
            // Insert after the section heading
            content = content.replace(sectionPattern, `$1\n- [${date}] ${note}`);
        }
        else {
            // Add a new section at the end
            content = content.trimEnd() + `\n\n## ${category}\n- [${date}] ${note}\n`;
        }
        fs.writeFileSync(this.projectMemoryFile, content, 'utf-8');
    }
    /**
     * Replace the entire MEMORY.md with the default template.
     */
    clear() {
        fs.writeFileSync(this.projectMemoryFile, this.defaultTemplate(), 'utf-8');
    }
    /**
     * Initialize MEMORY.md if it doesn't exist. Returns the file path.
     */
    init() {
        if (!fs.existsSync(this.projectMemoryFile)) {
            fs.writeFileSync(this.projectMemoryFile, this.defaultTemplate(), 'utf-8');
        }
        return this.projectMemoryFile;
    }
    // ─── Session Logs ──────────────────────────────────────────────────────────
    /** Get today's session log content (creates file if missing). */
    getToday() {
        const filePath = this.todayPath();
        if (!fs.existsSync(filePath)) {
            this.ensureSessionDir();
            const date = new Date().toISOString().split('T')[0];
            fs.writeFileSync(filePath, `# Session Log — ${date}\n\n`, 'utf-8');
        }
        return fs.readFileSync(filePath, 'utf-8');
    }
    /** Append a timestamped entry to today's session log. */
    appendToday(content) {
        this.ensureSessionDir();
        const filePath = this.todayPath();
        if (!fs.existsSync(filePath)) {
            const date = new Date().toISOString().split('T')[0];
            fs.writeFileSync(filePath, `# Session Log — ${date}\n\n`, 'utf-8');
        }
        const time = new Date().toISOString().split('T')[1].split('.')[0];
        fs.appendFileSync(filePath, `\n## [${time}]\n${content}\n`, 'utf-8');
    }
    // ─── Search ────────────────────────────────────────────────────────────────
    /**
     * Keyword search across MEMORY.md + all session logs.
     */
    search(query) {
        const results = [];
        const queryLower = query.toLowerCase();
        this.searchFile(this.projectMemoryFile, 'MEMORY.md', queryLower, results);
        this.searchFile(this.userMemoryFile, '~/.knowcap-code/MEMORY.md', queryLower, results);
        if (fs.existsSync(this.sessionDir)) {
            const files = fs.readdirSync(this.sessionDir)
                .filter(f => f.endsWith('.md'))
                .sort()
                .reverse(); // newest first
            for (const file of files) {
                this.searchFile(path.join(this.sessionDir, file), `memory/${file}`, queryLower, results);
            }
        }
        return results;
    }
    // ─── System Prompt Context ─────────────────────────────────────────────────
    /**
     * Returns memory content formatted for injection into the system prompt.
     * Loads project MEMORY.md + user-level MEMORY.md (both limited to 200 lines/25KB).
     */
    getSystemContext() {
        const parts = [];
        const project = this.load();
        if (project.trim()) {
            parts.push(`## Project Memory (MEMORY.md)\n${project}`);
        }
        const user = this.loadUserMemory();
        if (user.trim()) {
            parts.push(`## Personal Memory (~/.knowcap-code/MEMORY.md)\n${user}`);
        }
        return parts.length > 0 ? '\n\n' + parts.join('\n\n') : '';
    }
    // ─── Helpers ───────────────────────────────────────────────────────────────
    truncate(content) {
        // Enforce 200-line limit
        const lines = content.split('\n');
        if (lines.length > MAX_LINES) {
            const truncated = lines.slice(0, MAX_LINES).join('\n');
            return truncated + `\n\n<!-- [Truncated: ${lines.length - MAX_LINES} more lines. Use /memory to see full content.] -->`;
        }
        // Enforce 25KB limit
        if (Buffer.byteLength(content, 'utf-8') > MAX_BYTES) {
            let result = '';
            for (const line of lines) {
                if (Buffer.byteLength(result + line + '\n', 'utf-8') > MAX_BYTES)
                    break;
                result += line + '\n';
            }
            return result + '\n<!-- [Truncated at 25KB. Use /memory to see full content.] -->';
        }
        return content;
    }
    searchFile(filePath, label, queryLower, results) {
        if (!fs.existsSync(filePath))
            return;
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(queryLower)) {
                results.push({ file: label, line: i + 1, content: lines[i].trim() });
            }
        }
    }
    todayPath() {
        const date = new Date().toISOString().split('T')[0];
        return path.join(this.sessionDir, `${date}.md`);
    }
    ensureSessionDir() {
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }
    }
    defaultTemplate() {
        return `# MEMORY.md

> Project memory loaded by knowcap-code at session start (first 200 lines / 25KB).
> Human-written instructions and context — commit this to version control.

## Decisions
<!-- Record important architectural and design decisions here -->

## Context
<!-- Project tech stack, conventions, key facts -->

## Workflows
<!-- Build commands, test commands, deployment steps -->

## Todo
<!-- [ ] Open tasks -->
`;
    }
}
exports.MemoryManager = MemoryManager;
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=index.js.map