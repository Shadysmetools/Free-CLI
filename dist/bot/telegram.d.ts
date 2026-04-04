/**
 * telegram.ts — grammY bot setup and message routing
 *
 * Implements the full OpenClaw-equivalent Telegram channel:
 * - Long polling (default) or webhook mode
 * - Per-user session management and conversation state
 * - AI agent integration with streaming (message edits)
 * - All media types: photos, voice, documents, videos
 * - Inline keyboard callbacks
 * - Rate limiting and security
 * - Cron job triggers
 * - Typing indicators + ack reactions
 *
 * Architecture reference: OpenClaw channels/telegram.md
 */
import { Bot, Context } from 'grammy';
import { BotConfig } from './config';
import { BotSessionManager } from './session';
import { SecurityManager } from './security';
import { BotToolBridge } from './tools';
import { BotScheduler } from './scheduler';
import { MemoryManager } from '../memory/index';
import { SkillsManager } from '../skills/index';
export type BotContext = Context;
export interface BotRuntime {
    config: BotConfig;
    sessions: BotSessionManager;
    security: SecurityManager;
    toolBridge: BotToolBridge;
    scheduler: BotScheduler;
    memory: MemoryManager;
    skills: SkillsManager;
}
export declare function createTelegramBot(config: BotConfig): Promise<{
    bot: Bot;
    runtime: BotRuntime;
    start: () => Promise<void>;
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=telegram.d.ts.map