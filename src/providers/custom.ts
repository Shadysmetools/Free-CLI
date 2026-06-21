import { Provider, CompletionOptions, CompletionResult } from './index';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

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
export class CustomProvider implements Provider {
  name = 'custom';

  constructor(
    public model: string = 'gpt-4o-mini',
    private apiKey?: string,
    private baseUrl?: string,
    private headers?: Record<string, string>
  ) {}

  private resolveKey(): string | undefined {
    return this.apiKey || process.env.CUSTOM_API_KEY;
  }

  private resolveBaseUrl(): string | undefined {
    return this.baseUrl || process.env.CUSTOM_BASE_URL;
  }

  async isAvailable(): Promise<boolean> {
    return !!(this.resolveKey() && this.resolveBaseUrl());
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const key = this.resolveKey();
    if (!key) {
      throw new Error('Custom provider API key required. Set CUSTOM_API_KEY env var or providers.custom.apiKey in config.');
    }
    const baseUrl = this.resolveBaseUrl();
    if (!baseUrl) {
      throw new Error('Custom provider base URL required. Set CUSTOM_BASE_URL env var or providers.custom.baseUrl in config.');
    }

    const { messages, tools, stream, onToken } = options;

    const body: Record<string, unknown> = {
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

  private parseResponse(data: {
    choices?: Array<{
      message?: {
        content?: string;
        tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
      };
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  }): CompletionResult {
    const msg = data.choices?.[0]?.message || {};
    return {
      content: msg.content || '',
      tool_calls: msg.tool_calls?.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: tc.function,
      })),
      usage: data.usage,
    };
  }

  /**
   * Build request options from the base URL. Supports http and https endpoints
   * and preserves any base path segment (e.g. https://gw.example.com/openai).
   */
  private requestOptions(apiKey: string, baseUrl: string, bodyStr: string): {
    transport: typeof https | typeof http;
    options: https.RequestOptions;
  } {
    const url = new URL(baseUrl);
    const isHttp = url.protocol === 'http:';
    const basePath = url.pathname.replace(/\/$/, '');
    const headers: Record<string, string | number> = {
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

  private post(apiKey: string, baseUrl: string, body: Record<string, unknown>): Promise<{
    choices?: Array<{
      message?: {
        content?: string;
        tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
      };
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  }> {
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(body);
      const { transport, options } = this.requestOptions(apiKey, baseUrl, bodyStr);
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if ((res.statusCode || 200) >= 400) {
              reject(new Error(`Custom provider error ${res.statusCode}: ${parsed.error?.message || data}`));
            } else {
              resolve(parsed);
            }
          } catch {
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

  private streamRequest(apiKey: string, baseUrl: string, body: Record<string, unknown>, onToken: (token: string) => void): Promise<CompletionResult> {
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(body);
      let fullContent = '';
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      const { transport, options } = this.requestOptions(apiKey, baseUrl, bodyStr);
      const req = transport.request(options, (res) => {
        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data) as {
                  choices?: Array<{ delta?: { content?: string } }>;
                  usage?: typeof usage;
                };
                const token = parsed.choices?.[0]?.delta?.content || '';
                if (token) { fullContent += token; onToken(token); }
                if (parsed.usage) usage = parsed.usage;
              } catch { /* ignore */ }
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
