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

import * as readline from 'readline';
import chalk from 'chalk';

// ─── Pure helpers (unit-tested) ────────────────────────────────────────────────

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
export function sanitizePaste(str: string): string {
  if (!str) return '';

  let s = str;

  // Strip bracketed-paste markers if the terminal forwarded them inline.
  s = s.replace(/\x1b\[20[01]~/g, '');

  // A single trailing CR is the terminal's Enter echo, not a real line break.
  if (s.endsWith('\r') && !s.endsWith('\r\n')) {
    s = s.slice(0, -1);
  }

  // Normalise all remaining CR / CRLF to LF.
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove stray escape sequences (CSI / OSC) that some pastes carry.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/\x1b\[[0-9;]*[A-Za-z~]/g, '');

  // Drop remaining C0 control chars except newline (\n) and tab (\t).
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

  return s;
}

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
export function resolveSubmit(buffer: string): SubmitDecision {
  const match = buffer.match(/\\+$/);
  const trailing = match ? match[0].length : 0;

  if (trailing % 2 === 1) {
    // Odd → continuation: drop the marker backslash, add a newline.
    return { submit: false, buffer: buffer.slice(0, -1) + '\n' };
  }

  return { submit: true, buffer };
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

function getInnerWidth(): number {
  const cols = process.stdout.columns || 80;
  return Math.min(cols - 4, 70); // content width inside │ borders
}

/** Whether stdin+stdout are both interactive terminals. */
export function isTTYMode(): boolean {
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
export function drawInputBox(text: string): void {
  const inner = getInnerWidth();
  const label  = ' \uD83D\uDCAC Message '; // "💬 Message " — emoji takes 2 visual cols
  const dashes = Math.max(1, inner - label.length - 1);

  const top = chalk.cyan('┌─' + label + '─'.repeat(dashes) + '┐');

  const maxContent = inner - 2;

  // For multi-line buffers, the box shows the line currently being edited
  // (the last line). A leading "↵ " marker signals earlier lines are buffered.
  const newlineCount = (text.match(/\n/g) || []).length;
  const lastLine = newlineCount > 0 ? text.slice(text.lastIndexOf('\n') + 1) : text;
  const display = newlineCount > 0 ? '↵ ' + lastLine : lastLine;

  let vis: string;
  if (display.length > maxContent) {
    // Show "…" prefix to indicate truncated display (full text still in buffer)
    vis = '…' + display.slice(display.length - maxContent + 1);
  } else {
    vis = display;
  }
  const mid = chalk.cyan('│ ') + vis.padEnd(maxContent, ' ') + chalk.cyan(' │');

  const bot = chalk.cyan('└' + '─'.repeat(inner) + '┘');

  process.stdout.write(top + '\n' + mid + '\n' + bot);
}

// ─── Thinking indicator ───────────────────────────────────────────────────────

/**
 * Show "⏳ Thinking..." on the current blank line (TTY only).
 * Uses \r so printAIResponseStart() can overwrite it cleanly.
 * Call immediately after the user presses Enter, before runAgent().
 */
export function printThinking(tty: boolean): void {
  if (tty) {
    process.stdout.write(chalk.dim('  ⏳ Thinking...\r'));
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
export function printAIResponseStart(hadThinking = false): void {
  const cols  = process.stdout.columns || 80;
  const lineW = Math.min(cols - 4, 72);

  if (hadThinking) {
    // Overwrite the "⏳ Thinking..." on the current line
    process.stdout.write('\x1b[2K\r');               // clear line → col 0
    process.stdout.write(chalk.bold.green('  🤖 AI') + '\n');
  } else {
    process.stdout.write('\n' + chalk.bold.green('  🤖 AI') + '\n');
  }

  process.stdout.write(chalk.dim('  ' + '─'.repeat(lineW)) + '\n');
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
export function printAIResponseEnd(footerLine?: string): void {
  const cols  = process.stdout.columns || 80;
  const lineW = Math.min(cols - 4, 72);

  process.stdout.write('\n');
  if (footerLine) {
    process.stdout.write(chalk.dim('  ' + footerLine) + '\n');
  }
  process.stdout.write(chalk.dim('  ' + '─'.repeat(lineW)) + '\n\n');
}

// ─── InputResult ─────────────────────────────────────────────────────────────

export interface InputResult {
  text: string;
  eof: boolean; // true when stdin closed (Ctrl+D / pipe ended) with no text
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Read one message from the user.
 *
 * TTY  → bordered box, raw keypresses, 80 ms drain to discard buffered input.
 * Pipe → simple readline (no box).
 */
// Track if we ever detected TTY (so inquirer can't break us)
let wasTTY: boolean | null = null;

export async function readInputWithBox(): Promise<InputResult> {
  const isTTY = isTTYMode();
  if (wasTTY === null) wasTTY = isTTY;

  // Use TTY mode if we EVER were TTY (inquirer may temporarily break isTTY)
  if (!wasTTY && !isTTY) {
    return readLineRaw();
  }

  // Ensure stdin is ready for raw mode after inquirer
  try {
    if (process.stdin.destroyed) {
      // stdin was destroyed (e.g. by inquirer) — can't recover
      return { text: '', eof: true };
    }
    process.stdin.resume();
  } catch { /* */ }

  return readLineBoxed();
}

// ─── Non-TTY fallback ─────────────────────────────────────────────────────────

function readLineRaw(): Promise<InputResult> {
  return new Promise((resolve) => {
    const rl  = readline.createInterface({ input: process.stdin, terminal: false });
    let got   = false;

    rl.once('line', (line) => {
      got = true;
      rl.close();
      resolve({ text: line.trim(), eof: false });
    });

    rl.once('close', () => {
      if (!got) resolve({ text: '', eof: true });
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

function readLineBoxed(): Promise<InputResult> {
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
    function redraw(): void {
      // \x1b[2F  →  move 2 lines up, go to column 0
      // (box = 3 lines; cursor is at end of line 3, so 2 up = start of line 1)
      process.stdout.write('\x1b[2F');
      drawInputBox(buffer);
    }

    function cleanup(): void {
      clearTimeout(drainTimer);
      process.stdin.removeListener('keypress', onKey);
      try { process.stdin.setRawMode(false); } catch { /* ignore */ }
    }

    // ── Keypress handler ──────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function onKey(str: string | undefined, key: any): void {
      if (!key) return;

      // ── Always handle hard-exit regardless of drain ───────────────────
      if (key.ctrl && key.name === 'c') {
        cleanup();
        // Reset terminal fully before exit
        process.stdout.write('\x1b[?25h');  // show cursor
        process.stdout.write('\x1b[0m');     // reset colors
        process.stdout.write('\n');
        // Ensure raw mode is off and terminal is sane
        try { process.stdin.setRawMode(false); } catch { /* */ }
        try { process.stdin.pause(); } catch { /* */ }
        process.exit(0);
      }

      // ── Drain window: discard buffered keystrokes ─────────────────────
      if (!ready) return;

      // ── EOF / Ctrl+D ──────────────────────────────────────────────────
      if (key.ctrl && key.name === 'd') {
        cleanup();
        process.stdout.write('\n');
        const text = buffer.trim();
        resolve({ text, eof: text.length === 0 });
        return;
      }

      // ── Submit (or continue onto a new line) ──────────────────────────
      if (key.name === 'return' || key.name === 'enter') {
        // Trailing-backslash continuation → insert a newline, keep editing.
        const decision = resolveSubmit(buffer);
        if (!decision.submit) {
          buffer = decision.buffer;
          redraw();
          return;
        }

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
        'f1','f2','f3','f4','f5','f6',
        'f7','f8','f9','f10','f11','f12',
      ].includes(key.name)) {
        return;
      }

      // ── Regular printable character (or pasted chunk) ────────────────
      if (str && str.length > 0 && !key.ctrl && !key.meta) {
        // Pasted text can arrive as a multi-char string — append all at once.
        // sanitizePaste() PRESERVES embedded newlines (so pasted multi-line
        // text keeps its structure) while cleaning terminal artefacts.
        const clean = sanitizePaste(str);
        if (clean.length > 0) {
          buffer += clean;
          redraw();
        }
      }
    }

    process.stdin.on('keypress', onKey);
  });
}
