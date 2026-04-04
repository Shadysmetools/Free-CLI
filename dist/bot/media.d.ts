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
    duration?: number;
    width?: number;
    height?: number;
    /** Caption sent with the media */
    caption?: string;
}
/** Download a file from URL to local temp path */
export declare function downloadFile(url: string, fileName: string): Promise<string>;
/** Clean up temp files older than 1 hour */
export declare function cleanupTempFiles(): void;
/**
 * Build a prompt for image analysis.
 * The actual vision call happens via the AI provider's multimodal support.
 */
export declare function buildImagePrompt(caption?: string): string;
/**
 * Read an image file as base64 for AI providers that support it
 */
export declare function readImageAsBase64(localPath: string): string;
export interface TranscriptionResult {
    text: string;
    method: 'groq' | 'whisper' | 'unavailable';
}
/**
 * Transcribe an audio file using available methods.
 * Priority: Groq API → Local Whisper → Error message
 */
export declare function transcribeAudio(localPath: string, groqApiKey?: string): Promise<TranscriptionResult>;
/**
 * Check if a document should be read as text
 */
export declare function isTextDocument(fileName: string, mimeType?: string): boolean;
/**
 * Read a text document's content, truncated if too large
 */
export declare function readDocumentContent(localPath: string, maxChars?: number): string;
/**
 * Build context for a document sent to the bot
 */
export declare function buildDocumentContext(info: MediaInfo, content?: string): string;
/**
 * Build a text prompt describing the media for the AI agent.
 * This is what gets injected into the conversation when media is received.
 */
export declare function buildMediaContext(info: MediaInfo, extras?: {
    transcription?: string;
    content?: string;
    imageBase64?: string;
}): string;
//# sourceMappingURL=media.d.ts.map