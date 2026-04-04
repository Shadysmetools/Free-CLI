"use strict";
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
exports.createTelegramBot = createTelegramBot;
const grammy_1 = require("grammy");
const fs = __importStar(require("fs"));
const session_1 = require("./session");
const security_1 = require("./security");
const tools_1 = require("./tools");
const scheduler_1 = require("./scheduler");
const soul_1 = require("./soul");
const index_1 = require("../memory/index");
const index_2 = require("../skills/index");
const tokens_1 = require("../tracking/tokens");
const index_3 = require("../providers/index");
const settings_1 = require("../config/settings");
const conversation_1 = require("../agent/conversation");
const core_1 = require("../agent/core");
const formatter_1 = require("./formatter");
const keyboards_1 = require("./keyboards");
const media_1 = require("./media");
const commands_1 = require("./commands");
// ─── Helper: resolve provider for a user session ─────────────────────────────
function resolveProvider(session, config) {
    const settings = (0, settings_1.loadSettings)();
    const providerName = session?.profile.prefs.provider ?? config.provider;
    const modelName = session?.profile.prefs.model ?? config.model;
    if (modelName) {
        settings.providers[providerName] = settings.providers[providerName] ?? {};
        settings.providers[providerName].model = modelName;
    }
    return { provider: (0, index_3.createProvider)(providerName, settings), providerName, modelName };
}
// ─── Helper: build system prompt with persona / soul ─────────────────────────
function buildBotSystemPrompt(session, cwd, memory) {
    // If session has a soul system prompt override, use it (+ memory context)
    if (session?.systemPrompt) {
        const memCtx = memory.getSystemContext();
        return session.systemPrompt + (memCtx ? `\n\n${memCtx}` : '');
    }
    const persona = session?.profile.prefs.persona;
    const customInstructions = session?.profile.prefs.custom_instructions;
    const personaBlock = persona && persona !== 'english'
        ? `\n\nLanguage/Persona: Respond in ${persona} style/language.`
        : '';
    const customBlock = customInstructions
        ? `\n\nCustom instructions from user: ${customInstructions}`
        : '';
    return (0, conversation_1.buildSystemPrompt)({
        cwd,
        projectMemory: undefined,
        memoryContext: memory.getSystemContext(),
        profileContext: '',
        personaContext: personaBlock + customBlock,
    });
}
// ─── Helper: get Telegram file URL ───────────────────────────────────────────
async function getTelegramFileUrl(bot, fileId) {
    const file = await bot.api.getFile(fileId);
    const token = bot.token;
    return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
}
// ─── Main bot factory ─────────────────────────────────────────────────────────
async function createTelegramBot(config) {
    // ── Initialize runtime ────────────────────────────────────────────────────
    const sessions = new session_1.BotSessionManager();
    const security = new security_1.SecurityManager(config);
    const toolBridge = new tools_1.BotToolBridge(config, security);
    const scheduler = new scheduler_1.BotScheduler(config.scheduler);
    const memory = new index_1.MemoryManager(process.cwd());
    const skills = new index_2.SkillsManager(process.cwd());
    const soulManager = new soul_1.SoulManager();
    skills.loadAll();
    const runtime = {
        config, sessions, security, toolBridge, scheduler, memory, skills, soulManager,
    };
    // ── Create bot ─────────────────────────────────────────────────────────────
    const bot = new grammy_1.Bot(config.telegram.token);
    // ── Register Telegram command menu ────────────────────────────────────────
    await bot.api.setMyCommands((0, commands_1.getCommandList)()).catch(() => {
        console.warn('⚠ setMyCommands failed (DNS/network issue?)');
    });
    // ─────────────────────────────────────────────────────────────────────────
    // MIDDLEWARE
    // ─────────────────────────────────────────────────────────────────────────
    // ── Access control middleware ─────────────────────────────────────────────
    bot.use(async (ctx, next) => {
        const from = ctx.from;
        const chat = ctx.chat;
        if (!from || !chat)
            return; // ignore non-user updates
        // Telegram callback queries use their own access check below
        if (ctx.callbackQuery) {
            return next();
        }
        // Auto-claim: first user becomes admin
        security.autoClaimAdmin(from.id);
        const access = security.checkAccess(from.id, chat.id, chat.type);
        if (!access.allowed) {
            // Only reply in DMs (not groups, to avoid spam)
            if (chat.type === 'private') {
                await ctx.reply(`🔒 ${access.reason ?? 'Access denied.'}`).catch(() => { });
            }
            return; // block
        }
        return next();
    });
    // ─────────────────────────────────────────────────────────────────────────
    // COMMANDS
    // ─────────────────────────────────────────────────────────────────────────
    // Generic text handler for slash commands (catches all /commands not individually registered)
    // We use message:text and check for leading '/' to handle all commands uniformly
    // (grammY's bot.command() requires exact strings; we intercept in message:text below)
    // ─────────────────────────────────────────────────────────────────────────
    // TEXT MESSAGES → AI Agent
    // ─────────────────────────────────────────────────────────────────────────
    bot.on('message:text', async (ctx) => {
        const from = ctx.from;
        const chat = ctx.chat;
        const text = ctx.message.text;
        const { soulManager } = runtime;
        // ── Onboarding intercept (non-command messages only) ──────────────────
        if (!text.startsWith('/')) {
            // If user is mid-onboarding, route to onboarding handler
            if (soulManager.isOnboarding(from.id)) {
                await handleOnboardingInput(ctx, runtime, bot, text);
                return;
            }
            // First-time user with no soul → start onboarding
            if (!soulManager.hasSoul(from.id)) {
                await startOnboarding(ctx, runtime, bot);
                return;
            }
        }
        // ── Slash command routing ─────────────────────────────────────────────
        if (text.startsWith('/')) {
            const parts = text.slice(1).split(/[\s@]+/);
            const commandName = parts[0]?.toLowerCase() ?? '';
            const args = parts.slice(1).filter(Boolean);
            const cmd = (0, commands_1.findCommand)(commandName);
            if (!cmd) {
                await ctx.reply(`❓ Unknown command: /${(0, formatter_1.escapeHtml)(commandName)}\n\nType /help to see all commands.`, {
                    parse_mode: 'HTML',
                }).catch(() => { });
                return;
            }
            if (cmd.adminOnly && !security.isAdmin(from.id)) {
                await ctx.reply('🔒 This command requires admin access.').catch(() => { });
                return;
            }
            try {
                await cmd.handler(ctx, runtime, args);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                await ctx.reply((0, formatter_1.formatError)(`Command failed: ${msg}`), { parse_mode: 'HTML' }).catch(() => { });
            }
            return;
        }
        // Group mention check
        if (chat.type !== 'private' && config.telegram.require_mention) {
            const botInfo = await bot.api.getMe();
            const mentioned = ctx.message.entities?.some(e => {
                if (e.type !== 'mention')
                    return false;
                const mention = text.slice(e.offset, e.offset + e.length);
                return mention === `@${botInfo.username}`;
            }) ||
                ctx.message.reply_to_message?.from?.id === botInfo.id;
            if (!mentioned)
                return; // Ignore non-mentioned group messages
        }
        // Remove @botname from text for clean processing
        const botInfo2 = await bot.api.getMe().catch(() => null);
        let userMessage = text;
        if (botInfo2?.username) {
            userMessage = userMessage.replace(new RegExp(`@${botInfo2.username}`, 'gi'), '').trim();
        }
        if (!userMessage)
            return;
        await processMessage(ctx, runtime, bot, userMessage);
    });
    // ─────────────────────────────────────────────────────────────────────────
    // PHOTO → Vision analysis
    // ─────────────────────────────────────────────────────────────────────────
    bot.on('message:photo', async (ctx) => {
        if (!config.features.images) {
            await ctx.reply('📷 Image analysis is disabled in bot config.').catch(() => { });
            return;
        }
        const from = ctx.from;
        const caption = ctx.message.caption;
        // Get the largest photo size
        const photos = ctx.message.photo;
        const photo = photos[photos.length - 1];
        if (!photo)
            return;
        // Send ack reaction
        await reactToMessage(ctx, bot, config.ui.ack_reaction);
        if (config.ui.typing_indicator) {
            await ctx.replyWithChatAction('typing').catch(() => { });
        }
        try {
            const fileUrl = await getTelegramFileUrl(bot, photo.file_id);
            const localPath = await (0, media_1.downloadFile)(fileUrl, `photo_${photo.file_unique_id}.jpg`);
            const info = {
                type: 'photo',
                fileId: photo.file_id,
                fileSize: photo.file_size,
                width: photo.width,
                height: photo.height,
                caption,
            };
            const prompt = (0, media_1.buildImagePrompt)(caption);
            // Check if provider supports vision — fall back to text description
            const session = runtime.sessions.getOrCreate(from.id, ctx.chat.id, { username: from.username, first_name: from.first_name }, config.provider, config.model);
            // Inject image as base64 in the message context if provider supports it
            const imageData = fs.readFileSync(localPath).toString('base64');
            const imageMessage = `${prompt}\n\n[Image data (base64 JPEG, ${Math.round(photo.file_size ?? 0 / 1024)}KB): data:image/jpeg;base64,${imageData.slice(0, 100)}...]`;
            await processMessage(ctx, runtime, bot, imageMessage, session);
            // Cleanup
            fs.unlinkSync(localPath);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await ctx.reply((0, formatter_1.formatError)(`Image processing failed: ${msg}`), { parse_mode: 'HTML' }).catch(() => { });
        }
    });
    // ─────────────────────────────────────────────────────────────────────────
    // VOICE → Whisper transcription → AI
    // ─────────────────────────────────────────────────────────────────────────
    bot.on('message:voice', async (ctx) => {
        if (!config.features.voice) {
            await ctx.reply('🎤 Voice transcription is disabled.').catch(() => { });
            return;
        }
        const from = ctx.from;
        const voice = ctx.message.voice;
        await reactToMessage(ctx, bot, '🎤');
        if (config.ui.typing_indicator) {
            await ctx.replyWithChatAction('typing').catch(() => { });
        }
        // Send interim "transcribing..." message
        const interimMsg = await ctx.reply('🎤 Transcribing voice message...').catch(() => null);
        try {
            const fileUrl = await getTelegramFileUrl(bot, voice.file_id);
            const localPath = await (0, media_1.downloadFile)(fileUrl, `voice_${voice.file_unique_id}.ogg`);
            const settings = (0, settings_1.loadSettings)();
            const groqKey = settings.providers.groq?.apiKey ?? process.env.GROQ_API_KEY;
            const transcription = await (0, media_1.transcribeAudio)(localPath, groqKey);
            // Update or delete interim message
            if (interimMsg) {
                await bot.api.editMessageText(ctx.chat.id, interimMsg.message_id, `🎤 <i>Transcribed (${transcription.method}):</i>\n<blockquote>${(0, formatter_1.escapeHtml)(transcription.text)}</blockquote>`, { parse_mode: 'HTML' }).catch(() => { });
            }
            if (transcription.method === 'unavailable') {
                await ctx.reply('⚠️ Voice transcription unavailable. Set GROQ_API_KEY for free transcription.').catch(() => { });
                return;
            }
            // Process transcription as AI message
            const userMessage = transcription.text;
            if (config.ui.typing_indicator) {
                await ctx.replyWithChatAction('typing').catch(() => { });
            }
            await processMessage(ctx, runtime, bot, userMessage);
            // Cleanup
            fs.unlinkSync(localPath);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (interimMsg) {
                await bot.api.editMessageText(ctx.chat.id, interimMsg.message_id, (0, formatter_1.formatError)(`Transcription failed: ${msg}`), { parse_mode: 'HTML' }).catch(() => { });
            }
        }
    });
    // ─────────────────────────────────────────────────────────────────────────
    // AUDIO FILES → Transcription
    // ─────────────────────────────────────────────────────────────────────────
    bot.on('message:audio', async (ctx) => {
        if (!config.features.voice) {
            await ctx.reply('🎵 Audio transcription is disabled.').catch(() => { });
            return;
        }
        const from = ctx.from;
        const audio = ctx.message.audio;
        const caption = ctx.message.caption;
        await ctx.replyWithChatAction('typing').catch(() => { });
        try {
            const fileUrl = await getTelegramFileUrl(bot, audio.file_id);
            const ext = audio.mime_type?.includes('ogg') ? 'ogg' : 'mp3';
            const localPath = await (0, media_1.downloadFile)(fileUrl, `audio_${audio.file_unique_id}.${ext}`);
            const settings = (0, settings_1.loadSettings)();
            const groqKey = settings.providers.groq?.apiKey ?? process.env.GROQ_API_KEY;
            const transcription = await (0, media_1.transcribeAudio)(localPath, groqKey);
            const prompt = (0, media_1.buildMediaContext)({ type: 'audio', fileId: audio.file_id, mimeType: audio.mime_type, duration: audio.duration, caption }, { transcription: transcription.text });
            await processMessage(ctx, runtime, bot, prompt);
            fs.unlinkSync(localPath);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await ctx.reply((0, formatter_1.formatError)(`Audio processing failed: ${msg}`), { parse_mode: 'HTML' }).catch(() => { });
        }
    });
    // ─────────────────────────────────────────────────────────────────────────
    // DOCUMENTS → Read text files, describe others
    // ─────────────────────────────────────────────────────────────────────────
    bot.on('message:document', async (ctx) => {
        if (!config.features.files) {
            await ctx.reply('📄 File handling is disabled.').catch(() => { });
            return;
        }
        const from = ctx.from;
        const doc = ctx.message.document;
        const caption = ctx.message.caption;
        if (config.ui.typing_indicator) {
            await ctx.replyWithChatAction('upload_document').catch(() => { });
        }
        try {
            const info = {
                type: 'document',
                fileId: doc.file_id,
                fileSize: doc.file_size,
                mimeType: doc.mime_type,
                fileName: doc.file_name,
                caption,
            };
            let content;
            // For text files: download and read content
            if (doc.file_name && (0, media_1.isTextDocument)(doc.file_name, doc.mime_type)) {
                const fileUrl = await getTelegramFileUrl(bot, doc.file_id);
                const localPath = await (0, media_1.downloadFile)(fileUrl, doc.file_name ?? `doc_${doc.file_unique_id}`);
                content = (0, media_1.readDocumentContent)(localPath, config.security.max_output);
                fs.unlinkSync(localPath);
            }
            const prompt = (0, media_1.buildDocumentContext)(info, content);
            await processMessage(ctx, runtime, bot, prompt);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await ctx.reply((0, formatter_1.formatError)(`Document handling failed: ${msg}`), { parse_mode: 'HTML' }).catch(() => { });
        }
    });
    // ─────────────────────────────────────────────────────────────────────────
    // INLINE KEYBOARD CALLBACKS
    // ─────────────────────────────────────────────────────────────────────────
    bot.on('callback_query:data', async (ctx) => {
        const from = ctx.from;
        const data = ctx.callbackQuery.data;
        // Access check for callbacks
        const chat = ctx.chat;
        if (chat) {
            const access = security.checkAccess(from.id, chat.id, chat.type);
            if (!access.allowed) {
                await ctx.answerCallbackQuery({ text: '🔒 Access denied' }).catch(() => { });
                return;
            }
        }
        await ctx.answerCallbackQuery().catch(() => { }); // Dismiss loading indicator
        // ── Soul/onboarding callbacks ─────────────────────────────────────────
        if (data.startsWith('soul:role:')) {
            const roleId = data.slice('soul:role:'.length);
            await handleSoulRoleCallback(ctx, runtime, bot, from.id, roleId);
            return;
        }
        if (data.startsWith('soul:lang:')) {
            const langId = data.slice('soul:lang:'.length);
            await handleSoulLangCallback(ctx, runtime, bot, from.id, langId);
            return;
        }
        // Route callbacks
        if (data.startsWith('model:set:')) {
            const spec = data.slice('model:set:'.length);
            const session = runtime.sessions.get(from.id, ctx.chat?.id ?? from.id);
            if (session) {
                const colonIdx = spec.indexOf(':');
                session.profile.prefs.provider = colonIdx >= 0 ? spec.slice(0, colonIdx) : spec;
                session.profile.prefs.model = colonIdx >= 0 ? spec.slice(colonIdx + 1) : '';
                runtime.sessions.save(session);
            }
            await ctx.editMessageText(`✅ Switched to <code>${(0, formatter_1.escapeHtml)(spec)}</code>`, { parse_mode: 'HTML' }).catch(() => { });
        }
        else if (data.startsWith('persona:set:')) {
            const persona = data.slice('persona:set:'.length);
            const session = runtime.sessions.get(from.id, ctx.chat?.id ?? from.id);
            if (session) {
                session.profile.prefs.persona = persona;
                runtime.sessions.save(session);
            }
            await ctx.editMessageText(`✅ Persona set to <code>${(0, formatter_1.escapeHtml)(persona)}</code>`, { parse_mode: 'HTML' }).catch(() => { });
        }
        else if (data === 'session:clear') {
            const session = runtime.sessions.get(from.id, ctx.chat?.id ?? from.id);
            if (session) {
                runtime.sessions.clearConversation(session);
                runtime.sessions.save(session);
            }
            await ctx.editMessageText('🗑 Conversation cleared.').catch(() => { });
        }
        else if (data === 'session:stats') {
            const session = runtime.sessions.get(from.id, ctx.chat?.id ?? from.id);
            if (session) {
                const tu = session.tokenUsage;
                await ctx.editMessageText(`📊 <b>Stats</b>\nMessages: ${session.profile.message_count}\nTokens: ${tu.total}`, { parse_mode: 'HTML' }).catch(() => { });
            }
        }
        else if (data.startsWith('help:')) {
            const section = data.slice('help:'.length);
            await handleHelpSection(ctx, runtime, section);
        }
        else if (data.startsWith('confirm:')) {
            const choice = data.slice('confirm:'.length);
            // Pass callback as agent input
            await processMessage(ctx, runtime, bot, `User confirmed: ${choice}`);
        }
        else if (data === 'noop') {
            // Pagination label — do nothing
        }
        else if (data.startsWith('admin:')) {
            if (!security.isAdmin(from.id)) {
                await ctx.answerCallbackQuery({ text: '🔒 Admin only' }).catch(() => { });
                return;
            }
            await handleAdminCallback(ctx, runtime, data.slice('admin:'.length));
        }
        else {
            // Pass all other callbacks to the agent as natural text
            await processMessage(ctx, runtime, bot, `callback_data: ${data}`);
        }
    });
    // ─────────────────────────────────────────────────────────────────────────
    // REACTIONS (acknowledgement)
    // ─────────────────────────────────────────────────────────────────────────
    // Note: grammY handles message_reaction via bot.on('message_reaction')
    // For now we log it; full reaction routing would require allowed_updates config
    // ─────────────────────────────────────────────────────────────────────────
    // SCHEDULER → deliver job triggers to users
    // ─────────────────────────────────────────────────────────────────────────
    scheduler.on('job', async (event) => {
        const { job } = event;
        try {
            // Run the job message through the AI
            const from = { id: job.userId };
            const chatId = job.chatId;
            // Create a minimal context for processing
            await bot.api.sendChatAction(chatId, 'typing').catch(() => { });
            const session = runtime.sessions.get(job.userId, chatId);
            const settings = (0, settings_1.loadSettings)();
            const providerName = session?.profile.prefs.provider ?? config.provider;
            const modelName = session?.profile.prefs.model ?? config.model;
            if (modelName) {
                settings.providers[providerName] = settings.providers[providerName] ?? {};
                settings.providers[providerName].model = modelName;
            }
            const provider = (0, index_3.createProvider)(providerName, settings);
            const systemPrompt = buildBotSystemPrompt(session, process.cwd(), memory);
            const conv = session
                ? runtime.sessions.buildConversation(session, systemPrompt)
                : (0, conversation_1.createConversation)(systemPrompt);
            const tokenTracker = new tokens_1.TokenTracker();
            const result = await (0, core_1.runAgent)(provider, conv, job.message, {
                cwd: session?.cwd ?? process.cwd(),
                stream: false,
                registry: toolBridge.registry,
                memory, skills, tokenTracker,
            });
            if (session) {
                runtime.sessions.syncConversation(session, conv);
                runtime.sessions.save(session);
            }
            const responseText = result.content;
            if (!responseText)
                return;
            const prefix = `⏰ <b>Reminder: ${(0, formatter_1.escapeHtml)(job.name)}</b>\n\n`;
            const formatted = prefix + (0, formatter_1.formatForTelegram)(responseText);
            const chunks = (0, formatter_1.splitMessage)(formatted, config.ui.chunk_size);
            for (const chunk of chunks) {
                await bot.api.sendMessage(chatId, chunk, {
                    parse_mode: 'HTML',
                    link_preview_options: { is_disabled: !config.ui.link_previews },
                }).catch(() => { });
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await bot.api.sendMessage(job.chatId, `⏰ <b>Reminder: ${(0, formatter_1.escapeHtml)(job.name)}</b>\n\n${(0, formatter_1.escapeHtml)(job.message)}`, { parse_mode: 'HTML' }).catch(() => { });
            console.error('Scheduler job error:', msg);
        }
    });
    scheduler.start();
    // Periodic temp file cleanup
    setInterval(media_1.cleanupTempFiles, 3600 * 1000);
    // ─────────────────────────────────────────────────────────────────────────
    // ERROR HANDLER
    // ─────────────────────────────────────────────────────────────────────────
    bot.catch((err) => {
        const ctx = err.ctx;
        console.error(`[Bot Error] Update ${ctx.update.update_id}: ${err.error}`);
    });
    // ─────────────────────────────────────────────────────────────────────────
    // START / STOP
    // ─────────────────────────────────────────────────────────────────────────
    async function start() {
        if (config.telegram.webhook_url) {
            // Webhook mode
            const webhookPath = '/telegram-webhook';
            const webhookPort = config.telegram.webhook_port ?? 8787;
            const webhookSecret = config.telegram.webhook_secret;
            await bot.api.setWebhook(config.telegram.webhook_url, {
                secret_token: webhookSecret,
            });
            // Use grammY's built-in webhook handling
            const { webhookCallback } = await Promise.resolve().then(() => __importStar(require('grammy')));
            // Create a simple HTTP server
            const http = await Promise.resolve().then(() => __importStar(require('http')));
            const handler = webhookCallback(bot, 'http');
            const server = http.createServer(async (req, res) => {
                if (req.url === webhookPath) {
                    await handler(req, res);
                }
                else {
                    res.writeHead(404);
                    res.end();
                }
            });
            server.listen(webhookPort, '127.0.0.1', () => {
                console.log(`🌐 Webhook server listening on port ${webhookPort}`);
            });
        }
        else {
            // Long polling (default, matches OpenClaw)
            await bot.start({
                onStart: (info) => {
                    console.log(`✅ Bot @${info.username} started (long polling)`);
                },
            });
        }
    }
    async function stop() {
        scheduler.stop();
        await bot.stop();
    }
    return { bot, runtime, start, stop };
}
// ─── Core message processor ───────────────────────────────────────────────────
/**
 * Process a user message through the AI agent and send response.
 * Supports streaming via message edits (OpenClaw-style live preview).
 */
async function processMessage(ctx, runtime, bot, userMessage, existingSession) {
    const from = ctx.from;
    const chat = ctx.chat;
    const { config, sessions, memory, skills, toolBridge, security } = runtime;
    // ── Session ──────────────────────────────────────────────────────────────
    const session = existingSession ?? sessions.getOrCreate(from.id, chat.id, { username: from.username, first_name: from.first_name, last_name: from.last_name }, config.provider, config.model);
    const cwd = session.cwd;
    // ── ACK reaction while processing ────────────────────────────────────────
    if (config.ui.ack_reaction && ctx.message) {
        await reactToMessage(ctx, bot, config.ui.ack_reaction);
    }
    // ── Typing indicator ──────────────────────────────────────────────────────
    if (config.ui.typing_indicator) {
        await ctx.replyWithChatAction('typing').catch(() => { });
    }
    // ── Build provider and conversation ──────────────────────────────────────
    const { provider } = resolveProvider(session, config);
    const systemPrompt = buildBotSystemPrompt(session, cwd, memory);
    const conv = sessions.buildConversation(session, systemPrompt);
    const tokenTracker = new tokens_1.TokenTracker();
    // ── Streaming setup ───────────────────────────────────────────────────────
    let streamingMsgId = null;
    let streamedContent = '';
    let lastEditAt = 0;
    const STREAM_EDIT_INTERVAL_MS = 1200; // Edit every 1.2s (Telegram rate limit: 20/min per chat)
    const sendOrEdit = async (text, isFinal) => {
        if (!text.trim())
            return;
        const chunks = (0, formatter_1.splitMessage)(text, config.ui.chunk_size);
        const firstChunk = chunks[0];
        if (!firstChunk)
            return;
        if (streamingMsgId === null) {
            // Send initial message
            try {
                const msg = await bot.api.sendMessage(chat.id, firstChunk, {
                    parse_mode: 'HTML',
                    link_preview_options: { is_disabled: !config.ui.link_previews },
                    reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined,
                });
                streamingMsgId = msg.message_id;
            }
            catch {
                // Fallback: plain text
                try {
                    const msg = await bot.api.sendMessage(chat.id, firstChunk.replace(/<[^>]+>/g, ''));
                    streamingMsgId = msg.message_id;
                }
                catch { /* give up on this message */ }
            }
        }
        else if (!isFinal) {
            // Edit existing message (streaming preview)
            const now = Date.now();
            if (now - lastEditAt < STREAM_EDIT_INTERVAL_MS)
                return;
            lastEditAt = now;
            const preview = firstChunk + (chunks.length > 1 ? '\n\n<i>...</i>' : '');
            await bot.api.editMessageText(chat.id, streamingMsgId, preview, {
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true },
            }).catch(() => { }); // Ignore "message not modified" errors
        }
        else {
            // Final edit — send all chunks
            try {
                await bot.api.editMessageText(chat.id, streamingMsgId, firstChunk, {
                    parse_mode: 'HTML',
                    link_preview_options: { is_disabled: !config.ui.link_previews },
                }).catch(() => { });
            }
            catch { /* ignore */ }
            // Send additional chunks if message was split
            for (let i = 1; i < chunks.length; i++) {
                await bot.api.sendMessage(chat.id, chunks[i], {
                    parse_mode: 'HTML',
                    link_preview_options: { is_disabled: !config.ui.link_previews },
                }).catch(() => { });
            }
        }
    };
    // ── Run agent ─────────────────────────────────────────────────────────────
    try {
        const onToken = config.features.streaming
            ? async (token) => {
                streamedContent += token;
                const formatted = (0, formatter_1.formatForTelegram)(streamedContent);
                await sendOrEdit(formatted, false);
            }
            : undefined;
        const result = await (0, core_1.runAgent)(provider, conv, userMessage, {
            cwd,
            stream: config.features.streaming,
            onToken,
            registry: toolBridge.registry,
            memory,
            skills,
            tokenTracker,
        });
        // ── Final response ────────────────────────────────────────────────────
        const finalContent = result.content || streamedContent;
        if (finalContent) {
            const formatted = (0, formatter_1.formatForTelegram)(finalContent);
            await sendOrEdit(formatted, true);
        }
        else if (streamingMsgId === null) {
            await ctx.reply('(no response)').catch(() => { });
        }
        // ── Update session ────────────────────────────────────────────────────
        sessions.syncConversation(session, conv);
        if (result.usage) {
            sessions.addUsage(session, result.usage.prompt_tokens, result.usage.completion_tokens);
        }
        sessions.save(session);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[processMessage] Error:', msg);
        const errorText = (0, formatter_1.formatError)(msg);
        try {
            if (streamingMsgId) {
                await bot.api.editMessageText(chat.id, streamingMsgId, errorText, { parse_mode: 'HTML' }).catch(() => { });
            }
            else {
                await ctx.reply(errorText, { parse_mode: 'HTML' }).catch(() => { });
            }
        }
        catch { /* silently ignore */ }
    }
}
// ─── Reactions ────────────────────────────────────────────────────────────────
async function reactToMessage(ctx, bot, emoji) {
    if (!ctx.message || !ctx.chat)
        return;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await bot.api.raw.setMessageReaction({
            chat_id: ctx.chat.id,
            message_id: ctx.message.message_id,
            reaction: [{ type: 'emoji', emoji }],
        });
    }
    catch { /* Reactions may not be supported in all contexts */ }
}
// ─── Onboarding flow ─────────────────────────────────────────────────────────
/**
 * Start the first-time onboarding flow.
 * Asks: name → role (keyboard) → language (keyboard) → bot name
 */
