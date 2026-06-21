"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaProvider = void 0;
exports.recoverToolCallsFromText = recoverToolCallsFromText;
exports.recoverFromStreamedContent = recoverFromStreamedContent;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const url_1 = require("url");
class OllamaProvider {
    constructor(model, baseUrl = 'http://localhost:11434') {
        this.model = model;
        this.baseUrl = baseUrl;
        this.name = 'ollama';
    }
    async isAvailable() {
        try {
            await this.httpGet(`${this.baseUrl}/api/tags`);
            return true;
        }
        catch {
            return false;
        }
    }
    async complete(options) {
        const { messages, tools, stream, onToken } = options;
        // Convert tools to Ollama format
        const ollamaTools = tools?.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }));
        const body = {
            model: this.model,
            messages: messages.map(m => ({
                role: m.role === 'tool' ? 'tool' : m.role,
                content: m.content,
                // Ollama expects tool-call arguments as an object, but we store them as a
                // JSON string internally. Parse them back for the outgoing request, else
                // Ollama 400s: "Value looks like object, but can't find closing '}'".
                tool_calls: m.tool_calls?.map(tc => ({
                    ...tc,
                    function: { name: tc.function.name, arguments: parseToolArgs(tc.function.arguments) },
                })),
                tool_call_id: m.tool_call_id,
            })),
            tools: ollamaTools,
            stream: stream && !!onToken,
            options: {
                temperature: 0.3,
            },
        };
        if (stream && onToken) {
            return this.streamComplete(body, onToken);
        }
        const response = await this.httpPost(`${this.baseUrl}/api/chat`, body);
        const data = JSON.parse(response);
        const msg = data.message || {};
        const content = msg.content || '';
        const rawToolCalls = msg.tool_calls;
        let tool_calls = rawToolCalls?.map((tc, i) => ({
            id: `call_${i}`,
            type: 'function',
            function: {
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc.function.arguments),
            },
        }));
        // Repair: some local models (notably Qwen2.5-Coder on Ollama) emit tool
        // calls as JSON text in `content` instead of the native `tool_calls` field.
        // Recover them so the agent loop can actually execute the call.
        let outContent = content;
        if (!tool_calls || tool_calls.length === 0) {
            const recovered = recoverToolCallsFromText(content);
            if (recovered.length > 0) {
                tool_calls = recovered;
                outContent = '';
            }
        }
        return {
            content: outContent,
            tool_calls,
            usage: {
                prompt_tokens: data.prompt_eval_count || 0,
                completion_tokens: data.eval_count || 0,
                total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
            },
        };
    }
    async streamComplete(body, onToken) {
        return new Promise((resolve, reject) => {
            const bodyStr = JSON.stringify({ ...body, stream: true });
            const url = new url_1.URL(`${this.baseUrl}/api/chat`);
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
            };
            const lib = url.protocol === 'https:' ? https : http;
            let fullContent = '';
            let totalPromptTokens = 0;
            let totalCompletionTokens = 0;
            let nativeToolCalls;
            const req = lib.request(options, (res) => {
                res.on('data', (chunk) => {
                    const lines = chunk.toString().split('\n').filter(Boolean);
                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line);
                            if (data.message?.content) {
                                fullContent += data.message.content;
                                onToken(data.message.content);
                            }
                            if (data.message?.tool_calls?.length) {
                                nativeToolCalls = data.message.tool_calls;
                            }
                            if (data.done) {
                                totalPromptTokens = data.prompt_eval_count || 0;
                                totalCompletionTokens = data.eval_count || 0;
                            }
                        }
                        catch { /* ignore */ }
                    }
                });
                res.on('end', () => {
                    let tool_calls = nativeToolCalls?.map((tc, i) => ({
                        id: `call_${i}`,
                        type: 'function',
                        function: {
                            name: tc.function.name,
                            arguments: typeof tc.function.arguments === 'string'
                                ? tc.function.arguments
                                : JSON.stringify(tc.function.arguments),
                        },
                    }));
                    let content = fullContent;
                    if (!tool_calls || tool_calls.length === 0) {
                        const rec = recoverFromStreamedContent(fullContent);
                        content = rec.content;
                        tool_calls = rec.tool_calls;
                    }
                    else {
                        content = '';
                    }
                    resolve({
                        content,
                        tool_calls,
                        usage: {
                            prompt_tokens: totalPromptTokens,
                            completion_tokens: totalCompletionTokens,
                            total_tokens: totalPromptTokens + totalCompletionTokens,
                        },
                    });
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.write(bodyStr);
            req.end();
        });
    }
    httpGet(url) {
        return new Promise((resolve, reject) => {
            const lib = url.startsWith('https') ? https : http;
            lib.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => resolve(data));
                res.on('error', reject);
            }).on('error', reject);
        });
    }
    httpPost(url, body) {
        return new Promise((resolve, reject) => {
            const bodyStr = JSON.stringify(body);
            const parsed = new url_1.URL(url);
            const lib = parsed.protocol === 'https:' ? https : http;
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
            };
            const req = lib.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    if ((res.statusCode || 200) >= 400) {
                        reject(new Error(`Ollama error ${res.statusCode}: ${data}`));
                    }
                    else {
                        resolve(data);
                    }
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.write(bodyStr);
            req.end();
        });
    }
}
exports.OllamaProvider = OllamaProvider;
/**
 * Recover tool calls a model emitted as JSON text in `content`. Handles bare
 * objects, arrays, ```json fences, and <tool_call>…</tool_call> wrappers.
 */
