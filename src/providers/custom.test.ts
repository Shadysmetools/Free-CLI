import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ─── Mock the https module at import time ──────────────────────────────────────
//
// Spying/restoring https.request directly trips "Cannot redefine property" in
// this environment (the ESM namespace property is non-configurable), so we mock
// the whole module with a controllable request function instead.

const httpsRequest = vi.fn();
const httpRequest = vi.fn();

vi.mock('https', () => ({ request: (...args: unknown[]) => httpsRequest(...args) }));
vi.mock('http', () => ({ request: (...args: unknown[]) => httpRequest(...args) }));

// Imported AFTER the mocks are registered (vi.mock is hoisted regardless).
import { CustomProvider } from './custom';
import { createProvider } from './index';
import { loadSettings } from '../config/settings';

interface Captured {
  options?: { hostname?: string; path?: string; port?: string | number; headers?: Record<string, string> };
  body?: string;
}

/** Drive the given mock fn to reply with a single canned JSON response. */
function respondWithJson(fn: ReturnType<typeof vi.fn>, responseJson: unknown, statusCode = 200): Captured {
  const captured: Captured = {};
  fn.mockImplementation((options: Captured['options'], cb: (res: EventEmitter & { statusCode?: number }) => void) => {
    captured.options = options;
    const req = new EventEmitter() as EventEmitter & { write: (b: string) => void; end: () => void };
    req.write = (b: string) => { captured.body = b; };
    req.end = () => {
      const res = new EventEmitter() as EventEmitter & { statusCode?: number };
      res.statusCode = statusCode;
      setImmediate(() => {
        res.emit('data', Buffer.from(JSON.stringify(responseJson)));
        res.emit('end');
      });
      cb(res);
    };
    return req;
  });
  return captured;
}

/** Drive the given mock fn to reply with raw SSE chunks (for streaming). */
function respondWithChunks(fn: ReturnType<typeof vi.fn>, chunks: string[]): void {
  fn.mockImplementation((_options: unknown, cb: (res: EventEmitter & { statusCode?: number }) => void) => {
    const req = new EventEmitter() as EventEmitter & { write: (b: string) => void; end: () => void };
    req.write = () => {};
    req.end = () => {
      const res = new EventEmitter() as EventEmitter & { statusCode?: number };
      res.statusCode = 200;
      setImmediate(() => {
        for (const c of chunks) res.emit('data', Buffer.from(c));
        res.emit('end');
      });
      cb(res);
    };
    return req;
  });
}

