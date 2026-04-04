/**
 * scheduler.ts — Cron job and reminder system
 *
 * Lightweight built-in scheduler for the bot. Supports:
 * - One-shot reminders (at a specific time)
 * - Recurring jobs (cron-like expressions)
 * - Per-user job isolation
 * - Persistent storage (JSON)
 *
 * Architecture inspired by OpenClaw's cron system.
 * Jobs are stored in ~/.knowcap-code/bot-jobs.json
 */
import { EventEmitter } from 'events';
import { BotSchedulerConfig } from './config';
export type ScheduleKind = 'once' | 'every' | 'cron';
export interface ScheduledJob {
    id: string;
    name: string;
    kind: ScheduleKind;
    /** ISO timestamp for 'once', interval string for 'every', cron expr for 'cron' */
    schedule: string;
    /** Interval in milliseconds (for 'every' kind) */
    everyMs?: number;
    /** Cron expression fields [min, hour, dom, month, dow] */
    cronExpr?: string;
    /** The message/prompt to send */
    message: string;
    /** Telegram chat ID to send to */
    chatId: number;
    /** Telegram user ID this job belongs to */
    userId: number;
    enabled: boolean;
    createdAt: string;
    lastRun?: string;
    nextRun: string;
    deleteAfterRun: boolean;
    runCount: number;
}
export interface JobStore {
    jobs: ScheduledJob[];
    updatedAt: string;
}
export interface JobTriggerEvent {
    job: ScheduledJob;
}
/** Parse human-readable duration like "10m", "2h", "1d" → milliseconds */
export declare function parseDuration(duration: string): number;
export declare class BotScheduler extends EventEmitter {
    private config;
    private storePath;
    private jobs;
    private timer;
    private running;
    constructor(config: BotSchedulerConfig);
    start(): void;
    stop(): void;
    private tick;
    addOnce(params: {
        name: string;
        at: string | Date;
        message: string;
        chatId: number;
        userId: number;
    }): ScheduledJob;
    addRecurring(params: {
        name: string;
        /** Duration string like "1h" or cron expression "0 9 * * *" */
        schedule: string;
        message: string;
        chatId: number;
        userId: number;
    }): ScheduledJob;
    removeJob(jobId: string): boolean;
    disableJob(jobId: string): boolean;
    enableJob(jobId: string): boolean;
    getJobsForUser(userId: number): ScheduledJob[];
    getAllJobs(): ScheduledJob[];
    getJob(jobId: string): ScheduledJob | undefined;
    private load;
    private save;
    formatJob(job: ScheduledJob): string;
}
/** Parse a natural language reminder like "in 10 minutes", "tomorrow at 9am" */
export declare function parseNaturalDate(text: string): Date | null;
//# sourceMappingURL=scheduler.d.ts.map