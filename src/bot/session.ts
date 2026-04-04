/**
 * session.ts — Per-user session management
 *
 * Persists conversation history, settings, and memory per Telegram user.
 * Sessions stored in: ~/.knowcap-code/sessions/<userId>.json
 *
 * Architecture mirrors OpenClaw's session isolation per peer.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Message } from '../providers/index';
import { ConversationState, createConversation, clearConversation } from '../agent/conversation';

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface BotUserPrefs {
  provider?: string;
  model?: string;
  persona?: string;
  language?: string;
  custom_instructions?: string;
  timezone?: string;
}

export interface BotUserProfile {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
  first_seen: string;
  last_seen: string;
  message_count: number;
  prefs: BotUserPrefs;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string; // cron expression or ISO timestamp
  kind: 'once' | 'recurring';
  message: string;
  channel: string; // 'telegram'
  chatId: number;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string;
  deleteAfterRun: boolean;
}

export interface BotSession {
  userId: number;
  chatId: number;
  profile: BotUserProfile;
  /** Serialized conversation messages */
  messages: Message[];
  /** Custom system prompt override */
  systemPrompt?: string;
  /** Active agent working directory */
  cwd: string;
  /** Token usage stats */
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
    cost: number;
  };
  /** Per-session cron jobs */
  cronJobs: CronJob[];
  updatedAt: string;
}

// ─── Session Manager ──────────────────────────────────────────────────────────

export class BotSessionManager {
  private sessionsDir: string;
  private cache: Map<string, BotSession> = new Map();

  constructor() {
    this.sessionsDir = path.join(os.homedir(), '.knowcap-code', 'sessions');
    fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  // ── Session key ─────────────────────────────────────────────────────────────

  private sessionKey(userId: number, chatId: number): string {
    if (userId === chatId) {
      // DM: key = user id
      return `dm:${userId}`;
    }
    // Group: key = group id + user id
    return `group:${chatId}:user:${userId}`;
  }

  private sessionPath(key: string): string {
    const safe = key.replace(/[:/]/g, '_');
    return path.join(this.sessionsDir, `${safe}.json`);
  }

  // ── Load/save ────────────────────────────────────────────────────────────────

  get(userId: number, chatId: number): BotSession | null {
    const key = this.sessionKey(userId, chatId);

    // Memory cache
    if (this.cache.has(key)) return this.cache.get(key)!;

    const filePath = this.sessionPath(key);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const session = JSON.parse(raw) as BotSession;
      this.cache.set(key, session);
      return session;
    } catch {
      return null;
    }
  }

  getOrCreate(
    userId: number,
    chatId: number,
    profile: Partial<BotUserProfile>,
    defaultProvider: string,
    defaultModel: string,
  ): BotSession {
    const existing = this.get(userId, chatId);
    if (existing) {
      // Update profile info and last_seen
      existing.profile.last_seen = new Date().toISOString();
      if (profile.username) existing.profile.username = profile.username;
      if (profile.first_name) existing.profile.first_name = profile.first_name;
      return existing;
    }

    const now = new Date().toISOString();
    const session: BotSession = {
      userId,
      chatId,
      profile: {
        id: userId,
        username: profile.username,
        first_name: profile.first_name,
        last_name: profile.last_name,
        language_code: profile.language_code,
        first_seen: now,
        last_seen: now,
        message_count: 0,
        prefs: {
          provider: defaultProvider,
          model: defaultModel,
        },
      },
      messages: [],
      cwd: os.homedir(),
      tokenUsage: { prompt: 0, completion: 0, total: 0, cost: 0 },
      cronJobs: [],
      updatedAt: now,
    };

    this.save(session);
    return session;
  }

  save(session: BotSession): void {
    const key = this.sessionKey(session.userId, session.chatId);
    session.updatedAt = new Date().toISOString();

    // Trim message history to last 200 messages (keep system)
    const systemMsgs = session.messages.filter(m => m.role === 'system');
    const nonSystem = session.messages.filter(m => m.role !== 'system');
    if (nonSystem.length > 200) {
      session.messages = [...systemMsgs, ...nonSystem.slice(-180)];
    }

    this.cache.set(key, session);

    const filePath = this.sessionPath(key);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  // ── Conversation state ────────────────────────────────────────────────────────

  buildConversation(session: BotSession, systemPrompt: string): ConversationState {
    const conv = createConversation(session.systemPrompt ?? systemPrompt);

    // Restore message history (skip system messages, we set them fresh)
    for (const msg of session.messages) {
      if (msg.role !== 'system') {
        conv.messages.push(msg);
      }
    }

    return conv;
  }

  syncConversation(session: BotSession, conv: ConversationState): void {
    session.messages = [...conv.messages];
  }

  clearConversation(session: BotSession): void {
    session.messages = [];
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  addUsage(session: BotSession, promptTokens: number, completionTokens: number): void {
    session.tokenUsage.prompt += promptTokens;
    session.tokenUsage.completion += completionTokens;
    session.tokenUsage.total += promptTokens + completionTokens;
    session.profile.message_count++;
  }

  // ── List sessions ──────────────────────────────────────────────────────────

  listSessions(): BotSession[] {
    const sessions: BotSession[] = [];
    try {
      const files = fs.readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.sessionsDir, file), 'utf-8');
          sessions.push(JSON.parse(raw) as BotSession);
        } catch { /* skip malformed */ }
      }
    } catch { /* skip */ }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  delete(userId: number, chatId: number): boolean {
    const key = this.sessionKey(userId, chatId);
    this.cache.delete(key);
    const filePath = this.sessionPath(key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }
}