async function startOnboarding(ctx, runtime, bot) {
    const from = ctx.from;
    const chat = ctx.chat;
    const { soulManager } = runtime;
    soulManager.startOnboarding(from.id);
    const firstName = from.first_name ?? 'there';
    await bot.api.sendMessage(chat.id, `👋 <b>Hey ${(0, formatter_1.escapeHtml)(firstName)}! I'm your new AI assistant.</b>\n\nLet's set me up real quick — just 3 questions!\n\n<b>First: What should I call you?</b>\n<i>(Just type your name or nickname)</i>`, { parse_mode: 'HTML' }).catch(() => { });
}
/**
 * Handle text input during onboarding steps.
 */
async function handleOnboardingInput(ctx, runtime, bot, text) {
    const from = ctx.from;
    const chat = ctx.chat;
    const { soulManager } = runtime;
    const state = soulManager.getOnboardingState(from.id);
    if (!state)
        return;
    switch (state.step) {
        case 'ask_name': {
            const userName = text.trim().slice(0, 40) || from.first_name || 'friend';
            soulManager.advanceOnboarding(from.id, { userName }, 'ask_role');
            await bot.api.sendMessage(chat.id, `Nice to meet you, <b>${(0, formatter_1.escapeHtml)(userName)}</b>! 🎉\n\n<b>What should I be?</b> Pick my role:`, { parse_mode: 'HTML', reply_markup: (0, keyboards_1.roleKeyboard)() }).catch(() => { });
            break;
        }
        case 'ask_role': {
            // User typed a role instead of using the keyboard
            const roleInput = text.trim().toLowerCase();
            const resolved = (0, soul_1.resolveSoulRole)(roleInput);
            if (!resolved) {
                await bot.api.sendMessage(chat.id, `Please pick a role from the buttons below, or type one of:\ncoding, research, general, devops, data, creative`, { parse_mode: 'HTML', reply_markup: (0, keyboards_1.roleKeyboard)() }).catch(() => { });
                return;
            }
            await handleSoulRoleCallback(ctx, runtime, bot, from.id, resolved);
            break;
        }
        case 'ask_language': {
            // User typed a language
            const langInput = text.trim().toLowerCase();
            const resolved = (0, soul_1.resolveSoulLanguage)(langInput);
            if (!resolved) {
                await bot.api.sendMessage(chat.id, `Please pick a language from the buttons, or type: english, egyptian, franco, arabic, french, spanish, german, turkish, auto`, { parse_mode: 'HTML', reply_markup: (0, keyboards_1.languageKeyboard)() }).catch(() => { });
                return;
            }
            await handleSoulLangCallback(ctx, runtime, bot, from.id, resolved);
            break;
        }
        case 'ask_bot_name': {
            const botName = text.trim().slice(0, 50) || 'coderaw';
            await finishOnboarding(ctx, runtime, bot, from.id, chat.id, botName);
            break;
        }
        default:
            break;
    }
}
/**
 * Handle role selection callback (soul:role:*)
 */
