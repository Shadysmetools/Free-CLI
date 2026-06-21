/**
 * Research mode — a programmatic deep-research driver on the workflow engine:
 * scope (decompose) -> search -> fetch -> cited synthesis. Search/fetch are
 * deterministic; scope/synthesis are sub-agents. Everything network-touching is
 * dependency-injected so the driver is fully unit-testable offline.
 */

import { runSubAgent as realRunSubAgent, RunnerContext, SubAgentResult, SubAgentSpec } from '../workflow/runner';
import { parallel } from '../workflow/primitives';
import { webSearchStructured, SearchResult } from '../web/search';
import { executeWebFetch } from '../bot/web_tools';
import { printInfo } from '../ui/terminal';

export interface ResearchOptions { question: string; maxQueries?: number; maxSources?: number; provider?: string; model?: string }
export interface ResearchResult {
  ok: boolean; question: string; queries: string[];
  sources: Array<{ title: string; url: string }>;
  report: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  stoppedBy: 'done' | 'no_sources' | 'error';
}
export interface ResearchDeps {
  runSubAgent?: (s: SubAgentSpec, c: RunnerContext) => Promise<SubAgentResult>;
  search?: (q: string, limit: number) => Promise<SearchResult[]>;
  fetch?: (url: string, maxChars?: number) => Promise<{ url: string; text: string }>;
  render?: boolean;
}

const defaultFetch = async (url: string, maxChars = 8000): Promise<{ url: string; text: string }> => {
  const r = await executeWebFetch(url, maxChars);
  if (r.isError) throw new Error(r.content);
  return { url, text: r.content };
};

export async function runResearch(opts: ResearchOptions, ctx: RunnerContext, deps: ResearchDeps = {}): Promise<ResearchResult> {
  const runSubAgent = deps.runSubAgent ?? realRunSubAgent;
  const search = deps.search ?? ((q: string, limit: number) => webSearchStructured(q, limit));
  const fetch = deps.fetch ?? defaultFetch;
  const render = deps.render !== false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wf = (ctx.settings as any).workflows;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const research = (ctx.settings as any).research;
  const maxQueries = opts.maxQueries ?? research?.maxQueries ?? 5;
  const maxSources = opts.maxSources ?? research?.maxSources ?? 8;
  const conc = (ctx.defaultProviderName === 'ollama' ? wf?.concurrency?.ollama : wf?.concurrency?.default) ?? (ctx.defaultProviderName === 'ollama' ? 1 : 4);
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const addUsage = (u?: SubAgentResult['usage']) => { if (u) { usage.prompt_tokens += u.prompt_tokens; usage.completion_tokens += u.completion_tokens; usage.total_tokens += u.total_tokens; } };
  const subSpec = (task: string, validate?: SubAgentSpec['validate']): SubAgentSpec =>
    ({ role: 'researcher', task, provider: opts.provider, model: opts.model, validate });

  // 1) SCOPE
  if (render) printInfo(`Scoping research: ${opts.question}`);
  const scope = await runSubAgent(subSpec(
    `Decompose this question into ${maxQueries} focused web search-query strings. Question: ${opts.question}\nReturn ONLY a JSON array of strings.`,
    (c) => ({ ok: parseQueries(c, maxQueries).length > 0, feedback: 'return a JSON array of 3-5 query strings' }),
  ), ctx);
  addUsage(scope.usage);
  let queries = parseQueries(scope.content, maxQueries);
  if (queries.length === 0) queries = [opts.question]; // fallback: search the raw question
  if (render) printInfo(`Queries: ${queries.join(' | ')}`);

  // 2) SEARCH (parallel) → dedup by URL → cap
  const searchLists = await parallel(queries.map((q) => () => search(q, Math.max(3, Math.ceil(maxSources / queries.length) + 2))), { concurrency: conc });
  const seen = new Set<string>();
  const sources: SearchResult[] = [];
  for (const list of searchLists) {
    for (const r of list ?? []) {
      if (r?.url && !seen.has(r.url)) { seen.add(r.url); sources.push(r); }
      if (sources.length >= maxSources) break;
    }
    if (sources.length >= maxSources) break;
  }
  if (render) printInfo(`Found ${sources.length} unique sources; fetching…`);

  // 3) FETCH (parallel, drop failures)
  const fetched = (await parallel(sources.map((s) => () => fetch(s.url, 8000)), { concurrency: conc })).filter(Boolean) as Array<{ url: string; text: string }>;
  if (fetched.length === 0) {
    return { ok: false, question: opts.question, queries, sources: sources.map(s => ({ title: s.title, url: s.url })), report: 'No sources retrieved (are you online? is a search backend available?).', usage, stoppedBy: 'no_sources' };
  }

  // 4) SYNTHESIZE (cap total input to stay within the local context window)
  const MAX_INPUT = 14000;
  let budget = MAX_INPUT;
  const chunks: string[] = [];
  for (const f of fetched) {
    const piece = `SOURCE: ${f.url}\n${f.text}\n`;
    if (budget - piece.length < 0) break;
    chunks.push(piece); budget -= piece.length;
  }
  if (render) printInfo(`Synthesizing from ${chunks.length} sources…`);
  const synth = await runSubAgent(subSpec(
    `Write a cited markdown report answering: "${opts.question}".\nUse ONLY the sources below; cite each load-bearing claim with its source URL inline like (source: <url>). Flag gaps the sources don't cover.\n\n${chunks.join('\n---\n')}`,
  ), ctx);
  addUsage(synth.usage);

  return {
    ok: synth.ok,
    question: opts.question,
    queries,
    sources: fetched.map((f) => ({ title: sources.find(s => s.url === f.url)?.title ?? f.url, url: f.url })),
    report: synth.content,
    usage,
    stoppedBy: synth.ok ? 'done' : 'error',
  };
}

/** URL/file-safe slug for a research question. Never empty. */
export function slugify(s: string): string {
  const base = (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '');
  return base || 'research';
}

/** Parse a scope sub-agent's output into a list of search queries. */
export function parseQueries(text: string, cap = 5): string[] {
  const t = (text ?? '').trim();
  if (!t) return [];
  try {
    const arr = JSON.parse(t);
    if (Array.isArray(arr)) {
      const out = arr
        .map((x) => (typeof x === 'string' ? x : (x && typeof x === 'object' ? String((x as any).query ?? (x as any).content ?? '') : '')))
        .map((s) => s.trim())
        .filter(Boolean);
      if (out.length) return out.slice(0, cap);
    }
  } catch { /* fall through to line parsing */ }
  return t.split('\n')
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, cap);
}
