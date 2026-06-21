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
exports.embed = embed;
exports.cosine = cosine;
/** Semantic embeddings via Ollama `/api/embed`. Never throws — returns null on failure. */
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const url_1 = require("url");
async function embed(texts, opts) {
    if (!texts || texts.length === 0)
        return [];
    const post = opts.httpPost ?? defaultHttpPost;
    try {
        const url = `${opts.baseUrl.replace(/\/$/, '')}/api/embed`;
        const res = await post(url, { model: opts.model, input: texts });
        const data = (typeof res === 'string' ? JSON.parse(res) : res);
        const embeddings = data?.embeddings;
        if (!Array.isArray(embeddings) || embeddings.length !== texts.length)
            return null;
        return embeddings;
    }
    catch {
        return null;
    }
}
function cosine(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0)
        return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0)
        return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function defaultHttpPost(url, body) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(body);
        const parsed = new url_1.URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request({
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
        }, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
                if ((res.statusCode || 200) >= 400)
                    reject(new Error(`Embed error ${res.statusCode}: ${data}`));
                else
                    resolve(data);
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(Number(process.env.OLLAMA_TIMEOUT_MS) || 600000, () => {
            req.destroy(new Error('Ollama embed request timed out.'));
        });
        req.write(bodyStr);
        req.end();
    });
}
//# sourceMappingURL=embeddings.js.map