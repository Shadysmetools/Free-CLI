/**
 * formatter.ts — Convert AI output to Telegram HTML format
 *
 * OpenClaw uses HTML parse mode (not MarkdownV2) because HTML escaping
 * is simpler and more reliable. This module converts AI markdown output
 * to Telegram-safe HTML.
 *
 * Reference: https://core.telegram.org/bots/api#html-style
 */
/** Escape special HTML characters for Telegram HTML mode */
export declare function escapeHtml(text: string): string;
/**
 * Convert markdown-style AI output to Telegram HTML.
 * Handles: fenced code blocks, inline code, **bold**, *italic*, ### headers,
 * bullet lists, blockquotes, and bare URLs.
 */
export declare function formatForTelegram(text: string): string;
/**
 * Split a long HTML message into chunks ≤ maxLength chars.
 * Respects paragraph and line boundaries. Never splits inside HTML tags.
 *
 * OpenClaw reference: channels.telegram.chunkMode = "newline" (paragraph splits)
 */
export declare function splitMessage(text: string, maxLength?: number): string[];
/** Format a tool call notification */
export declare function formatToolCall(toolName: string, args: Record<string, unknown>): string;
/** Format an error for Telegram */
export declare function formatError(message: string): string;
/** Format a success message */
export declare function formatSuccess(message: string): string;
/** Truncate output to stay within limits */
export declare function truncateOutput(text: string, maxChars: number): string;
/** Format a status/info block */
export declare function formatStatus(title: string, items: Array<[string, string]>): string;
/** Format a code block with optional language */
export declare function formatCode(code: string, lang?: string): string;
/** Format a list of items as bullet points */
export declare function formatList(title: string, items: string[]): string;
//# sourceMappingURL=formatter.d.ts.map