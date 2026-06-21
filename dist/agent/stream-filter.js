"use strict";
/**
 * Streaming visibility filter for Claude-Code-style output.
 *
 * Local models (e.g. Qwen2.5-Coder on Ollama) frequently emit their tool calls
 * as JSON *text* in the streamed content rather than via the native tool_calls
 * field (see recoverFromStreamedContent in providers/ollama.ts). When we stream
 * on every iteration, that raw tool-call JSON would leak to the user's terminal.
 *
 * StreamFilter sits between the provider's onToken callback and stdout. It looks
 * at the FIRST non-whitespace character of the assistant's message to decide,
 * once, whether the whole message is user-facing prose or a tool-call blob:
 *   - prose  → every token is shown verbatim (and any buffered leading
 *              whitespace is flushed first), and
 *   - tool   → all tokens are withheld from the visible stream.
 *
 * The agent loop still runs the model's full content through the tool-call
 * recovery path afterwards, so suppressed tool JSON is never lost — it's just
 * not printed mid-stream.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamFilter = void 0;
exports.looksLikeToolCallStart = looksLikeToolCallStart;
/**
 * Does this (possibly partial) accumulated text begin like a tool call rather
 * than user-facing prose? Mirrors the signals in looksLikeToolAttempt and the
 * recoverToolCallsFromText markers: a leading JSON object, a ```json fence, or a
 * <tool_call> tag. Leading whitespace is ignored.
 */
function looksLikeToolCallStart(text) {
    const t = (text || '').replace(/^\s+/, '');
    if (!t)
        return false;
    if (t.startsWith('<tool_call>'))
        return true;
    if (/^```(?:json)?/i.test(t))
        return true;
    // A message DOMINATED by a JSON object (starts with '{') is how local models
    // emit tool calls as text. Prose like "Use the object { count: 2 }" does not
    // start with '{', so it is unaffected.
    if (t.startsWith('{'))
        return true;
    return false;
}
/**
 * While streaming char-by-char, the leading non-whitespace text may be an
 * incomplete PREFIX of a tool marker (e.g. "<too" on the way to "<tool_call>",
 * or "``" on the way to a ```json fence). In that case we must keep buffering
 * rather than prematurely committing the stream to prose. Returns true when the
 * accumulated text is still a viable prefix of a tool-call marker.
 */
function couldBecomeToolMarker(text) {
    const t = (text || '').replace(/^\s+/, '');
    if (!t)
        return true; // only whitespace so far — undecided
    return '<tool_call>'.startsWith(t) || '```'.startsWith(t.slice(0, 3));
}
class StreamFilter {
    constructor() {
        this.acc = '';
        this.decided = 'unknown';
    }
    /**
     * Feed the next streamed token. Returns the substring (possibly empty) that
     * should be written to the user's terminal right now.
     */
    push(token) {
        if (!token)
            return '';
        this.acc += token;
        if (this.decided === 'tool')
            return '';
        if (this.decided === 'prose')
            return token;
        // Still undecided. If we have only whitespace so far, keep buffering — we
        // can't yet tell prose from a tool blob, and we want to preserve any leading
        // whitespace if it turns out to be prose.
        if (this.acc.trim() === '')
            return '';
        // First non-whitespace character has arrived. If it confidently matches a
        // tool marker, suppress. If it could still GROW into one (an incomplete
        // "<tool_call>" / "```" prefix), keep buffering. Otherwise it's prose.
        if (looksLikeToolCallStart(this.acc)) {
            this.decided = 'tool';
            return '';
        }
        if (couldBecomeToolMarker(this.acc))
            return '';
        this.decided = 'prose';
        // Flush everything accumulated so far (includes any leading whitespace).
        return this.acc;
    }
    /** Call once the stream ends. Flushes any buffer still held while undecided. */
    flush() {
        if (this.decided === 'prose')
            return '';
        if (this.decided === 'tool')
            return '';
        // Undecided at end-of-stream means we only ever saw whitespace (or nothing).
        // Treat trailing-only whitespace as prose-safe to show.
        const pending = this.acc;
        this.decided = looksLikeToolCallStart(this.acc) ? 'tool' : 'prose';
        return this.decided === 'tool' ? '' : pending;
    }
    /** True once the filter has classified the stream as a tool-call blob. */
    get suppressed() {
        return this.decided === 'tool';
    }
}
exports.StreamFilter = StreamFilter;
//# sourceMappingURL=stream-filter.js.map