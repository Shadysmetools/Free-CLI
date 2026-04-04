"use strict";
/**
 * Multimodal Input — Images, Video frames, Voice files
 *
 * Supports:
 *   Images:  PNG, JPG, JPEG, GIF, WebP → base64 data URLs
 *   Video:   MP4, MOV, AVI, MKV → extract frames via ffmpeg, analyze first frame
 *   Audio:   MP3, WAV, M4A, OGG, FLAC → transcribe via Whisper/Groq
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
exports.isImageFile = isImageFile;
exports.isVideoFile = isVideoFile;
exports.isAudioFile = isAudioFile;
exports.loadImageAsBase64 = loadImageAsBase64;
exports.extractVideoFrame = extractVideoFrame;
exports.buildMultimodalContent = buildMultimodalContent;
exports.buildAnthropicContent = buildAnthropicContent;
exports.describeFile = describeFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process = __importStar(require("child_process"));
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac']);
function isImageFile(filePath) {
    return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}
function isVideoFile(filePath) {
    return VIDEO_EXTS.has(path.extname(filePath).toLowerCase());
}
function isAudioFile(filePath) {
    return AUDIO_EXTS.has(path.extname(filePath).toLowerCase());
}
/**
 * Load an image file as base64 data
 */
function loadImageAsBase64(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    const ext = path.extname(filePath).toLowerCase();
    const mediaTypeMap = {
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
function extractVideoFrame(videoPath) {
    if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
    }
    // Check ffmpeg is available
    try {
        child_process.execSync('ffmpeg -version', { stdio: 'ignore' });
    }
    catch {
        throw new Error('ffmpeg not found. Install it: https://ffmpeg.org/download.html');
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcc-video-'));
    const framePath = path.join(tmpDir, 'frame.jpg');
    try {
        // Extract frame at 1 second mark (or 0 if shorter)
        child_process.execSync(`ffmpeg -i "${videoPath}" -ss 00:00:01 -frames:v 1 "${framePath}" -y`, { stdio: 'ignore', timeout: 30000 });
        if (!fs.existsSync(framePath)) {
            // Try at 0 seconds
            child_process.execSync(`ffmpeg -i "${videoPath}" -frames:v 1 "${framePath}" -y`, { stdio: 'ignore', timeout: 30000 });
        }
        return loadImageAsBase64(framePath);
    }
    finally {
        // Cleanup temp dir later (not immediately, may still be needed)
        setTimeout(() => {
            try {
                fs.rmSync(tmpDir, { recursive: true });
            }
            catch { /* ignore */ }
        }, 60000);
    }
}
/**
 * Build a multimodal message content array for providers
 * Returns: [{type: "text", text: "..."}, {type: "image_url", image_url: {url: "data:..."}}]
 */
function buildMultimodalContent(text, images) {
    const parts = [];
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
function buildAnthropicContent(text, images) {
    const parts = [];
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
function describeFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath);
    if (IMAGE_EXTS.has(ext))
        return `image file "${name}"`;
    if (VIDEO_EXTS.has(ext))
        return `video file "${name}" (showing first frame)`;
    if (AUDIO_EXTS.has(ext))
        return `audio file "${name}"`;
    return `file "${name}"`;
}
//# sourceMappingURL=index.js.map