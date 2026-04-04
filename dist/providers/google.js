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
exports.GoogleProvider = void 0;
const https = __importStar(require("https"));
class GoogleProvider {
    constructor(model = 'gemini-2.0-flash', apiKey) {
        this.model = model;
        this.apiKey = apiKey;
        this.name = 'google';
    }
    async isAvailable() {
        return !!(this.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
    }
    async complete(options) {
        const key = this.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        if (!key) {
            throw new Error('Google API key required. Set GOOGLE_API_KEY env var. Get free key at https://aistudio.google.com');
        }
        const { messages, tools, stream, onToken } = options;
        // Build Gemini-format contents
        let systemInstruction;
        const contents = [];
        for (const m of messages) {
            if (m.role === 'system') {
                systemInstruction = m.content;
            }
            else if (m.role === 'tool') {
                contents.push({
                    role: 'user',
                    parts: [{ text: `Tool result: ${m.content}` }],
                });
            }
            else {
                const role = m.role === 'assistant' ? 'model' : 'user';
                contents.push({ role, parts: [{ text: m.content }] });
            }
        }
        const body = { contents };
        if (systemInstruction) {
            body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }
        if (tools && tools.length > 0) {
            body.tools = [{
                    function_declarations: tools.map(t => ({
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters,
                    })),
                }];
        }
        body.generationConfig = { temperature: 0.3 };
        const path = `/v1beta/models/${this.model}:generateContent?key=${key}`;
        if (stream && !tools && onToken) {
            return this.streamRequest(path, body, onToken);
        }
        const response = await this.post(path, body);
        return this.parseResponse(response);
    }
    parseResponse(data) {
        let content = '';
        const tool_calls = [];
        const parts = data.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
            if (part.text)
                content += part.text;
            if (part.functionCall) {
                tool_calls.push({
                    id: `call_${Date.now()}`,
                    type: 'function',
                    function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args),
                    },
                });
            }
        }
        const usage = data.usageMetadata;
        return {
            content,
            tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
            usage: usage ? {
                prompt_tokens: usage.promptTokenCount,
                completion_tokens: usage.candidatesTokenCount,
                total_tokens: usage.promptTokenCount + usage.candidatesTokenCount,
            } : undefined,
        };
    }
    post(path, body) {
        return new Promise((resolve, reject) => {
            const bodyStr = JSON.stringify(body);
            const req = https.request({
                hostname: 'generativelanguage.googleapis.com',
                path,
                method: 'POST',
                headers: {
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
                            reject(new Error(`Google error ${res.statusCode}: ${parsed.error?.message || data}`));
                        }
                        else {
                            resolve(parsed);
                        }
                    }
                    catch {
                        reject(new Error(`Failed to parse Google response: ${data}`));
                    }
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.write(bodyStr);
            req.end();
        });
    }
    streamRequest(path, body, onToken) {
        const streamPath = path.replace(':generateContent', ':streamGenerateContent');
        return new Promise((resolve, reject) => {
            const bodyStr = JSON.stringify(body);
            let fullContent = '';
            let promptTokens = 0;
            let outputTokens = 0;
            const req = https.request({
                hostname: 'generativelanguage.googleapis.com',
                path: streamPath,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
            }, (res) => {
                let buffer = '';
                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    // Gemini streams as JSON array items
                    const matches = buffer.matchAll(/"text":\s*"((?:[^"\\]|\\.)*)"/g);
                    for (const match of matches) {
                        const text = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                        fullContent += text;
                        onToken(text);
                    }
                    // Extract usage
                    const usageMatch = buffer.match(/"promptTokenCount":\s*(\d+).*?"candidatesTokenCount":\s*(\d+)/s);
                    if (usageMatch) {
                        promptTokens = parseInt(usageMatch[1]);
                        outputTokens = parseInt(usageMatch[2]);
                    }
                });
                res.on('end', () => resolve({
                    content: fullContent,
                    usage: { prompt_tokens: promptTokens, completion_tokens: outputTokens, total_tokens: promptTokens + outputTokens },
                }));
                res.on('error', reject);
            });
            req.on('error', reject);
            req.write(bodyStr);
            req.end();
        });
    }
}
exports.GoogleProvider = GoogleProvider;
//# sourceMappingURL=google.js.map