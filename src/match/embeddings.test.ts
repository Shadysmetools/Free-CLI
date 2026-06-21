import { describe, it, expect, vi } from 'vitest';
import { embed, cosine } from './embeddings';

describe('cosine', () => {
  it('identical vectors → 1', () => { expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1); });
  it('orthogonal vectors → 0', () => { expect(cosine([1, 0], [0, 1])).toBeCloseTo(0); });
  it('opposite vectors → -1', () => { expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1); });
  it('mismatched length or zero vector → 0', () => {
    expect(cosine([1, 2], [1])).toBe(0);
    expect(cosine([0, 0], [0, 0])).toBe(0);
  });
});

describe('embed', () => {
  const opts = (httpPost: any) => ({ baseUrl: 'http://x', model: 'nomic-embed-text', httpPost });

  it('returns vectors from the injected httpPost', async () => {
    const httpPost = vi.fn().mockResolvedValue({ embeddings: [[1, 0], [0, 1]] });
    const res = await embed(['a', 'b'], opts(httpPost));
    expect(res).toEqual([[1, 0], [0, 1]]);
    expect(httpPost).toHaveBeenCalledWith('http://x/api/embed', { model: 'nomic-embed-text', input: ['a', 'b'] });
  });

  it('parses a JSON string body too', async () => {
    const httpPost = vi.fn().mockResolvedValue(JSON.stringify({ embeddings: [[1, 2, 3]] }));
    expect(await embed(['a'], opts(httpPost))).toEqual([[1, 2, 3]]);
  });

  it('returns null when httpPost throws', async () => {
    const httpPost = vi.fn().mockRejectedValue(new Error('connection refused'));
    expect(await embed(['a'], opts(httpPost))).toBeNull();
  });

  it('returns null when the embedding count does not match the input count', async () => {
    const httpPost = vi.fn().mockResolvedValue({ embeddings: [[1, 0]] });
    expect(await embed(['a', 'b'], opts(httpPost))).toBeNull();
  });

  it('returns [] for empty input without calling httpPost', async () => {
    const httpPost = vi.fn();
    expect(await embed([], opts(httpPost))).toEqual([]);
    expect(httpPost).not.toHaveBeenCalled();
  });
});
