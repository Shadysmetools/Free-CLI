/**
 * Memory Manager — models CLAUDE.md patterns from Claude Code
 *
 * Architecture:
 *   MEMORY.md       — human-written project memory (version-controlled)
 *   memory/          — AI-written session logs (date-based, not committed)
 *   ~/.coderaw/MEMORY.md — user-level memory (personal, all projects)
 *
 * Load limit: first 200 lines / 25KB (matching Claude Code's CLAUDE.md behavior)
 */
export interface SearchResult {
    file: string;
    line: number;
    content: string;
}
export declare class MemoryManager {
    private projectMemoryFile;
    private sessionDir;
    private userMemoryFile;
    constructor(cwd: string);
    /**
     * Load MEMORY.md — returns empty string if missing.
     * Enforces 200-line / 25KB limit (matching Claude Code's CLAUDE.md behavior).
     */
    load(full?: boolean): string;
    /** Full raw content (for /memory command display) */
    loadFull(): string;
    /** User-level memory (personal, not project-specific) */
    loadUserMemory(): string;
    /**
     * Save a note under a category heading in MEMORY.md.
     * Creates the file with the standard template if it doesn't exist.
     */
    save(note: string, category?: string): void;
    /**
     * Replace the entire MEMORY.md with the default template.
     */
    clear(): void;
    /**
     * Initialize MEMORY.md if it doesn't exist. Returns the file path.
     */
    init(): string;
    /** Get today's session log content (creates file if missing). */
    getToday(): string;
    /** Append a timestamped entry to today's session log. */
    appendToday(content: string): void;
    /**
     * Keyword search across MEMORY.md + all session logs.
     */
    search(query: string): SearchResult[];
    /**
     * Returns memory content formatted for injection into the system prompt.
     * Loads project MEMORY.md + user-level MEMORY.md (both limited to 200 lines/25KB).
     */
    getSystemContext(): string;
    private truncate;
    private searchFile;
    private todayPath;
    private ensureSessionDir;
    private defaultTemplate;
}
//# sourceMappingURL=index.d.ts.map