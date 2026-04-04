"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMarkdown = renderMarkdown;
exports.renderMarkdownCompact = renderMarkdownCompact;
const chalk_1 = __importDefault(require("chalk"));
const c = chalk_1.default;
// Simple terminal markdown renderer
function renderMarkdown(text) {
    // Code blocks
    text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
        const trimmed = code.trimEnd();
        const lines = trimmed.split('\n').map((line) => `  ${c.white(line)}`).join('\n');
        const header = lang ? `  ${c.dim(`─── ${lang} ───`)}` : `  ${c.dim('─────────')}`;
        return `\n${header}\n${lines}\n  ${c.dim('─────────')}\n`;
    });
    // Inline code
    text = text.replace(/`([^`]+)`/g, (_, code) => c.bgBlack.white(` ${code} `));
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, (_, t) => c.bold(t));
    // Italic
    text = text.replace(/\*(.+?)\*/g, (_, t) => c.italic(t));
    // Headers
    text = text.replace(/^### (.+)$/gm, (_, t) => c.bold.cyan(t));
    text = text.replace(/^## (.+)$/gm, (_, t) => c.bold.cyan('▌ ' + t));
    text = text.replace(/^# (.+)$/gm, (_, t) => c.bold.cyan('▌▌ ' + t));
    // Bullet points
    text = text.replace(/^- (.+)$/gm, (_, t) => `  ${c.cyan('•')} ${t}`);
    text = text.replace(/^\* (.+)$/gm, (_, t) => `  ${c.cyan('•')} ${t}`);
    // Numbered lists
    text = text.replace(/^(\d+)\. (.+)$/gm, (_, n, t) => `  ${c.cyan(n + '.')} ${t}`);
    // Blockquotes
    text = text.replace(/^> (.+)$/gm, (_, t) => `  ${c.dim('│')} ${c.dim(t)}`);
    return text;
}
function renderMarkdownCompact(text) {
    // Strip most formatting for compact display
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