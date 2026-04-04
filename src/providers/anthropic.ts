import { Provider, CompletionOptions, CompletionResult, Message } from './index';
import * as https from 'https';

export class AnthropicProvider implements Provider {
  name = 'anthropic';

  constructor(
    public model: string = 'claude-3-5-haiku-20241022',
    private apiKey?: string
  ) {}

  async isAvailable(): Promise<boolean> {
    return !!(this.apiKey || process.env.ANTHROPIC_API_KEY);
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const key = this.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('Anthropic API key required. Set ANTHROPIC_API_KEY env var.');
    }

    const { messages, tools, stream, onToken } = options;

    // Separate system message
    let systemPrompt: string | undefined;
    const filteredMessages: Message[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        systemPrompt = m.content;
      } else {
        filteredMessages.push(m);
      }
    }

    // Convert messages to Anthropic format
    const anthropicMessages = filteredMessages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: m.tool_call_id,
            content: m.content,
          }],
        };
      }
      if (m.tool_calls) {
        return {
          role: 'assistant',
          content: m.tool_calls.map(tc => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          })),
        };
      }
      return { role: m.role, content: m.content };
    });

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 8192,
      messages: anthropicMessages,
    };

    if (systemPrompt) body.system = systemPrompt;

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    if (stream && !tools && onToken) {
      body.stream = true;
      return this.streamRequest(key, body, onToken);
    }

    const response = await this.post(key, body);
    return this.parseResponse(response);
  }

  private parseResponse(data: {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    usage?: { input_tokens: number; output_tokens: number };
  }): CompletionResult {
    let content = '';
    const tool_calls = [];

    for (const block of data.content || []) {
      if (block.type === 'text') content += block.text || '';
      if (block.type === 'tool_use') {
        tool_calls.push({
          id: block.id || '',
          type: 'function' as const,
          function: {
            name: block.name || '',
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    return {
      content,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      usage: data.usage ? {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
      } : undefined,
    };
  }

  private post(apiKey: string, body: Record<string, unknown>): Promise<{
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    usage?: { input_tokens: number; output_tokens: number };
  }> {
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(body);
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
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
              reject(new Error(`Anthropic error ${res.statusCode}: ${parsed.error?.message || data}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Failed to parse Anthropic response: ${data}`));
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
      let inputTokens = 0;
      let outputTokens = 0;

      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
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
              try {
                const parsed = JSON.parse(data) as {
                  type?: string;
                  delta?: { type?: string; text?: string };
                  message?: { usage?: { input_tokens: number; output_tokens: number } };
                  usage?: { output_tokens: number };
                };
                if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                  const token = parsed.delta.text || '';
                  fullContent += token;
                  onToken(token);
                }
                if (parsed.type === 'message_start' && parsed.message?.usage) {
                  inputTokens = parsed.message.usage.input_tokens;
                }
                if (parsed.type === 'message_delta' && parsed.usage) {
                  outputTokens = parsed.usage.output_tokens;
                }
              } catch { /* ignore */ }
            }
          }
        });
        res.on('end', () => resolve({
          content: fullContent,
          usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
        }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }
}
