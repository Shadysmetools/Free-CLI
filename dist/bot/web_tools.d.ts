/**
 * web_tools.ts — Web search, fetch, and API call tool implementations
 *
 * Free tools (no API key needed by default):
 *   web_search  — DuckDuckGo Instant Answer API (free, no key)
 *   web_fetch   — Fetch URL content, strip HTML to readable text
 *   api_call    — HTTP requests to external APIs
 *
 * Optional: Set BRAVE_SEARCH_KEY env var for richer web search results.
 */
export interface ToolResult {
    content: string;
    isError?: boolean;
}
/**
 * Search the web using DuckDuckGo Instant Answer API (free, no key needed).
 * Falls back to Brave Search API if BRAVE_SEARCH_KEY is set.
 */
export declare function executeWebSearch(query: string): Promise<ToolResult>;
/**
 * Fetch a URL and return its text content, with HTML stripped.
 */
export declare function executeWebFetch(url: string, maxChars?: number): Promise<ToolResult>;
export interface ApiCallArgs {
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
    timeout_ms?: number;
}
/**
 * Make an HTTP request to an external API.
 * Supports GET/POST/PUT/PATCH/DELETE with custom headers and body.
 */
export declare function executeApiCall(args: ApiCallArgs): Promise<ToolResult>;
export declare const WEB_TOOL_DEFS: readonly [{
    readonly name: "web_search";
    readonly description: "Search the web for current information, news, documentation, or any topic. Uses DuckDuckGo (free) or Brave Search.";
    readonly parameters: {
        readonly type: "object";
        readonly properties: {
            readonly query: {
                readonly type: "string";
                readonly description: "The search query. Be specific for better results.";
            };
        };
        readonly required: readonly ["query"];
    };
}, {
    readonly name: "web_fetch";
    readonly description: "Fetch and read the content of a URL. Strips HTML and returns readable text. Use for reading docs, articles, or web pages.";
    readonly parameters: {
        readonly type: "object";
        readonly properties: {
            readonly url: {
                readonly type: "string";
                readonly description: "The full URL to fetch (must start with http:// or https://)";
            };
            readonly max_chars: {
                readonly type: "number";
                readonly description: "Maximum characters to return (default: 8000)";
            };
        };
        readonly required: readonly ["url"];
    };
}, {
    readonly name: "api_call";
    readonly description: "Make HTTP requests to external APIs. Supports GET/POST/PUT/PATCH/DELETE with custom headers and JSON body.";
    readonly parameters: {
        readonly type: "object";
        readonly properties: {
            readonly url: {
                readonly type: "string";
                readonly description: "Full URL to request";
            };
            readonly method: {
                readonly type: "string";
                readonly enum: readonly ["GET", "POST", "PUT", "PATCH", "DELETE"];
                readonly description: "HTTP method (default: GET)";
            };
            readonly headers: {
                readonly type: "object";
                readonly description: "Request headers as key-value pairs";
                readonly additionalProperties: {
                    readonly type: "string";
                };
            };
            readonly body: {
                readonly type: "string";
                readonly description: "Request body (JSON string or plain text)";
            };
            readonly timeout_ms: {
                readonly type: "number";
                readonly description: "Request timeout in milliseconds (default: 15000)";
            };
        };
        readonly required: readonly ["url"];
    };
}];
//# sourceMappingURL=web_tools.d.ts.map