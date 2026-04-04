/**
 * Multimodal Input — Images, Video frames, Voice files
 *
 * Supports:
 *   Images:  PNG, JPG, JPEG, GIF, WebP → base64 data URLs
 *   Video:   MP4, MOV, AVI, MKV → extract frames via ffmpeg, analyze first frame
 *   Audio:   MP3, WAV, M4A, OGG, FLAC → transcribe via Whisper/Groq
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';

export interface ImageContent {
  type: 'image';
  mediaType: string;
  data: string; // base64
  filePath: string;
}

export interface MultimodalInput {
  text?: string;
  images?: ImageContent[];
  transcription?: string; // from voice/video
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac']);

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

export function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTS.has(path.extname(filePath).toLowerCase());
}

export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTS.has(path.extname(filePath).toLowerCase());
}

/**
 * Load an image file as base64 data
 */
export function loadImageAsBase64(filePath: string): ImageContent {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const mediaTypeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };

  const mediaType = mediaTypeMap[ext];
  if (!mediaType) {
    throw new Error(`Unsupported image format: ${ext}. Supported: PNG, JPG, GIF, WebP`);
  }

  const data = fs.readFileSync(filePath).toString('base64');
  return { type: 'image', mediaType, data, filePath };
}

/**
 * Extract first frame from video using ffmpeg
 */
export function extractVideoFrame(videoPath: string): ImageContent {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  // Check ffmpeg is available
  try {
    child_process.execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch {
    throw new Error('ffmpeg not found. Install it: https://ffmpeg.org/download.html');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcc-video-'));
  const framePath = path.join(tmpDir, 'frame.jpg');

  try {
    // Extract frame at 1 second mark (or 0 if shorter)
    child_process.execSync(
      `ffmpeg -i "${videoPath}" -ss 00:00:01 -frames:v 1 "${framePath}" -y`,
      { stdio: 'ignore', timeout: 30000 }
    );

    if (!fs.existsSync(framePath)) {
      // Try at 0 seconds
      child_process.execSync(
        `ffmpeg -i "${videoPath}" -frames:v 1 "${framePath}" -y`,
        { stdio: 'ignore', timeout: 30000 }
      );
    }

    return loadImageAsBase64(framePath);
  } finally {
    // Cleanup temp dir later (not immediately, may still be needed)
    setTimeout(() => {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }, 60000);
  }
}

/**
 * Build a multimodal message content array for providers
 * Returns: [{type: "text", text: "..."}, {type: "image_url", image_url: {url: "data:..."}}]
 */
export function buildMultimodalContent(
  text: string,
  images: ImageContent[]
): Array<{ type: string; text?: string; image_url?: { url: string } }> {
  const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

  // Add text first
  if (text) {
    parts.push({ type: 'text', text });
  }

  // Add images
  for (const img of images) {
    parts.push({
      type: 'image_url',
      image_url: {
        url: `data:${img.mediaType};base64,${img.data}`,
      },
    });
  }

  return parts;
}

/**
 * Build Anthropic-format multimodal content
 */
export function buildAnthropicContent(
  text: string,
  images: ImageContent[]
): Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> {
  const parts: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];

  for (const img of images) {
    parts.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.data,
      },
    });
  }

  if (text) {
    parts.push({ type: 'text', text });
  }

  return parts;
}

/**
 * Get file description for prompt
 */
export function describeFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);
  if (IMAGE_EXTS.has(ext)) return `image file "${name}"`;
  if (VIDEO_EXTS.has(ext)) return `video file "${name}" (showing first frame)`;
  if (AUDIO_EXTS.has(ext)) return `audio file "${name}"`;
  return `file "${name}"`;
}
