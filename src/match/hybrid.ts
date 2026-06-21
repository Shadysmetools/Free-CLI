/** Fuse BM25 keyword ranking with semantic embeddings via Reciprocal Rank Fusion. */
import { BM25, Scored } from './bm25';
import { cosine } from './embeddings';

export interface MatchDoc { id: string; text: string }
export interface HybridOpts {
  topK?: number;
  embed?: (texts: string[]) => Promise<number[][] | null>;
  rrfK?: number;
}

// Module-level in-memory cache (text → vector) to avoid re-embedding within a session.
const embedCache = new Map<string, number[]>();
export function clearEmbedCache(): void { embedCache.clear(); }

async function embedCached(
  embed: (texts: string[]) => Promise<number[][] | null>,
  texts: string[],
): Promise<number[][] | null> {
  const missing = texts.filter(t => !embedCache.has(t));
  if (missing.length > 0) {
    const vecs = await embed(missing);
    if (!vecs || vecs.length !== missing.length) return null;
    missing.forEach((t, i) => embedCache.set(t, vecs[i]));
  }
  return texts.map(t => embedCache.get(t)!);
}

export async function hybridSearch(query: string, docs: MatchDoc[], opts: HybridOpts = {}): Promise<Scored[]> {
  const topK = opts.topK ?? 10;
  const rrfK = opts.rrfK ?? 60;
  if (docs.length === 0) return [];

  // BM25 ranked list (over all docs so ranks are complete).
  const bm = new BM25();
  for (const d of docs) bm.add(d.id, d.text);
  const bmRanked = bm.search(query, docs.length);

  // Semantic ranked list (optional — degrade to BM25-only on any miss).
  let semRanked: Scored[] = [];
  if (opts.embed) {
    try {
      const vectors = await embedCached(opts.embed, [query, ...docs.map(d => d.text)]);
      if (vectors && vectors.length === docs.length + 1) {
        const qv = vectors[0];
        semRanked = docs
          .map((d, i) => ({ id: d.id, score: cosine(qv, vectors[i + 1]) }))
          .sort((a, b) => b.score - a.score);
      }
    } catch { /* degrade to BM25-only */ }
  }

  // RRF fuse: score += 1 / (rrfK + rank+1) for each list the id appears in.
  const rankIndex = (list: Scored[]) => {
    const m = new Map<string, number>();
    list.forEach((s, i) => m.set(s.id, i));
    return m;
  };
  const bmRank = rankIndex(bmRanked);
  const semRank = rankIndex(semRanked);
  const ids = new Set<string>([...bmRanked.map(s => s.id), ...semRanked.map(s => s.id)]);

  const fused: Scored[] = [];
  for (const id of ids) {
    let score = 0;
    if (bmRank.has(id)) score += 1 / (rrfK + bmRank.get(id)! + 1);
    if (semRank.has(id)) score += 1 / (rrfK + semRank.get(id)! + 1);
    fused.push({ id, score });
  }

  const max = fused.reduce((m, f) => (f.score > m ? f.score : m), 1e-9);
  return fused
    .map(f => ({ id: f.id, score: f.score / max }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
