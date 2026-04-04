/**
 * chat-input.ts — Gemini-style bordered chat input box + AI response bubbles
 *
 * TTY mode  → bordered 💬 input box, raw keypresses, redraws on each key.
 *             Input is BLOCKED while AI is processing (while(true) loop in cli.ts
 *             never re-enters readInputWithBox until runAgent completes).
 *             80 ms drain window discards any keys buffered during AI response.
 *
 * Non-TTY   → simple readline fallback (pipe / one-shot).
 */
/** Whether stdin+stdout are both interactive terminals. */
export declare function isTTYMode(): boolean;
/**
 * Write 3 lines (top / content / bottom) with NO trailing newline.
 * Cursor ends at the last char of the bottom border line.
 *
 *   ┌─ 💬 Message ──────────────────────────────────┐
 *   │ text here                                      │
 *   └────────────────────────────────────────────────┘
 */
export declare function drawInputBox(text: string): void;
/**
 * Show "⏳ Thinking..." on the current blank line (TTY only).
 * Uses \r so printAIResponseStart() can overwrite it cleanly.
 * Call immediately after the user presses Enter, before runAgent().
 */
export declare function printThinking(tty: boolean): void;
/**
 * Clear the thinking indicator (if any) and print the 🤖 AI header + separator.
 * Call once, right before streaming begins.
 *
 * Resulting cursor position: after leading "  " indent on the token line.
 *
 *   🤖 AI
 *   ────────────────────────────────────────
 *   [cursor here — tokens stream from this point]
 */
export declare function printAIResponseStart(hadThinking?: boolean): void;
/**
 * Print footer + closing separator after the AI response ends.
 *
 *   [blank line]
 *   provider/model · N tokens · free
 *   ────────────────────────────────────────
 *   [blank line]
 */
export declare function printAIResponseEnd(footerLine?: string): void;
export interface InputResult {
    text: string;
    eof: boolean;
}
/**
 * Read one message from the user.
 *
 * TTY  → bordered box, raw keypresses, 80 ms drain to discard buffered input.
 * Pipe → simple readline (no box).
 */
export declare function readInputWithBox(): Promise<InputResult>;
//# sourceMappingURL=chat-input.d.ts.map