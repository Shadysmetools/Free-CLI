/** Pure Okapi BM25 keyword ranking — no dependencies. */

export interface Scored { id: string; score: number }

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on',
  'with', 'as', 'at', 'by', 'be', 'this', 'that', 'from', 'are', 'was',
]);

/** Lowercase, split on non-alphanumerics, drop very short tokens + stopwords. */
export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

interface Doc { id: string; tf: Map<string, number>; len: number }

export class BM25 {
  private k1: number;
  private b: number;
  private docs: Doc[] = [];
  private df = new Map<string, number>();
  private totalLen = 0;

  constructor(opts: { k1?: number; b?: number } = {}) {
    this.k1 = opts.k1 ?? 1.5;
    this.b = opts.b ?? 0.75;
  }

  add(id: string, text: string): void {
    const tokens = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.docs.push({ id, tf, len: tokens.length });
    this.totalLen += tokens.length;
  }

  search(query: string, topK = 10): Scored[] {
    const N = this.docs.length;
    if (N === 0) return [];
    const qTerms = Array.from(new Set(tokenize(query)));
    if (qTerms.length === 0) return [];
    const avg = this.totalLen / N || 1;

    const scored: Scored[] = this.docs.map(doc => {
      let score = 0;
      for (const term of qTerms) {
        const f = doc.tf.get(term);
        if (!f) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        score += idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * (doc.len / avg)));
      }
      return { id: doc.id, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
