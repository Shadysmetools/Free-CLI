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
/**
 * Does this (possibly partial) accumulated text begin like a tool call rather
 * than user-facing prose? Mirrors the signals in looksLikeToolAttempt and the
 * recoverToolCallsFromText markers: a leading JSON object, a ```json fence, or a
 * <tool_call> tag. Leading whitespace is ignored.
 */
export declare function looksLikeToolCallStart(text: string): boolean;
export declare class StreamFilter {
    private acc;
    private decided;
    /**
     * Feed the next streamed token. Returns the substring (possibly empty) that
     * should be written to the user's terminal right now.
     */
    push(token: string): string;
    /** Call once the stream ends. Flushes any buffer still held while undecided. */
    flush(): string;
    /** True once the filter has classified the stream as a tool-call blob. */
    get suppressed(): boolean;
}
//# sourceMappingURL=stream-filter.d.ts.map