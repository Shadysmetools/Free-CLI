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

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Message } from '../providers/index';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionRecord {
  id: string;               // e.g. "20260404-142301"
  title: string;            // auto-derived from first user message
  provider: string;
  model: string;
  cwd: string;
  createdAt: string;        // ISO timestamp
  updatedAt: string;
  messageCount: number;
  messages: Message[];
}

export interface SessionSummary {
  id: string;
  title: string;
  provider: string;
  model: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const HISTORY_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA ?? os.homedir(), 'knowcap-code', 'history')
  : path.join(os.homedir(), '.knowcap-code', 'history');

function ensureHistoryDir(): void {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

function sessionPath(id: string): string {
  return path.join(HISTORY_DIR, `${id}.json`);
}

// ─── HistoryManager ───────────────────────────────────────────────────────────

export class HistoryManager {
  private currentId: string;
  private record: SessionRecord;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(provider: string, model: string, cwd: string) {
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
  addMessage(msg: Message): void {
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
  save(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  private scheduleSave(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 2000); // 2s debounce
  }

  private flush(): void {
    if (!this.dirty) return;
    try {
      ensureHistoryDir();
      fs.writeFileSync(sessionPath(this.currentId), JSON.stringify(this.record, null, 2), 'utf-8');
      this.dirty = false;
    } catch { /* non-fatal */ }
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  getCurrentId(): string { return this.currentId; }
  getCurrentTitle(): string { return this.record.title; }
  getMessages(): Message[] { return this.record.messages; }

  // ── Static helpers ─────────────────────────────────────────────────────────

  /** List all saved sessions, newest first */
  static list(limitDays = 90): SessionSummary[] {
    ensureHistoryDir();
    const cutoff = Date.now() - limitDays * 24 * 60 * 60 * 1000;

    try {
      return fs.readdirSync(HISTORY_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            const raw = fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8');
            const rec = JSON.parse(raw) as SessionRecord;
            return {
              id: rec.id,
              title: rec.title,
              provider: rec.provider,
              model: rec.model,
              cwd: rec.cwd,
              createdAt: rec.createdAt,
              updatedAt: rec.updatedAt,
              messageCount: rec.messageCount,
            } satisfies SessionSummary;
          } catch { return null; }
        })
        .filter((s): s is SessionSummary => s !== null)
        .filter(s => new Date(s.updatedAt).getTime() >= cutoff)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch { return []; }
  }

  /** Load a full session record by id */
  static load(id: string): SessionRecord | null {
    // Support partial id matching
    ensureHistoryDir();
    const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
    const match = files.find(f => f.startsWith(id) || f === `${id}.json`);
    if (!match) return null;
    try {
      const raw = fs.readFileSync(path.join(HISTORY_DIR, match), 'utf-8');
      return JSON.parse(raw) as SessionRecord;
    } catch { return null; }
  }

  /** Delete a session */
  static delete(id: string): boolean {
    try {
      const fpath = sessionPath(id);
      if (fs.existsSync(fpath)) { fs.unlinkSync(fpath); return true; }
      return false;
    } catch { return false; }
  }

  /** Export a session as human-readable markdown */
  static exportMarkdown(record: SessionRecord): string {
    const lines: string[] = [
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
      if (msg.role === 'system') continue; // skip system prompts
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
  static search(query: string, limitDays = 90): Array<{ session: SessionSummary; snippet: string }> {
    const sessions = HistoryManager.list(limitDays);
    const q = query.toLowerCase();
    const results: Array<{ session: SessionSummary; snippet: string }> = [];

    for (const summary of sessions) {
      const record = HistoryManager.load(summary.id);
      if (!record) continue;

      // Check title
      if (summary.title.toLowerCase().includes(q)) {
        results.push({ session: summary, snippet: `Title: "${summary.title}"` });
        continue;
      }

      // Search messages
      for (const msg of record.messages) {
        if (msg.role === 'system') continue;
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
  static lastSessionId(): string | null {
    const list = HistoryManager.list(7); // last 7 days only
    return list.length > 0 ? list[0].id : null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  const now = new Date();
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
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
export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
