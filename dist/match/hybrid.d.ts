/** Fuse BM25 keyword ranking with semantic embeddings via Reciprocal Rank Fusion. */
import { Scored } from './bm25';
export interface MatchDoc {
    id: string;
    text: string;
}
export interface HybridOpts {
    topK?: number;
    embed?: (texts: string[]) => Promise<number[][] | null>;
    rrfK?: number;
}
export declare function clearEmbedCache(): void;
export declare function hybridSearch(query: string, docs: MatchDoc[], opts?: HybridOpts): Promise<Scored[]>;
//# sourceMappingURL=hybrid.d.ts.map