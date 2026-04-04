"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTTYMode = isTTYMode;
exports.drawInputBox = drawInputBox;
exports.printThinking = printThinking;
exports.printAIResponseStart = printAIResponseStart;
exports.printAIResponseEnd = printAIResponseEnd;
exports.readInputWithBox = readInputWithBox;
const readline = __importStar(require("readline"));
const chalk_1 = __importDefault(require("chalk"));
// ─── Geometry ─────────────────────────────────────────────────────────────────
function getInnerWidth() {
    const cols = process.stdout.columns || 80;
    return Math.min(cols - 4, 70); // content width inside │ borders
}
/** Whether stdin+stdout are both interactive terminals. */
function isTTYMode() {
    return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}
// ─── Input box ────────────────────────────────────────────────────────────────
/**
 * Write 3 lines (top / content / bottom) with NO trailing newline.
 * Cursor ends at the last char of the bottom border line.
 *
 *   ┌─ 💬 Message ──────────────────────────────────┐
 *   │ text here                                      │
 *   └────────────────────────────────────────────────┘
 */
function drawInputBox(text) {
    const inner = getInnerWidth();
    const label = ' \uD83D\uDCAC Message '; // "💬 Message " — emoji takes 2 visual cols
    const dashes = Math.max(1, inner - label.length - 1);
    const top = chalk_1.default.cyan('┌─' + label + '─'.repeat(dashes) + '┐');
    const maxContent = inner - 2;
    let vis;
    if (text.length > maxContent) {
        // Show "…" prefix to indicate truncated display (full text still in buffer)
        vis = '…' + text.slice(text.length - maxContent + 1);
    }
    else {
        vis = text;
    }
    const mid = chalk_1.default.cyan('│ ') + vis.padEnd(maxContent, ' ') + chalk_1.default.cyan(' │');
    const bot = chalk_1.default.cyan('└' + '─'.repeat(inner) + '┘');
    process.stdout.write(top + '\n' + mid + '\n' + bot);
}
// ─── Thinking indicator ───────────────────────────────────────────────────────
/**
 * Show "⏳ Thinking..." on the current blank line (TTY only).
 * Uses \r so printAIResponseStart() can overwrite it cleanly.
 * Call immediately after the user presses Enter, before runAgent().
 */
function printThinking(tty) {
    if (tty) {
        process.stdout.write(chalk_1.default.dim('  ⏳ Thinking...\r'));
    }
}
// ─── AI response header / footer ──────────────────────────────────────────────
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
function printAIResponseStart(hadThinking = false) {
    const cols = process.stdout.columns || 80;
    const lineW = Math.min(cols - 4, 72);
    if (hadThinking) {
        // Overwrite the "⏳ Thinking..." on the current line
        process.stdout.write('\x1b[2K\r'); // clear line → col 0
        process.stdout.write(chalk_1.default.bold.green('  🤖 AI') + '\n');
    }
    else {
        process.stdout.write('\n' + chalk_1.default.bold.green('  🤖 AI') + '\n');
    }
    process.stdout.write(chalk_1.default.dim('  ' + '─'.repeat(lineW)) + '\n');
    process.stdout.write('  '); // indent — streamed tokens continue here
}
/**
 * Print footer + closing separator after the AI response ends.
 *
 *   [blank line]
 *   provider/model · N tokens · free
 *   ────────────────────────────────────────
 *   [blank line]
 */
function printAIResponseEnd(footerLine) {
    const cols = process.stdout.columns || 80;
    const lineW = Math.min(cols - 4, 72);
    process.stdout.write('\n');
    if (footerLine) {
        process.stdout.write(chalk_1.default.dim('  ' + footerLine) + '\n');
    }
    process.stdout.write(chalk_1.default.dim('  ' + '─'.repeat(lineW)) + '\n\n');
}
// ─── Public entry point ───────────────────────────────────────────────────────
/**
 * Read one message from the user.
 *
 * TTY  → bordered box, raw keypresses, 80 ms drain to discard buffered input.
 * Pipe → simple readline (no box).
 */
async function readInputWithBox() {
    if (!isTTYMode()) {
        return readLineRaw();
    }
    return readLineBoxed();
}
// ─── Non-TTY fallback ─────────────────────────────────────────────────────────
function readLineRaw() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, terminal: false });
        let got = false;
        rl.once('line', (line) => {
            got = true;
            rl.close();
            resolve({ text: line.trim(), eof: false });
        });
        rl.once('close', () => {
            if (!got)
                resolve({ text: '', eof: true });
        });
    });
}
// ─── TTY boxed input ──────────────────────────────────────────────────────────
/**
 * How long (ms) to discard incoming keystrokes after entering raw mode.
 * This drains any keys the user may have typed while the AI was responding —
 * those are buffered by the kernel and would otherwise fire immediately.
 */
