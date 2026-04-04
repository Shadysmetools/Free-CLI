"use strict";
/**
 * session.ts — Per-user session management
 *
 * Persists conversation history, settings, and memory per Telegram user.
 * Sessions stored in: ~/.coderaw/sessions/<userId>.json
 *
 * Architecture mirrors OpenClaw's session isolation per peer.
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
exports.BotSessionManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const conversation_1 = require("../agent/conversation");
// ─── Session Manager ──────────────────────────────────────────────────────────
class BotSessionManager {
    constructor() {
        this.cache = new Map();
        this.sessionsDir = path.join(os.homedir(), '.coderaw', 'sessions');
        fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
    // ── Session key ─────────────────────────────────────────────────────────────
    sessionKey(userId, chatId) {
        if (userId === chatId) {
            // DM: key = user id
            return `dm:${userId}`;
        }
        // Group: key = group id + user id
        return `group:${chatId}:user:${userId}`;
    }
    sessionPath(key) {
        const safe = key.replace(/[:/]/g, '_');
        return path.join(this.sessionsDir, `${safe}.json`);
    }
    // ── Load/save ────────────────────────────────────────────────────────────────
    get(userId, chatId) {
        const key = this.sessionKey(userId, chatId);
        // Memory cache
        if (this.cache.has(key))
            return this.cache.get(key);
        const filePath = this.sessionPath(key);
        if (!fs.existsSync(filePath))
            return null;
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const session = JSON.parse(raw);
            this.cache.set(key, session);
            return session;
        }
        catch {
            return null;
        }
    }
    getOrCreate(userId, chatId, profile, defaultProvider, defaultModel) {
        const existing = this.get(userId, chatId);
        if (existing) {
            // Update profile info and last_seen
            existing.profile.last_seen = new Date().toISOString();
            if (profile.username)
                existing.profile.username = profile.username;
            if (profile.first_name)
                existing.profile.first_name = profile.first_name;
            return existing;
        }
        const now = new Date().toISOString();
        const session = {
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
    save(session) {
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
    buildConversation(session, systemPrompt) {
        const conv = (0, conversation_1.createConversation)(session.systemPrompt ?? systemPrompt);
        // Restore message history (skip system messages, we set them fresh)
        for (const msg of session.messages) {
            if (msg.role !== 'system') {
                conv.messages.push(msg);
            }
        }
        return conv;
    }
    syncConversation(session, conv) {
        session.messages = [...conv.messages];
    }
    clearConversation(session) {
        session.messages = [];
    }
    // ── Stats ─────────────────────────────────────────────────────────────────────
    addUsage(session, promptTokens, completionTokens) {
        session.tokenUsage.prompt += promptTokens;
        session.tokenUsage.completion += completionTokens;
        session.tokenUsage.total += promptTokens + completionTokens;
        session.profile.message_count++;
    }
    // ── List sessions ──────────────────────────────────────────────────────────
    listSessions() {
        const sessions = [];
        try {
            const files = fs.readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const raw = fs.readFileSync(path.join(this.sessionsDir, file), 'utf-8');
                    sessions.push(JSON.parse(raw));
                }
                catch { /* skip malformed */ }
            }
        }
        catch { /* skip */ }
        return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    // ── Delete ─────────────────────────────────────────────────────────────────
    delete(userId, chatId) {
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
exports.BotSessionManager = BotSessionManager;
//# sourceMappingURL=session.js.map