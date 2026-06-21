import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hybridSearch, clearEmbedCache } from './hybrid';

const DOCS = [
  { id: 'deploy', text: 'deploy the application to production server' },
  { id: 'review', text: 'review a pull request and leave comments' },
  { id: 'login', text: 'implement a user login authentication flow' },
];

beforeEach(() => clearEmbedCache());

describe('hybridSearch', () => {
  it('returns [] for empty docs', async () => {
    expect(await hybridSearch('anything', [])).toEqual([]);
  });

  it('BM25-only when no embed provided; scores normalized 0..1 desc', async () => {
    const res = await hybridSearch('deploy production', DOCS);
    expect(res[0].id).toBe('deploy');
    expect(res[0].score).toBeCloseTo(1); // top normalized to 1
    expect(res.every(r => r.score <= 1 && r.score >= 0)).toBe(true);
  });

  it('semantic ranking via RRF can change the order vs BM25-only', async () => {
    // Embeddings that make the query most similar to "review" even though BM25 favors "login".
    const vecByText: Record<string, number[]> = {
      'pr feedback': [0, 1, 0],
      'deploy the application to production server': [1, 0, 0],
      'review a pull request and leave comments': [0, 1, 0],
      'implement a user login authentication flow': [0, 0, 1],
    };
    const embed = vi.fn(async (texts: string[]) => texts.map(t => vecByText[t] ?? [0, 0, 0]));
    const res = await hybridSearch('pr feedback', DOCS, { embed });
    expect(res[0].id).toBe('review');
    expect(embed).toHaveBeenCalled();
  });

  it('falls back to BM25-only when embed returns null', async () => {
    const embed = vi.fn(async () => null);
    const res = await hybridSearch('deploy production', DOCS, { embed });
    expect(res[0].id).toBe('deploy');
  });

  it('caches embeddings: a repeated identical search does not re-embed', async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0]));
    await hybridSearch('deploy production', DOCS, { embed });
    const callsAfterFirst = embed.mock.calls.length;
    await hybridSearch('deploy production', DOCS, { embed });
    expect(embed.mock.calls.length).toBe(callsAfterFirst); // nothing new to embed
  });
});
