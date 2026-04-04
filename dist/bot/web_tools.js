"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEB_TOOL_DEFS = void 0;
exports.executeWebSearch = executeWebSearch;
exports.executeWebFetch = executeWebFetch;
exports.executeApiCall = executeApiCall;
const axios_1 = __importDefault(require("axios"));
// ─── web_search ────────────────────────────────────────────────────────────────
/**
 * Search the web using DuckDuckGo Instant Answer API (free, no key needed).
 * Falls back to Brave Search API if BRAVE_SEARCH_KEY is set.
 */
async function executeWebSearch(query) {
    if (!query?.trim()) {
        return { content: 'Error: query is required', isError: true };
    }
    const braveKey = process.env.BRAVE_SEARCH_KEY;
    if (braveKey) {
        return searchWithBrave(query, braveKey);
    }
    return searchWithDuckDuckGo(query);
}
async function searchWithDuckDuckGo(query) {
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const resp = await axios_1.default.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; coderaw-bot/1.0)',
            },
        });
        const data = resp.data;
        const parts = [`🔍 Web Search: "${query}"\n`];
        // Abstract (main result)
        if (data.Abstract) {
            parts.push(`📄 **Summary:** ${data.Abstract}`);
            if (data.AbstractURL)
                parts.push(`🔗 Source: ${data.AbstractURL}`);
            parts.push('');
        }
        // Answer (instant answer)
        if (data.Answer) {
            parts.push(`💡 **Answer:** ${data.Answer}`);
            parts.push('');
        }
        // Definition
        if (data.Definition) {
            parts.push(`📖 **Definition:** ${data.Definition}`);
            parts.push('');
        }
        // Related topics
        if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            parts.push('🔗 **Related:**');
            const topics = data.RelatedTopics.slice(0, 5);
            for (const t of topics) {
                if (t.Text && t.FirstURL) {
                    parts.push(`  • ${t.Text.slice(0, 120)}`);
                    parts.push(`    ${t.FirstURL}`);
                }
            }
            parts.push('');
        }
        // Results (web links)
        if (data.Results && data.Results.length > 0) {
            parts.push('📋 **Results:**');
            for (const r of data.Results.slice(0, 5)) {
                if (r.Text && r.FirstURL) {
                    parts.push(`  • ${r.Text.slice(0, 120)}`);
                    parts.push(`    ${r.FirstURL}`);
                }
            }
        }
        if (parts.length <= 1) {
            // No useful results from DDG instant answer — suggest a URL to visit
            parts.push(`No instant answer found. Try searching at:`);
            parts.push(`  https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
            parts.push(`  https://www.google.com/search?q=${encodeURIComponent(query)}`);
        }
        return { content: parts.join('\n') };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Search failed: ${msg}`, isError: true };
    }
}
async function searchWithBrave(query, apiKey) {
    try {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
        const resp = await axios_1.default.get(url, {
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip',
                'X-Subscription-Token': apiKey,
            },
        });
        const data = resp.data;
        const parts = [`🔍 Web Search: "${query}"\n`];
        const results = data.web?.results ?? [];
        if (results.length === 0) {
            return { content: `No results found for: "${query}"` };
        }
        for (const r of results) {
            parts.push(`📄 **${r.title}**`);
            if (r.description)
                parts.push(`   ${r.description}`);
            parts.push(`   🔗 ${r.url}`);
            parts.push('');
        }
        return { content: parts.join('\n') };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Brave search failed: ${msg}`, isError: true };
    }
}
// ─── web_fetch ─────────────────────────────────────────────────────────────────
/**
 * Fetch a URL and return its text content, with HTML stripped.
 */
