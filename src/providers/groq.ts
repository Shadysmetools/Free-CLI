import { Provider, CompletionOptions, CompletionResult } from './index';
import * as https from 'https';

export class GroqProvider implements Provider {
  name = 'groq';

  constructor(
    public model: string = 'llama-3.3-70b-versatile',
    private apiKey?: string
  ) {}

  async isAvailable(): Promise<boolean> {
    return !!(this.apiKey || process.env.GROQ_API_KEY);
  }

  /** Parse "Please try again in Xs" or "in Xm Ys" from Groq 429 messages. Returns ms to wait. */
  private parseRetryAfterMs(message: string): number {
    // "Please try again in 30s" or "try again in 1m30s"
    const secMatch = message.match(/try again in (?:(\d+)m\s*)?(\d+(?:\.\d+)?)s/i);
    if (secMatch) {
      const mins = parseInt(secMatch[1] || '0', 10);
      const secs = parseFloat(secMatch[2] || '0');
      return Math.ceil((mins * 60 + secs) * 1000);
    }
    return 30_000; // default 30s
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const key = this.apiKey || process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error('Groq API key required. Set GROQ_API_KEY env var or run /config to set it.');
    }

    const { messages, tools, stream, onToken } = options;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0.3,
      stream: stream && !tools,
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
      body.stream = false;
    }

    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (stream && !tools && onToken) {
          return await this.streamRequest(key, body, onToken);
        }
        const response = await this.post(key, body);
        return this.parseResponse(response);
      } catch (err) {
        const msg = (err as Error).message;
        const is429 = msg.includes('429') || msg.toLowerCase().includes('rate limit');
        if (is429 && attempt < maxRetries) {
          const waitMs = this.parseRetryAfterMs(msg);
          const waitSec = Math.ceil(waitMs / 1000);
          process.stderr.write(`\n⏳ Groq rate limited — waiting ${waitSec}s before retry (${attempt + 1}/${maxRetries})...\n`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
        if (is429) {
          throw new Error(
            `⏳ Rate limited. Wait ~30s or switch: /model openrouter:meta-llama/llama-3.3-70b-instruct:free`
          );
        }
        throw err;
      }
    }
    // Should never reach here
    throw new Error('Groq: max retries exceeded');
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
    const choice = data.choices?.[0];
    const msg = choice?.message || {};
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
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
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
              reject(new Error(`Groq error ${res.statusCode}: ${parsed.error?.message || data}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Failed to parse Groq response: ${data}`));
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
      const bodyStr = JSON.stringify({ ...body, stream: true });
      let fullContent = '';
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      const req = https.request({
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
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
                  x_groq?: { usage?: typeof usage };
                };
                const token = parsed.choices?.[0]?.delta?.content || '';
                if (token) {
                  fullContent += token;
                  onToken(token);
                }
                if (parsed.x_groq?.usage) usage = parsed.x_groq.usage;
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
