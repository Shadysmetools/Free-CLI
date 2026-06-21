/** Pure Okapi BM25 keyword ranking — no dependencies. */
export interface Scored {
    id: string;
    score: number;
}
/** Lowercase, split on non-alphanumerics, drop very short tokens + stopwords. */
export declare function tokenize(text: string): string[];
export declare class BM25 {
    private k1;
    private b;
    private docs;
    private df;
    private totalLen;
    constructor(opts?: {
        k1?: number;
        b?: number;
    });
    add(id: string, text: string): void;
    search(query: string, topK?: number): Scored[];
}
//# sourceMappingURL=bm25.d.ts.map