"use strict";
/**
 * Persistent Conversation History
 *
 * Saves every session to ~/.knowcap-code/history/<timestamp>-<title>.json
 * Supports:
 *  - Auto-save on every message
 *  - List past sessions
 *  - Resume / load session
 *  - Export session as markdown
 *  - Search across history
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
exports.HistoryManager = void 0;
exports.formatRelativeTime = formatRelativeTime;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// ─── Paths ────────────────────────────────────────────────────────────────────
const HISTORY_DIR = process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? os.homedir(), 'knowcap-code', 'history')
    : path.join(os.homedir(), '.knowcap-code', 'history');
function ensureHistoryDir() {
    if (!fs.existsSync(HISTORY_DIR)) {
        fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
}
function sessionPath(id) {
    return path.join(HISTORY_DIR, `${id}.json`);
}
// ─── HistoryManager ───────────────────────────────────────────────────────────
class HistoryManager {
    constructor(provider, model, cwd) {
        this.dirty = false;
        this.flushTimer = null;
        this.currentId = generateId();
        this.record = {
            id: this.currentId,
            title: 'New session',
            provider,
            model,
            cwd,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messageCount: 0,
            messages: [],
        };
        ensureHistoryDir();
    }
    // ── Write ──────────────────────────────────────────────────────────────────
    /** Append a message and schedule a debounced flush to disk */
    addMessage(msg) {
        this.record.messages.push(msg);
        this.record.messageCount = this.record.messages.length;
        this.record.updatedAt = new Date().toISOString();
        // Auto-derive title from first user message
        if (msg.role === 'user' && this.record.title === 'New session') {
            this.record.title = msg.content.slice(0, 60).replace(/\n/g, ' ').trim();
        }
        this.dirty = true;
        this.scheduleSave();
    }
    /** Flush immediately to disk */
    save() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        this.flush();
    }
    scheduleSave() {
        if (this.flushTimer)
            clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => this.flush(), 2000); // 2s debounce
    }
    flush() {
        if (!this.dirty)
            return;
        try {
            ensureHistoryDir();
            fs.writeFileSync(sessionPath(this.currentId), JSON.stringify(this.record, null, 2), 'utf-8');
            this.dirty = false;
        }
        catch { /* non-fatal */ }
    }
    // ── Read ───────────────────────────────────────────────────────────────────
    getCurrentId() { return this.currentId; }
    getCurrentTitle() { return this.record.title; }
    getMessages() { return this.record.messages; }
    // ── Static helpers ─────────────────────────────────────────────────────────
    /** List all saved sessions, newest first */
    static list(limitDays = 90) {
        ensureHistoryDir();
        const cutoff = Date.now() - limitDays * 24 * 60 * 60 * 1000;
        try {
            return fs.readdirSync(HISTORY_DIR)
                .filter(f => f.endsWith('.json'))
                .map(f => {
                try {
                    const raw = fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8');
                    const rec = JSON.parse(raw);
                    return {
                        id: rec.id,
                        title: rec.title,
                        provider: rec.provider,
                        model: rec.model,
                        cwd: rec.cwd,
                        createdAt: rec.createdAt,
                        updatedAt: rec.updatedAt,
                        messageCount: rec.messageCount,
                    };
                }
                catch {
                    return null;
                }
            })
                .filter((s) => s !== null)
                .filter(s => new Date(s.updatedAt).getTime() >= cutoff)
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        }
        catch {
            return [];
        }
    }
    /** Load a full session record by id */
    static load(id) {
        // Support partial id matching
        ensureHistoryDir();
        const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
        const match = files.find(f => f.startsWith(id) || f === `${id}.json`);
        if (!match)
            return null;
        try {
            const raw = fs.readFileSync(path.join(HISTORY_DIR, match), 'utf-8');
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    /** Delete a session */
    static delete(id) {
        try {
            const fpath = sessionPath(id);
            if (fs.existsSync(fpath)) {
                fs.unlinkSync(fpath);
                return true;
            }
            return false;
        }
        catch {
            return false;
        }
    }
    /** Export a session as human-readable markdown */
    static exportMarkdown(record) {
        const lines = [
            `# ${record.title}`,
            ``,
            `**Session:** ${record.id}  `,
            `**Date:** ${new Date(record.createdAt).toLocaleString()}  `,
            `**Provider:** ${record.provider} / ${record.model}  `,
            `**Messages:** ${record.messageCount}  `,
            ``,
            `---`,
            ``,
        ];
        for (const msg of record.messages) {
            if (msg.role === 'system')
                continue; // skip system prompts
            const label = msg.role === 'user' ? '### 🧑 You' :
                msg.role === 'assistant' ? '### 🤖 AI' : '### ⚙ Tool';
            lines.push(label);
            lines.push('');
            lines.push(msg.content);
            lines.push('');
        }
        return lines.join('\n');
    }
    /** Search across all session titles and message contents */
    static search(query, limitDays = 90) {
        const sessions = HistoryManager.list(limitDays);
        const q = query.toLowerCase();
        const results = [];
        for (const summary of sessions) {
            const record = HistoryManager.load(summary.id);
            if (!record)
                continue;
            // Check title
            if (summary.title.toLowerCase().includes(q)) {
                results.push({ session: summary, snippet: `Title: "${summary.title}"` });
                continue;
            }
            // Search messages
            for (const msg of record.messages) {
                if (msg.role === 'system')
                    continue;
                const idx = msg.content.toLowerCase().indexOf(q);
                if (idx >= 0) {
                    const start = Math.max(0, idx - 40);
                    const end = Math.min(msg.content.length, idx + 80);
                    const snippet = (start > 0 ? '…' : '') + msg.content.slice(start, end) + (end < msg.content.length ? '…' : '');
                    results.push({ session: summary, snippet: snippet.replace(/\n/g, ' ') });
                    break;
                }
            }
        }
        return results;
    }
    /** Last session id (for auto-resume) */
    static lastSessionId() {
        const list = HistoryManager.list(7); // last 7 days only
        return list.length > 0 ? list[0].id : null;
    }
}
exports.HistoryManager = HistoryManager;
// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateId() {
    const now = new Date();
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    return [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        '-',
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
    ].join('');
}
/** Format a date string for display */
function formatRelativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (mins < 1)
        return 'just now';
    if (mins < 60)
        return `${mins}m ago`;
    if (hours < 24)
        return `${hours}h ago`;
    if (days === 1)
        return 'yesterday';
    if (days < 7)
        return `${days} days ago`;
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
//# sourceMappingURL=index.js.map