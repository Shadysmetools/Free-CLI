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

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { BotSchedulerConfig } from './config';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Job trigger event ────────────────────────────────────────────────────────

export interface JobTriggerEvent {
  job: ScheduledJob;
}

// ─── Cron expression parser ───────────────────────────────────────────────────

/** Simple 5-field cron expression matcher: min hour dom month dow */
function matchesCron(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minF, hourF, domF, monthF, dowF] = fields;

  const matches = (field: string, value: number, min: number, max: number): boolean => {
    if (field === '*') return true;
    if (field.includes('/')) {
      const [, step] = field.split('/');
      return value % parseInt(step, 10) === 0;
    }
    if (field.includes(',')) {
      return field.split(',').map(n => parseInt(n, 10)).includes(value);
    }
    if (field.includes('-')) {
      const [lo, hi] = field.split('-').map(n => parseInt(n, 10));
      return value >= lo && value <= hi;
    }
    return parseInt(field, 10) === value;
  };

  return (
    matches(minF, date.getMinutes(), 0, 59) &&
    matches(hourF, date.getHours(), 0, 23) &&
    matches(domF, date.getDate(), 1, 31) &&
    matches(monthF, date.getMonth() + 1, 1, 12) &&
    matches(dowF, date.getDay(), 0, 7)
  );
}

