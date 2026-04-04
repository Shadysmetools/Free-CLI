"use strict";
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
exports.BotScheduler = void 0;
exports.parseDuration = parseDuration;
exports.parseNaturalDate = parseNaturalDate;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const events_1 = require("events");
// ─── Cron expression parser ───────────────────────────────────────────────────
/** Simple 5-field cron expression matcher: min hour dom month dow */
function matchesCron(expr, date) {
    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 5)
        return false;
    const [minF, hourF, domF, monthF, dowF] = fields;
    const matches = (field, value, min, max) => {
        if (field === '*')
            return true;
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
    return (matches(minF, date.getMinutes(), 0, 59) &&
        matches(hourF, date.getHours(), 0, 23) &&
        matches(domF, date.getDate(), 1, 31) &&
        matches(monthF, date.getMonth() + 1, 1, 12) &&
        matches(dowF, date.getDay(), 0, 7));
}
/** Parse human-readable duration like "10m", "2h", "1d" → milliseconds */
function parseDuration(duration) {
    const units = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
    };
    const match = duration.trim().match(/^(\d+)([smhd])$/);
    if (!match)
        throw new Error(`Invalid duration: "${duration}". Use format like "10m", "2h", "1d"`);
    return parseInt(match[1], 10) * units[match[2]];
}
/** Compute next run time for a 'cron' job */
function nextCronRun(expr, after) {
    const next = new Date(after.getTime() + 60 * 1000); // start 1 min ahead
    next.setSeconds(0, 0);
    // Search up to 1 year ahead
    for (let i = 0; i < 366 * 24 * 60; i++) {
        if (matchesCron(expr, next))
            return next;
        next.setMinutes(next.getMinutes() + 1);
    }
    throw new Error(`Could not compute next run for cron "${expr}"`);
}
// ─── Scheduler ────────────────────────────────────────────────────────────────
class BotScheduler extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.jobs = [];
        this.timer = null;
        this.running = false;
        this.config = config;
        this.storePath = config.store.replace('~', os.homedir());
        fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    }
    // ── Lifecycle ─────────────────────────────────────────────────────────────
    start() {
        if (this.running || !this.config.enabled)
            return;
        this.running = true;
        this.load();
        // Check every 30 seconds
        this.timer = setInterval(() => this.tick(), 30000);
        // Immediate first tick
        setTimeout(() => this.tick(), 1000);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.running = false;
    }
    // ── Tick ──────────────────────────────────────────────────────────────────
    tick() {
        const now = new Date();
        let dirty = false;
        for (const job of this.jobs) {
            if (!job.enabled)
                continue;
            const nextRun = new Date(job.nextRun);
            if (now < nextRun)
                continue;
            // Trigger
            this.emit('job', { job });
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
                }
                else if (job.kind === 'cron' && job.cronExpr) {
                    job.nextRun = nextCronRun(job.cronExpr, now).toISOString();
                }
                else {
                    job.enabled = false;
                }
            }
            catch {
                job.enabled = false;
            }
            dirty = true;
        }
        // Clean up disabled once-jobs
        const before = this.jobs.length;
        this.jobs = this.jobs.filter(j => j.enabled || j.kind !== 'once');
        if (this.jobs.length !== before)
            dirty = true;
        if (dirty)
            this.save();
    }
    // ── Job management ────────────────────────────────────────────────────────
    addOnce(params) {
        const runAt = params.at instanceof Date ? params.at : new Date(params.at);
        const job = {
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
    addRecurring(params) {
        const isCron = params.schedule.includes(' ');
        let kind;
        let everyMs;
        let cronExpr;
        let nextRun;
        if (isCron) {
            kind = 'cron';
            cronExpr = params.schedule;
            nextRun = nextCronRun(cronExpr, new Date()).toISOString();
        }
        else {
            kind = 'every';
            everyMs = parseDuration(params.schedule);
            nextRun = new Date(Date.now() + everyMs).toISOString();
        }
        const job = {
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
    removeJob(jobId) {
        const before = this.jobs.length;
        this.jobs = this.jobs.filter(j => j.id !== jobId);
        if (this.jobs.length !== before) {
            this.save();
            return true;
        }
        return false;
    }
    disableJob(jobId) {
        const job = this.jobs.find(j => j.id === jobId);
        if (job) {
            job.enabled = false;
            this.save();
            return true;
        }
        return false;
    }
    enableJob(jobId) {
        const job = this.jobs.find(j => j.id === jobId);
        if (job) {
            job.enabled = true;
            this.save();
            return true;
        }
        return false;
    }
    getJobsForUser(userId) {
        return this.jobs.filter(j => j.userId === userId);
    }
    getAllJobs() {
        return [...this.jobs];
    }
    getJob(jobId) {
        return this.jobs.find(j => j.id === jobId);
    }
    // ── Persistence ───────────────────────────────────────────────────────────
    load() {
        if (!fs.existsSync(this.storePath))
            return;
        try {
            const raw = fs.readFileSync(this.storePath, 'utf-8');
            const store = JSON.parse(raw);
            this.jobs = store.jobs ?? [];
        }
        catch {
            this.jobs = [];
        }
    }
    save() {
        const store = {
            jobs: this.jobs,
            updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2), 'utf-8');
    }
    formatJob(job) {
        const next = new Date(job.nextRun).toLocaleString();
        const status = job.enabled ? '🟢' : '🔴';
        return `${status} <b>${job.id.slice(0, 8)}</b> — ${job.name}\n  Schedule: <code>${job.schedule}</code>\n  Next: ${next}\n  Runs: ${job.runCount}`;
    }
}
exports.BotScheduler = BotScheduler;
// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
/** Parse a natural language reminder like "in 10 minutes", "tomorrow at 9am" */
function parseNaturalDate(text) {
    const now = new Date();
    // "in X minutes/hours/days"
    const inMatch = text.match(/in\s+(\d+)\s*(min|minute|hour|day|week)s?/i);
    if (inMatch) {
        const amount = parseInt(inMatch[1], 10);
        const unit = inMatch[2].toLowerCase();
        const ms = {
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
            if (ampm === 'pm' && h < 12)
                h += 12;
            if (ampm === 'am' && h === 12)
                h = 0;
            d.setHours(h, m, 0, 0);
        }
        return d;
    }
    // ISO timestamp
    const iso = Date.parse(text);
    if (!isNaN(iso))
        return new Date(iso);
    return null;
}
//# sourceMappingURL=scheduler.js.map