async function handleSoulRoleCallback(ctx, runtime, bot, userId, roleId) {
    const chat = ctx.chat;
    const { soulManager } = runtime;
    const roleDef = soul_1.ROLE_DEFS[roleId] ?? soul_1.ROLE_DEFS.general;
    // If not onboarding, this is a role change
    if (!soulManager.isOnboarding(userId)) {
        const updated = soulManager.updateSoul(userId, {
            role: roleId,
            capabilities: roleDef.capabilities,
        });
        if (!updated)
            return;
        const session = runtime.sessions.get(userId, chat.id);
        if (session) {
            session.systemPrompt = updated.systemPrompt;
            runtime.sessions.save(session);
        }
        await ctx.editMessageText(`✅ Role changed to ${roleDef.emoji} <b>${(0, formatter_1.escapeHtml)(roleDef.label)}</b>\n\n<i>${(0, formatter_1.escapeHtml)(roleDef.shortDesc)}</i>`, { parse_mode: 'HTML' }).catch(() => { });
        return;
    }
    // During onboarding: advance to ask_language
    soulManager.advanceOnboarding(userId, { role: roleId }, 'ask_language');
    // Edit the role selection message to show what was chosen
    await ctx.editMessageText(`${roleDef.emoji} <b>${(0, formatter_1.escapeHtml)(roleDef.label)}</b> — got it!\n\n<i>${(0, formatter_1.escapeHtml)(roleDef.shortDesc)}</i>`, { parse_mode: 'HTML' }).catch(() => { });
    // Send language question
    await bot.api.sendMessage(chat.id, `<b>What language should I speak?</b>`, { parse_mode: 'HTML', reply_markup: (0, keyboards_1.languageKeyboard)() }).catch(() => { });
}
/**
 * Handle language selection callback (soul:lang:*)
 */