function recoverToolCallsFromText(content) {
    const text = (content || '').trim();
    if (!text)
        return [];
    const candidates = [];
    const tagRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    let m;
    while ((m = tagRe.exec(text)) !== null)
        candidates.push(m[1].trim());
    if (candidates.length === 0) {
        const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
        while ((m = fenceRe.exec(text)) !== null)
            candidates.push(m[1].trim());
    }
    if (candidates.length === 0) {
        candidates.push(...extractAllJsonObjects(text));
    }
    const out = [];
    for (const cand of candidates) {
        for (const o of parseToolObjects(cand)) {
            const name = typeof o.name === 'string' ? o.name : '';
            if (!name)
                continue;
            const rawArgs = o.arguments ?? o.parameters ?? {};
            const argsStr = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs);
            out.push({ id: `call_${out.length}`, type: 'function', function: { name, arguments: argsStr } });
        }
    }
    return out;
}
/** Split accumulated streamed content into final text vs recovered tool calls. */
function recoverFromStreamedContent(content) {
    const recovered = recoverToolCallsFromText(content);
    if (recovered.length > 0)
        return { content: '', tool_calls: recovered };
    return { content };
}
function parseToolObjects(text) {
    const whole = safeJsonParse(text);
    if (whole !== undefined) {
        if (Array.isArray(whole))
            return whole.filter(isToolish);
        if (isToolish(whole))
            return [whole];
        return [];
    }
    const obj = extractFirstJsonObject(text);
    if (obj) {
        const parsed = safeJsonParse(obj);
        if (isToolish(parsed))
            return [parsed];
    }
    return [];
}
function isToolish(v) {
    return typeof v === 'object' && v !== null && 'name' in v;
}
function safeJsonParse(s) {
    try {
        return JSON.parse(s);
    }
    catch {
        return undefined;
    }
}
function extractFirstJsonObject(text) {
    const start = text.indexOf('{');
    if (start < 0)
        return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (esc)
                esc = false;
            else if (ch === '\\')
                esc = true;
            else if (ch === '"')
                inStr = false;
        }
        else if (ch === '"')
            inStr = true;
        else if (ch === '{')
            depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0)
                return text.slice(start, i + 1);
        }
    }
    return null;
}
/** Extract every top-level balanced JSON object in order (handles multiple calls). */
function extractAllJsonObjects(text) {
    const out = [];
    let rest = text;
    for (;;) {
        const obj = extractFirstJsonObject(rest);
        if (!obj)
            break;
        out.push(obj);
        const idx = rest.indexOf(obj);
        rest = rest.slice(idx + obj.length);
    }
    return out;
}
/** Ollama wants tool-call arguments as an object; we store them as a JSON string. */
function parseToolArgs(args) {
    if (typeof args !== 'string')
        return args;
    try {
        return JSON.parse(args);
    }
    catch {
        return args;
    }
}
//# sourceMappingURL=ollama.js.map