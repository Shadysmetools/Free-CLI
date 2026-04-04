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

import { Bot, Context, InputFile } from 'grammy';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { BotConfig } from './config';
import { BotSessionManager } from './session';
import { SecurityManager } from './security';
import { BotToolBridge } from './tools';
import { BotScheduler, JobTriggerEvent } from './scheduler';
import {
  SoulManager, ROLE_DEFS, LANGUAGE_DEFS, SoulLanguage, SoulRole,
  resolveSoulLanguage, resolveSoulRole,
} from './soul';
import { MemoryManager } from '../memory/index';
import { SkillsManager } from '../skills/index';
import { TokenTracker } from '../tracking/tokens';
import { createProvider, PROVIDER_INFO } from '../providers/index';
import { loadSettings } from '../config/settings';
import { createConversation, buildSystemPrompt } from '../agent/conversation';
import { runAgent } from '../agent/core';
import {
  formatForTelegram, splitMessage, formatToolCall,
  formatError, escapeHtml, truncateOutput,
} from './formatter';
import {
  confirmKeyboard, modelKeyboard, personaKeyboard,
  roleKeyboard, languageKeyboard,
} from './keyboards';
import {
  downloadFile, transcribeAudio, buildMediaContext, buildImagePrompt,
  isTextDocument, readDocumentContent, buildDocumentContext, cleanupTempFiles,
  MediaInfo,
} from './media';
import { findCommand, getCommandList } from './commands';
import { parseNaturalDate } from './scheduler';

// ─── Bot context augmentation ─────────────────────────────────────────────────

export type BotContext = Context;

// ─── Runtime — shared state passed to all handlers ────────────────────────────

export interface BotRuntime {
  config: BotConfig;
  sessions: BotSessionManager;
  security: SecurityManager;
  toolBridge: BotToolBridge;
  scheduler: BotScheduler;
  memory: MemoryManager;
  skills: SkillsManager;
  soulManager: SoulManager;
}

// ─── Helper: resolve provider for a user session ─────────────────────────────

function resolveProvider(session: ReturnType<BotSessionManager['get']>, config: BotConfig) {
  const settings = loadSettings();
  const providerName = session?.profile.prefs.provider ?? config.provider;
  const modelName = session?.profile.prefs.model ?? config.model;

  if (modelName) {
    settings.providers[providerName] = settings.providers[providerName] ?? {};
    settings.providers[providerName].model = modelName;
  }

  return { provider: createProvider(providerName, settings), providerName, modelName };
}

// ─── Helper: build system prompt with persona / soul ─────────────────────────

function buildBotSystemPrompt(
  session: ReturnType<BotSessionManager['get']>,
  cwd: string,
  memory: MemoryManager,
): string {
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

  const capabilitiesBlock = `

BOT CAPABILITIES (what you can do in this Telegram bot):
- 🎤 Voice/Audio Transcription: Users can send voice messages or audio files — they are auto-transcribed via Whisper/Groq and sent to you as text.
- 📄 Document Analysis: Users can send text files, code, PDFs — content is extracted and sent to you.
- 🖼️ Image Analysis: Users can send photos — you can analyze them if the model supports vision.
- 🔍 Web Search: /search command for DuckDuckGo search.
- 🌐 URL Fetch: /fetch command to read web pages.
- 💻 Code Execution: You have shell, file read/write, git tools available.
- 📊 PDF/Excel Generation: You can generate documents.
- ⏰ Reminders: /remind command for scheduling.
- 🔑 API Keys: Users can add keys with /setkey <provider> <key>.
- 🤖 Model Switching: /model to change AI model.

IMPORTANT: You DO support voice transcription. When a user asks about voice/audio, tell them to just send a voice message or audio file directly in the chat.`;

  return buildSystemPrompt({
    cwd,
    projectMemory: undefined,
    memoryContext: memory.getSystemContext(),
    profileContext: '',
    personaContext: personaBlock + customBlock + capabilitiesBlock,
  });
}

// ─── Helper: get Telegram file URL ───────────────────────────────────────────

async function getTelegramFileUrl(bot: Bot, fileId: string): Promise<string> {
  const file = await bot.api.getFile(fileId);
  const token = (bot as unknown as { token: string }).token;
  return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
}

// ─── Main bot factory ─────────────────────────────────────────────────────────