async function executeWebFetch(url, maxChars = 8000) {
    if (!url?.trim()) {
        return { content: 'Error: url is required', isError: true };
    }
    // Basic URL validation
    try {
        new URL(url);
    }
    catch {
        return { content: `Error: invalid URL: ${url}`, isError: true };
    }
    try {
        const resp = await axios_1.default.get(url, {
            timeout: 15000,
            maxContentLength: 5 * 1024 * 1024, // 5MB
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; coderaw-bot/1.0; +https://github.com/Shadysmetools/knowcap-code)',
                'Accept': 'text/html,application/xhtml+xml,application/xml,text/plain,*/*',
            },
            responseType: 'text',
        });
        const raw = resp.data ?? '';
        const contentType = resp.headers['content-type'] ?? '';
        let text;
        if (contentType.includes('json')) {
            // Return pretty-printed JSON
            try {
                text = JSON.stringify(JSON.parse(raw), null, 2);
            }
            catch {
                text = raw;
            }
        }
        else if (contentType.includes('text/plain')) {
            text = raw;
        }
        else {
            // Strip HTML
            text = stripHtml(raw);
        }
        // Truncate
        const truncated = text.length > maxChars
            ? text.slice(0, maxChars) + `\n\n... [truncated at ${maxChars} chars, total: ${text.length}]`
            : text;
        return {
            content: `🌐 Fetched: ${url}\n\n${truncated}`,
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Fetch failed: ${msg}`, isError: true };
    }
}
/** Strip HTML tags and decode common entities to plain text */
function stripHtml(html) {
    // Remove script and style blocks entirely
    let text = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
        .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
        .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
        .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ');
    // Block elements → newlines
    text = text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(p|div|h[1-6]|li|tr|blockquote|section|article|main)[^>]*>/gi, '\n');
    // Remove all remaining tags
    text = text.replace(/<[^>]+>/g, '');
    // Decode HTML entities
    text = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
    // Clean up whitespace
    text = text
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text;
}
/**
 * Make an HTTP request to an external API.
 * Supports GET/POST/PUT/PATCH/DELETE with custom headers and body.
 */
async function executeApiCall(args) {
    const { url, method = 'GET', headers = {}, body, timeout_ms = 15000 } = args;
    if (!url?.trim()) {
        return { content: 'Error: url is required', isError: true };
    }
    try {
        new URL(url);
    }
    catch {
        return { content: `Error: invalid URL: ${url}`, isError: true };
    }
    try {
        let parsedBody = undefined;
        if (body) {
            try {
                parsedBody = JSON.parse(body);
            }
            catch {
                parsedBody = body; // send as raw string
            }
        }
        const resp = await (0, axios_1.default)({
            method,
            url,
            headers: {
                'User-Agent': 'coderaw-bot/1.0',
                ...headers,
            },
            data: parsedBody,
            timeout: timeout_ms,
            validateStatus: () => true, // Don't throw on non-2xx
        });
        const status = resp.status;
        const respHeaders = Object.entries(resp.headers)
            .slice(0, 6)
            .map(([k, v]) => `  ${k}: ${v}`)
            .join('\n');
        let respBody;
        if (typeof resp.data === 'object') {
            respBody = JSON.stringify(resp.data, null, 2);
        }
        else {
            respBody = String(resp.data ?? '');
        }
        // Truncate large responses
        if (respBody.length > 8000) {
            respBody = respBody.slice(0, 8000) + '\n... [truncated]';
        }
        const statusEmoji = status < 300 ? '✅' : status < 400 ? '↩️' : '❌';
        return {
            content: `${statusEmoji} ${method} ${url}\nStatus: ${status}\n\nHeaders:\n${respHeaders}\n\nBody:\n${respBody}`,
            isError: status >= 400,
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `API call failed: ${msg}`, isError: true };
    }
}
// ─── Tool definitions (for AI schema) ─────────────────────────────────────────
exports.WEB_TOOL_DEFS = [
    {
        name: 'web_search',
        description: 'Search the web for current information, news, documentation, or any topic. Uses DuckDuckGo (free) or Brave Search.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query. Be specific for better results.',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'web_fetch',
        description: 'Fetch and read the content of a URL. Strips HTML and returns readable text. Use for reading docs, articles, or web pages.',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The full URL to fetch (must start with http:// or https://)',
                },
                max_chars: {
                    type: 'number',
                    description: 'Maximum characters to return (default: 8000)',
                },
            },
            required: ['url'],
        },
    },
    {
        name: 'api_call',
        description: 'Make HTTP requests to external APIs. Supports GET/POST/PUT/PATCH/DELETE with custom headers and JSON body.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Full URL to request' },
                method: {
                    type: 'string',
                    enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
                    description: 'HTTP method (default: GET)',
                },
                headers: {
                    type: 'object',
                    description: 'Request headers as key-value pairs',
                    additionalProperties: { type: 'string' },
                },
                body: {
                    type: 'string',
                    description: 'Request body (JSON string or plain text)',
                },
                timeout_ms: {
                    type: 'number',
                    description: 'Request timeout in milliseconds (default: 15000)',
                },
            },
            required: ['url'],
        },
    },
];
//# sourceMappingURL=web_tools.js.map