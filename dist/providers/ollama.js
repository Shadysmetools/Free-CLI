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
                tool_calls: m.tool_calls,
                tool_call_id: m.tool_call_id,
            })),
            tools: ollamaTools,
            stream: stream && !tools,
            options: {
                temperature: 0.3,
            },
        };
        if (stream && !tools && onToken) {
            return this.streamComplete(body, onToken);
        }
        const response = await this.httpPost(`${this.baseUrl}/api/chat`, body);
        const data = JSON.parse(response);
        const msg = data.message || {};
        const content = msg.content || '';
        const rawToolCalls = msg.tool_calls;
        const tool_calls = rawToolCalls?.map((tc, i) => ({
            id: `call_${i}`,
            type: 'function',
            function: {
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc.function.arguments),
            },
        }));
        return {
            content,
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
                            if (data.done) {
                                totalPromptTokens = data.prompt_eval_count || 0;
                                totalCompletionTokens = data.eval_count || 0;
                            }
                        }
                        catch { /* ignore */ }
                    }
                });
                res.on('end', () => {
                    resolve({
                        content: fullContent,
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
//# sourceMappingURL=ollama.js.map