import { Provider, CompletionOptions, CompletionResult } from './index';
import * as https from 'https';
import { URL } from 'url';

export class OpenAIProvider implements Provider {
  name = 'openai';
  private hostname: string;
  private basePath: string;

  constructor(
    public model: string = 'gpt-4o-mini',
    private apiKey?: string,
    baseUrl?: string
  ) {
    const url = new URL(baseUrl || 'https://api.openai.com');
    this.hostname = url.hostname;
    this.basePath = url.pathname.replace(/\/$/, '');
  }

  async isAvailable(): Promise<boolean> {
    return !!(this.apiKey || process.env.OPENAI_API_KEY);
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const key = this.apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('OpenAI API key required. Set OPENAI_API_KEY env var.');
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
      return this.streamRequest(key, body, onToken);
    }

    const response = await this.post(key, body);
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

  private post(apiKey: string, body: Record<string, unknown>): Promise<{
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
        res.on('data', (chunk: Buffer) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if ((res.statusCode || 200) >= 400) {
              reject(new Error(`OpenAI error ${res.statusCode}: ${parsed.error?.message || data}`));
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

  private streamRequest(apiKey: string, body: Record<string, unknown>, onToken: (token: string) => void): Promise<CompletionResult> {
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
