/**
 * Multimodal Input — Images, Video frames, Voice files
 *
 * Supports:
 *   Images:  PNG, JPG, JPEG, GIF, WebP → base64 data URLs
 *   Video:   MP4, MOV, AVI, MKV → extract frames via ffmpeg, analyze first frame
 *   Audio:   MP3, WAV, M4A, OGG, FLAC → transcribe via Whisper/Groq
 */
export interface ImageContent {
    type: 'image';
    mediaType: string;
    data: string;
    filePath: string;
}
export interface MultimodalInput {
    text?: string;
    images?: ImageContent[];
    transcription?: string;
}
export declare function isImageFile(filePath: string): boolean;
export declare function isVideoFile(filePath: string): boolean;
export declare function isAudioFile(filePath: string): boolean;
/**
 * Load an image file as base64 data
 */
export declare function loadImageAsBase64(filePath: string): ImageContent;
/**
 * Extract first frame from video using ffmpeg
 */
export declare function extractVideoFrame(videoPath: string): ImageContent;
/**
 * Build a multimodal message content array for providers
 * Returns: [{type: "text", text: "..."}, {type: "image_url", image_url: {url: "data:..."}}]
 */
export declare function buildMultimodalContent(text: string, images: ImageContent[]): Array<{
    type: string;
    text?: string;
    image_url?: {
        url: string;
    };
}>;
/**
 * Build Anthropic-format multimodal content
 */
export declare function buildAnthropicContent(text: string, images: ImageContent[]): Array<{
    type: string;
    text?: string;
    source?: {
        type: string;
        media_type: string;
        data: string;
    };
}>;
/**
 * Get file description for prompt
 */
export declare function describeFile(filePath: string): string;
//# sourceMappingURL=index.d.ts.map