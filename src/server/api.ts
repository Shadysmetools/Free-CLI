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

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { loadSettings } from '../config/settings';
import { createProvider } from '../providers/index';
import { createConversation, buildSystemPrompt } from '../agent/conversation';
import { runAgent } from '../agent/core';
import { createDefaultRegistry } from '../registry/index';
import { MemoryManager } from '../memory/index';
import { SkillsManager } from '../skills/index';
import { TokenTracker } from '../tracking/tokens';
import { transcribeViaGroq, transcribeFile } from '../whisper/transcribe';

export interface ServerOptions {
  port: number;
  host?: string;
  cwd?: string;
}

// Minimal Express-like router without requiring express to be installed
// Uses Node's built-in http module for zero-dependency serving
type Handler = (req: ParsedRequest, res: ServerResponse) => Promise<void> | void;

interface ParsedRequest {
  method: string;
  pathname: string;
  body: Record<string, unknown>;
  headers: http.IncomingMessage['headers'];
}

interface ServerResponse {
  json: (data: unknown, status?: number) => void;
  text: (data: string, status?: number) => void;
  error: (msg: string, status?: number) => void;
}

interface Route {
  method: string;
  path: string;
  handler: Handler;
}

class MiniServer {
  private routes: Route[] = [];
  private server: http.Server;

  constructor() {
    this.server = http.createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });
  }

  get(pathname: string, handler: Handler): void {
    this.routes.push({ method: 'GET', path: pathname, handler });
  }

  post(pathname: string, handler: Handler): void {
    this.routes.push({ method: 'POST', path: pathname, handler });
  }

  listen(port: number, host: string, callback?: () => void): void {
    this.server.listen(port, host, callback);
  }

  close(): void {
    this.server.close();
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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
    let body: Record<string, unknown> = {};
    if (method === 'POST') {
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw || '{}') as Record<string, unknown>;
      } catch {
        body = {};
      }
    }

    // Find route
    const route = this.routes.find(r => r.method === method && r.path === pathname);

    const serverRes: ServerResponse = {
      json: (data: unknown, status = 200) => {
        res.writeHead(status);
        res.end(JSON.stringify(data, null, 2));
      },
      text: (data: string, status = 200) => {
        res.setHeader('Content-Type', 'text/plain');
        res.writeHead(status);
        res.end(data);
      },
      error: (msg: string, status = 400) => {
        res.writeHead(status);
        res.end(JSON.stringify({ error: msg }));
      },
    };

    const parsedReq: ParsedRequest = { method, pathname, body, headers: req.headers };

    if (route) {
      try {
        await route.handler(parsedReq, serverRes);
      } catch (err) {
        serverRes.error(`Internal error: ${(err as Error).message}`, 500);
      }
    } else {
      serverRes.error(`Not found: ${method} ${pathname}`, 404);
    }
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export async function startApiServer(opts: ServerOptions): Promise<void> {
  const { port, host = '0.0.0.0', cwd = process.cwd() } = opts;
  const settings = loadSettings();

  const app = new MiniServer();
  const tokenTracker = new TokenTracker();
  const memory = new MemoryManager(cwd);
  const skills = new SkillsManager(cwd);
  skills.loadAll();
  const registry = createDefaultRegistry();
  const startTime = Date.now();

  // Track conversations per session
  const sessions: Map<string, ReturnType<typeof createConversation>> = new Map();

  function getOrCreateConversation(sessionId: string): ReturnType<typeof createConversation> {
    if (!sessions.has(sessionId)) {
      const systemPrompt = buildSystemPrompt({
        cwd,
        projectMemory: undefined,
        memoryContext: memory.getSystemContext(),
      });
      sessions.set(sessionId, createConversation(systemPrompt));
    }
    return sessions.get(sessionId)!;
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
    const tools = registry.list().map((t: { name: string; description: string; category: string; enabled: boolean }) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      enabled: t.enabled,
    }));
    res.json({ tools, count: tools.length });
  });

  // ── POST /api/chat ───────────────────────────────────────────────────────
  app.post('/api/chat', async (req, res) => {
    const { message, provider: providerName, model: modelName, session_id } = req.body as {
      message?: string;
      provider?: string;
      model?: string;
      session_id?: string;
    };

    if (!message) {
      res.error('Missing required field: message');
      return;
    }

    const sessionId = (session_id as string) || 'default';
    const pName = (providerName as string) || settings.defaultProvider;

    if (modelName) {
      settings.providers[pName] = settings.providers[pName] || {};
      settings.providers[pName].model = modelName;
    }

    let provider;
    try {
      provider = createProvider(pName, settings);
    } catch (err) {
      res.error(`Invalid provider: ${(err as Error).message}`);
      return;
    }

    const conversation = getOrCreateConversation(sessionId);
    let responseText = '';

    try {
      const result = await runAgent(provider, conversation, message as string, {
        cwd,
        stream: false,
        mcpClient: undefined,
        registry,
        memory,
        skills,
        tokenTracker,
        onToken: (token: string) => { responseText += token; },
      });

      res.json({
        response: result.content || responseText,
        session_id: sessionId,
        provider: pName,
        model: provider.model,
        usage: result.usage,
      });
    } catch (err) {
      res.error(`Chat failed: ${(err as Error).message}`, 500);
    }
  });

  // ── POST /api/transcribe ─────────────────────────────────────────────────
  app.post('/api/transcribe', async (req, res) => {
    const { file_path, language } = req.body as { file_path?: string; language?: string };

    if (!file_path) {
      res.error('Missing required field: file_path');
      return;
    }

    const resolved = path.resolve(cwd, file_path as string);
    if (!fs.existsSync(resolved)) {
      res.error(`File not found: ${resolved}`, 404);
      return;
    }

    const groqKey = settings.providers.groq?.apiKey || process.env.GROQ_API_KEY;

    try {
      let result;
      if (groqKey) {
        result = await transcribeViaGroq(resolved, groqKey, { language: language as string });
      } else {
        result = await transcribeFile(resolved, { model: settings.whisper?.model || 'base', language: language as string });
      }

      res.json({
        text: result.text,
        language: result.language,
        duration: result.duration,
        file: path.basename(resolved),
      });
    } catch (err) {
      res.error(`Transcription failed: ${(err as Error).message}`, 500);
    }
  });

  // ── Start server ─────────────────────────────────────────────────────────
  await new Promise<void>((resolve) => {
    app.listen(port, host, () => {
      resolve();
    });
  });

  console.log(`\n✅ knowcap-code API server running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
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
  await new Promise<void>((resolve) => {
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
