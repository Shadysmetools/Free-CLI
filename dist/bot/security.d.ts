/**
 * security.ts — User whitelist, rate limiting, command blocking, sandboxing
 *
 * Implements OpenClaw's access control model:
 * - dmPolicy: "allowlist" — only allowed_users can DM
 * - groupPolicy: "allowlist" — only allowed_groups with allowed_users
 * - Rate limiting per user (token bucket)
 * - Command blocking for dangerous shell commands
 * - Sandbox directory restriction
 */
import { BotConfig } from './config';
export declare class RateLimiter {
    private buckets;
    private perMinute;
    private burst;
    constructor(perMinute: number, burst: number);
    /** Returns true if the user is allowed, false if rate limited */
    check(userId: number): boolean;
    /** Returns seconds until next token available */
    waitTime(userId: number): number;
    /** Reset a user's rate limit (admin action) */
    reset(userId: number): void;
}
export declare class SecurityManager {
    private config;
    rateLimiter: RateLimiter;
    constructor(config: BotConfig);
    /** Check if a user is allowed in DMs. Empty list = open to everyone. */
    isUserAllowed(userId: number): boolean;
    /** Auto-claim: first user to message becomes admin */
    autoClaimAdmin(userId: number): void;
    /** Check if a user is allowed in a specific group */
    isGroupAllowed(groupId: number, userId: number): boolean;
    /** Check if a user is an admin */
    isAdmin(userId: number): boolean;
    /** Classify the chat type and check access */
    checkAccess(userId: number, chatId: number, chatType: string): AccessResult;
    /** Check if a shell command is blocked */
    isCommandBlocked(command: string): BlockResult;
    /** Sandbox a file path to the allowed directory */
    sandboxPath(filePath: string): string;
    /** Check if a path is within the sandbox */
    isPathAllowed(filePath: string): boolean;
    truncate(output: string): string;
}
export interface AccessResult {
    allowed: boolean;
    reason?: string;
}
export interface BlockResult {
    blocked: boolean;
    reason?: string;
}
//# sourceMappingURL=security.d.ts.map