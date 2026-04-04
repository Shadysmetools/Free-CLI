/**
 * commands.ts — Telegram slash command handlers
 *
 * All /commands the bot responds to, matching OpenClaw's command set:
 * /help /clear /model /models /tools /persona /lang /memory /stats /cost
 * /sessions /status /cron /remind /profile /admin /config
 *
 * Commands are processed here and can send back formatted HTML replies.
 */

import { Context } from 'grammy';
import { BotContext, BotRuntime } from './telegram';
import {
  formatForTelegram, formatList, formatStatus, formatCode, escapeHtml,
} from './formatter';
import {
  helpKeyboard, modelKeyboard, personaKeyboard,
  sessionKeyboard, schedulerKeyboard, adminKeyboard,
} from './keyboards';
import { parseNaturalDate, parseDuration } from './scheduler';
import { PROVIDER_INFO, PROVIDER_MODELS } from '../providers/index';

// ─── Command registry ─────────────────────────────────────────────────────────

export type CommandHandler = (ctx: BotContext, runtime: BotRuntime, args: string[]) => Promise<void>;

export interface BotCommand {
  command: string;
  description: string;
  adminOnly?: boolean;
  handler: CommandHandler;
}

// ─── Safe send helper ─────────────────────────────────────────────────────────

async function reply(ctx: BotContext, text: string, extra?: Parameters<typeof ctx.reply>[1]): Promise<void> {
  try {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...extra,
    });
  } catch {
    // Fallback: send as plain text
    try {
      await ctx.reply(text.replace(/<[^>]+>/g, ''), extra);
    } catch { /* silently ignore */ }
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export const COMMANDS: BotCommand[] = [

  // ── /help ─────────────────────────────────────────────────────────────────
  {
    command: 'help',
    description: 'Show help and available commands',
    async handler(ctx, runtime) {
      const text = `<b>🤖 coderaw Bot</b>

AI coding assistant in your Telegram. Powered by ${escapeHtml(runtime.config.provider)}/${escapeHtml(runtime.config.model)}.

<b>Conversation:</b>
  /clear — Clear conversation history
  /compact — Summarize old messages
  /stats — Show token usage and costs

<b>AI Configuration:</b>
  /model [provider:model] — Switch AI model
  /models — List all available models
  /persona [name] — Change language/persona
  /lang [code] — Quick language switch

<b>Memory &amp; Knowledge:</b>
  /memory — View your memory notes
  /memory save &lt;note&gt; — Save a note
  /memory search &lt;query&gt; — Search notes
  /profile — View your profile

<b>Tools:</b>
  /tools — List available tools
  /tools info &lt;name&gt; — Tool details

<b>Scheduler:</b>
  /remind &lt;time&gt; &lt;message&gt; — Set a reminder
  /cron — Manage scheduled jobs

<b>Sessions:</b>
  /sessions — Active sessions (admin)
  /status — Bot status

<b>Admin:</b>
  /admin — Admin panel (owner only)

Just send any message to chat with the AI! 💬`;

      await reply(ctx, text, { reply_markup: helpKeyboard() });
    },
  },

  // ── /start ────────────────────────────────────────────────────────────────
  {
    command: 'start',
    description: 'Start the bot',
    async handler(ctx, runtime) {
      const from = ctx.from;
      const name = from?.first_name ?? 'there';
      const model = runtime.config.model;

      await reply(ctx, `👋 <b>Hello, ${escapeHtml(name)}!</b>

I'm your AI coding assistant. Send me any question, code snippet, or task.

<b>Model:</b> <code>${escapeHtml(model)}</code>
<b>Features:</b> ${Object.entries(runtime.config.features)
  .filter(([, v]) => v)
  .map(([k]) => k)
  .join(', ')}

Type /help to see all commands, or just start chatting! 🚀`);
    },
  },

  // ── /clear ────────────────────────────────────────────────────────────────
  {
    command: 'clear',
    description: 'Clear conversation history',
    async handler(ctx, runtime) {
      const from = ctx.from;
      if (!from) return;

      const session = runtime.sessions.get(from.id, ctx.chat!.id);
      if (session) {
        runtime.sessions.clearConversation(session);
        runtime.sessions.save(session);
      }

      await reply(ctx, '🗑 Conversation history cleared. Starting fresh!');
    },
  },

  // ── /stats / /cost ────────────────────────────────────────────────────────
  {
    command: 'stats',
    description: 'Show token usage and session statistics',
    async handler(ctx, runtime) {
      const from = ctx.from;
      if (!from) return;

      const session = runtime.sessions.get(from.id, ctx.chat!.id);
      if (!session) {
        await reply(ctx, 'No session data yet. Send a message first!');
        return;
      }

      const msgCount = session.profile.message_count;
      const tu = session.tokenUsage;
      const firstSeen = new Date(session.profile.first_seen).toLocaleDateString();
      const lastSeen = new Date(session.profile.last_seen).toLocaleString();

      await reply(ctx, formatStatus('📊 Session Stats', [
        ['Messages', String(msgCount)],
        ['Prompt tokens', String(tu.prompt)],
        ['Completion tokens', String(tu.completion)],
        ['Total tokens', String(tu.total)],
        ['Provider', runtime.config.provider],
        ['Model', runtime.config.model],
        ['First seen', firstSeen],
        ['Last seen', lastSeen],
      ]));
    },
  },

  // ── /model ────────────────────────────────────────────────────────────────
  {
    command: 'model',
    description: 'Switch AI model: /model [provider:model]',
    async handler(ctx, runtime, args) {
      const from = ctx.from;
      if (!from) return;

      if (args.length === 0) {
        // Show model picker keyboard
        const session = runtime.sessions.get(from.id, ctx.chat!.id);
        const current = session?.profile.prefs.model;
        await reply(ctx,
          `<b>🤖 Choose a model</b>\n\nCurrent: <code>${escapeHtml(runtime.config.model)}</code>`,
          { reply_markup: modelKeyboard(current) },
        );
        return;
      }

      const spec = args[0];
      const colonIdx = spec.indexOf(':');
      const provider = colonIdx >= 0 ? spec.slice(0, colonIdx) : spec;
      const model = colonIdx >= 0 ? spec.slice(colonIdx + 1) : '';

      // Save to session prefs
      const session = runtime.sessions.getOrCreate(
        from.id, ctx.chat!.id,
        { username: from.username, first_name: from.first_name },
        provider, model,
      );
      session.profile.prefs.provider = provider;
      session.profile.prefs.model = model;
      runtime.sessions.save(session);

      await reply(ctx, `✅ Switched to <code>${escapeHtml(spec)}</code>`);
    },
  },

  // ── /models ───────────────────────────────────────────────────────────────
  {
    command: 'models',
    description: 'List all available AI models',
    async handler(ctx) {
      const lines: string[] = ['<b>📋 Available Models</b>\n'];

      for (const [provName, models] of Object.entries(PROVIDER_MODELS)) {
        const info = PROVIDER_INFO[provName];
        const freeTag = info?.requiresKey ? '(BYOK)' : '(free)';
        lines.push(`<b>${escapeHtml(provName.toUpperCase())}</b> ${freeTag}`);
        for (const m of models.slice(0, 5)) {
          const rec = m.recommended ? ' ⭐' : '';
          lines.push(`  • <code>${escapeHtml(m.id)}</code>${rec}`);
        }
        lines.push('');
      }

      lines.push('<i>Switch: /model provider:model-name</i>');
      await reply(ctx, lines.join('\n'));
    },
  },

  // ── /persona ──────────────────────────────────────────────────────────────
  {
    command: 'persona',
    description: 'Change language/persona: /persona [name]',
    async handler(ctx, runtime, args) {
      const from = ctx.from;
      if (!from) return;

      if (args.length === 0) {
        const session = runtime.sessions.get(from.id, ctx.chat!.id);
        const current = session?.profile.prefs.persona;
        await reply(ctx,
          `<b>🎭 Choose a persona/language</b>\n\nCurrent: <code>${escapeHtml(current ?? 'english')}</code>`,
          { reply_markup: personaKeyboard(current) },
        );
        return;
      }

      const persona = args.join(' ').toLowerCase();
      const session = runtime.sessions.getOrCreate(
        from.id, ctx.chat!.id,
        { username: from.username, first_name: from.first_name },
        runtime.config.provider, runtime.config.model,
      );
      session.profile.prefs.persona = persona;
      runtime.sessions.save(session);

      await reply(ctx, `✅ Persona set to <code>${escapeHtml(persona)}</code>. The AI will now respond in this style.`);
    },
  },

  // ── /lang ─────────────────────────────────────────────────────────────────
  {
    command: 'lang',
    description: 'Quick language switch: /lang [code]',
    async handler(ctx, runtime, args) {
      // Just alias /persona
      const from = ctx.from;
      if (!from) return;

      if (args.length === 0) {
        const session = runtime.sessions.get(from.id, ctx.chat!.id);
        await reply(ctx, `Current language/persona: <code>${escapeHtml(session?.profile.prefs.persona ?? 'english')}</code>\n\nUse /persona to change it.`);
        return;
      }

      const persona = args.join(' ').toLowerCase();
      const session = runtime.sessions.getOrCreate(
        from.id, ctx.chat!.id,
        { username: from.username, first_name: from.first_name },
        runtime.config.provider, runtime.config.model,
      );
      session.profile.prefs.persona = persona;
      runtime.sessions.save(session);
      await reply(ctx, `✅ Language set to <code>${escapeHtml(persona)}</code>`);
    },
  },

  // ── /memory ───────────────────────────────────────────────────────────────
  {
    command: 'memory',
    description: 'View or save memory notes',
    async handler(ctx, runtime, args) {
      const from = ctx.from;
      if (!from) return;

      const sub = args[0]?.toLowerCase();
      const content = args.slice(1).join(' ');

      if (!sub || sub === 'show') {
        const mem = runtime.memory.loadFull();
        if (!mem.trim()) {
          await reply(ctx, '📋 <b>Memory</b>\n\n<i>Empty. Use /memory save &lt;note&gt; to add notes.</i>');
        } else {
          await reply(ctx, `📋 <b>Memory</b>\n\n<code>${escapeHtml(mem.slice(0, 3000))}</code>`);
        }
      } else if (sub === 'save') {
        if (!content) {
          await reply(ctx, '❌ Usage: /memory save &lt;your note here&gt;');
          return;
        }
        runtime.memory.save(content);
        await reply(ctx, `✅ Saved to memory: <i>${escapeHtml(content.slice(0, 100))}</i>`);
      } else if (sub === 'search') {
        if (!content) {
          await reply(ctx, '❌ Usage: /memory search &lt;query&gt;');
          return;
        }
        const results = runtime.memory.search(content);
        if (results.length === 0) {
          await reply(ctx, `🔍 No results for: <i>${escapeHtml(content)}</i>`);
        } else {
          const lines = results.slice(0, 10).map(r =>
            `  • <code>${escapeHtml(r.content.slice(0, 80))}</code>`
          );
          await reply(ctx, `🔍 <b>Memory results for "${escapeHtml(content)}"</b>\n\n${lines.join('\n')}`);
        }
      } else if (sub === 'clear') {
        runtime.memory.clear();
        await reply(ctx, '🗑 Memory cleared.');
      } else {
        await reply(ctx, '❌ Unknown subcommand. Try: /memory, /memory save &lt;note&gt;, /memory search &lt;query&gt;');
      }
    },
  },

  // ── /tools ────────────────────────────────────────────────────────────────
  {
    command: 'tools',
    description: 'List and manage available tools',
    async handler(ctx, runtime, args) {
      const sub = args[0]?.toLowerCase();
      const name = args[1];

      if (!sub || sub === 'list') {
        const desc = runtime.toolBridge.getToolDescriptions();
        await reply(ctx, `<b>🔧 Available Tools</b>\n\n${desc}`);
      } else if (sub === 'info' && name) {
        const info = runtime.toolBridge.registry.formatInfo(name);
        if (!info) {
          await reply(ctx, `❌ Tool not found: <code>${escapeHtml(name)}</code>`);
        } else {
          await reply(ctx, formatForTelegram(info));
        }
      } else {
        await reply(ctx, '❌ Usage: /tools [list|info &lt;name&gt;]');
      }
    },
  },

  // ── /remind ───────────────────────────────────────────────────────────────
  {
    command: 'remind',
    description: 'Set a reminder: /remind in 10min Check the build',
    async handler(ctx, runtime, args) {
      const from = ctx.from;
      if (!from) return;

      if (args.length < 2) {
        await reply(ctx, `<b>⏰ Remind</b>

Usage: <code>/remind &lt;time&gt; &lt;message&gt;</code>

Examples:
  /remind in 10min Check the build
  /remind in 2h Team standup
  /remind tomorrow at 9am Review PRs
  /remind in 1d Weekly report`);
        return;
      }

      // Extract time and message
      // Try "in X unit message" pattern
      const inMatch = args.join(' ').match(/^(in\s+[\w\s]+?)\s+(at\s+\d|[A-Z].*)$/i);
      let timeStr: string;
      let message: string;

      if (inMatch) {
        timeStr = inMatch[1];
        message = inMatch[2];
      } else {
        // Assume first 1-3 args are time, rest is message
        // Look for transition from time spec to message
        let timeEnd = 0;
        const timeWords = new Set(['in', 'at', 'tomorrow', 'tonight', 'am', 'pm']);
        for (let i = 0; i < Math.min(4, args.length); i++) {
          if (timeWords.has(args[i].toLowerCase()) || /^\d/.test(args[i])) {
            timeEnd = i + 1;
          } else if (i > 0) break;
        }
        timeStr = args.slice(0, timeEnd || 2).join(' ');
        message = args.slice(timeEnd || 2).join(' ');
      }

      if (!message) {
        await reply(ctx, '❌ Please include a reminder message after the time.');
        return;
      }

      // Parse the time
      let runAt: Date | null = null;

      // Duration format: "in 10m", "in 2h"
      const durationMatch = timeStr.match(/in\s+(\d+\s*\w+)/i);
      if (durationMatch) {
        try {
          const ms = parseDuration(durationMatch[1].replace(/\s+/g, ''));
          runAt = new Date(Date.now() + ms);
        } catch {
          runAt = parseNaturalDate(timeStr);
        }
      } else {
        runAt = parseNaturalDate(timeStr);
      }

      if (!runAt || runAt <= new Date()) {
        await reply(ctx, `❌ Couldn't parse time: <code>${escapeHtml(timeStr)}</code>\n\nTry: "in 10m", "in 2h", "tomorrow at 9am"`);
        return;
      }

      const job = runtime.scheduler.addOnce({
        name: `Reminder: ${message.slice(0, 40)}`,
        at: runAt,
        message,
        chatId: ctx.chat!.id,
        userId: from.id,
      });

      const timeStr2 = runAt.toLocaleString();
      await reply(ctx, `⏰ <b>Reminder set!</b>\n\n📌 <i>${escapeHtml(message)}</i>\n🕐 At: ${timeStr2}\n🆔 Job ID: <code>${job.id.slice(0, 8)}</code>`);
    },
  },

  // ── /cron ─────────────────────────────────────────────────────────────────
  {
    command: 'cron',
    description: 'Manage scheduled jobs',
    async handler(ctx, runtime, args) {
      const from = ctx.from;
      if (!from) return;

      const sub = args[0]?.toLowerCase();

      if (!sub || sub === 'list') {
        const jobs = runtime.scheduler.getJobsForUser(from.id);
        if (jobs.length === 0) {
          await reply(ctx, '📋 <b>No scheduled jobs</b>\n\nUse /remind to set a reminder, or /cron add.', {
            reply_markup: schedulerKeyboard(),
          });
          return;
        }
        const lines = jobs.map(j => runtime.scheduler.formatJob(j));
        await reply(ctx, `<b>⏰ Your Jobs (${jobs.length})</b>\n\n${lines.join('\n\n')}`);

      } else if (sub === 'delete' || sub === 'remove') {
        const jobId = args[1];
        if (!jobId) {
          await reply(ctx, '❌ Usage: /cron delete &lt;job-id&gt;');
          return;
        }
        // Find job belonging to this user
        const job = runtime.scheduler.getJobsForUser(from.id)
          .find(j => j.id.startsWith(jobId));
        if (!job) {
          await reply(ctx, `❌ Job not found: <code>${escapeHtml(jobId)}</code>`);
          return;
        }
        runtime.scheduler.removeJob(job.id);
        await reply(ctx, `✅ Job <code>${job.id.slice(0, 8)}</code> deleted.`);

      } else if (sub === 'clear') {
        const jobs = runtime.scheduler.getJobsForUser(from.id);
        for (const job of jobs) {
          runtime.scheduler.removeJob(job.id);
        }
        await reply(ctx, `✅ Cleared ${jobs.length} jobs.`);

      } else {
        await reply(ctx, `<b>⏰ Cron Commands</b>

/cron list — View your jobs
/cron delete &lt;id&gt; — Delete a job
/cron clear — Delete all your jobs
/remind in 10m &lt;message&gt; — Quick reminder`);
      }
    },
  },

  // ── /profile ──────────────────────────────────────────────────────────────
  {
    command: 'profile',
    description: 'View your profile and preferences',
    async handler(ctx, runtime, args) {
      const from = ctx.from;
      if (!from) return;

      const session = runtime.sessions.get(from.id, ctx.chat!.id);
      if (!session) {
        await reply(ctx, 'No profile yet. Send a message to create one!');
        return;
      }

      const p = session.profile;
      const prefs = p.prefs;

      await reply(ctx, formatStatus('👤 Your Profile', [
        ['Name', [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown'],
        ['Username', p.username ? `@${p.username}` : 'none'],
        ['User ID', String(p.id)],
        ['Messages', String(p.message_count)],
        ['Member since', new Date(p.first_seen).toLocaleDateString()],
        ['Provider', prefs.provider ?? runtime.config.provider],
        ['Model', prefs.model ?? runtime.config.model],
        ['Persona', prefs.persona ?? 'english'],
      ]));
    },
  },

  // ── /status ───────────────────────────────────────────────────────────────
  {
    command: 'status',
    description: 'Bot status and health check',
    async handler(ctx, runtime) {
      const sessions = runtime.sessions.listSessions();
      const jobs = runtime.scheduler.getAllJobs();
      const uptime = Math.floor(process.uptime());
      const mem = process.memoryUsage();

      await reply(ctx, formatStatus('🤖 Bot Status', [
        ['Status', '🟢 Online'],
        ['Uptime', `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`],
        ['Provider', runtime.config.provider],
        ['Model', runtime.config.model],
        ['Active sessions', String(sessions.length)],
        ['Scheduled jobs', String(jobs.filter(j => j.enabled).length)],
        ['Memory (RSS)', `${Math.round(mem.rss / 1024 / 1024)} MB`],
        ['Node', process.version],
      ]));
    },
  },

  // ── /admin ────────────────────────────────────────────────────────────────
  {
    command: 'admin',
    description: 'Admin panel (owner only)',
    adminOnly: true,
    async handler(ctx, runtime) {
      const sessions = runtime.sessions.listSessions();
      const jobs = runtime.scheduler.getAllJobs();

      await reply(ctx,
        `<b>⚙ Admin Panel</b>

<b>Sessions:</b> ${sessions.length}
<b>Jobs:</b> ${jobs.length} total, ${jobs.filter(j => j.enabled).length} active
<b>Tools:</b> ${runtime.toolBridge.listEnabledTools().length} enabled`,
        { reply_markup: adminKeyboard() },
      );
    },
  },

  // ── /sessions (admin) ─────────────────────────────────────────────────────
  {
    command: 'sessions',
    description: 'List all active sessions (admin)',
    adminOnly: true,
    async handler(ctx, runtime) {
      const sessions = runtime.sessions.listSessions().slice(0, 20);
      if (sessions.length === 0) {
        await reply(ctx, '📋 No sessions found.');
        return;
      }

      const lines = sessions.map(s => {
        const name = [s.profile.first_name, s.profile.last_name].filter(Boolean).join(' ') || String(s.userId);
        const age = new Date(s.updatedAt).toLocaleDateString();
        return `• <b>${escapeHtml(name)}</b> (${s.userId}) — ${s.profile.message_count} msgs — ${age}`;
      });

      await reply(ctx, `<b>👥 Sessions (${sessions.length})</b>\n\n${lines.join('\n')}`);
    },
  },

];

// ─── Command lookup ────────────────────────────────────────────────────────────

export function findCommand(name: string): BotCommand | undefined {
  return COMMANDS.find(c => c.command === name.toLowerCase());
}

/** Returns the list of commands for BotFather registration */
export function getCommandList(): Array<{ command: string; description: string }> {
  return COMMANDS
    .filter(c => !c.adminOnly)
    .map(c => ({ command: c.command, description: c.description }));
}
