"use strict";
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
exports.SecurityManager = exports.RateLimiter = void 0;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
class RateLimiter {
    constructor(perMinute, burst) {
        this.buckets = new Map();
        this.perMinute = perMinute;
        this.burst = burst;
    }
    /** Returns true if the user is allowed, false if rate limited */
    check(userId) {
        const now = Date.now();
        let bucket = this.buckets.get(userId);
        if (!bucket) {
            bucket = { tokens: this.burst, lastRefill: now };
            this.buckets.set(userId, bucket);
        }
        // Refill tokens based on time elapsed
        const elapsed = (now - bucket.lastRefill) / 1000 / 60; // minutes
        const refill = elapsed * this.perMinute;
        bucket.tokens = Math.min(this.burst, bucket.tokens + refill);
        bucket.lastRefill = now;
        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return true;
        }
        return false;
    }
    /** Returns seconds until next token available */
    waitTime(userId) {
        const bucket = this.buckets.get(userId);
        if (!bucket || bucket.tokens >= 1)
            return 0;
        const deficit = 1 - bucket.tokens;
        return Math.ceil((deficit / this.perMinute) * 60);
    }
    /** Reset a user's rate limit (admin action) */
    reset(userId) {
        this.buckets.delete(userId);
    }
}
exports.RateLimiter = RateLimiter;
// ─── Security Manager ─────────────────────────────────────────────────────────
class SecurityManager {
    constructor(config) {
        this.config = config;
        this.rateLimiter = new RateLimiter(config.security.rate_limit_per_minute, config.security.rate_limit_burst);
    }
    // ── Access control ────────────────────────────────────────────────────────
    /** Check if a user is allowed in DMs. Empty list = open to everyone. */
    isUserAllowed(userId) {
        const allowed = this.config.telegram.allowed_users;
        // Empty = open access (anyone can use)
        if (allowed.length === 0)
            return true;
        return allowed.includes(userId);
    }
    /** Auto-claim: first user to message becomes admin */
    autoClaimAdmin(userId) {
        if (this.config.telegram.allowed_users.length === 0 && this.config.telegram.admin_users.length === 0) {
            this.config.telegram.allowed_users.push(userId);
            this.config.telegram.admin_users.push(userId);
            // Save config with claimed admin
            try {
                const { saveBotConfig } = require('./config');
                saveBotConfig(this.config);
            }
            catch { /* non-fatal */ }
        }
    }
    /** Check if a user is allowed in a specific group */
    isGroupAllowed(groupId, userId) {
        const allowedGroups = this.config.telegram.allowed_groups;
        // Empty = open access
        if (allowedGroups.length === 0)
            return true;
        // Check if this group is allowed
        const groupAllowed = allowedGroups.includes('*') ||
            allowedGroups.includes(groupId) ||
            allowedGroups.includes(String(groupId));
        if (!groupAllowed)
            return false;
        // Check if this user is in the allowed list
        return this.isUserAllowed(userId);
    }
    /** Check if a user is an admin */
    isAdmin(userId) {
        return this.config.telegram.admin_users.includes(userId);
    }
    /** Classify the chat type and check access */
    checkAccess(userId, chatId, chatType) {
        const isDM = chatType === 'private';
        if (isDM) {
            if (!this.isUserAllowed(userId)) {
                return { allowed: false, reason: 'You are not authorized to use this bot.' };
            }
        }
        else {
            // Group/supergroup/channel
            if (!this.isGroupAllowed(chatId, userId)) {
                return { allowed: false, reason: 'This group or user is not authorized.' };
            }
        }
        // Rate limit check
        if (!this.rateLimiter.check(userId)) {
            const wait = this.rateLimiter.waitTime(userId);
            return {
                allowed: false,
                reason: `Rate limit exceeded. Please wait ${wait} seconds.`,
            };
        }
        return { allowed: true };
    }
    // ── Command security ──────────────────────────────────────────────────────
    /** Check if a shell command is blocked */
    isCommandBlocked(command) {
        const cmd = command.trim().toLowerCase();
        for (const blocked of this.config.security.blocked_commands) {
            if (cmd.includes(blocked.toLowerCase())) {
                return { blocked: true, reason: `Command contains blocked pattern: "${blocked}"` };
            }
        }
        return { blocked: false };
    }
    /** Sandbox a file path to the allowed directory */
    sandboxPath(filePath) {
        if (!this.config.security.sandbox)
            return filePath;
        const sandboxDir = this.config.security.sandbox_dir.replace('~', os.homedir());
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(sandboxDir)) {
            // Redirect to sandbox
            const basename = path.basename(filePath);
            return path.join(sandboxDir, basename);
        }
        return resolved;
    }
    /** Check if a path is within the sandbox */
    isPathAllowed(filePath) {
        if (!this.config.security.sandbox)
            return true;
        const sandboxDir = this.config.security.sandbox_dir.replace('~', os.homedir());
        const resolved = path.resolve(filePath);
        return resolved.startsWith(sandboxDir) || resolved.startsWith(os.homedir());
    }
    // ── Output truncation ──────────────────────────────────────────────────────
    truncate(output) {
        const maxChars = this.config.security.max_output;
        if (output.length <= maxChars)
            return output;
        return output.slice(0, maxChars - 50) + `\n...[truncated ${output.length - maxChars + 50} chars]`;
    }
}
exports.SecurityManager = SecurityManager;
//# sourceMappingURL=security.js.map