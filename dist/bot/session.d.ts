/**
 * session.ts — Per-user session management
 *
 * Persists conversation history, settings, and memory per Telegram user.
 * Sessions stored in: ~/.knowcap-code/sessions/<userId>.json
 *
 * Architecture mirrors OpenClaw's session isolation per peer.
 */
import { Message } from '../providers/index';
import { ConversationState } from '../agent/conversation';
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
    schedule: string;
    kind: 'once' | 'recurring';
    message: string;
    channel: string;
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
export declare class BotSessionManager {
    private sessionsDir;
    private cache;
    constructor();
    private sessionKey;
    private sessionPath;
    get(userId: number, chatId: number): BotSession | null;
    getOrCreate(userId: number, chatId: number, profile: Partial<BotUserProfile>, defaultProvider: string, defaultModel: string): BotSession;
    save(session: BotSession): void;
    buildConversation(session: BotSession, systemPrompt: string): ConversationState;
    syncConversation(session: BotSession, conv: ConversationState): void;
    clearConversation(session: BotSession): void;
    addUsage(session: BotSession, promptTokens: number, completionTokens: number): void;
    listSessions(): BotSession[];
    delete(userId: number, chatId: number): boolean;
}
//# sourceMappingURL=session.d.ts.map