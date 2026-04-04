/**
 * media.ts — Photo, voice, document, and video handling
 *
 * Handles all media types sent to the bot:
 * - Photos → vision analysis via AI
 * - Voice messages → Whisper transcription → AI response
 * - Documents → file content extraction or download
 * - Videos → metadata + frame description
 * - Stickers → description
 *
 * Reference: OpenClaw audio/video handling (channels/telegram.md)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DownloadedFile {
  localPath: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
}

export interface MediaInfo {
  type: 'photo' | 'voice' | 'audio' | 'document' | 'video' | 'sticker' | 'video_note';
  fileId: string;
  fileSize?: number;
  mimeType?: string;
  fileName?: string;
  duration?: number; // for audio/video
  width?: number;   // for photos/video
  height?: number;  // for photos/video
  /** Caption sent with the media */
  caption?: string;
}

// ─── File download ────────────────────────────────────────────────────────────

const TEMP_DIR = path.join(os.homedir(), '.knowcap-code', 'temp');

/** Ensure temp directory exists */
function ensureTempDir(): void {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/** Download a file from URL to local temp path */
export async function downloadFile(
  url: string,
  fileName: string,
): Promise<string> {
  ensureTempDir();
  const localPath = path.join(TEMP_DIR, fileName);

  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(localPath);

    proto.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          downloadFile(redirectUrl, fileName).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(localPath);
      });
      file.on('error', (err) => {
        fs.unlinkSync(localPath);
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/** Clean up temp files older than 1 hour */
export function cleanupTempFiles(): void {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const hourAgo = Date.now() - 3600 * 1000;
    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < hourAgo) {
        fs.unlinkSync(filePath);
      }
    }
  } catch { /* non-fatal */ }
}

// ─── Image handling ───────────────────────────────────────────────────────────

/**
 * Build a prompt for image analysis.
 * The actual vision call happens via the AI provider's multimodal support.
 */
export function buildImagePrompt(caption?: string): string {
  if (caption) {
    return `The user sent an image with this caption: "${caption}"\nPlease analyze the image and respond to the caption.`;
  }
  return 'The user sent an image. Please describe and analyze what you see in it.';
}

/**
 * Read an image file as base64 for AI providers that support it
 */
export function readImageAsBase64(localPath: string): string {
  const data = fs.readFileSync(localPath);
  return data.toString('base64');
}

// ─── Voice/Audio handling ─────────────────────────────────────────────────────

export interface TranscriptionResult {
  text: string;
  method: 'groq' | 'whisper' | 'unavailable';
}

/**
 * Transcribe an audio file using available methods.
 * Priority: Groq API → Local Whisper → Error message
 */
export async function transcribeAudio(
  localPath: string,
  groqApiKey?: string,
): Promise<TranscriptionResult> {
  // Try Groq first (free, fast, no local install needed)
  if (groqApiKey) {
    try {
      const { transcribeViaGroq } = await import('../whisper/transcribe');
      const result = await transcribeViaGroq(localPath, groqApiKey);
      return { text: result.text, method: 'groq' };
    } catch { /* fall through */ }
  }

  // Try local Whisper
  try {
    const { transcribeFile } = await import('../whisper/transcribe');
    const result = await transcribeFile(localPath, { model: 'base' });
    return { text: result.text, method: 'whisper' };
  } catch { /* fall through */ }

  return {
    text: '[Voice transcription unavailable. Install Whisper or set GROQ_API_KEY.]',
    method: 'unavailable',
  };
}

// ─── Document handling ────────────────────────────────────────────────────────

const TEXT_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/html',
  'application/json', 'application/javascript', 'application/typescript',
  'application/xml', 'text/xml',
]);

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.js', '.ts', '.py', '.sh', '.yaml', '.yml',
  '.html', '.css', '.xml', '.toml', '.ini', '.conf', '.log', '.env',
]);

/**
 * Check if a document should be read as text
 */
export function isTextDocument(fileName: string, mimeType?: string): boolean {
  if (mimeType && TEXT_MIME_TYPES.has(mimeType)) return true;
  const ext = path.extname(fileName).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * Read a text document's content, truncated if too large
 */
export function readDocumentContent(localPath: string, maxChars = 8000): string {
  const content = fs.readFileSync(localPath, 'utf-8');
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + `\n\n[... truncated (${content.length - maxChars} more chars) ...]`;
}

/**
 * Build context for a document sent to the bot
 */
export function buildDocumentContext(info: MediaInfo, content?: string): string {
  const parts: string[] = [];

  parts.push(`User sent a file: ${info.fileName || 'unnamed'}`);
  if (info.mimeType) parts.push(`Type: ${info.mimeType}`);
  if (info.fileSize) parts.push(`Size: ${Math.round(info.fileSize / 1024)} KB`);
  if (info.caption) parts.push(`Caption: "${info.caption}"`);
  if (content) {
    parts.push(`\nFile contents:\n\`\`\`\n${content}\n\`\`\``);
  }

  return parts.join('\n');
}

// ─── Media context builder ────────────────────────────────────────────────────

/**
 * Build a text prompt describing the media for the AI agent.
 * This is what gets injected into the conversation when media is received.
 */
export function buildMediaContext(info: MediaInfo, extras?: {
  transcription?: string;
  content?: string;
  imageBase64?: string;
}): string {
  switch (info.type) {
    case 'photo':
      return buildImagePrompt(info.caption);

    case 'voice':
    case 'audio': {
      const transcription = extras?.transcription ?? '[not transcribed]';
      const duration = info.duration ? ` (${info.duration}s)` : '';
      return `User sent a voice message${duration}. Transcription: "${transcription}"${info.caption ? `\nCaption: "${info.caption}"` : ''}`;
    }

    case 'document':
      return buildDocumentContext(info, extras?.content);

    case 'video':
    case 'video_note': {
      const duration = info.duration ? ` (${info.duration}s)` : '';
      const dims = (info.width && info.height) ? ` ${info.width}x${info.height}` : '';
      return `User sent a video${duration}${dims}.${info.caption ? `\nCaption: "${info.caption}"` : ''}\nPlease acknowledge receipt and offer to analyze if you have vision capability.`;
    }

    case 'sticker':
      return `User sent a sticker.${info.caption ? `\nCaption: "${info.caption}"` : ''} Feel free to respond naturally.`;

    default:
      return `User sent media (${info.type}).${info.caption ? `\nCaption: "${info.caption}"` : ''}`;
  }
}
