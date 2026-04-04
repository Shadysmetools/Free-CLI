"use strict";
/**
 * commands.ts — Telegram slash command handlers
 *
 * All /commands the bot responds to, matching OpenClaw's command set:
 * /help /clear /model /models /tools /persona /lang /memory /stats /cost
 * /sessions /status /cron /remind /profile /admin /config
 *
 * Commands are processed here and can send back formatted HTML replies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMANDS = void 0;
exports.findCommand = findCommand;
exports.getCommandList = getCommandList;
const formatter_1 = require("./formatter");
const keyboards_1 = require("./keyboards");
const soul_1 = require("./soul");
const web_tools_1 = require("./web_tools");
const scheduler_1 = require("./scheduler");
const index_1 = require("../providers/index");
// ─── Safe send helper ─────────────────────────────────────────────────────────
async function reply(ctx, text, extra) {
    try {
        await ctx.reply(text, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            ...extra,
        });
    }
    catch {
        // Fallback: send as plain text
        try {
            await ctx.reply(text.replace(/<[^>]+>/g, ''), extra);
        }
        catch { /* silently ignore */ }
    }
}
// ─── Commands ─────────────────────────────────────────────────────────────────
exports.COMMANDS = [
    // ── /help ─────────────────────────────────────────────────────────────────
    {
        command: 'help',
        description: 'Show help and available commands',
        async handler(ctx, runtime) {
            const text = `<b>🤖 coderaw Bot</b>

AI coding assistant in your Telegram. Powered by ${(0, formatter_1.escapeHtml)(runtime.config.provider)}/${(0, formatter_1.escapeHtml)(runtime.config.model)}.

<b>Conversation:</b>
  /clear — Clear chat (keep identity)
  /reset — Full wipe (back to intro)
  /compact — Summarize old messages
  /stats — Show token usage and costs

<b>AI Configuration:</b>
  /model [provider:model] — Switch AI model
  /models — List all available models
  /setkey &lt;provider&gt; &lt;key&gt; — Set API key
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
            await reply(ctx, text, { reply_markup: (0, keyboards_1.helpKeyboard)() });
        },
    },
    // ── /start ────────────────────────────────────────────────────────────────
    {
        command: 'start',
        description: 'Start the bot',
        async handler(ctx, runtime) {
            const from = ctx.from;
            if (!from)
                return;
            // If user already has a soul, show a welcome back message
            const soul = runtime.soulManager.getSoul(from.id);
            if (soul) {
                const roleDef = soul_1.ROLE_DEFS[soul.role];
                await reply(ctx, `👋 <b>Welcome back, ${(0, formatter_1.escapeHtml)(soul.userName)}!</b>

I'm <b>${(0, formatter_1.escapeHtml)(soul.botName)}</b>, your ${roleDef.emoji} ${(0, formatter_1.escapeHtml)(roleDef.label)}.

Type /help for commands, or just start chatting! 💬
Use /soul to view your config, /reset to start over.`);
                return;
            }
            // New user — trigger onboarding (cancel any pending first)
            runtime.soulManager.cancelOnboarding(from.id);
            runtime.soulManager.startOnboarding(from.id);
            const firstName = from.first_name ?? 'there';
            await reply(ctx, `👋 <b>Hey ${(0, formatter_1.escapeHtml)(firstName)}! I'm your new AI assistant.</b>

Let's set me up real quick — just 3 questions!

<b>First: What should I call you?</b>
<i>(Just type your name or nickname)</i>`);
        },
    },
    // ── /clear ────────────────────────────────────────────────────────────────
    {
        command: 'clear',
        description: 'Clear chat history (keeps your identity & settings)',
        async handler(ctx, runtime) {
            const from = ctx.from;
            if (!from)
                return;
            const session = runtime.sessions.get(from.id, ctx.chat.id);
            if (session) {
                runtime.sessions.clearConversation(session);
                runtime.sessions.save(session);
            }
            const soul = runtime.soulManager.getSoul(from.id);
            const name = soul?.userName || 'there';
            await reply(ctx, `🗑 Chat cleared, ${(0, formatter_1.escapeHtml)(name)}! Your identity & settings are kept. Just start chatting again.`);
        },
    },
    // ── /reset ────────────────────────────────────────────────────────────────
    {
        command: 'reset',
        description: 'Full reset — delete soul, session, memory. Restart from intro.',
        async handler(ctx, runtime) {
            const from = ctx.from;
            if (!from)
                return;
            // Delete soul (personality, name, role, language)
            runtime.soulManager.deleteSoul(from.id);
            // Delete session (conversation, tokens, prefs)
            runtime.sessions.delete(from.id, ctx.chat.id);
            // Clear user memory
            try {
                runtime.memory.clear();
            }
            catch { /* may not have per-user memory */ }
            await reply(ctx, `🔄 <b>Full reset complete!</b>

Everything has been wiped:
• ✅ Soul (name, role, language)
• ✅ Conversation history
• ✅ Session preferences
• ✅ Memory notes

Send any message to start the onboarding again! 👋`);
        },
    },
    // ── /stats / /cost ────────────────────────────────────────────────────────
    {
        command: 'stats',
        description: 'Show token usage and session statistics',
        async handler(ctx, runtime) {
            const from = ctx.from;
            if (!from)
                return;
            const session = runtime.sessions.get(from.id, ctx.chat.id);
            if (!session) {
                await reply(ctx, 'No session data yet. Send a message first!');
                return;
            }
            const msgCount = session.profile.message_count;
            const tu = session.tokenUsage;
            const firstSeen = new Date(session.profile.first_seen).toLocaleDateString();
            const lastSeen = new Date(session.profile.last_seen).toLocaleString();
            await reply(ctx, (0, formatter_1.formatStatus)('📊 Session Stats', [
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
            if (!from)
                return;
            if (args.length === 0) {
                // Show model picker keyboard
                const session = runtime.sessions.get(from.id, ctx.chat.id);
                const current = session?.profile.prefs.model;
                await reply(ctx, `<b>🤖 Choose a model</b>\n\nCurrent: <code>${(0, formatter_1.escapeHtml)(runtime.config.model)}</code>`, { reply_markup: (0, keyboards_1.modelKeyboard)(current) });
                return;
            }
            const spec = args[0];
            const colonIdx = spec.indexOf(':');
            const provider = colonIdx >= 0 ? spec.slice(0, colonIdx) : spec;
            const model = colonIdx >= 0 ? spec.slice(colonIdx + 1) : '';
            // Save to session prefs
            const session = runtime.sessions.getOrCreate(from.id, ctx.chat.id, { username: from.username, first_name: from.first_name }, provider, model);
            session.profile.prefs.provider = provider;
            session.profile.prefs.model = model;
            runtime.sessions.save(session);
            await reply(ctx, `✅ Switched to <code>${(0, formatter_1.escapeHtml)(spec)}</code>`);
        },
    },
    // ── /models ───────────────────────────────────────────────────────────────
    {
        command: 'models',
        description: 'List all available AI models',
        async handler(ctx) {
            const lines = ['<b>📋 Available Models</b>\n'];
            for (const [provName, models] of Object.entries(index_1.PROVIDER_MODELS)) {
                const info = index_1.PROVIDER_INFO[provName];
                const freeTag = info?.requiresKey ? '(BYOK)' : '(free)';
                lines.push(`<b>${(0, formatter_1.escapeHtml)(provName.toUpperCase())}</b> ${freeTag}`);
                for (const m of models.slice(0, 5)) {
                    const rec = m.recommended ? ' ⭐' : '';
                    lines.push(`  • <code>${(0, formatter_1.escapeHtml)(m.id)}</code>${rec}`);
                }
                lines.push('');
            }
            lines.push('<i>Switch: /model provider:model-name</i>');
            await reply(ctx, lines.join('\n'));
        },
    },
    // ── /setkey ─────────────────────────────────────────────────────────────────
    {
        command: 'setkey',
        description: 'Set API key: /setkey <provider> <key>',
        async handler(ctx, runtime, args) {
            if (args.length < 2) {
                const envMap = {
                    openrouter: process.env.OPENROUTER_API_KEY ? '✅' : '❌',
                    groq: process.env.GROQ_API_KEY ? '✅' : '❌',
                    google: (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) ? '✅' : '❌',
                    mistral: process.env.MISTRAL_API_KEY ? '✅' : '❌',
                    anthropic: process.env.ANTHROPIC_API_KEY ? '✅' : '❌',
                    openai: process.env.OPENAI_API_KEY ? '✅' : '❌',
                };
                const lines = ['<b>🔑 API Keys</b>\n'];
                for (const [name, status] of Object.entries(envMap)) {
                    lines.push(`  ${status} ${(0, formatter_1.escapeHtml)(name)}`);
                }
                lines.push('\n<b>Usage:</b> <code>/setkey provider api-key</code>');
                lines.push('\n<b>Providers:</b> openrouter, groq, google, mistral, anthropic, openai');
                lines.push('\n<b>Free keys:</b>');
                lines.push('• <a href="https://openrouter.ai/keys">openrouter.ai/keys</a>');
                lines.push('• <a href="https://console.groq.com">console.groq.com</a>');
                lines.push('• <a href="https://aistudio.google.com">aistudio.google.com</a>');
                lines.push('• <a href="https://console.mistral.ai">console.mistral.ai</a>');
                await reply(ctx, lines.join('\n'));
                return;
            }
            const provider = args[0].toLowerCase();
            const apiKey = args[1];
            const envVarMap = {
                openrouter: 'OPENROUTER_API_KEY',
                groq: 'GROQ_API_KEY',
                google: 'GOOGLE_API_KEY',
                gemini: 'GOOGLE_API_KEY',
                mistral: 'MISTRAL_API_KEY',
                anthropic: 'ANTHROPIC_API_KEY',
                openai: 'OPENAI_API_KEY',
            };
            const envVar = envVarMap[provider];
            if (!envVar) {
                await reply(ctx, `❌ Unknown provider: <code>${(0, formatter_1.escapeHtml)(provider)}</code>\n\nTry: openrouter, groq, google, mistral, anthropic, openai`);
                return;
            }
            // Set the env var so fallback chain picks it up
            process.env[envVar] = apiKey;
            // Delete the message with the key for security
            try {
                await ctx.deleteMessage();
            }
            catch { /* may not have permission */ }
            await reply(ctx, `✅ <b>${(0, formatter_1.escapeHtml)(provider)}</b> API key set!\n\n🔒 Your message with the key was deleted for security.`);
        },
    },
    // ── /persona ──────────────────────────────────────────────────────────────
    {
        command: 'persona',
        description: 'Change language/persona: /persona [name]',
        async handler(ctx, runtime, args) {
            const from = ctx.from;
            if (!from)
                return;
            if (args.length === 0) {
                const session = runtime.sessions.get(from.id, ctx.chat.id);
                const current = session?.profile.prefs.persona;
                await reply(ctx, `<b>🎭 Choose a persona/language</b>\n\nCurrent: <code>${(0, formatter_1.escapeHtml)(current ?? 'english')}</code>`, { reply_markup: (0, keyboards_1.personaKeyboard)(current) });
                return;
            }
            const persona = args.join(' ').toLowerCase();
            const session = runtime.sessions.getOrCreate(from.id, ctx.chat.id, { username: from.username, first_name: from.first_name }, runtime.config.provider, runtime.config.model);
            session.profile.prefs.persona = persona;
            runtime.sessions.save(session);
            await reply(ctx, `✅ Persona set to <code>${(0, formatter_1.escapeHtml)(persona)}</code>. The AI will now respond in this style.`);
        },
    },
    // ── /lang ─────────────────────────────────────────────────────────────────
    {
        command: 'lang',
        description: 'Quick language switch: /lang [code]',
        async handler(ctx, runtime, args) {
            // Just alias /persona
            const from = ctx.from;
            if (!from)
                return;
            if (args.length === 0) {
                const session = runtime.sessions.get(from.id, ctx.chat.id);
                await reply(ctx, `Current language/persona: <code>${(0, formatter_1.escapeHtml)(session?.profile.prefs.persona ?? 'english')}</code>\n\nUse /persona to change it.`);
                return;
            }
            const persona = args.join(' ').toLowerCase();
            const session = runtime.sessions.getOrCreate(from.id, ctx.chat.id, { username: from.username, first_name: from.first_name }, runtime.config.provider, runtime.config.model);
            session.profile.prefs.persona = persona;
            runtime.sessions.save(session);
            await reply(ctx, `✅ Language set to <code>${(0, formatter_1.escapeHtml)(persona)}</code>`);
        },
    },
    // ── /memory ───────────────────────────────────────────────────────────────
    {
        command: 'memory',
        description: 'View or save memory notes',
        async handler(ctx, runtime, args) {
            const from = ctx.from;
            if (!from)
                return;
            const sub = args[0]?.toLowerCase();
            const content = args.slice(1).join(' ');
            if (!sub || sub === 'show') {
                const mem = runtime.memory.loadFull();
                if (!mem.trim()) {
                    await reply(ctx, '📋 <b>Memory</b>\n\n<i>Empty. Use /memory save &lt;note&gt; to add notes.</i>');
                }
                else {
                    await reply(ctx, `📋 <b>Memory</b>\n\n<code>${(0, formatter_1.escapeHtml)(mem.slice(0, 3000))}</code>`);
                }
            }
            else if (sub === 'save') {
                if (!content) {
                    await reply(ctx, '❌ Usage: /memory save &lt;your note here&gt;');
                    return;
                }
                runtime.memory.save(content);
                await reply(ctx, `✅ Saved to memory: <i>${(0, formatter_1.escapeHtml)(content.slice(0, 100))}</i>`);
            }
            else if (sub === 'search') {
                if (!content) {
                    await reply(ctx, '❌ Usage: /memory search &lt;query&gt;');
                    return;
                }
                const results = runtime.memory.search(content);
                if (results.length === 0) {
                    await reply(ctx, `🔍 No results for: <i>${(0, formatter_1.escapeHtml)(content)}</i>`);
                }
                else {
                    const lines = results.slice(0, 10).map(r => `  • <code>${(0, formatter_1.escapeHtml)(r.content.slice(0, 80))}</code>`);
                    await reply(ctx, `🔍 <b>Memory results for "${(0, formatter_1.escapeHtml)(content)}"</b>\n\n${lines.join('\n')}`);
                }
            }
            else if (sub === 'clear') {
                runtime.memory.clear();
                await reply(ctx, '🗑 Memory cleared.');
            }
            else {
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
            }
            else if (sub === 'info' && name) {
                const info = runtime.toolBridge.registry.formatInfo(name);
                if (!info) {
                    await reply(ctx, `❌ Tool not found: <code>${(0, formatter_1.escapeHtml)(name)}</code>`);
                }
                else {
                    await reply(ctx, (0, formatter_1.formatForTelegram)(info));
                }
            }
            else {
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
            if (!from)
                return;
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
            let timeStr;
            let message;
            if (inMatch) {
                timeStr = inMatch[1];
                message = inMatch[2];
            }
            else {
                // Assume first 1-3 args are time, rest is message
                // Look for transition from time spec to message
                let timeEnd = 0;
                const timeWords = new Set(['in', 'at', 'tomorrow', 'tonight', 'am', 'pm']);
                for (let i = 0; i < Math.min(4, args.length); i++) {
                    if (timeWords.has(args[i].toLowerCase()) || /^\d/.test(args[i])) {
                        timeEnd = i + 1;
                    }
                    else if (i > 0)
                        break;
                }
                timeStr = args.slice(0, timeEnd || 2).join(' ');
                message = args.slice(timeEnd || 2).join(' ');
            }
            if (!message) {
                await reply(ctx, '❌ Please include a reminder message after the time.');
                return;
            }
            // Parse the time
            let runAt = null;
            // Duration format: "in 10m", "in 2h"
            const durationMatch = timeStr.match(/in\s+(\d+\s*\w+)/i);
            if (durationMatch) {
                try {
                    const ms = (0, scheduler_1.parseDuration)(durationMatch[1].replace(/\s+/g, ''));
                    runAt = new Date(Date.now() + ms);
                }
                catch {
                    runAt = (0, scheduler_1.parseNaturalDate)(timeStr);
                }
            }
            else {
                runAt = (0, scheduler_1.parseNaturalDate)(timeStr);
            }
            if (!runAt || runAt <= new Date()) {
                await reply(ctx, `❌ Couldn't parse time: <code>${(0, formatter_1.escapeHtml)(timeStr)}</code>\n\nTry: "in 10m", "in 2h", "tomorrow at 9am"`);
                return;
            }
            const job = runtime.scheduler.addOnce({
                name: `Reminder: ${message.slice(0, 40)}`,
                at: runAt,
                message,
                chatId: ctx.chat.id,
                userId: from.id,
            });
            const timeStr2 = runAt.toLocaleString();
            await reply(ctx, `⏰ <b>Reminder set!</b>\n\n📌 <i>${(0, formatter_1.escapeHtml)(message)}</i>\n🕐 At: ${timeStr2}\n🆔 Job ID: <code>${job.id.slice(0, 8)}</code>`);
        },
    },
    // ── /cron ─────────────────────────────────────────────────────────────────
    {
        command: 'cron',
        description: 'Manage scheduled jobs',
        async handler(ctx, runtime, args) {
            const from = ctx.from;
            if (!from)
                return;
            const sub = args[0]?.toLowerCase();
            if (!sub || sub === 'list') {
                const jobs = runtime.scheduler.getJobsForUser(from.id);
                if (jobs.length === 0) {
                    await reply(ctx, '📋 <b>No scheduled jobs</b>\n\nUse /remind to set a reminder, or /cron add.', {
                        reply_markup: (0, keyboards_1.schedulerKeyboard)(),
                    });
                    return;
                }
                const lines = jobs.map(j => runtime.scheduler.formatJob(j));
                await reply(ctx, `<b>⏰ Your Jobs (${jobs.length})</b>\n\n${lines.join('\n\n')}`);
            }
            else if (sub === 'delete' || sub === 'remove') {
                const jobId = args[1];
                if (!jobId) {
                    await reply(ctx, '❌ Usage: /cron delete &lt;job-id&gt;');
                    return;
                }
                // Find job belonging to this user
                const job = runtime.scheduler.getJobsForUser(from.id)
                    .find(j => j.id.startsWith(jobId));
                if (!job) {
                    await reply(ctx, `❌ Job not found: <code>${(0, formatter_1.escapeHtml)(jobId)}</code>`);
                    return;
                }
                runtime.scheduler.removeJob(job.id);
                await reply(ctx, `✅ Job <code>${job.id.slice(0, 8)}</code> deleted.`);
            }
            else if (sub === 'clear') {
                const jobs = runtime.scheduler.getJobsForUser(from.id);
                for (const job of jobs) {
                    runtime.scheduler.removeJob(job.id);
                }
                await reply(ctx, `✅ Cleared ${jobs.length} jobs.`);
            }
            else {
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
            if (!from)
                return;
            const session = runtime.sessions.get(from.id, ctx.chat.id);
            if (!session) {
                await reply(ctx, 'No profile yet. Send a message to create one!');
                return;
            }
            const p = session.profile;
            const prefs = p.prefs;
            await reply(ctx, (0, formatter_1.formatStatus)('👤 Your Profile', [
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
            await reply(ctx, (0, formatter_1.formatStatus)('🤖 Bot Status', [
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
            await reply(ctx, `<b>⚙ Admin Panel</b>

<b>Sessions:</b> ${sessions.length}
<b>Jobs:</b> ${jobs.length} total, ${jobs.filter(j => j.enabled).length} active
<b>Tools:</b> ${runtime.toolBridge.listEnabledTools().length} enabled`, { reply_markup: (0, keyboards_1.adminKeyboard)() });
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
                return `• <b>${(0, formatter_1.escapeHtml)(name)}</b> (${s.userId}) — ${s.profile.message_count} msgs — ${age}`;
            });
            await reply(ctx, `<b>👥 Sessions (${sessions.length})</b>\n\n${lines.join('\n')}`);
        },
    },
    // ── /soul ─────────────────────────────────────────────────────────────────
    {
        command: 'soul',
        description: 'Show current personality / soul config',
        async handler(ctx, runtime) {
            const from = ctx.from;
            if (!from)
                return;
            const soul = runtime.soulManager.getSoul(from.id);
            if (!soul) {
                await reply(ctx, `🪬 No soul configured yet.\n\nSend any message to start onboarding, or use /start.`);
                return;
            }
            await reply(ctx, (0, soul_1.formatSoul)(soul));
        },
    },
    // ── /name ─────────────────────────────────────────────────────────────────
    {
        command: 'name',
        description: 'Rename the bot: /name <new name>',
        async handler(ctx, runtime, args) {
            const from = ctx.from;
            if (!from)
                return;
            if (args.length === 0) {
                const soul = runtime.soulManager.getSoul(from.id);
                await reply(ctx, `Bot name: <b>${(0, formatter_1.escapeHtml)(soul?.botName ?? 'coderaw')}</b>\n\nUsage: <code>/name NewName</code>`);
                return;
            }
            const newName = args.join(' ').trim().slice(0, 50);
            const updated = runtime.soulManager.updateSoul(from.id, { botName: newName });
            if (!updated) {
                // Create a default soul first
                await reply(ctx, `⚠️ No soul configured yet. Send any message to start setup first.`);
                return;
            }
            // Refresh session system prompt
            const session = runtime.sessions.get(from.id, ctx.chat.id);
            if (session) {
                session.systemPrompt = updated.systemPrompt;
                runtime.sessions.save(session);
            }
            await reply(ctx, `✅ Bot renamed to <b>${(0, formatter_1.escapeHtml)(newName)}</b>! I'll go by that from now on.`);
        },
    },
    // ── /role ─────────────────────────────────────────────────────────────────
    {
        command: 'role',
        description: 'Change bot role: /role [coding|research|general|devops|data|creative]',
        async handler(ctx, runtime, args) {
            const from = ctx.from;
            if (!from)
                return;
            const soul = runtime.soulManager.getSoul(from.id);
            if (args.length === 0) {
                const currentRole = soul?.role ?? 'general';
                await reply(ctx, `<b>🎭 Choose a role</b>\n\nCurrent: <code>${(0, formatter_1.escapeHtml)(currentRole)}</code>`, { reply_markup: (0, keyboards_1.roleChangeKeyboard)(currentRole) });
                return;
            }
            const roleInput = args.join(' ').trim();
            const resolvedRole = (0, soul_1.resolveSoulRole)(roleInput);
            if (!resolvedRole) {
                await reply(ctx, `❌ Unknown role: <code>${(0, formatter_1.escapeHtml)(roleInput)}</code>\n\nAvailable: coding, research, general, devops, data, creative`);
                return;
            }
            if (!soul) {
                await reply(ctx, `⚠️ No soul configured yet. Send any message to start setup first.`);
                return;
            }
            const roleDef = soul_1.ROLE_DEFS[resolvedRole];
            const updated = runtime.soulManager.updateSoul(from.id, {
                role: resolvedRole,
                capabilities: roleDef.capabilities,
            });
            if (!updated)
                return;
            const session = runtime.sessions.get(from.id, ctx.chat.id);
            if (session) {
                session.systemPrompt = updated.systemPrompt;
                runtime.sessions.save(session);
            }
            await reply(ctx, `✅ Role changed to ${roleDef.emoji} <b>${roleDef.label}</b>\n\n<i>${roleDef.shortDesc}</i>`);
        },
    },
    // ── /language ─────────────────────────────────────────────────────────────
    {
        command: 'language',
        description: 'Change language: /language [english|egyptian|franco|arabic|french|...]',
        async handler(ctx, runtime, args) {
            const from = ctx.from;
            if (!from)
                return;
            const soul = runtime.soulManager.getSoul(from.id);
            const currentLang = soul?.language ?? 'english';
            if (args.length === 0) {
                const langDef = soul_1.LANGUAGE_DEFS[currentLang];
                await reply(ctx, `<b>🌍 Choose a language</b>\n\nCurrent: ${langDef.flag} <b>${langDef.label}</b>`, { reply_markup: (0, keyboards_1.languageChangeKeyboard)(currentLang) });
                return;
            }
            const sub = args[0].toLowerCase();
            if (sub === 'list') {
                const lines = Object.entries(soul_1.LANGUAGE_DEFS).map(([id, def]) => `  ${def.flag} <code>${id.padEnd(12)}</code> ${def.label}${soul?.language === id ? ' ← current' : ''}`);
                await reply(ctx, `<b>🌍 Available Languages</b>\n\n${lines.join('\n')}\n\n<i>Use: /language &lt;name&gt;</i>`);
                return;
            }
            const langInput = (sub === 'set' ? args[1] : args[0]) ?? '';
            const resolvedLang = (0, soul_1.resolveSoulLanguage)(langInput);
            if (!resolvedLang) {
                await reply(ctx, `❌ Unknown language: <code>${(0, formatter_1.escapeHtml)(langInput)}</code>\n\nTry: english, egyptian, franco, arabic, french, spanish, german, turkish, auto`);
                return;
            }
            if (!soul) {
                // Also update the session persona if no soul
                const session = runtime.sessions.get(from.id, ctx.chat.id);
                if (session) {
                    session.profile.prefs.persona = resolvedLang;
                    runtime.sessions.save(session);
                }
                const langDef = soul_1.LANGUAGE_DEFS[resolvedLang];
                await reply(ctx, `✅ Language set to ${langDef.flag} <b>${langDef.label}</b>`);
                return;
            }
            const updated = runtime.soulManager.updateSoul(from.id, { language: resolvedLang });
            if (!updated)
                return;
            const session = runtime.sessions.get(from.id, ctx.chat.id);
            if (session) {
                session.systemPrompt = updated.systemPrompt;
                runtime.sessions.save(session);
            }
            const langDef = soul_1.LANGUAGE_DEFS[resolvedLang];
            await reply(ctx, `✅ Language changed to ${langDef.flag} <b>${langDef.label}</b>`);
        },
    },
    // ── /reset ────────────────────────────────────────────────────────────────
    {
        command: 'reset',
        description: 'Reset soul/personality to default (will re-run onboarding)',
        async handler(ctx, runtime) {
            const from = ctx.from;
            if (!from)
                return;
            runtime.soulManager.deleteSoul(from.id);
            runtime.soulManager.cancelOnboarding(from.id);
            // Clear session system prompt too
            const session = runtime.sessions.get(from.id, ctx.chat.id);
            if (session) {
                session.systemPrompt = undefined;
                runtime.sessions.clearConversation(session);
                runtime.sessions.save(session);
            }
            await reply(ctx, `🔄 Soul reset! Send any message and I'll run setup again.`);
        },
    },
    // ── /search ───────────────────────────────────────────────────────────────
    {
        command: 'search',
        description: 'Search the web: /search <query>',
        async handler(ctx, runtime, args) {
            if (args.length === 0) {
                await reply(ctx, `<b>🔍 Web Search</b>\n\nUsage: <code>/search your query here</code>\n\nExample: <code>/search nodejs express tutorial</code>`);
                return;
            }
            const query = args.join(' ');
            await ctx.replyWithChatAction('typing').catch(() => { });
            const result = await (0, web_tools_1.executeWebSearch)(query);
            const text = result.content.slice(0, 4000);
            await reply(ctx, (0, formatter_1.escapeHtml)(text).replace(/\*\*(.*?)\*\*/g, '<b>$1</b>'));
        },
    },
    // ── /fetch ────────────────────────────────────────────────────────────────
    {
        command: 'fetch',
        description: 'Fetch URL content: /fetch <url>',
        async handler(ctx, runtime, args) {
            if (args.length === 0) {
                await reply(ctx, `<b>🌐 Web Fetch</b>\n\nUsage: <code>/fetch https://example.com</code>`);
                return;
            }
            const url = args[0];
            await ctx.replyWithChatAction('typing').catch(() => { });
            const result = await (0, web_tools_1.executeWebFetch)(url, 4000);
            if (result.isError) {
                await reply(ctx, `❌ ${(0, formatter_1.escapeHtml)(result.content)}`);
            }
            else {
                await reply(ctx, `<code>${(0, formatter_1.escapeHtml)(result.content.slice(0, 3800))}</code>`);
            }
        },
    },
    // ── /api ──────────────────────────────────────────────────────────────────
    {
        command: 'api',
        description: 'Make an API call: /api <method> <url>',
        async handler(ctx, runtime, args) {
            if (args.length < 2) {
                await reply(ctx, `<b>🔌 API Call</b>

Usage: <code>/api &lt;method&gt; &lt;url&gt;</code>

Examples:
  <code>/api GET https://api.github.com/users/shadysmetools</code>
  <code>/api GET https://httpbin.org/get</code>

For headers/body, ask the AI to make API calls for you.`);
                return;
            }
            const method = args[0].toUpperCase();
            const url = args[1];
            const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
            if (!validMethods.includes(method)) {
                await reply(ctx, `❌ Invalid method. Use: ${validMethods.join(', ')}`);
                return;
            }
            await ctx.replyWithChatAction('typing').catch(() => { });
            const result = await (0, web_tools_1.executeApiCall)({ url, method: method });
            const text = result.content.slice(0, 3800);
            if (result.isError) {
                await reply(ctx, `❌ ${(0, formatter_1.escapeHtml)(text)}`);
            }
            else {
                await reply(ctx, `<code>${(0, formatter_1.escapeHtml)(text)}</code>`);
            }
        },
    },
    // ── /compact ──────────────────────────────────────────────────────────────
    {
        command: 'compact',
        description: 'Summarize old conversation history to save tokens',
        async handler(ctx, runtime) {
            const from = ctx.from;
            if (!from)
                return;
            const session = runtime.sessions.get(from.id, ctx.chat.id);
            if (!session) {
                await reply(ctx, 'No session data yet. Send a message first!');
                return;
            }
            const before = session.messages.filter(m => m.role !== 'system').length;
            if (before <= 4) {
                await reply(ctx, `Conversation is already short (${before} messages). Nothing to compact.`);
                return;
            }
            // Keep last 4 non-system messages, summarize the rest
            const systemMsgs = session.messages.filter(m => m.role === 'system');
            const nonSystem = session.messages.filter(m => m.role !== 'system');
            const kept = nonSystem.slice(-4);
            const removed = nonSystem.length - kept.length;
            session.messages = [...systemMsgs, ...kept];
            runtime.sessions.save(session);
            await reply(ctx, `✅ Compacted: removed ${removed} old messages, kept last 2 turns. Saves tokens on next request!`);
        },
    },
];
// ─── Command lookup ────────────────────────────────────────────────────────────
function findCommand(name) {
    return exports.COMMANDS.find(c => c.command === name.toLowerCase());
}
/** Returns the list of commands for BotFather registration */
function getCommandList() {
    return exports.COMMANDS
        .filter(c => !c.adminOnly)
        .map(c => ({ command: c.command, description: c.description }));
}
//# sourceMappingURL=commands.js.map