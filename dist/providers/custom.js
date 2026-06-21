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
exports.CustomProvider = void 0;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const url_1 = require("url");
/**
 * Custom OpenAI-compatible provider.
 *
 * Points coderaw at ANY OpenAI-compatible endpoint via a base URL + API key +
 * model (+ optional custom headers). Mirrors the OpenAI provider's request,
 * streaming and tool-call shape so tools and streaming work identically.
 *
 * Configure via settings.providers.custom { baseUrl, apiKey, model, headers? }
 * or env vars CUSTOM_BASE_URL / CUSTOM_API_KEY / CUSTOM_MODEL.
 */
class CustomProvider {
    constructor(model = 'gpt-4o-mini', apiKey, baseUrl, headers) {
        this.model = model;
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.headers = headers;
        this.name = 'custom';
    }
    resolveKey() {
        return this.apiKey || process.env.CUSTOM_API_KEY;
    }
    resolveBaseUrl() {
        return this.baseUrl || process.env.CUSTOM_BASE_URL;
    }
    async isAvailable() {
        return !!(this.resolveKey() && this.resolveBaseUrl());
    }
    async complete(options) {
        const key = this.resolveKey();
        if (!key) {
            throw new Error('Custom provider API key required. Set CUSTOM_API_KEY env var or providers.custom.apiKey in config.');
        }
        const baseUrl = this.resolveBaseUrl();
        if (!baseUrl) {
            throw new Error('Custom provider base URL required. Set CUSTOM_BASE_URL env var or providers.custom.baseUrl in config.');
        }
        const { messages, tools, stream, onToken } = options;
        const body = {
            model: this.model,
            messages,
            temperature: 0.3,
        };
        if (tools && tools.length > 0) {
            body.tools = tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                },
            }));
            body.tool_choice = 'auto';
        }
        if (stream && !tools && onToken) {
            body.stream = true;
            return this.streamRequest(key, baseUrl, body, onToken);
        }
        const response = await this.post(key, baseUrl, body);
        return this.parseResponse(response);
    }
    parseResponse(data) {
        const msg = data.choices?.[0]?.message || {};
        return {
            content: msg.content || '',
            tool_calls: msg.tool_calls?.map(tc => ({
                id: tc.id,
                type: 'function',
                function: tc.function,
            })),
            usage: data.usage,
        };
    }
    /**
     * Build request options from the base URL. Supports http and https endpoints
     * and preserves any base path segment (e.g. https://gw.example.com/openai).
     */
    requestOptions(apiKey, baseUrl, bodyStr) {
        const url = new url_1.URL(baseUrl);
        const isHttp = url.protocol === 'http:';
        const basePath = url.pathname.replace(/\/$/, '');
        const headers = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            ...(this.headers || {}),
        };
        return {
            transport: isHttp ? http : https,
            options: {
                hostname: url.hostname,
                port: url.port || undefined,
                path: `${basePath}/v1/chat/completions`,
                method: 'POST',
                headers,
            },
        };
    }
    post(apiKey, baseUrl, body) {
        return new Promise((resolve, reject) => {
            const bodyStr = JSON.stringify(body);
            const { transport, options } = this.requestOptions(apiKey, baseUrl, bodyStr);
            const req = transport.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if ((res.statusCode || 200) >= 400) {
                            reject(new Error(`Custom provider error ${res.statusCode}: ${parsed.error?.message || data}`));
                        }
                        else {
                            resolve(parsed);
                        }
                    }
                    catch {
                        reject(new Error(`Failed to parse response: ${data}`));
                    }
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.write(bodyStr);
            req.end();
        });
    }
    streamRequest(apiKey, baseUrl, body, onToken) {
        return new Promise((resolve, reject) => {
            const bodyStr = JSON.stringify(body);
            let fullContent = '';
            let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
            const { transport, options } = this.requestOptions(apiKey, baseUrl, bodyStr);
            const req = transport.request(options, (res) => {
                let buffer = '';
                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6).trim();
                            if (data === '[DONE]')
                                continue;
                            try {
                                const parsed = JSON.parse(data);
                                const token = parsed.choices?.[0]?.delta?.content || '';
                                if (token) {
                                    fullContent += token;
                                    onToken(token);
                                }
                                if (parsed.usage)
                                    usage = parsed.usage;
                            }
                            catch { /* ignore */ }
                        }
                    }
                });
                res.on('end', () => resolve({ content: fullContent, usage }));
                res.on('error', reject);
            });
            req.on('error', reject);
            req.write(bodyStr);
            req.end();
        });
    }
}
exports.CustomProvider = CustomProvider;
//# sourceMappingURL=custom.js.map