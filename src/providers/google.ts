import { Provider, CompletionOptions, CompletionResult, Message } from './index';
import * as https from 'https';

export class GoogleProvider implements Provider {
  name = 'google';

  constructor(
    public model: string = 'gemini-2.0-flash',
    private apiKey?: string
  ) {}

  async isAvailable(): Promise<boolean> {
    return !!(this.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const key = this.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('Google API key required. Set GOOGLE_API_KEY env var. Get free key at https://aistudio.google.com');
    }

    const { messages, tools, stream, onToken } = options;

    // Build Gemini-format contents
    let systemInstruction: string | undefined;
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    for (const m of messages) {
      if (m.role === 'system') {
        systemInstruction = m.content;
      } else if (m.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [{ text: `Tool result: ${m.content}` }],
        });
      } else {
        const role = m.role === 'assistant' ? 'model' : 'user';
        contents.push({ role, parts: [{ text: m.content }] });
      }
    }

    const body: Record<string, unknown> = { contents };

    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    if (tools && tools.length > 0) {
      body.tools = [{
        function_declarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }

    body.generationConfig = { temperature: 0.3 };

    const path = `/v1beta/models/${this.model}:generateContent?key=${key}`;

    if (stream && !tools && onToken) {
      return this.streamRequest(path, body, onToken);
    }

    const response = await this.post(path, body);
    return this.parseResponse(response);
  }

  private parseResponse(data: {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string; functionCall?: { name: string; args: unknown } }>;
      };
    }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  }): CompletionResult {
    let content = '';
    const tool_calls = [];
    const parts = data.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      if (part.text) content += part.text;
      if (part.functionCall) {
        tool_calls.push({
          id: `call_${Date.now()}`,
          type: 'function' as const,
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
        });
      }
    }

    const usage = data.usageMetadata;
    return {
      content,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      usage: usage ? {
        prompt_tokens: usage.promptTokenCount,
        completion_tokens: usage.candidatesTokenCount,
        total_tokens: usage.promptTokenCount + usage.candidatesTokenCount,
      } : undefined,
    };
  }

  private post(path: string, body: Record<string, unknown>): Promise<{
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: unknown } }> };
    }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  }> {
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(body);
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path,
        method: 'POST',
        headers: {
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
              reject(new Error(`Google error ${res.statusCode}: ${parsed.error?.message || data}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Failed to parse Google response: ${data}`));
          }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }

  private streamRequest(path: string, body: Record<string, unknown>, onToken: (token: string) => void): Promise<CompletionResult> {
    const streamPath = path.replace(':generateContent', ':streamGenerateContent');
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(body);
      let fullContent = '';
      let promptTokens = 0;
      let outputTokens = 0;

      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path: streamPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      }, (res) => {
        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          // Gemini streams as JSON array items
          const matches = buffer.matchAll(/"text":\s*"((?:[^"\\]|\\.)*)"/g);
          for (const match of matches) {
            const text = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            fullContent += text;
            onToken(text);
          }
          // Extract usage
          const usageMatch = buffer.match(/"promptTokenCount":\s*(\d+).*?"candidatesTokenCount":\s*(\d+)/s);
          if (usageMatch) {
            promptTokens = parseInt(usageMatch[1]);
            outputTokens = parseInt(usageMatch[2]);
          }
        });
        res.on('end', () => resolve({
          content: fullContent,
          usage: { prompt_tokens: promptTokens, completion_tokens: outputTokens, total_tokens: promptTokens + outputTokens },
        }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }
}
