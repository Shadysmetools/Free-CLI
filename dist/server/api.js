"use strict";
/**
 * REST API Server — `kcc serve --port 3333`
 *
 * Endpoints:
 *   POST /api/chat       — send message, get AI response
 *   POST /api/transcribe — transcribe audio/video file
 *   GET  /api/tools      — list available tools
 *   GET  /api/status     — health + usage stats
 *   GET  /api/models     — list available providers/models
 */
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
exports.startApiServer = startApiServer;
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const settings_1 = require("../config/settings");
const index_1 = require("../providers/index");
const conversation_1 = require("../agent/conversation");
const core_1 = require("../agent/core");
const index_2 = require("../registry/index");
const index_3 = require("../memory/index");
const index_4 = require("../skills/index");
const tokens_1 = require("../tracking/tokens");
const transcribe_1 = require("../whisper/transcribe");
class MiniServer {
    constructor() {
        this.routes = [];
        this.server = http.createServer(async (req, res) => {
            await this.handleRequest(req, res);
        });
    }
    get(pathname, handler) {
        this.routes.push({ method: 'GET', path: pathname, handler });
    }
    post(pathname, handler) {
        this.routes.push({ method: 'POST', path: pathname, handler });
    }
    listen(port, host, callback) {
        this.server.listen(port, host, callback);
    }
    close() {
        this.server.close();
    }
    async handleRequest(req, res) {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname;
        const method = req.method || 'GET';
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Content-Type', 'application/json');
        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        // Parse body
        let body = {};
        if (method === 'POST') {
            try {
                const raw = await readBody(req);
                body = JSON.parse(raw || '{}');
            }
            catch {
                body = {};
            }
        }
        // Find route
        const route = this.routes.find(r => r.method === method && r.path === pathname);
        const serverRes = {
            json: (data, status = 200) => {
                res.writeHead(status);
                res.end(JSON.stringify(data, null, 2));
            },
            text: (data, status = 200) => {
                res.setHeader('Content-Type', 'text/plain');
                res.writeHead(status);
                res.end(data);
            },
            error: (msg, status = 400) => {
                res.writeHead(status);
                res.end(JSON.stringify({ error: msg }));
            },
        };
        const parsedReq = { method, pathname, body, headers: req.headers };
        if (route) {
            try {
                await route.handler(parsedReq, serverRes);
            }
            catch (err) {
                serverRes.error(`Internal error: ${err.message}`, 500);
            }
        }
        else {
            serverRes.error(`Not found: ${method} ${pathname}`, 404);
        }
    }
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk.toString(); });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}
async function startApiServer(opts) {
    const { port, host = '0.0.0.0', cwd = process.cwd() } = opts;
    const settings = (0, settings_1.loadSettings)();
    const app = new MiniServer();
    const tokenTracker = new tokens_1.TokenTracker();
    const memory = new index_3.MemoryManager(cwd);
    const skills = new index_4.SkillsManager(cwd);
    skills.loadAll();
    const registry = (0, index_2.createDefaultRegistry)();
    const startTime = Date.now();
    // Track conversations per session
    const sessions = new Map();
    function getOrCreateConversation(sessionId) {
        if (!sessions.has(sessionId)) {
            const systemPrompt = (0, conversation_1.buildSystemPrompt)({
                cwd,
                projectMemory: undefined,
                memoryContext: memory.getSystemContext(),
            });
            sessions.set(sessionId, (0, conversation_1.createConversation)(systemPrompt));
        }
        return sessions.get(sessionId);
    }
    // ── GET /api/status ──────────────────────────────────────────────────────
    app.get('/api/status', (req, res) => {
        res.json({
            status: 'ok',
            version: '1.0.0',
            uptime: Math.floor((Date.now() - startTime) / 1000),
            provider: settings.defaultProvider,
            model: settings.providers[settings.defaultProvider]?.model || 'unknown',
            sessions: sessions.size,
            usage: tokenTracker.formatStatusBar(),
        });
    });
    // ── GET /api/models ──────────────────────────────────────────────────────
    app.get('/api/models', (req, res) => {
        const models = Object.entries(settings.providers).map(([name, cfg]) => ({
            provider: name,
            model: cfg.model,
            hasKey: !!cfg.apiKey,
        }));
        res.json({ providers: models, default: settings.defaultProvider });
    });
    // ── GET /api/tools ───────────────────────────────────────────────────────
    app.get('/api/tools', (req, res) => {
        const tools = registry.list().map((t) => ({
            name: t.name,
            description: t.description,
            category: t.category,
            enabled: t.enabled,
        }));
        res.json({ tools, count: tools.length });
    });
    // ── POST /api/chat ───────────────────────────────────────────────────────
    app.post('/api/chat', async (req, res) => {
        const { message, provider: providerName, model: modelName, session_id } = req.body;
        if (!message) {
            res.error('Missing required field: message');
            return;
        }
        const sessionId = session_id || 'default';
        const pName = providerName || settings.defaultProvider;
        if (modelName) {
            settings.providers[pName] = settings.providers[pName] || {};
            settings.providers[pName].model = modelName;
        }
        let provider;
        try {
            provider = (0, index_1.createProvider)(pName, settings);
        }
        catch (err) {
            res.error(`Invalid provider: ${err.message}`);
            return;
        }
        const conversation = getOrCreateConversation(sessionId);
        let responseText = '';
        try {
            const result = await (0, core_1.runAgent)(provider, conversation, message, {
                cwd,
                stream: false,
                mcpClient: undefined,
                registry,
                memory,
                skills,
                tokenTracker,
                onToken: (token) => { responseText += token; },
            });
            res.json({
                response: result.content || responseText,
                session_id: sessionId,
                provider: pName,
                model: provider.model,
                usage: result.usage,
            });
        }
        catch (err) {
            res.error(`Chat failed: ${err.message}`, 500);
        }
    });
    // ── POST /api/transcribe ─────────────────────────────────────────────────
    app.post('/api/transcribe', async (req, res) => {
        const { file_path, language } = req.body;
        if (!file_path) {
            res.error('Missing required field: file_path');
            return;
        }
        const resolved = path.resolve(cwd, file_path);
        if (!fs.existsSync(resolved)) {
            res.error(`File not found: ${resolved}`, 404);
            return;
        }
        const groqKey = settings.providers.groq?.apiKey || process.env.GROQ_API_KEY;
        try {
            let result;
            if (groqKey) {
                result = await (0, transcribe_1.transcribeViaGroq)(resolved, groqKey, { language: language });
            }
            else {
                result = await (0, transcribe_1.transcribeFile)(resolved, { model: settings.whisper?.model || 'base', language: language });
            }
            res.json({
                text: result.text,
                language: result.language,
                duration: result.duration,
                file: path.basename(resolved),
            });
        }
        catch (err) {
            res.error(`Transcription failed: ${err.message}`, 500);
        }
    });
    // ── Start server ─────────────────────────────────────────────────────────
    await new Promise((resolve) => {
        app.listen(port, host, () => {
            resolve();
        });
    });
    console.log(`\n✅ coderaw API server running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  http://localhost:${port}/api/status`);
    console.log(`  GET  http://localhost:${port}/api/models`);
    console.log(`  GET  http://localhost:${port}/api/tools`);
    console.log(`  POST http://localhost:${port}/api/chat`);
    console.log(`  POST http://localhost:${port}/api/transcribe`);
    console.log(`\nExample:\n  curl -X POST http://localhost:${port}/api/chat \\`);
    console.log(`    -H 'Content-Type: application/json' \\`);
    console.log(`    -d '{"message": "Hello, write a hello world in Python"}'`);
    console.log(`\nPress Ctrl+C to stop.\n`);
    // Keep alive
    await new Promise((resolve) => {
        process.on('SIGINT', () => {
            console.log('\nShutting down API server...');
            app.close();
            resolve();
        });
        process.on('SIGTERM', () => {
            app.close();
            resolve();
        });
    });
}
//# sourceMappingURL=api.js.map