export async function createTelegramBot(config: BotConfig): Promise<{
  bot: Bot;
  runtime: BotRuntime;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}> {
  // ── Initialize runtime ────────────────────────────────────────────────────
  const sessions = new BotSessionManager();
  const security = new SecurityManager(config);
  const toolBridge = new BotToolBridge(config, security);
  const scheduler = new BotScheduler(config.scheduler);
  const memory = new MemoryManager(process.cwd());
  const skills = new SkillsManager(process.cwd());
  const soulManager = new SoulManager();
  skills.loadAll();

  const runtime: BotRuntime = {
    config, sessions, security, toolBridge, scheduler, memory, skills, soulManager,
  };

  // ── Create bot ─────────────────────────────────────────────────────────────
  const bot = new Bot(config.telegram.token);

  // ── Register Telegram command menu ────────────────────────────────────────
  await bot.api.setMyCommands(getCommandList()).catch(() => {
    console.warn('⚠ setMyCommands failed (DNS/network issue?)');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MIDDLEWARE
  // ─────────────────────────────────────────────────────────────────────────

  // ── Access control middleware ─────────────────────────────────────────────
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    const chat = ctx.chat;
    if (!from || !chat) return; // ignore non-user updates

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
        await ctx.reply(`🔒 ${access.reason ?? 'Access denied.'}`).catch(() => {});
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
    const from = ctx.from!;
    const chat = ctx.chat!;
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

      const cmd = findCommand(commandName);
      if (!cmd) {
        await ctx.reply(`❓ Unknown command: /${escapeHtml(commandName)}\n\nType /help to see all commands.`, {
          parse_mode: 'HTML',
        }).catch(() => {});
        return;
      }

      if (cmd.adminOnly && !security.isAdmin(from.id)) {
        await ctx.reply('🔒 This command requires admin access.').catch(() => {});
        return;
      }

      try {
        await cmd.handler(ctx, runtime, args);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.reply(formatError(`Command failed: ${msg}`), { parse_mode: 'HTML' }).catch(() => {});
      }
      return;
    }

    // Group mention check
    if (chat.type !== 'private' && config.telegram.require_mention) {
      const botInfo = await bot.api.getMe();
      const mentioned =
        ctx.message.entities?.some(e => {
          if (e.type !== 'mention') return false;
          const mention = text.slice(e.offset, e.offset + e.length);
          return mention === `@${botInfo.username}`;
        }) ||
        ctx.message.reply_to_message?.from?.id === botInfo.id;

      if (!mentioned) return; // Ignore non-mentioned group messages
    }

    // Remove @botname from text for clean processing
    const botInfo2 = await bot.api.getMe().catch(() => null);
    let userMessage = text;
    if (botInfo2?.username) {
      userMessage = userMessage.replace(new RegExp(`@${botInfo2.username}`, 'gi'), '').trim();
    }
    if (!userMessage) return;

    await processMessage(ctx, runtime, bot, userMessage);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PHOTO → Vision analysis
  // ─────────────────────────────────────────────────────────────────────────

  bot.on('message:photo', async (ctx) => {
    if (!config.features.images) {
      await ctx.reply('📷 Image analysis is disabled in bot config.').catch(() => {});
      return;
    }

    const from = ctx.from!;
    const caption = ctx.message.caption;

    // Get the largest photo size
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    if (!photo) return;

    // Send ack reaction
    await reactToMessage(ctx, bot, config.ui.ack_reaction);
    if (config.ui.typing_indicator) {
      await ctx.replyWithChatAction('typing').catch(() => {});
    }

    try {
      const fileUrl = await getTelegramFileUrl(bot, photo.file_id);
      const localPath = await downloadFile(fileUrl, `photo_${photo.file_unique_id}.jpg`);

      const info: MediaInfo = {
        type: 'photo',
        fileId: photo.file_id,
        fileSize: photo.file_size,
        width: photo.width,
        height: photo.height,
        caption,
      };

      const prompt = buildImagePrompt(caption);

      // Check if provider supports vision — fall back to text description
      const session = runtime.sessions.getOrCreate(
        from.id, ctx.chat!.id,
        { username: from.username, first_name: from.first_name },
        config.provider, config.model,
      );

      // Inject image as base64 in the message context if provider supports it
      const imageData = fs.readFileSync(localPath).toString('base64');
      const imageMessage = `${prompt}\n\n[Image data (base64 JPEG, ${Math.round(photo.file_size ?? 0 / 1024)}KB): data:image/jpeg;base64,${imageData.slice(0, 100)}...]`;

      await processMessage(ctx, runtime, bot, imageMessage, session);

      // Cleanup
      fs.unlinkSync(localPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(formatError(`Image processing failed: ${msg}`), { parse_mode: 'HTML' }).catch(() => {});
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // VOICE → Whisper transcription → AI
  // ─────────────────────────────────────────────────────────────────────────

  bot.on('message:voice', async (ctx) => {
    if (!config.features.voice) {
      await ctx.reply('🎤 Voice transcription is disabled.').catch(() => {});
      return;
    }

    const from = ctx.from!;
    const voice = ctx.message.voice;

    await reactToMessage(ctx, bot, '🎤');
    if (config.ui.typing_indicator) {
      await ctx.replyWithChatAction('typing').catch(() => {});
    }

    // Send interim "transcribing..." message
    const interimMsg = await ctx.reply('🎤 Transcribing voice message...').catch(() => null);

    try {
      const fileUrl = await getTelegramFileUrl(bot, voice.file_id);
      const localPath = await downloadFile(fileUrl, `voice_${voice.file_unique_id}.ogg`);

      const settings = loadSettings();
      const groqKey = settings.providers.groq?.apiKey ?? process.env.GROQ_API_KEY;
      const transcription = await transcribeAudio(localPath, groqKey);

      // Update or delete interim message
      if (interimMsg) {
        await bot.api.editMessageText(
          ctx.chat!.id, interimMsg.message_id,
          `🎤 <i>Transcribed (${transcription.method}):</i>\n<blockquote>${escapeHtml(transcription.text)}</blockquote>`,
          { parse_mode: 'HTML' },
        ).catch(() => {});
      }

      if (transcription.method === 'unavailable') {
        await ctx.reply('⚠️ Voice transcription unavailable. Set GROQ_API_KEY for free transcription.').catch(() => {});
        return;
      }

      // Process transcription as AI message
      const userMessage = transcription.text;
      if (config.ui.typing_indicator) {
        await ctx.replyWithChatAction('typing').catch(() => {});
      }

      await processMessage(ctx, runtime, bot, userMessage);

      // Cleanup
      fs.unlinkSync(localPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (interimMsg) {
        await bot.api.editMessageText(ctx.chat!.id, interimMsg.message_id,
          formatError(`Transcription failed: ${msg}`), { parse_mode: 'HTML' }).catch(() => {});
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AUDIO FILES → Transcription
  // ─────────────────────────────────────────────────────────────────────────

  bot.on('message:audio', async (ctx) => {
    if (!config.features.voice) {
      await ctx.reply('🎵 Audio transcription is disabled.').catch(() => {});
      return;
    }

    const from = ctx.from!;
    const audio = ctx.message.audio;
    const caption = ctx.message.caption;

    await ctx.replyWithChatAction('typing').catch(() => {});

    try {
      const fileUrl = await getTelegramFileUrl(bot, audio.file_id);
      const ext = audio.mime_type?.includes('ogg') ? 'ogg' : 'mp3';
      const localPath = await downloadFile(fileUrl, `audio_${audio.file_unique_id}.${ext}`);

      const settings = loadSettings();
      const groqKey = settings.providers.groq?.apiKey ?? process.env.GROQ_API_KEY;
      const transcription = await transcribeAudio(localPath, groqKey);

      const prompt = buildMediaContext(
        { type: 'audio', fileId: audio.file_id, mimeType: audio.mime_type, duration: audio.duration, caption },
        { transcription: transcription.text },
      );

      await processMessage(ctx, runtime, bot, prompt);
      fs.unlinkSync(localPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(formatError(`Audio processing failed: ${msg}`), { parse_mode: 'HTML' }).catch(() => {});
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // VIDEO → Transcribe audio track via Groq/Whisper
  // ─────────────────────────────────────────────────────────────────────────

  bot.on('message:video', async (ctx) => {
    if (!config.features.voice) {
      await ctx.reply('🎬 Video processing is disabled.').catch(() => {});
      return;
    }

    const video = ctx.message.video;
    const caption = ctx.message.caption || '';

    await reactToMessage(ctx, bot, '🎬');
    if (config.ui.typing_indicator) {
      await ctx.replyWithChatAction('typing').catch(() => {});
    }

    const interimMsg = await ctx.reply('🎬 Downloading and transcribing video...').catch(() => null);

    try {
      const fileUrl = await getTelegramFileUrl(bot, video.file_id);
      const ext = video.mime_type?.includes('mp4') ? 'mp4' : 'mp4';
      const localPath = await downloadFile(fileUrl, `video_${video.file_unique_id}.${ext}`);

      const settings = loadSettings();
      const groqKey = settings.providers.groq?.apiKey ?? process.env.GROQ_API_KEY;
      const transcription = await transcribeAudio(localPath, groqKey);

      if (interimMsg) {
        const preview = transcription.text.length > 200
          ? transcription.text.slice(0, 200) + '...'
          : transcription.text;
        await bot.api.editMessageText(
          ctx.chat!.id, interimMsg.message_id,
          `🎬 <i>Transcribed video (${transcription.method}):</i>\n<blockquote>${escapeHtml(preview)}</blockquote>`,
          { parse_mode: 'HTML' },
        ).catch(() => {});
      }

      if (transcription.method === 'unavailable') {
        await ctx.reply('⚠️ Video transcription unavailable. Use /setkey groq <key> for free transcription.').catch(() => {});
        return;
      }

      // Process transcription as AI message
      const userMessage = caption
        ? `[Video transcription]: ${transcription.text}\n\nUser's caption: ${caption}`
        : `[Video transcription]: ${transcription.text}`;

      if (config.ui.typing_indicator) {
        await ctx.replyWithChatAction('typing').catch(() => {});
      }

      await processMessage(ctx, runtime, bot, userMessage);

      // Cleanup
      fs.unlinkSync(localPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (interimMsg) {
        await bot.api.editMessageText(ctx.chat!.id, interimMsg.message_id,
          formatError(`Video processing failed: ${msg}`), { parse_mode: 'HTML' }).catch(() => {});
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DOCUMENTS → Read text files, describe others
  // ─────────────────────────────────────────────────────────────────────────

  bot.on('message:document', async (ctx) => {
    if (!config.features.files) {
      await ctx.reply('📄 File handling is disabled.').catch(() => {});
      return;
    }

    const from = ctx.from!;
    const doc = ctx.message.document;
    const caption = ctx.message.caption;

    if (config.ui.typing_indicator) {
      await ctx.replyWithChatAction('upload_document').catch(() => {});
    }

    try {
      const info: MediaInfo = {
        type: 'document',
        fileId: doc.file_id,
        fileSize: doc.file_size,
        mimeType: doc.mime_type,
        fileName: doc.file_name,
        caption,
      };

      let content: string | undefined;

      // For text files: download and read content
      if (doc.file_name && isTextDocument(doc.file_name, doc.mime_type)) {
        const fileUrl = await getTelegramFileUrl(bot, doc.file_id);
        const localPath = await downloadFile(fileUrl, doc.file_name ?? `doc_${doc.file_unique_id}`);
        content = readDocumentContent(localPath, config.security.max_output);
        fs.unlinkSync(localPath);
      }

      const prompt = buildDocumentContext(info, content);
      await processMessage(ctx, runtime, bot, prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(formatError(`Document handling failed: ${msg}`), { parse_mode: 'HTML' }).catch(() => {});
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
        await ctx.answerCallbackQuery({ text: '🔒 Access denied' }).catch(() => {});
        return;
      }
    }

    await ctx.answerCallbackQuery().catch(() => {}); // Dismiss loading indicator

    // ── Soul/onboarding callbacks ─────────────────────────────────────────
    if (data.startsWith('soul:role:')) {
      const roleId = data.slice('soul:role:'.length) as SoulRole;
      await handleSoulRoleCallback(ctx, runtime, bot, from.id, roleId);
      return;
    }

    if (data.startsWith('soul:lang:')) {
      const langId = data.slice('soul:lang:'.length) as SoulLanguage;
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
      await ctx.editMessageText(`✅ Switched to <code>${escapeHtml(spec)}</code>`, { parse_mode: 'HTML' }).catch(() => {});

    } else if (data.startsWith('persona:set:')) {
      const persona = data.slice('persona:set:'.length);
      const session = runtime.sessions.get(from.id, ctx.chat?.id ?? from.id);
      if (session) {
        session.profile.prefs.persona = persona;
        runtime.sessions.save(session);
      }
      await ctx.editMessageText(`✅ Persona set to <code>${escapeHtml(persona)}</code>`, { parse_mode: 'HTML' }).catch(() => {});

    } else if (data === 'session:clear') {
      const session = runtime.sessions.get(from.id, ctx.chat?.id ?? from.id);
      if (session) {
        runtime.sessions.clearConversation(session);
        runtime.sessions.save(session);
      }
      await ctx.editMessageText('🗑 Conversation cleared.').catch(() => {});

    } else if (data === 'session:stats') {
      const session = runtime.sessions.get(from.id, ctx.chat?.id ?? from.id);
      if (session) {
        const tu = session.tokenUsage;
        await ctx.editMessageText(
          `📊 <b>Stats</b>\nMessages: ${session.profile.message_count}\nTokens: ${tu.total}`,
          { parse_mode: 'HTML' },
        ).catch(() => {});
      }

    } else if (data.startsWith('help:')) {
      const section = data.slice('help:'.length);
      await handleHelpSection(ctx, runtime, section);

    } else if (data.startsWith('confirm:')) {
      const choice = data.slice('confirm:'.length);
      // Pass callback as agent input
      await processMessage(ctx, runtime, bot, `User confirmed: ${choice}`);

    } else if (data === 'noop') {
      // Pagination label — do nothing

    } else if (data.startsWith('admin:')) {
      if (!security.isAdmin(from.id)) {
        await ctx.answerCallbackQuery({ text: '🔒 Admin only' }).catch(() => {});
        return;
      }
      await handleAdminCallback(ctx, runtime, data.slice('admin:'.length));

    } else {
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

  scheduler.on('job', async (event: JobTriggerEvent) => {
    const { job } = event;
    try {
      // Run the job message through the AI
      const from = { id: job.userId };
      const chatId = job.chatId;

      // Create a minimal context for processing
      await bot.api.sendChatAction(chatId, 'typing').catch(() => {});

      const session = runtime.sessions.get(job.userId, chatId);
      const settings = loadSettings();
      const providerName = session?.profile.prefs.provider ?? config.provider;
      const modelName = session?.profile.prefs.model ?? config.model;
      if (modelName) {
        settings.providers[providerName] = settings.providers[providerName] ?? {};
        settings.providers[providerName].model = modelName;
      }
      const provider = createProvider(providerName, settings);
      const systemPrompt = buildBotSystemPrompt(session, process.cwd(), memory);
      const conv = session
        ? runtime.sessions.buildConversation(session, systemPrompt)
        : createConversation(systemPrompt);
      const tokenTracker = new TokenTracker();

      const result = await runAgent(provider, conv, job.message, {
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
      if (!responseText) return;

      const prefix = `⏰ <b>Reminder: ${escapeHtml(job.name)}</b>\n\n`;
      const formatted = prefix + formatForTelegram(responseText);
      const chunks = splitMessage(formatted, config.ui.chunk_size);

      for (const chunk of chunks) {
        await bot.api.sendMessage(chatId, chunk, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: !config.ui.link_previews },
        }).catch(() => {});
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await bot.api.sendMessage(job.chatId,
        `⏰ <b>Reminder: ${escapeHtml(job.name)}</b>\n\n${escapeHtml(job.message)}`,
        { parse_mode: 'HTML' },
      ).catch(() => {});
      console.error('Scheduler job error:', msg);
    }
  });

  scheduler.start();

  // Periodic temp file cleanup
  setInterval(cleanupTempFiles, 3600 * 1000);

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

  async function start(): Promise<void> {
    if (config.telegram.webhook_url) {
      // Webhook mode
      const webhookPath = '/telegram-webhook';
      const webhookPort = config.telegram.webhook_port ?? 8787;
      const webhookSecret = config.telegram.webhook_secret;

      await bot.api.setWebhook(config.telegram.webhook_url, {
        secret_token: webhookSecret,
      });

      // Use grammY's built-in webhook handling
      const { webhookCallback } = await import('grammy');
      // Create a simple HTTP server
      const http = await import('http');
      const handler = webhookCallback(bot, 'http');
      const server = http.createServer(async (req, res) => {
        if (req.url === webhookPath) {
          await handler(req, res);
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      server.listen(webhookPort, '127.0.0.1', () => {
        console.log(`🌐 Webhook server listening on port ${webhookPort}`);
      });

    } else {
      // Long polling (default, matches OpenClaw)
      await bot.start({
        onStart: (info) => {
          console.log(`✅ Bot @${info.username} started (long polling)`);
        },
      });
    }
  }

  async function stop(): Promise<void> {
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
async function processMessage(
  ctx: BotContext,
  runtime: BotRuntime,
  bot: Bot,
  userMessage: string,
  existingSession?: ReturnType<BotSessionManager['get']>,
): Promise<void> {
  const from = ctx.from!;
  const chat = ctx.chat!;
  const { config, sessions, memory, skills, toolBridge, security } = runtime;

  // ── Session ──────────────────────────────────────────────────────────────
  const session = existingSession ?? sessions.getOrCreate(
    from.id, chat.id,
    { username: from.username, first_name: from.first_name, last_name: from.last_name },
    config.provider, config.model,
  );

  const cwd = session.cwd;

  // ── ACK reaction while processing ────────────────────────────────────────
  if (config.ui.ack_reaction && ctx.message) {
    await reactToMessage(ctx, bot, config.ui.ack_reaction);
  }

  // ── Typing indicator ──────────────────────────────────────────────────────
  if (config.ui.typing_indicator) {
    await ctx.replyWithChatAction('typing').catch(() => {});
  }

  // ── Build provider and conversation ──────────────────────────────────────
  const { provider } = resolveProvider(session, config);
  const systemPrompt = buildBotSystemPrompt(session, cwd, memory);
  const conv = sessions.buildConversation(session, systemPrompt);
  const tokenTracker = new TokenTracker();

  // ── Streaming setup ───────────────────────────────────────────────────────
  let streamingMsgId: number | null = null;
  let streamedContent = '';
  let lastEditAt = 0;
  const STREAM_EDIT_INTERVAL_MS = 1200; // Edit every 1.2s (Telegram rate limit: 20/min per chat)

  const sendOrEdit = async (text: string, isFinal: boolean) => {
    if (!text.trim()) return;

    const chunks = splitMessage(text, config.ui.chunk_size);
    const firstChunk = chunks[0];
    if (!firstChunk) return;

    if (streamingMsgId === null) {
      // Send initial message
      try {
        const msg = await bot.api.sendMessage(chat.id, firstChunk, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: !config.ui.link_previews },
          reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined,
        });
        streamingMsgId = msg.message_id;
      } catch {
        // Fallback: plain text
        try {
          const msg = await bot.api.sendMessage(chat.id, firstChunk.replace(/<[^>]+>/g, ''));
          streamingMsgId = msg.message_id;
        } catch { /* give up on this message */ }
      }
    } else if (!isFinal) {
      // Edit existing message (streaming preview)
      const now = Date.now();
      if (now - lastEditAt < STREAM_EDIT_INTERVAL_MS) return;
      lastEditAt = now;

      const preview = firstChunk + (chunks.length > 1 ? '\n\n<i>...</i>' : '');
      await bot.api.editMessageText(chat.id, streamingMsgId, preview, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }).catch(() => {}); // Ignore "message not modified" errors

    } else {
      // Final edit — send all chunks
      try {
        await bot.api.editMessageText(chat.id, streamingMsgId, firstChunk, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: !config.ui.link_previews },
        }).catch(() => {});
      } catch { /* ignore */ }

      // Send additional chunks if message was split
      for (let i = 1; i < chunks.length; i++) {
        await bot.api.sendMessage(chat.id, chunks[i], {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: !config.ui.link_previews },
        }).catch(() => {});
      }
    }
  };

  // ── Run agent ─────────────────────────────────────────────────────────────
  try {
    const onToken = config.features.streaming
      ? async (token: string) => {
          streamedContent += token;
          const formatted = formatForTelegram(streamedContent);
          await sendOrEdit(formatted, false);
        }
      : undefined;

    const result = await runAgent(provider, conv, userMessage, {
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
      const formatted = formatForTelegram(finalContent);
      await sendOrEdit(formatted, true);
    } else if (streamingMsgId === null) {
      await ctx.reply('(no response)').catch(() => {});
    }

    // ── Update session ────────────────────────────────────────────────────
    sessions.syncConversation(session, conv);
    if (result.usage) {
      sessions.addUsage(session, result.usage.prompt_tokens, result.usage.completion_tokens);
    }
    sessions.save(session);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[processMessage] Error:', msg);

    const errorText = formatError(msg);
    try {
      if (streamingMsgId) {
        await bot.api.editMessageText(chat.id, streamingMsgId, errorText, { parse_mode: 'HTML' }).catch(() => {});
      } else {
        await ctx.reply(errorText, { parse_mode: 'HTML' }).catch(() => {});
      }
    } catch { /* silently ignore */ }
  }
}

// ─── Reactions ────────────────────────────────────────────────────────────────

async function reactToMessage(ctx: BotContext, bot: Bot, emoji: string): Promise<void> {
  if (!ctx.message || !ctx.chat) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (bot.api.raw as any).setMessageReaction({
      chat_id: ctx.chat.id,
      message_id: ctx.message.message_id,
      reaction: [{ type: 'emoji', emoji }],
    });
  } catch { /* Reactions may not be supported in all contexts */ }
}

// ─── Onboarding flow ─────────────────────────────────────────────────────────

/**
 * Start the first-time onboarding flow.
 * Asks: name → role (keyboard) → language (keyboard) → bot name
 */
async function startOnboarding(
  ctx: BotContext,
  runtime: BotRuntime,
  bot: Bot,
): Promise<void> {
  const from = ctx.from!;
  const chat = ctx.chat!;
  const { soulManager } = runtime;

  soulManager.startOnboarding(from.id);

  const firstName = from.first_name ?? 'there';

  await bot.api.sendMessage(
    chat.id,
    `👋 <b>Hey ${escapeHtml(firstName)}! I'm your new AI assistant.</b>\n\nLet's set me up real quick — just 3 questions!\n\n<b>First: What should I call you?</b>\n<i>(Just type your name or nickname)</i>`,
    { parse_mode: 'HTML' },
  ).catch(() => {});
}

/**
 * Handle text input during onboarding steps.
 */
async function handleOnboardingInput(
  ctx: BotContext,
  runtime: BotRuntime,
  bot: Bot,
  text: string,
): Promise<void> {
  const from = ctx.from!;
  const chat = ctx.chat!;
  const { soulManager } = runtime;

  const state = soulManager.getOnboardingState(from.id);
  if (!state) return;

  switch (state.step) {
    case 'ask_name': {
      const userName = text.trim().slice(0, 40) || from.first_name || 'friend';
      soulManager.advanceOnboarding(from.id, { userName }, 'ask_role');

      await bot.api.sendMessage(
        chat.id,
        `Nice to meet you, <b>${escapeHtml(userName)}</b>! 🎉\n\n<b>What should I be?</b> Pick my role:`,
        { parse_mode: 'HTML', reply_markup: roleKeyboard() },
      ).catch(() => {});
      break;
    }

    case 'ask_role': {
      // User typed a role instead of using the keyboard
      const roleInput = text.trim().toLowerCase();
      const resolved = resolveSoulRole(roleInput);

      if (!resolved) {
        await bot.api.sendMessage(
          chat.id,
          `Please pick a role from the buttons below, or type one of:\ncoding, research, general, devops, data, creative`,
          { parse_mode: 'HTML', reply_markup: roleKeyboard() },
        ).catch(() => {});
        return;
      }

      await handleSoulRoleCallback(ctx, runtime, bot, from.id, resolved);
      break;
    }

    case 'ask_language': {
      // User typed a language
      const langInput = text.trim().toLowerCase();
      const resolved = resolveSoulLanguage(langInput);

      if (!resolved) {
        await bot.api.sendMessage(
          chat.id,
          `Please pick a language from the buttons, or type: english, egyptian, franco, arabic, french, spanish, german, turkish, auto`,
          { parse_mode: 'HTML', reply_markup: languageKeyboard() },
        ).catch(() => {});
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
async function handleSoulRoleCallback(
  ctx: BotContext,
  runtime: BotRuntime,
  bot: Bot,
  userId: number,
  roleId: SoulRole,
): Promise<void> {
  const chat = ctx.chat!;
  const { soulManager } = runtime;
  const roleDef = ROLE_DEFS[roleId] ?? ROLE_DEFS.general;

  // If not onboarding, this is a role change
  if (!soulManager.isOnboarding(userId)) {
    const updated = soulManager.updateSoul(userId, {
      role: roleId,
      capabilities: roleDef.capabilities,
    });
    if (!updated) return;

    const session = runtime.sessions.get(userId, chat.id);
    if (session) {
      session.systemPrompt = updated.systemPrompt;
      runtime.sessions.save(session);
    }

    await ctx.editMessageText(
      `✅ Role changed to ${roleDef.emoji} <b>${escapeHtml(roleDef.label)}</b>\n\n<i>${escapeHtml(roleDef.shortDesc)}</i>`,
      { parse_mode: 'HTML' },
    ).catch(() => {});
    return;
  }

  // During onboarding: advance to ask_language
  soulManager.advanceOnboarding(userId, { role: roleId }, 'ask_language');

  // Edit the role selection message to show what was chosen
  await ctx.editMessageText(
    `${roleDef.emoji} <b>${escapeHtml(roleDef.label)}</b> — got it!\n\n<i>${escapeHtml(roleDef.shortDesc)}</i>`,
    { parse_mode: 'HTML' },
  ).catch(() => {});

  // Send language question
  await bot.api.sendMessage(
    chat.id,
    `<b>What language should I speak?</b>`,
    { parse_mode: 'HTML', reply_markup: languageKeyboard() },
  ).catch(() => {});
}

/**
 * Handle language selection callback (soul:lang:*)
 */
async function handleSoulLangCallback(
  ctx: BotContext,
  runtime: BotRuntime,
  bot: Bot,
  userId: number,
  langId: SoulLanguage,
): Promise<void> {
  const chat = ctx.chat!;
  const { soulManager } = runtime;
  const langDef = LANGUAGE_DEFS[langId] ?? LANGUAGE_DEFS.english;

  // If not onboarding, this is a language change
  if (!soulManager.isOnboarding(userId)) {
    const updated = soulManager.updateSoul(userId, { language: langId });
    if (!updated) return;

    const session = runtime.sessions.get(userId, chat.id);
    if (session) {
      session.systemPrompt = updated.systemPrompt;
      runtime.sessions.save(session);
    }

    await ctx.editMessageText(
      `✅ Language changed to ${langDef.flag} <b>${escapeHtml(langDef.label)}</b>`,
      { parse_mode: 'HTML' },
    ).catch(() => {});
    return;
  }

  // During onboarding: advance to ask_bot_name
  soulManager.advanceOnboarding(userId, { language: langId }, 'ask_bot_name');

  // Edit language message
  await ctx.editMessageText(
    `${langDef.flag} <b>${escapeHtml(langDef.label)}</b> — perfect!`,
    { parse_mode: 'HTML' },
  ).catch(() => {});

  // Ask for bot name
  const state = soulManager.getOnboardingState(userId);
  const roleDef = ROLE_DEFS[state?.data.role ?? 'general'];

  await bot.api.sendMessage(
    chat.id,
    `Almost done! 🎯\n\n<b>What should I call myself?</b>\n\nI'll be your <i>${escapeHtml(roleDef.label)}</i> in ${langDef.flag} ${escapeHtml(langDef.label)}.\n\nGive me a name or just send <code>skip</code> and I'll go by <b>coderaw</b>.`,
    { parse_mode: 'HTML' },
  ).catch(() => {});
}

/**
 * Complete onboarding, save soul, send welcome message.
 */
async function finishOnboarding(
  ctx: BotContext,
  runtime: BotRuntime,
  bot: Bot,
  userId: number,
  chatId: number,
  botNameInput: string,
): Promise<void> {
  const { soulManager, sessions, config } = runtime;

  const botName = botNameInput.toLowerCase() === 'skip' ? 'coderaw' : botNameInput;

  // Advance state with bot name then complete
  soulManager.advanceOnboarding(userId, { botName }, 'done');
  const soul = soulManager.completeOnboarding(userId);

  if (!soul) {
    await bot.api.sendMessage(chatId, '❌ Setup failed. Please try /start again.', {}).catch(() => {});
    return;
  }

  // Create/update session with soul system prompt
  const from = ctx.from!;
  const session = sessions.getOrCreate(
    userId, chatId,
    { username: from.username, first_name: from.first_name },
    config.provider, config.model,
  );
  session.systemPrompt = soul.systemPrompt;
  sessions.save(session);

  const roleDef = ROLE_DEFS[soul.role];
  const langDef = LANGUAGE_DEFS[soul.language];

  const capLines = soul.capabilities.slice(0, 4).join('\n');

  await bot.api.sendMessage(
    chatId,
    `🎉 <b>Setup complete!</b>

I'm <b>${escapeHtml(soul.botName)}</b>, your ${escapeHtml(roleDef.emoji)} ${escapeHtml(roleDef.label)}.
Speaking: ${langDef.flag} ${escapeHtml(langDef.label)}

<b>Here's what I can do:</b>
${escapeHtml(capLines)}

<b>Ask me anything!</b> Type /help for commands.`,
    { parse_mode: 'HTML' },
  ).catch(() => {});
}

// ─── Help sections ────────────────────────────────────────────────────────────

async function handleHelpSection(ctx: BotContext, runtime: BotRuntime, section: string): Promise<void> {
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
    ctx.reply(text, { parse_mode: 'HTML' }).catch(() => {});
  });
}

// ─── Admin callbacks ──────────────────────────────────────────────────────────

async function handleAdminCallback(
  ctx: BotContext,
  runtime: BotRuntime,
  action: string,
): Promise<void> {
  switch (action) {
    case 'sessions': {
      const sessions = runtime.sessions.listSessions().slice(0, 10);
      const lines = sessions.map(s =>
        `• <b>${escapeHtml(s.profile.first_name ?? String(s.userId))}</b> — ${s.profile.message_count} msgs`
      );
      await ctx.editMessageText(
        `<b>👥 Sessions (${sessions.length})</b>\n\n${lines.join('\n') || 'none'}`,
        { parse_mode: 'HTML' },
      ).catch(() => {});
      break;
    }
    case 'tools': {
      const tools = runtime.toolBridge.listEnabledTools();
      await ctx.editMessageText(
        `<b>🔧 Enabled Tools</b>\n\n${tools.map(t => `• <code>${t}</code>`).join('\n')}`,
        { parse_mode: 'HTML' },
      ).catch(() => {});
      break;
    }
    case 'jobs': {
      const jobs = runtime.scheduler.getAllJobs().filter(j => j.enabled);
      const lines = jobs.slice(0, 10).map(j =>
        `• <code>${j.id.slice(0, 8)}</code> ${escapeHtml(j.name)}`
      );
      await ctx.editMessageText(
        `<b>⏰ Active Jobs (${jobs.length})</b>\n\n${lines.join('\n') || 'none'}`,
        { parse_mode: 'HTML' },
      ).catch(() => {});
      break;
    }
    default:
      await ctx.editMessageText(`Admin action: ${escapeHtml(action)} (not yet implemented)`, { parse_mode: 'HTML' }).catch(() => {});
  }
}
