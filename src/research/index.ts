/**
 * Research mode — a programmatic deep-research driver on the workflow engine:
 * scope (decompose) -> search -> fetch -> cited synthesis. Search/fetch are
 * deterministic; scope/synthesis are sub-agents. Everything network-touching is
 * dependency-injected so the driver is fully unit-testable offline.
 */

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
