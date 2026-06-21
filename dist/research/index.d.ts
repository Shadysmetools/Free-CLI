/**
 * Research mode — a programmatic deep-research driver on the workflow engine:
 * scope (decompose) -> search -> fetch -> cited synthesis. Search/fetch are
 * deterministic; scope/synthesis are sub-agents. Everything network-touching is
 * dependency-injected so the driver is fully unit-testable offline.
 */
import { RunnerContext, SubAgentResult, SubAgentSpec } from '../workflow/runner';
import { SearchResult } from '../web/search';
export interface ResearchOptions {
    question: string;
    maxQueries?: number;
    maxSources?: number;
    provider?: string;
    model?: string;
}
export interface ResearchResult {
    ok: boolean;
    question: string;
    queries: string[];
    sources: Array<{
        title: string;
        url: string;
    }>;
    report: string;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    stoppedBy: 'done' | 'no_sources' | 'error';
}
export interface ResearchDeps {
    runSubAgent?: (s: SubAgentSpec, c: RunnerContext) => Promise<SubAgentResult>;
    search?: (q: string, limit: number) => Promise<SearchResult[]>;
    fetch?: (url: string, maxChars?: number) => Promise<{
        url: string;
        text: string;
    }>;
    render?: boolean;
}
export declare function runResearch(opts: ResearchOptions, ctx: RunnerContext, deps?: ResearchDeps): Promise<ResearchResult>;
/** URL/file-safe slug for a research question. Never empty. */
export declare function slugify(s: string): string;
/** Parse a scope sub-agent's output into a list of search queries. */
export declare function parseQueries(text: string, cap?: number): string[];
//# sourceMappingURL=index.d.ts.map