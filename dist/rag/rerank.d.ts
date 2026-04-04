/**
 * RAG Reranking — Context-aware search result ranking
 *
 * Uses Reciprocal Rank Fusion (RRF) to merge multiple ranked lists
 * without needing external embeddings or API calls.
 *
 * Pipeline:
 *   1. keyword_search  → ranked list A (BM25-style TF scoring)
 *   2. pattern_search  → ranked list B (regex / exact match)
 *   3. recency_sort    → ranked list C (newer files first)
 *   4. RRF merge       → unified score
 *   5. threshold cut   → only top-K above min relevance
 */
export interface SearchResult {
    file: string;
    relativePath: string;
    line: number;
    content: string;
    score: number;
    matchType: 'keyword' | 'pattern' | 'filename' | 'memory';
}
export interface RerankOptions {
    topK?: number;
    minScore?: number;
    cwd?: string;
}
/**
 * Merge multiple ranked result lists into one using RRF.
 * Each result is identified by `file:line`.
 */
export declare function reciprocalRankFusion(lists: SearchResult[][], opts?: RerankOptions): SearchResult[];
/**
 * Search files for query terms, scoring by term frequency and field weight.
 * No external deps — pure Node.js.
 */
export declare function keywordSearch(query: string, files: string[], cwd: string, topK?: number): SearchResult[];
export declare function patternSearch(pattern: string, files: string[], cwd: string, topK?: number): SearchResult[];
export interface MemoryEntry {
    file: string;
    line: number;
    content: string;
}
export declare function rerankMemoryResults(entries: MemoryEntry[], query: string, cwd: string, topK?: number): SearchResult[];
export declare function collectFiles(dir: string, maxFiles?: number): string[];
/**
 * Run the full RAG pipeline: collect files → multi-strategy search → RRF → top-K
 */
export declare function ragSearch(query: string, cwd: string, opts?: RerankOptions): SearchResult[];
//# sourceMappingURL=rerank.d.ts.map