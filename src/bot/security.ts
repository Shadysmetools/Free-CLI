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

import * as path from 'path';
import * as os from 'os';
import { BotConfig } from './config';

// ─── Rate Limiter (Token Bucket) ──────────────────────────────────────────────

interface RateBucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets: Map<number, RateBucket> = new Map();
  private perMinute: number;
  private burst: number;

  constructor(perMinute: number, burst: number) {
    this.perMinute = perMinute;
    this.burst = burst;
  }

  /** Returns true if the user is allowed, false if rate limited */
  check(userId: number): boolean {
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
  waitTime(userId: number): number {
    const bucket = this.buckets.get(userId);
    if (!bucket || bucket.tokens >= 1) return 0;
    const deficit = 1 - bucket.tokens;
    return Math.ceil((deficit / this.perMinute) * 60);
  }

  /** Reset a user's rate limit (admin action) */
  reset(userId: number): void {
    this.buckets.delete(userId);
  }
}

// ─── Security Manager ─────────────────────────────────────────────────────────

export class SecurityManager {
  private config: BotConfig;
  public rateLimiter: RateLimiter;

  constructor(config: BotConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter(
      config.security.rate_limit_per_minute,
      config.security.rate_limit_burst,
    );
  }

  // ── Access control ────────────────────────────────────────────────────────

  /** Check if a user is allowed in DMs */
  isUserAllowed(userId: number): boolean {
    const allowed = this.config.telegram.allowed_users;
    if (allowed.length === 0) return false;
    return allowed.includes(userId);
  }

  /** Check if a user is allowed in a specific group */
  isGroupAllowed(groupId: number, userId: number): boolean {
    const allowedGroups = this.config.telegram.allowed_groups;
    if (allowedGroups.length === 0) return false;

    // Check if this group is allowed
    const groupAllowed =
      allowedGroups.includes('*') ||
      allowedGroups.includes(groupId) ||
      allowedGroups.includes(String(groupId));

    if (!groupAllowed) return false;

    // Check if this user is in the allowed list
    return this.isUserAllowed(userId);
  }

  /** Check if a user is an admin */
  isAdmin(userId: number): boolean {
    return this.config.telegram.admin_users.includes(userId);
  }

  /** Classify the chat type and check access */
  checkAccess(userId: number, chatId: number, chatType: string): AccessResult {
    const isDM = chatType === 'private';

    if (isDM) {
      if (!this.isUserAllowed(userId)) {
        return { allowed: false, reason: 'You are not authorized to use this bot.' };
      }
    } else {
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
  isCommandBlocked(command: string): BlockResult {
    const cmd = command.trim().toLowerCase();
    for (const blocked of this.config.security.blocked_commands) {
      if (cmd.includes(blocked.toLowerCase())) {
        return { blocked: true, reason: `Command contains blocked pattern: "${blocked}"` };
      }
    }
    return { blocked: false };
  }

  /** Sandbox a file path to the allowed directory */
  sandboxPath(filePath: string): string {
    if (!this.config.security.sandbox) return filePath;

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
  isPathAllowed(filePath: string): boolean {
    if (!this.config.security.sandbox) return true;

    const sandboxDir = this.config.security.sandbox_dir.replace('~', os.homedir());
    const resolved = path.resolve(filePath);
    return resolved.startsWith(sandboxDir) || resolved.startsWith(os.homedir());
  }

  // ── Output truncation ──────────────────────────────────────────────────────

  truncate(output: string): string {
    const maxChars = this.config.security.max_output;
    if (output.length <= maxChars) return output;
    return output.slice(0, maxChars - 50) + `\n...[truncated ${output.length - maxChars + 50} chars]`;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AccessResult {
  allowed: boolean;
  reason?: string;
}

export interface BlockResult {
  blocked: boolean;
  reason?: string;
}
