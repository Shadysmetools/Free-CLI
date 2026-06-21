/**
 * Structured web search — parsers + backend selection.
 *
 * Parsers are pure and regex-based (no new deps). webSearchStructured (added in
 * a later task) picks a backend (Brave → DuckDuckGo HTML → Instant Answer) and
 * never throws — it returns [] on any failure so the research driver degrades
 * gracefully offline or when a backend is unavailable.
 */
import axios from 'axios';
export interface SearchResult { title: string; url: string; snippet?: string }

/** Strip tags + decode the few entities that appear in DDG titles/snippets. */
function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBraveJson(raw: unknown, limit: number): SearchResult[] {
  const results = (raw as { web?: { results?: unknown[] } })?.web?.results;
  if (!Array.isArray(results)) return [];
  const out: SearchResult[] = [];
  for (const r of results) {
    const o = r as { title?: unknown; url?: unknown; description?: unknown };
    if (typeof o?.title === 'string' && typeof o?.url === 'string') {
      out.push({ title: o.title, url: o.url, ...(typeof o.description === 'string' ? { snippet: o.description } : {}) });
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Decode a DuckDuckGo redirect href (//duckduckgo.com/l/?uddg=<encoded>) to the real URL. */
function resolveDdgHref(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) { try { return decodeURIComponent(m[1]); } catch { /* fall through */ } }
  if (href.startsWith('//')) return 'https:' + href;
  return href;
}

export interface SearchDeps {
  httpGet?: (url: string, headers?: Record<string, string>) => Promise<{ data: unknown }>;
}

const UA = 'Mozilla/5.0 (compatible; coderaw/1.0; +https://github.com/Shadysmetools/Free-CLI)';

/** Structured web search with graceful degradation. Never throws → [] on failure. */
export async function webSearchStructured(query: string, limit = 6, deps: SearchDeps = {}): Promise<SearchResult[]> {
  const q = (query ?? '').trim();
  if (!q) return [];
  const httpGet = deps.httpGet ?? (async (url: string, headers?: Record<string, string>) => {
    const isJson = (headers?.['Accept'] ?? '').includes('application/json');
    const r = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': UA, ...(headers ?? {}) },
      responseType: isJson ? ('json' as const) : ('text' as const),
    });
    return { data: r.data };
  });
  try {
    const braveKey = process.env.BRAVE_SEARCH_KEY;
    if (braveKey) {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${limit}`;
      const { data } = await httpGet(url, { Accept: 'application/json', 'X-Subscription-Token': braveKey });
      const parsed = parseBraveJson(data, limit);
      if (parsed.length) return parsed;
    }
    // DuckDuckGo HTML (free, real result links). No Accept header → default httpGet uses responseType:'text' → axios returns the raw HTML string.
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const { data } = await httpGet(ddgUrl);
    const html = typeof data === 'string' ? data : '';
    return parseDdgHtml(html, limit);
  } catch {
    return [];
  }
}

export function parseDdgHtml(html: string, limit: number): SearchResult[] {
  if (!html) return [];
  const out: SearchResult[] = [];
  // Result anchors: <a class="result__a" href="...">title</a>
  const anchorRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]{0,400}?)<\/a>/gi;
  const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]{0,1000}?)<\/a>/gi;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(clean(sm[1]));
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = anchorRe.exec(html)) !== null) {
    const url = resolveDdgHref(m[1]);
    const title = clean(m[2]);
    if (!title || !/^https?:\/\//i.test(url)) { continue; }
    out.push({ title, url, ...(snippets[i] ? { snippet: snippets[i] } : {}) });
    i++;
    if (out.length >= limit) break;
  }
  return out;
}
