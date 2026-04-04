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
import { Message } from '../providers/index';
export interface SessionRecord {
    id: string;
    title: string;
    provider: string;
    model: string;
    cwd: string;
    createdAt: string;
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
export declare class HistoryManager {
    private currentId;
    private record;
    private dirty;
    private flushTimer;
    constructor(provider: string, model: string, cwd: string);
    /** Append a message and schedule a debounced flush to disk */
    addMessage(msg: Message): void;
    /** Flush immediately to disk */
    save(): void;
    private scheduleSave;
    private flush;
    getCurrentId(): string;
    getCurrentTitle(): string;
    getMessages(): Message[];
    /** List all saved sessions, newest first */
    static list(limitDays?: number): SessionSummary[];
    /** Load a full session record by id */
    static load(id: string): SessionRecord | null;
    /** Delete a session */
    static delete(id: string): boolean;
    /** Export a session as human-readable markdown */
    static exportMarkdown(record: SessionRecord): string;
    /** Search across all session titles and message contents */
    static search(query: string, limitDays?: number): Array<{
        session: SessionSummary;
        snippet: string;
    }>;
    /** Last session id (for auto-resume) */
    static lastSessionId(): string | null;
}
/** Format a date string for display */
export declare function formatRelativeTime(iso: string): string;
//# sourceMappingURL=index.d.ts.map