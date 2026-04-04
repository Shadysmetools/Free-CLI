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

import * as fs from 'fs';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  file: string;           // absolute path
  relativePath: string;   // relative to cwd
  line: number;
  content: string;        // the matching line or snippet
  score: number;          // 0–1 relevance score after reranking
  matchType: 'keyword' | 'pattern' | 'filename' | 'memory';
}

export interface RerankOptions {
  topK?: number;          // max results to return (default: 10)
  minScore?: number;      // minimum score threshold 0–1 (default: 0.1)
  cwd?: string;
}

// RRF constant k — higher = less aggressive rank-boosting
const RRF_K = 60;

// ─── Reciprocal Rank Fusion ───────────────────────────────────────────────────

/**
 * Merge multiple ranked result lists into one using RRF.
 * Each result is identified by `file:line`.
 */
export function reciprocalRankFusion(
  lists: SearchResult[][],
  opts: RerankOptions = {}
): SearchResult[] {
  const { topK = 10, minScore = 0.05 } = opts;

  const scoreMap = new Map<string, number>();
  const resultMap = new Map<string, SearchResult>();

  for (const list of lists) {
    list.forEach((result, rank) => {
      const key = `${result.file}:${result.line}`;
      const rrfScore = 1 / (RRF_K + rank + 1);
      scoreMap.set(key, (scoreMap.get(key) ?? 0) + rrfScore);
      if (!resultMap.has(key)) {
        resultMap.set(key, result);
      }
    });
  }

  // Normalize to 0–1 based on maximum possible score (all lists rank it #1)
  const maxPossible = lists.length * (1 / (RRF_K + 1));

  const merged: SearchResult[] = [];
  for (const [key, rawScore] of scoreMap) {
    const result = resultMap.get(key)!;
    const normalizedScore = Math.min(rawScore / maxPossible, 1);
    merged.push({ ...result, score: normalizedScore });
  }

  return merged
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── Keyword Search (BM25-lite) ───────────────────────────────────────────────

/**
 * Search files for query terms, scoring by term frequency and field weight.
 * No external deps — pure Node.js.
 */
export function keywordSearch(
  query: string,
  files: string[],
  cwd: string,
  topK = 20
): SearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const results: Array<SearchResult & { rawScore: number }> = [];

  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 512 * 1024) continue; // skip files >512KB
      if (stat.isDirectory()) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // File-level: score filename match highly
      const relPath = path.relative(cwd, filePath);
      const fileNameScore = terms.reduce((acc, t) =>
        acc + (relPath.toLowerCase().includes(t) ? 3 : 0), 0
      );

      // Line-level: score each line
      lines.forEach((line, idx) => {
        const lowerLine = line.toLowerCase();
        let lineScore = 0;
        for (const term of terms) {
          // Count occurrences (TF)
          const occurrences = (lowerLine.match(new RegExp(escapeRegex(term), 'g')) ?? []).length;
          lineScore += occurrences * tfWeight(term, line);
        }

        if (lineScore > 0 || fileNameScore > 0) {
          results.push({
            file: filePath,
            relativePath: relPath,
            line: idx + 1,
            content: line.trim(),
            score: 0,
            rawScore: lineScore + (fileNameScore > 0 && idx === 0 ? fileNameScore : 0),
            matchType: 'keyword',
          });
        }
      });
    } catch {
      // skip unreadable files
    }
  }

  return results
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, topK)
    .map(({ rawScore: _r, ...rest }) => rest);
}

// ─── Pattern / Exact Search ───────────────────────────────────────────────────

export function patternSearch(
  pattern: string,
  files: string[],
  cwd: string,
  topK = 20
): SearchResult[] {
  const results: SearchResult[] = [];
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'gi');
  } catch {
    re = new RegExp(escapeRegex(pattern), 'gi');
  }

  for (const filePath of files) {
    try {
      if (fs.statSync(filePath).isDirectory()) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(cwd, filePath);

      lines.forEach((line, idx) => {
        if (re.test(line)) {
          results.push({
            file: filePath,
            relativePath: relPath,
            line: idx + 1,
            content: line.trim(),
            score: 0,
            matchType: 'pattern',
          });
        }
        re.lastIndex = 0; // reset for global flag
      });
    } catch { /* skip */ }
  }

  return results.slice(0, topK);
}

// ─── Memory Search ────────────────────────────────────────────────────────────

export interface MemoryEntry {
  file: string;
  line: number;
  content: string;
}

export function rerankMemoryResults(
  entries: MemoryEntry[],
  query: string,
  cwd: string,
  topK = 5
): SearchResult[] {
  const terms = tokenize(query);
  if (entries.length === 0) return [];

  const scored = entries.map(entry => {
    const lc = entry.content.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (lc.includes(t)) score += (1 + Math.log(1 + (lc.match(new RegExp(escapeRegex(t), 'g')) ?? []).length));
    }
    return {
      file: entry.file,
      relativePath: path.relative(cwd, entry.file),
      line: entry.line,
      content: entry.content,
      score,
      matchType: 'memory' as const,
    };
  });

  return scored
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── File Collector ───────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'coverage', '.cache']);
const SKIP_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.zip', '.tar', '.gz', '.lock', '.bin', '.exe']);

export function collectFiles(dir: string, maxFiles = 500): string[] {
  const results: string[] = [];

  function walk(current: string, depth: number): void {
    if (depth > 8 || results.length >= maxFiles) return;
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && depth > 0) continue;
        if (SKIP_DIRS.has(entry.name)) continue;

        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (!SKIP_EXTS.has(path.extname(entry.name).toLowerCase())) {
          results.push(full);
        }
      }
    } catch { /* skip */ }
  }

  walk(dir, 0);
  return results;
}

// ─── Full Pipeline ────────────────────────────────────────────────────────────

/**
 * Run the full RAG pipeline: collect files → multi-strategy search → RRF → top-K
 */
export function ragSearch(
  query: string,
  cwd: string,
  opts: RerankOptions = {}
): SearchResult[] {
  const files = collectFiles(cwd);

  const kwResults = keywordSearch(query, files, cwd, 30);
  const ptResults = patternSearch(query, files, cwd, 20);

  // Filename hits get their own list for boosting
  const fnResults = files
    .filter(f => path.basename(f).toLowerCase().includes(query.toLowerCase().split(' ')[0]))
    .slice(0, 10)
    .map((f, i) => ({
      file: f,
      relativePath: path.relative(cwd, f),
      line: 1,
      content: `(file: ${path.basename(f)})`,
      score: 0,
      matchType: 'filename' as const,
    }));

  return reciprocalRankFusion([kwResults, ptResults, fnResults], { topK: opts.topK ?? 10, minScore: opts.minScore });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

function tfWeight(term: string, line: string): number {
  // Boost exact matches in identifiers (camelCase/snake_case proximity)
  const exact = line.includes(term) ? 1.5 : 1;
  // Boost short terms that are likely identifiers
  const lengthBonus = term.length <= 4 ? 0.8 : 1;
  return exact * lengthBonus;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'and',
  'or', 'but', 'not', 'be', 'as', 'by', 'we', 'do', 'if', 'my', 'so', 'up',
  'with', 'that', 'this', 'have', 'from', 'they', 'will', 'would', 'could',
  'should', 'which', 'what', 'how', 'when', 'where', 'there', 'here', 'are',
  'was', 'were', 'been', 'has', 'had', 'can', 'may', 'might', 'must', 'shall',
]);
