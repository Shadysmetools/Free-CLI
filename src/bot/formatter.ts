/**
 * formatter.ts — Convert AI output to Telegram HTML format
 *
 * OpenClaw uses HTML parse mode (not MarkdownV2) because HTML escaping
 * is simpler and more reliable. This module converts AI markdown output
 * to Telegram-safe HTML.
 *
 * Reference: https://core.telegram.org/bots/api#html-style
 */

const TELEGRAM_CHUNK_SIZE = 4000;

// ─── HTML Escaping ────────────────────────────────────────────────────────────

/** Escape special HTML characters for Telegram HTML mode */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Markdown → Telegram HTML ─────────────────────────────────────────────────

/**
 * Convert markdown-style AI output to Telegram HTML.
 * Handles: fenced code blocks, inline code, **bold**, *italic*, ### headers,
 * bullet lists, blockquotes, and bare URLs.
 */
export function formatForTelegram(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  for (const line of lines) {
    // ── Fenced code block ──────────────────────────────────────────────────
    const fenceMatch = line.match(/^```(\w*)$/);
    if (fenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = fenceMatch[1] || '';
        codeLines = [];
      } else {
        inCodeBlock = false;
        const escaped = escapeHtml(codeLines.join('\n'));
        const langComment = codeLang ? `<code class="language-${codeLang}">` : '<code>';
        result.push(`<pre>${langComment}${escaped}</code></pre>`);
        codeLines = [];
        codeLang = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // ── Headers → bold ─────────────────────────────────────────────────────
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      result.push(`<b>${escapeHtml(headerMatch[2])}</b>`);
      continue;
    }

    // ── Horizontal rule ────────────────────────────────────────────────────
    if (/^---+$/.test(line.trim())) {
      result.push('─────────────────');
      continue;
    }

    // ── Process inline markdown ────────────────────────────────────────────
    result.push(processInlineLine(line));
  }

  // Close unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    const escaped = escapeHtml(codeLines.join('\n'));
    result.push(`<pre><code>${escaped}</code></pre>`);
  }

  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Process a single line for inline markdown elements.
 * Handles: `inline code`, **bold**, *italic*, _italic_, ~~strikethrough~~,
 * bullet lists, blockquotes, and URLs.
 */
function processInlineLine(line: string): string {
  // Blockquote
  if (line.startsWith('> ')) {
    return '<blockquote>' + processInlineMarkup(line.slice(2)) + '</blockquote>';
  }

  // Bullet list
  const bulletMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
  if (bulletMatch) {
    const indent = bulletMatch[1].length;
    const marker = /^\d/.test(bulletMatch[2]) ? '  ' : '  •';
    const prefix = indent > 0 ? '    '.repeat(Math.floor(indent / 2)) : '';
    return `${prefix}${marker} ${processInlineMarkup(bulletMatch[3])}`;
  }

  return processInlineMarkup(line);
}

/**
 * Process inline markup within a text segment.
 * Extracts code spans first, then applies other formatting.
 */
function processInlineMarkup(text: string): string {
  // Split out inline code spans to avoid formatting inside them
  const parts: Array<{ type: 'code' | 'text'; content: string }> = [];
  let remaining = text;
  let searchFrom = 0;
  const codeRegex = /`([^`]+)`/g;
  let match: RegExpExecArray | null;

  // Reset regex
  codeRegex.lastIndex = 0;
  let lastEnd = 0;

  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > lastEnd) {
      parts.push({ type: 'text', content: text.slice(lastEnd, match.index) });
    }
    parts.push({ type: 'code', content: match[1] });
    lastEnd = match.index + match[0].length;
  }

  if (lastEnd < text.length) {
    parts.push({ type: 'text', content: text.slice(lastEnd) });
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', content: remaining });
  }

  return parts.map(part => {
    if (part.type === 'code') {
      return `<code>${escapeHtml(part.content)}</code>`;
    }

    let t = escapeHtml(part.content);

    // **bold** or __bold__
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    t = t.replace(/__([^_\n]+)__/g, '<b>$1</b>');

    // *italic* or _italic_ (single)
    t = t.replace(/(?<!\*)\*(?!\*)([^*\n]+)(?<!\*)\*(?!\*)/g, '<i>$1</i>');
    t = t.replace(/(?<!_)_(?!_)([^_\n]+)(?<!_)_(?!_)/g, '<i>$1</i>');

    // ~~strikethrough~~
    t = t.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');

    return t;
  }).join('');
}

// ─── Message Splitting ─────────────────────────────────────────────────────────

/**
 * Split a long HTML message into chunks ≤ maxLength chars.
 * Respects paragraph and line boundaries. Never splits inside HTML tags.
 *
 * OpenClaw reference: channels.telegram.chunkMode = "newline" (paragraph splits)
 */
export function splitMessage(text: string, maxLength = TELEGRAM_CHUNK_SIZE): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = maxLength;

    // Try paragraph boundary (double newline)
    const paraIdx = remaining.lastIndexOf('\n\n', maxLength);
    if (paraIdx > maxLength * 0.4) {
      splitAt = paraIdx + 2;
    } else {
      // Try line boundary
      const lineIdx = remaining.lastIndexOf('\n', maxLength);
      if (lineIdx > maxLength * 0.4) {
        splitAt = lineIdx + 1;
      }
      // Otherwise hard-split at maxLength
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.trim().length > 0) {
    chunks.push(remaining.trimEnd());
  }

  return chunks.filter(c => c.length > 0);
}

// ─── Special formatters ────────────────────────────────────────────────────────

/** Format a tool call notification */
export function formatToolCall(toolName: string, args: Record<string, unknown>): string {
  const argsStr = Object.entries(args)
    .slice(0, 3)
    .map(([k, v]) => `${escapeHtml(k)}=<code>${escapeHtml(String(v).slice(0, 60))}</code>`)
    .join(', ');
  return `🔧 <code>${escapeHtml(toolName)}</code>(${argsStr})`;
}

/** Format an error for Telegram */
export function formatError(message: string): string {
  return `❌ <b>Error</b>\n<code>${escapeHtml(message.slice(0, 500))}</code>`;
}

/** Format a success message */
export function formatSuccess(message: string): string {
  return `✅ ${escapeHtml(message)}`;
}

/** Truncate output to stay within limits */
export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = maxChars - 40;
  return text.slice(0, truncated) + `\n\n<i>[truncated ${text.length - truncated} chars]</i>`;
}

/** Format a status/info block */
export function formatStatus(title: string, items: Array<[string, string]>): string {
  const rows = items.map(([k, v]) => `  <b>${escapeHtml(k)}:</b> ${escapeHtml(v)}`).join('\n');
  return `<b>${escapeHtml(title)}</b>\n${rows}`;
}

/** Format a code block with optional language */
export function formatCode(code: string, lang = ''): string {
  return `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`;
}

/** Format a list of items as bullet points */
export function formatList(title: string, items: string[]): string {
  const bullets = items.map(i => `  • ${escapeHtml(i)}`).join('\n');
  return `<b>${escapeHtml(title)}</b>\n${bullets}`;
}