async function handleSoulLangCallback(ctx, runtime, bot, userId, langId) {
    const chat = ctx.chat;
    const { soulManager } = runtime;
    const langDef = soul_1.LANGUAGE_DEFS[langId] ?? soul_1.LANGUAGE_DEFS.english;
    // If not onboarding, this is a language change
    if (!soulManager.isOnboarding(userId)) {
        const updated = soulManager.updateSoul(userId, { language: langId });
        if (!updated)
            return;
        const session = runtime.sessions.get(userId, chat.id);
        if (session) {
            session.systemPrompt = updated.systemPrompt;
            runtime.sessions.save(session);
        }
        await ctx.editMessageText(`✅ Language changed to ${langDef.flag} <b>${(0, formatter_1.escapeHtml)(langDef.label)}</b>`, { parse_mode: 'HTML' }).catch(() => { });
        return;
    }
    // During onboarding: advance to ask_bot_name
    soulManager.advanceOnboarding(userId, { language: langId }, 'ask_bot_name');
    // Edit language message
    await ctx.editMessageText(`${langDef.flag} <b>${(0, formatter_1.escapeHtml)(langDef.label)}</b> — perfect!`, { parse_mode: 'HTML' }).catch(() => { });
    // Ask for bot name
    const state = soulManager.getOnboardingState(userId);
    const roleDef = soul_1.ROLE_DEFS[state?.data.role ?? 'general'];
    await bot.api.sendMessage(chat.id, `Almost done! 🎯\n\n<b>What should I call myself?</b>\n\nI'll be your <i>${(0, formatter_1.escapeHtml)(roleDef.label)}</i> in ${langDef.flag} ${(0, formatter_1.escapeHtml)(langDef.label)}.\n\nGive me a name or just send <code>skip</code> and I'll go by <b>coderaw</b>.`, { parse_mode: 'HTML' }).catch(() => { });
}
/**
 * Complete onboarding, save soul, send welcome message.
 */
