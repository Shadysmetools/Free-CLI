export interface SearchResult {
    title: string;
    url: string;
    snippet?: string;
}
export declare function parseBraveJson(raw: unknown, limit: number): SearchResult[];
export interface SearchDeps {
    httpGet?: (url: string, headers?: Record<string, string>) => Promise<{
        data: unknown;
    }>;
}
/** Structured web search with graceful degradation. Never throws → [] on failure. */
export declare function webSearchStructured(query: string, limit?: number, deps?: SearchDeps): Promise<SearchResult[]>;
export declare function parseDdgHtml(html: string, limit: number): SearchResult[];
//# sourceMappingURL=search.d.ts.map