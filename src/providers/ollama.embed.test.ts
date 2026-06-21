import { describe, it, expect } from 'vitest';
import { OllamaProvider } from './ollama';

describe('OllamaProvider.embed', () => {
  it('delegates to match/embeddings using the provider baseUrl + private httpPost', async () => {
    const p = new OllamaProvider('qwen2.5-coder:7b', 'http://localhost:11434');
    const calls: Array<{ url: string; body: unknown }> = [];
    // Override the private httpPost on the instance to avoid a real network call.
    (p as any).httpPost = async (url: string, body: object) => {
      calls.push({ url, body });
      return JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] });
    };
    const res = await p.embed(['hello'], 'nomic-embed-text');
    expect(res).toEqual([[0.1, 0.2, 0.3]]);
    expect(calls[0].url).toBe('http://localhost:11434/api/embed');
    expect(calls[0].body).toEqual({ model: 'nomic-embed-text', input: ['hello'] });
  });

  it('returns null when httpPost throws (model not pulled)', async () => {
    const p = new OllamaProvider('qwen2.5-coder:7b', 'http://localhost:11434');
    (p as any).httpPost = async () => { throw new Error('404 model not found'); };
    expect(await p.embed(['hello'], 'nomic-embed-text')).toBeNull();
  });
});