async function finishOnboarding(ctx, runtime, bot, userId, chatId, botNameInput) {
    const { soulManager, sessions, config } = runtime;
    const botName = botNameInput.toLowerCase() === 'skip' ? 'coderaw' : botNameInput;
    // Advance state with bot name then complete
    soulManager.advanceOnboarding(userId, { botName }, 'done');
    const soul = soulManager.completeOnboarding(userId);
    if (!soul) {
        await bot.api.sendMessage(chatId, '❌ Setup failed. Please try /start again.', {}).catch(() => { });
        return;
    }
    // Create/update session with soul system prompt
    const from = ctx.from;
    const session = sessions.getOrCreate(userId, chatId, { username: from.username, first_name: from.first_name }, config.provider, config.model);
    session.systemPrompt = soul.systemPrompt;
    sessions.save(session);
    const roleDef = soul_1.ROLE_DEFS[soul.role];
    const langDef = soul_1.LANGUAGE_DEFS[soul.language];
    const capLines = soul.capabilities.slice(0, 4).join('\n');
    await bot.api.sendMessage(chatId, `🎉 <b>Setup complete!</b>

I'm <b>${(0, formatter_1.escapeHtml)(soul.botName)}</b>, your ${(0, formatter_1.escapeHtml)(roleDef.emoji)} ${(0, formatter_1.escapeHtml)(roleDef.label)}.
Speaking: ${langDef.flag} ${(0, formatter_1.escapeHtml)(langDef.label)}

<b>Here's what I can do:</b>
${(0, formatter_1.escapeHtml)(capLines)}

<b>Ask me anything!</b> Type /help for commands.`, { parse_mode: 'HTML' }).catch(() => { });
}
// ─── Help sections ────────────────────────────────────────────────────────────
async function handleHelpSection(ctx, runtime, section) {
    let text = '';
    switch (section) {
        case 'tools':
            text = `<b>🔧 Available Tools</b>\n\n${runtime.toolBridge.getToolDescriptions()}`;
            break;
        case 'models':
            text = '<b>🤖 Models</b>\n\nUse /models to see full list\n\nQuick switch: /model provider:model-name';
            break;
        case 'personas':
            text = `<b>🎭 Personas</b>

Available language modes:
  • english — Default English
  • egyptian — Egyptian Arabic (عامية)
  • arabic — Modern Standard Arabic
  • franco — Franco-Arabic (Latin)
  • french — French
  • german — German

Use: /persona &lt;name&gt; or /lang &lt;name&gt;`;
            break;
        case 'scheduler':
            text = `<b>⏰ Scheduler</b>

<code>/remind in 10m Check the build</code>
<code>/remind in 2h Team meeting</code>
<code>/remind tomorrow at 9am Daily standup</code>

<code>/cron list</code> — List all jobs
<code>/cron delete &lt;id&gt;</code> — Delete a job`;
            break;
        case 'security':
            text = `<b>🔒 Security</b>

Sandbox: ${runtime.config.security.sandbox ? '✅ Enabled' : '❌ Disabled'}
Rate limit: ${runtime.config.security.rate_limit_per_minute}/min
Blocked: ${runtime.config.security.blocked_commands.length} commands`;
            break;
        case 'stats':
            text = 'Use /stats to see your session statistics.';
            break;
        default:
            text = 'Use /help for the command list.';
    }
    await ctx.editMessageText(text, { parse_mode: 'HTML' }).catch(() => {
        ctx.reply(text, { parse_mode: 'HTML' }).catch(() => { });
    });
}
// ─── Admin callbacks ──────────────────────────────────────────────────────────
async function handleAdminCallback(ctx, runtime, action) {
    switch (action) {
        case 'sessions': {
            const sessions = runtime.sessions.listSessions().slice(0, 10);
            const lines = sessions.map(s => `• <b>${(0, formatter_1.escapeHtml)(s.profile.first_name ?? String(s.userId))}</b> — ${s.profile.message_count} msgs`);
            await ctx.editMessageText(`<b>👥 Sessions (${sessions.length})</b>\n\n${lines.join('\n') || 'none'}`, { parse_mode: 'HTML' }).catch(() => { });
            break;
        }
        case 'tools': {
            const tools = runtime.toolBridge.listEnabledTools();
            await ctx.editMessageText(`<b>🔧 Enabled Tools</b>\n\n${tools.map(t => `• <code>${t}</code>`).join('\n')}`, { parse_mode: 'HTML' }).catch(() => { });
            break;
        }
        case 'jobs': {
            const jobs = runtime.scheduler.getAllJobs().filter(j => j.enabled);
            const lines = jobs.slice(0, 10).map(j => `• <code>${j.id.slice(0, 8)}</code> ${(0, formatter_1.escapeHtml)(j.name)}`);
            await ctx.editMessageText(`<b>⏰ Active Jobs (${jobs.length})</b>\n\n${lines.join('\n') || 'none'}`, { parse_mode: 'HTML' }).catch(() => { });
            break;
        }
        default:
            await ctx.editMessageText(`Admin action: ${(0, formatter_1.escapeHtml)(action)} (not yet implemented)`, { parse_mode: 'HTML' }).catch(() => { });
    }
}
//# sourceMappingURL=telegram.js.map