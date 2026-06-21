import { Provider, CompletionOptions, CompletionResult, Message } from './index';
import { embed as embedTexts } from '../match/embeddings';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export class OllamaProvider implements Provider {
  name = 'ollama';

  constructor(
    public model: string,
    private baseUrl: string = 'http://localhost:11434'
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      await this.httpGet(`${this.baseUrl}/api/tags`);
      return true;
    } catch {
      return false;
    }
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
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
    const data = JSON.parse(response) as {
      message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const msg = data.message || {};
    const content = msg.content || '';
    const rawToolCalls = msg.tool_calls;

    let tool_calls = rawToolCalls?.map((tc, i) => ({
      id: `call_${i}`,
      type: 'function' as const,
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

  /** Semantic embeddings via Ollama /api/embed. Reuses the tested match/embeddings logic. */
  async embed(texts: string[], model: string): Promise<number[][] | null> {
    return embedTexts(texts, {
      baseUrl: this.baseUrl,
      model,
      // this.httpPost returns the raw body string; embedTexts JSON-parses it.
      httpPost: (url, body) => this.httpPost(url, body as object),
    });
  }

  private async streamComplete(
    body: object,
    onToken: (token: string) => void
  ): Promise<CompletionResult> {
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify({ ...body, stream: true });
      const url = new URL(`${this.baseUrl}/api/chat`);
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
      let nativeToolCalls: Array<{ function: { name: string; arguments: unknown } }> | undefined;

      const req = lib.request(options, (res) => {
        res.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const data = JSON.parse(line) as {
                message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
                done?: boolean;
                prompt_eval_count?: number;
                eval_count?: number;
              };
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
            } catch { /* ignore */ }
          }
        });
        res.on('end', () => {
          let tool_calls = nativeToolCalls?.map((tc, i) => ({
            id: `call_${i}`,
            type: 'function' as const,
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
          } else {
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
      // Cap a hung request (e.g. model OOM never returns) instead of waiting forever.
      req.setTimeout(Number(process.env.OLLAMA_TIMEOUT_MS) || 600_000, () => {
        req.destroy(new Error('Ollama request timed out with no response. Is the model loaded? Try `ollama run <model>`.'));
      });
      req.write(bodyStr);
      req.end();
    });
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const lib = url.startsWith('https') ? https : http;
      lib.get(url, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk));
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  private httpPost(url: string, body: object): Promise<string> {
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(body);
      const parsed = new URL(url);
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
        res.on('data', (chunk: Buffer) => (data += chunk));
        res.on('end', () => {
          if ((res.statusCode || 200) >= 400) {
            reject(new Error(`Ollama error ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      // Cap a hung request (e.g. model OOM never returns) instead of waiting forever.
      req.setTimeout(Number(process.env.OLLAMA_TIMEOUT_MS) || 600_000, () => {
        req.destroy(new Error('Ollama request timed out with no response. Is the model loaded? Try `ollama run <model>`.'));
      });
      req.write(bodyStr);
      req.end();
    });
  }
}

// ─── Tool-call repair for local models ────────────────────────────────────────
// Some Ollama models (e.g. Qwen2.5-Coder) return tool calls as JSON text in the
// message content rather than the structured tool_calls field. These helpers
// recover them so the agent loop can execute the call.

interface RecoveredToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type ToolishObject = { name?: unknown; arguments?: unknown; parameters?: unknown };

/**
 * Recover tool calls a model emitted as JSON text in `content`. Handles bare
 * objects, arrays, ```json fences, and <tool_call>…</tool_call> wrappers.
 */
export function recoverToolCallsFromText(content: string): RecoveredToolCall[] {
  const text = (content || '').trim();
  if (!text) return [];

  const candidates: string[] = [];

  const tagRe = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) candidates.push(m[1].trim());

  if (candidates.length === 0) {
    const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
    while ((m = fenceRe.exec(text)) !== null) candidates.push(m[1].trim());
  }

  if (candidates.length === 0) {
    candidates.push(...extractAllJsonObjects(text));
  }

  const out: RecoveredToolCall[] = [];
  for (const cand of candidates) {
    for (const o of parseToolObjects(cand)) {
      const name = typeof o.name === 'string' ? o.name : '';
      if (!name) continue;
      const rawArgs: unknown = o.arguments ?? o.parameters ?? {};
      const argsStr = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs);
      out.push({ id: `call_${out.length}`, type: 'function', function: { name, arguments: argsStr } });
    }
  }
  return out;
}

/** Split accumulated streamed content into final text vs recovered tool calls. */
export function recoverFromStreamedContent(content: string): { content: string; tool_calls?: RecoveredToolCall[] } {
  const recovered = recoverToolCallsFromText(content);
  if (recovered.length > 0) return { content: '', tool_calls: recovered };
  return { content };
}

function parseToolObjects(text: string): ToolishObject[] {
  const whole = safeJsonParse(text);
  if (whole !== undefined) {
    if (Array.isArray(whole)) return whole.filter(isToolish);
    if (isToolish(whole)) return [whole];
    return [];
  }
  const obj = extractFirstJsonObject(text);
  if (obj) {
    const parsed = safeJsonParse(obj);
    if (isToolish(parsed)) return [parsed];
  }
  return [];
}

function isToolish(v: unknown): v is ToolishObject {
  return typeof v === 'object' && v !== null && 'name' in (v as object);
}

function safeJsonParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/** Extract every top-level balanced JSON object in order (handles multiple calls). */
function extractAllJsonObjects(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  for (;;) {
    const obj = extractFirstJsonObject(rest);
    if (!obj) break;
    out.push(obj);
    const idx = rest.indexOf(obj);
    rest = rest.slice(idx + obj.length);
  }
  return out;
}

/** Ollama wants tool-call arguments as an object; we store them as a JSON string. */
function parseToolArgs(args: unknown): unknown {
  if (typeof args !== 'string') return args;
  try { return JSON.parse(args); } catch { return args; }
}
