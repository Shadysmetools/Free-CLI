"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMarkdown = renderMarkdown;
exports.renderMarkdownCompact = renderMarkdownCompact;
const chalk_1 = __importDefault(require("chalk"));
const c = chalk_1.default;
// ─── Code block syntax highlighter (no external package needed) ───────────────
function highlightLine(line, lang) {
    if (!lang || lang === 'plaintext' || lang === 'text')
        return c.white(line);
    let result = line;
    // Comments — must come first so they aren't re-processed
    const commentPatterns = [];
    if (['js', 'ts', 'javascript', 'typescript', 'go', 'java', 'c', 'cpp', 'cs', 'rust', 'swift'].includes(lang)) {
        commentPatterns.push(/\/\/.*/);
    }
    if (['py', 'python', 'rb', 'ruby', 'sh', 'bash', 'yaml', 'toml'].includes(lang)) {
        commentPatterns.push(/#.*/);
    }
    if (['html', 'xml'].includes(lang)) {
        commentPatterns.push(/<!--.*?-->/);
    }
    // Replace comments with placeholder, restore after other replacements
    const commentPlaceholders = [];
    for (const pat of commentPatterns) {
        result = result.replace(pat, (m) => {
            const idx = commentPlaceholders.length;
            commentPlaceholders.push(c.dim(m));
            return `\x00COMMENT${idx}\x00`;
        });
    }
    // Strings
    result = result.replace(/(["'`])((?:\\.|[^\\])*?)\1/g, (_, q, s) => c.green(`${q}${s}${q}`));
    // JS/TS/Python/Go keywords
    const kwColors = {
        blue: /\b(const|let|var|function|class|import|export|from|return|if|else|for|while|do|switch|case|break|continue|new|typeof|instanceof|async|await|try|catch|finally|throw|in|of|default|extends|implements|interface|type|enum|namespace|module|declare|abstract|public|private|protected|static|readonly|override|def|pass|yield|lambda|with|as|assert|del|raise|except|elif|global|nonlocal|and|or|not|is|None|True|False|func|package|import|var|go|chan|select|defer|goroutine|struct|map|range|nil|true|false|self|super|this)\b/,
    };
    for (const [color, pat] of Object.entries(kwColors)) {
        result = result.replace(pat, m => c[color]?.(m) ?? m);
    }
    // Numbers
    result = result.replace(/\b(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, m => c.yellow(m));
    // Restore comments
    for (let i = 0; i < commentPlaceholders.length; i++) {
        result = result.replace(`\x00COMMENT${i}\x00`, commentPlaceholders[i]);
    }
    return result;
}
// ─── Render markdown to terminal ──────────────────────────────────────────────
function renderMarkdown(text) {
    // ── Code blocks — bordered box ────────────────────────────────────────────
    text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
        const trimmed = code.trimEnd();
        const rawLines = trimmed.split('\n');
        const visibleWidth = rawLines.reduce((max, l) => Math.max(max, l.length), 0);
        const boxWidth = Math.min(Math.max(visibleWidth + 2, 20), 90);
        const langLabel = lang ? ` ${lang} ` : '';
        const topFill = '─'.repeat(Math.max(0, boxWidth - langLabel.length - 2));
        const top = `  ${c.dim('┌─')}${langLabel ? c.dim.italic(langLabel) : ''}${c.dim(topFill + '─┐')}`;
        const bottom = `  ${c.dim('└' + '─'.repeat(boxWidth) + '┘')}`;
        const contentLines = rawLines.map(rawLine => {
            const hl = highlightLine(rawLine, lang ?? '');
            const pad = Math.max(0, boxWidth - rawLine.length - 1);
            return `  ${c.dim('│')} ${hl}${' '.repeat(pad)}${c.dim('│')}`;
        });
        return '\n' + [top, ...contentLines, bottom].join('\n') + '\n';
    });
    // ── Inline code ───────────────────────────────────────────────────────────
    text = text.replace(/`([^`]+)`/g, (_, code) => c.bgBlack.white(` ${code} `));
    // ── Bold ──────────────────────────────────────────────────────────────────
    text = text.replace(/\*\*(.+?)\*\*/g, (_, t) => c.bold(t));
    // ── Italic ────────────────────────────────────────────────────────────────
    text = text.replace(/\*(.+?)\*/g, (_, t) => c.italic(t));
    // ── Headers ───────────────────────────────────────────────────────────────
    text = text.replace(/^### (.+)$/gm, (_, t) => c.bold.cyan(t));
    text = text.replace(/^## (.+)$/gm, (_, t) => c.bold.cyan('▌ ' + t));
    text = text.replace(/^# (.+)$/gm, (_, t) => c.bold.cyan('▌▌ ' + t));
    // ── Bullet points ─────────────────────────────────────────────────────────
    text = text.replace(/^- (.+)$/gm, (_, t) => `  ${c.cyan('•')} ${t}`);
    text = text.replace(/^\* (.+)$/gm, (_, t) => `  ${c.cyan('•')} ${t}`);
    // ── Numbered lists ────────────────────────────────────────────────────────
    text = text.replace(/^(\d+)\. (.+)$/gm, (_, n, t) => `  ${c.cyan(n + '.')} ${t}`);
    // ── Blockquotes ───────────────────────────────────────────────────────────
    text = text.replace(/^> (.+)$/gm, (_, t) => `  ${c.dim('│')} ${c.dim(t)}`);
    // ── Horizontal rules ──────────────────────────────────────────────────────
    text = text.replace(/^---+$/gm, c.dim('─'.repeat(50)));
    return text;
}
function renderMarkdownCompact(text) {
    text = text.replace(/```[\s\S]*?```/g, (match) => {
        const lines = match.split('\n').slice(1, -1);
        return lines.map((l) => `  ${l}`).join('\n');
    });
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/\*\*(.+?)\*\*/g, '$1');
    text = text.replace(/\*(.+?)\*/g, '$1');
    text = text.replace(/^#{1,3} (.+)$/gm, '$1');
    return text;
}
//# sourceMappingURL=markdown.js.map