const OK_RESPONSE = {
  choices: [{ message: { content: 'hello from custom endpoint' } }],
  usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('CustomProvider', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CUSTOM_API_KEY;
    delete process.env.CUSTOM_BASE_URL;
    delete process.env.CUSTOM_MODEL;
    httpsRequest.mockReset();
    httpRequest.mockReset();
    // Default: any unexpected network call throws.
    httpsRequest.mockImplementation(() => { throw new Error('unexpected https call'); });
    httpRequest.mockImplementation(() => { throw new Error('unexpected http call'); });
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('exposes name "custom" and the configured model', () => {
    const p = new CustomProvider('my-model', 'sk-test', 'https://api.example.com');
    expect(p.name).toBe('custom');
    expect(p.model).toBe('my-model');
  });

  it('isAvailable requires both an API key and a base URL', async () => {
    expect(await new CustomProvider('m', 'sk', 'https://api.example.com').isAvailable()).toBe(true);
    expect(await new CustomProvider('m', '', 'https://api.example.com').isAvailable()).toBe(false);
    expect(await new CustomProvider('m', 'sk', '').isAvailable()).toBe(false);
  });

  it('isAvailable can pick up env vars', async () => {
    process.env.CUSTOM_API_KEY = 'sk-env';
    process.env.CUSTOM_BASE_URL = 'https://env.example.com';
    expect(await new CustomProvider('m').isAvailable()).toBe(true);
  });

  it('throws a helpful error when the API key is missing', async () => {
    const p = new CustomProvider('m', '', 'https://api.example.com');
    await expect(p.complete({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow(/api key/i);
  });

  it('throws a helpful error when the base URL is missing', async () => {
    const p = new CustomProvider('m', 'sk', '');
    await expect(p.complete({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow(/base url/i);
  });

  it('posts to <baseUrl>/v1/chat/completions with the model and bearer auth', async () => {
    const captured = respondWithJson(httpsRequest, OK_RESPONSE);
    const p = new CustomProvider('my-model', 'sk-test', 'https://api.example.com');

    const result = await p.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(captured.options?.hostname).toBe('api.example.com');
    expect(captured.options?.path).toBe('/v1/chat/completions');
    expect(captured.options?.headers?.['Authorization']).toBe('Bearer sk-test');
    const body = JSON.parse(captured.body || '{}');
    expect(body.model).toBe('my-model');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(result.content).toBe('hello from custom endpoint');
    expect(result.usage?.total_tokens).toBe(3);
  });

  it('preserves a base path segment from the base URL', async () => {
    const captured = respondWithJson(httpsRequest, OK_RESPONSE);
    const p = new CustomProvider('m', 'sk', 'https://gateway.example.com/openai');
    await p.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(captured.options?.hostname).toBe('gateway.example.com');
    expect(captured.options?.path).toBe('/openai/v1/chat/completions');
  });

  it('uses the http transport for http:// base URLs', async () => {
    const captured = respondWithJson(httpRequest, OK_RESPONSE);
    const p = new CustomProvider('m', 'sk', 'http://localhost:8000');
    await p.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(httpRequest).toHaveBeenCalledTimes(1);
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(captured.options?.hostname).toBe('localhost');
    expect(captured.options?.port).toBe('8000');
  });

  it('sends custom headers alongside the defaults', async () => {
    const captured = respondWithJson(httpsRequest, OK_RESPONSE);
    const p = new CustomProvider('m', 'sk', 'https://api.example.com', {
      'X-Org': 'acme',
      'X-Trace': '123',
    });
    await p.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(captured.options?.headers?.['X-Org']).toBe('acme');
    expect(captured.options?.headers?.['X-Trace']).toBe('123');
    expect(captured.options?.headers?.['Authorization']).toBe('Bearer sk');
  });

  it('serialises tools in OpenAI function shape and parses tool_calls back', async () => {
    const toolResponse = {
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
          }],
        },
      }],
    };
    const captured = respondWithJson(httpsRequest, toolResponse);
    const p = new CustomProvider('m', 'sk', 'https://api.example.com');

    const result = await p.complete({
      messages: [{ role: 'user', content: 'read a.ts' }],
      tools: [{
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      }],
    });

    const body = JSON.parse(captured.body || '{}');
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    });
    expect(body.tool_choice).toBe('auto');
    expect(result.tool_calls?.[0].function.name).toBe('read_file');
  });

  it('streams tokens when stream + onToken are set and no tools', async () => {
    respondWithChunks(httpsRequest, [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
      'data: [DONE]\n',
    ]);

    const tokens: string[] = [];
    const p = new CustomProvider('m', 'sk', 'https://api.example.com');
    const result = await p.complete({
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      onToken: (t) => tokens.push(t),
    });

    expect(tokens.join('')).toBe('Hello');
    expect(result.content).toBe('Hello');
  });

  it('does not stream when tools are present (falls back to a single POST)', async () => {
    const captured = respondWithJson(httpsRequest, OK_RESPONSE);
    const p = new CustomProvider('m', 'sk', 'https://api.example.com');
    await p.complete({
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      onToken: () => {},
      tools: [{ name: 'x', description: 'd', parameters: { type: 'object', properties: {} } }],
    });
    const body = JSON.parse(captured.body || '{}');
    expect(body.stream).toBeUndefined();
  });
});

describe('createProvider("custom")', () => {
  const savedEnv = { ...process.env };
  afterEach(() => { process.env = { ...savedEnv }; });

  it('builds a CustomProvider from settings.providers.custom env overrides', () => {
    process.env.CUSTOM_API_KEY = 'sk-from-env';
    process.env.CUSTOM_BASE_URL = 'https://vendor.example.com';
    process.env.CUSTOM_MODEL = 'vendor-large';
    const settings = loadSettings();
    const p = createProvider('custom', settings);
    expect(p.name).toBe('custom');
    expect(p.model).toBe('vendor-large');
  });
});
