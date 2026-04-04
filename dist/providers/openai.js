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
exports.OpenAIProvider = void 0;
const https = __importStar(require("https"));
const url_1 = require("url");
class OpenAIProvider {
    constructor(model = 'gpt-4o-mini', apiKey, baseUrl) {
        this.model = model;
        this.apiKey = apiKey;
        this.name = 'openai';
        const url = new url_1.URL(baseUrl || 'https://api.openai.com');
        this.hostname = url.hostname;
        this.basePath = url.pathname.replace(/\/$/, '');
    }
    async isAvailable() {
        return !!(this.apiKey || process.env.OPENAI_API_KEY);
    }
    async complete(options) {
        const key = this.apiKey || process.env.OPENAI_API_KEY;
        if (!key) {
            throw new Error('OpenAI API key required. Set OPENAI_API_KEY env var.');
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
            return this.streamRequest(key, body, onToken);
        }
        const response = await this.post(key, body);
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
    post(apiKey, body) {
        return new Promise((resolve, reject) => {
            const bodyStr = JSON.stringify(body);
            const req = https.request({
                hostname: this.hostname,
                path: `${this.basePath}/v1/chat/completions`,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if ((res.statusCode || 200) >= 400) {
                            reject(new Error(`OpenAI error ${res.statusCode}: ${parsed.error?.message || data}`));
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
    streamRequest(apiKey, body, onToken) {
        return new Promise((resolve, reject) => {
            const bodyStr = JSON.stringify(body);
            let fullContent = '';
            let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
            const req = https.request({
                hostname: this.hostname,
                path: `${this.basePath}/v1/chat/completions`,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
            }, (res) => {
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
exports.OpenAIProvider = OpenAIProvider;
//# sourceMappingURL=openai.js.map