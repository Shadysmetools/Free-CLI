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
/**
 * Sanitise a raw input chunk (typed or pasted) for storage in the buffer.
 *
 * The OLD behaviour stripped ALL newlines (`/[\r\n]/g`), which made pasting
 * multi-line text impossible. We now PRESERVE embedded newlines so a pasted
 * block keeps its line structure, while still cleaning up terminal artefacts:
 *
 *   • CRLF  ("\r\n")  → "\n"   (Windows / network paste)
 *   • lone  "\r"      → "\n"   (classic-Mac line ending)
 *   • a single trailing "\r"   is the terminal's Enter echo → dropped
 *   • bracketed-paste guards "\x1b[200~" / "\x1b[201~" → stripped
 *   • other C0 control bytes (except \n and \t) → stripped
 */
export declare function sanitizePaste(str: string): string;
/** Result of evaluating an Enter press against the current buffer. */
export interface SubmitDecision {
    /** true → send the message; false → insert a newline and keep editing. */
    submit: boolean;
    /** the (possibly rewritten) buffer to continue with. */
    buffer: string;
}
/**
 * Decide what an Enter keypress means for the given buffer (TTY mode).
 *
 * Continuation rule (matches shell / Claude-Code multi-line entry):
 *   A line ending in an ODD number of backslashes is a continuation —
 *   the final "\" is the line-continuation marker. It is consumed and a real
 *   newline is appended, so the user keeps typing on a fresh line.
 *   An EVEN number of trailing backslashes is literal text → the message
 *   submits as-is.
 */
export declare function resolveSubmit(buffer: string): SubmitDecision;
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
export declare function readInputWithBox(): Promise<InputResult>;
//# sourceMappingURL=chat-input.d.ts.map