/** Parse human-readable duration like "10m", "2h", "1d" → milliseconds */
export function parseDuration(duration: string): number {
  const units: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  const match = duration.trim().match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration: "${duration}". Use format like "10m", "2h", "1d"`);
  return parseInt(match[1], 10) * units[match[2]];
}

/** Compute next run time for a 'cron' job */
function nextCronRun(expr: string, after: Date): Date {
  const next = new Date(after.getTime() + 60 * 1000); // start 1 min ahead
  next.setSeconds(0, 0);

  // Search up to 1 year ahead
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matchesCron(expr, next)) return next;
    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error(`Could not compute next run for cron "${expr}"`);
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export class BotScheduler extends EventEmitter {
  private config: BotSchedulerConfig;
  private storePath: string;
  private jobs: ScheduledJob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: BotSchedulerConfig) {
    super();
    this.config = config;
    this.storePath = config.store.replace('~', os.homedir());
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.running || !this.config.enabled) return;
    this.running = true;
    this.load();

    // Check every 30 seconds
    this.timer = setInterval(() => this.tick(), 30_000);
    // Immediate first tick
    setTimeout(() => this.tick(), 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  private tick(): void {
    const now = new Date();
    let dirty = false;

    for (const job of this.jobs) {
      if (!job.enabled) continue;
      const nextRun = new Date(job.nextRun);
      if (now < nextRun) continue;

      // Trigger
      this.emit('job', { job } as JobTriggerEvent);
      job.lastRun = now.toISOString();
      job.runCount++;

      if (job.kind === 'once' && job.deleteAfterRun) {
        job.enabled = false;
        dirty = true;
        continue;
      }

      // Compute next run
      try {
        if (job.kind === 'every' && job.everyMs) {
          job.nextRun = new Date(now.getTime() + job.everyMs).toISOString();
        } else if (job.kind === 'cron' && job.cronExpr) {
          job.nextRun = nextCronRun(job.cronExpr, now).toISOString();
        } else {
          job.enabled = false;
        }
      } catch {
        job.enabled = false;
      }

      dirty = true;
    }

    // Clean up disabled once-jobs
    const before = this.jobs.length;
    this.jobs = this.jobs.filter(j => j.enabled || j.kind !== 'once');
    if (this.jobs.length !== before) dirty = true;

    if (dirty) this.save();
  }

  // ── Job management ────────────────────────────────────────────────────────

  addOnce(params: {
    name: string;
    at: string | Date; // ISO string or Date
    message: string;
    chatId: number;
    userId: number;
  }): ScheduledJob {
    const runAt = params.at instanceof Date ? params.at : new Date(params.at);
    const job: ScheduledJob = {
      id: generateId(),
      name: params.name,
      kind: 'once',
      schedule: runAt.toISOString(),
      message: params.message,
      chatId: params.chatId,
      userId: params.userId,
      enabled: true,
      createdAt: new Date().toISOString(),
      nextRun: runAt.toISOString(),
      deleteAfterRun: true,
      runCount: 0,
    };
    this.jobs.push(job);
    this.save();
    return job;
  }

  addRecurring(params: {
    name: string;
    /** Duration string like "1h" or cron expression "0 9 * * *" */
    schedule: string;
    message: string;
    chatId: number;
    userId: number;
  }): ScheduledJob {
    const isCron = params.schedule.includes(' ');
    let kind: ScheduleKind;
    let everyMs: number | undefined;
    let cronExpr: string | undefined;
    let nextRun: string;

    if (isCron) {
      kind = 'cron';
      cronExpr = params.schedule;
      nextRun = nextCronRun(cronExpr, new Date()).toISOString();
    } else {
      kind = 'every';
      everyMs = parseDuration(params.schedule);
      nextRun = new Date(Date.now() + everyMs).toISOString();
    }

    const job: ScheduledJob = {
      id: generateId(),
      name: params.name,
      kind,
      schedule: params.schedule,
      everyMs,
      cronExpr,
      message: params.message,
      chatId: params.chatId,
      userId: params.userId,
      enabled: true,
      createdAt: new Date().toISOString(),
      nextRun,
      deleteAfterRun: false,
      runCount: 0,
    };
    this.jobs.push(job);
    this.save();
    return job;
  }

  removeJob(jobId: string): boolean {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter(j => j.id !== jobId);
    if (this.jobs.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  disableJob(jobId: string): boolean {
    const job = this.jobs.find(j => j.id === jobId);
    if (job) { job.enabled = false; this.save(); return true; }
    return false;
  }

  enableJob(jobId: string): boolean {
    const job = this.jobs.find(j => j.id === jobId);
    if (job) { job.enabled = true; this.save(); return true; }
    return false;
  }

  getJobsForUser(userId: number): ScheduledJob[] {
    return this.jobs.filter(j => j.userId === userId);
  }

  getAllJobs(): ScheduledJob[] {
    return [...this.jobs];
  }

  getJob(jobId: string): ScheduledJob | undefined {
    return this.jobs.find(j => j.id === jobId);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private load(): void {
    if (!fs.existsSync(this.storePath)) return;
    try {
      const raw = fs.readFileSync(this.storePath, 'utf-8');
      const store = JSON.parse(raw) as JobStore;
      this.jobs = store.jobs ?? [];
    } catch { this.jobs = []; }
  }

  private save(): void {
    const store: JobStore = {
      jobs: this.jobs,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2), 'utf-8');
  }

  formatJob(job: ScheduledJob): string {
    const next = new Date(job.nextRun).toLocaleString();
    const status = job.enabled ? '🟢' : '🔴';
    return `${status} <b>${job.id.slice(0, 8)}</b> — ${job.name}\n  Schedule: <code>${job.schedule}</code>\n  Next: ${next}\n  Runs: ${job.runCount}`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Parse a natural language reminder like "in 10 minutes", "tomorrow at 9am" */
export function parseNaturalDate(text: string): Date | null {
  const now = new Date();

  // "in X minutes/hours/days"
  const inMatch = text.match(/in\s+(\d+)\s*(min|minute|hour|day|week)s?/i);
  if (inMatch) {
    const amount = parseInt(inMatch[1], 10);
    const unit = inMatch[2].toLowerCase();
    const ms: Record<string, number> = {
      min: 60000, minute: 60000,
      hour: 3600000, day: 86400000, week: 604800000,
    };
    return new Date(now.getTime() + amount * (ms[unit] ?? 60000));
  }

  // "tomorrow"
  if (/tomorrow/i.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0); // default to 9am
    const timeMatch = text.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2] ?? '0', 10);
      const ampm = timeMatch[3]?.toLowerCase();
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      d.setHours(h, m, 0, 0);
    }
    return d;
  }

  // ISO timestamp
  const iso = Date.parse(text);
  if (!isNaN(iso)) return new Date(iso);

  return null;
}