const DRAIN_MS = 20; // Keep short — 80ms was eating pasted text
function readLineBoxed() {
    return new Promise((resolve) => {
        let buffer = '';
        // ── Draw initial empty box ────────────────────────────────────────────
        process.stdout.write('\n');
        drawInputBox('');
        // ── Enable keypresses ─────────────────────────────────────────────────
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        // ── Drain window — discard buffered keystrokes ────────────────────────
        // Keys typed during the AI response are buffered by the kernel.
        // We ignore them for DRAIN_MS so they never reach the input box.
        let ready = false;
        const drainTimer = setTimeout(() => { ready = true; }, DRAIN_MS);
        // ── Helpers ───────────────────────────────────────────────────────────
        /** Redraw box in-place. Cursor must be at end of the bottom border line. */
        function redraw() {
            // \x1b[2F  →  move 2 lines up, go to column 0
            // (box = 3 lines; cursor is at end of line 3, so 2 up = start of line 1)
            process.stdout.write('\x1b[2F');
            drawInputBox(buffer);
        }
        function cleanup() {
            clearTimeout(drainTimer);
            process.stdin.removeListener('keypress', onKey);
            try {
                process.stdin.setRawMode(false);
            }
            catch { /* ignore */ }
        }
        // ── Keypress handler ──────────────────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function onKey(str, key) {
            if (!key)
                return;
            // ── Always handle hard-exit regardless of drain ───────────────────
            if (key.ctrl && key.name === 'c') {
                cleanup();
                // Reset terminal fully before exit
                process.stdout.write('\x1b[?25h'); // show cursor
                process.stdout.write('\x1b[0m'); // reset colors
                process.stdout.write('\n');
                // Ensure raw mode is off and terminal is sane
                try {
                    process.stdin.setRawMode(false);
                }
                catch { /* */ }
                try {
                    process.stdin.pause();
                }
                catch { /* */ }
                process.exit(0);
            }
            // ── Drain window: discard buffered keystrokes ─────────────────────
            if (!ready)
                return;
            // ── EOF / Ctrl+D ──────────────────────────────────────────────────
            if (key.ctrl && key.name === 'd') {
                cleanup();
                process.stdout.write('\n');
                const text = buffer.trim();
                resolve({ text, eof: text.length === 0 });
                return;
            }
            // ── Submit ────────────────────────────────────────────────────────
            if (key.name === 'return' || key.name === 'enter') {
                const text = buffer.trim();
                if (text.length === 0) {
                    // Empty enter — just redraw box, don't submit
                    redraw();
                    return;
                }
                buffer = '';
                cleanup();
                process.stdout.write('\n'); // move cursor below the box
                resolve({ text, eof: false });
                return;
            }
            // ── Backspace ─────────────────────────────────────────────────────
            if (key.name === 'backspace') {
                if (buffer.length > 0) {
                    buffer = buffer.slice(0, -1);
                    redraw();
                }
                return;
            }
            // ── Ctrl+U — clear entire line ────────────────────────────────────
            if (key.ctrl && key.name === 'u') {
                buffer = '';
                redraw();
                return;
            }
            // ── Ctrl+W — delete last word ─────────────────────────────────────
            if (key.ctrl && key.name === 'w') {
                buffer = buffer.replace(/\S+\s*$/, '');
                redraw();
                return;
            }
            // ── Ignore navigation / function keys ─────────────────────────────
            if (key.name && [
                'left', 'right', 'up', 'down',
                'home', 'end', 'pageup', 'pagedown',
                'tab', 'escape', 'delete', 'insert',
                'f1', 'f2', 'f3', 'f4', 'f5', 'f6',
                'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
            ].includes(key.name)) {
                return;
            }
            // ── Regular printable character (or pasted chunk) ────────────────
            if (str && str.length > 0 && !key.ctrl && !key.meta) {
                // Pasted text can arrive as multi-char string — append all at once
                const clean = str.replace(/[\r\n]/g, ''); // strip newlines from paste
                if (clean.length > 0) {
                    buffer += clean;
                    redraw();
                }
            }
        }
        process.stdin.on('keypress', onKey);
    });
}
//# sourceMappingURL=chat-input.js.map