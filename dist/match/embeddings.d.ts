export interface EmbedOpts {
    baseUrl: string;
    model: string;
    /** Injectable for tests; defaults to a real http/https POST. Returns raw body (string) or parsed object. */
    httpPost?: (url: string, body: unknown) => Promise<unknown>;
}
export declare function embed(texts: string[], opts: EmbedOpts): Promise<number[][] | null>;
export declare function cosine(a: number[], b: number[]): number;
//# sourceMappingURL=embeddings.d.ts.map