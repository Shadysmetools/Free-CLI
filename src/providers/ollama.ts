import { Provider, CompletionOptions, CompletionResult, Message } from './index';
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
    const data = JSON.parse(response) as {
      message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const msg = data.message || {};
    const content = msg.content || '';
    const rawToolCalls = msg.tool_calls;

    const tool_calls = rawToolCalls?.map((tc, i) => ({
      id: `call_${i}`,
      type: 'function' as const,
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

      const req = lib.request(options, (res) => {
        res.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const data = JSON.parse(line) as {
                message?: { content?: string };
                done?: boolean;
                prompt_eval_count?: number;
                eval_count?: number;
              };
              if (data.message?.content) {
                fullContent += data.message.content;
                onToken(data.message.content);
              }
              if (data.done) {
                totalPromptTokens = data.prompt_eval_count || 0;
                totalCompletionTokens = data.eval_count || 0;
              }
            } catch { /* ignore */ }
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
      req.write(bodyStr);
      req.end();
    });
  }
}
