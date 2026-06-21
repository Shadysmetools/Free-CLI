import { describe, it, expect } from 'vitest';
import { parseQueries, runResearch } from './index';
import type { SubAgentSpec, SubAgentResult, RunnerContext } from '../workflow/runner';
import { getDefaultSettings } from '../config/settings';
import { createDefaultRegistry } from '../registry/index';

describe('parseQueries', () => {
  it('parses a JSON array of strings', () => {
    expect(parseQueries('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  });
  it('parses a JSON array of {query} objects', () => {
    expect(parseQueries('[{"query":"x"},{"query":"y"}]')).toEqual(['x', 'y']);
  });
  it('falls back to numbered/bulleted lines', () => {
    expect(parseQueries('1. first\n2. second\n- third')).toEqual(['first', 'second', 'third']);
  });
  it('caps and handles empties', () => {
    expect(parseQueries('["a","b","c"]', 2)).toEqual(['a', 'b']);
    expect(parseQueries('')).toEqual([]);
  });
});

function ctx(): RunnerContext {
  return { settings: getDefaultSettings(), defaultProviderName: 'ollama', parentRegistry: createDefaultRegistry(), cwd: process.cwd() };
}

describe('runResearch', () => {
  const run = async (spec: SubAgentSpec): Promise<SubAgentResult> =>
    spec.task.includes('decompose') || spec.task.toLowerCase().includes('search-quer')
      ? { ok: true, content: '["q1","q2"]', task: spec.task, usage: { prompt_tokens:1, completion_tokens:1, total_tokens:2 } }
      : { ok: true, content: '# Report\nFinding (source: https://a.com/1)', task: spec.task, usage: { prompt_tokens:1, completion_tokens:1, total_tokens:2 } };

  it('scopes, searches, fetches, synthesizes a cited report; dedups + caps sources', async () => {
    const fetched: string[] = [];
    const res = await runResearch({ question: 'what is X?', maxSources: 2 }, ctx(), {
      runSubAgent: run,
      search: async (q) => ([{ title: 't', url: 'https://a.com/1' }, { title: 't2', url: 'https://a.com/1' }, { title: 't3', url: `https://a.com/${q}` }]),
      fetch: async (url) => { fetched.push(url); return { url, text: `content of ${url}` }; },
      render: false,
    });
    expect(res.ok).toBe(true);
    expect(res.stoppedBy).toBe('done');
    expect(res.queries).toEqual(['q1', 'q2']);
    expect(new Set(fetched).size).toBe(fetched.length);   // deduped
    expect(res.sources.length).toBeLessThanOrEqual(2);     // maxSources cap
    expect(res.report).toContain('source:');
    expect(res.usage.total_tokens).toBeGreaterThan(0);
  });

  it('returns no_sources (no synthesis) when nothing is fetched', async () => {
    let synth = 0;
    const res = await runResearch({ question: 'q' }, ctx(), {
      runSubAgent: async (s: SubAgentSpec) => { if (!s.task.includes('decompose') && !s.task.toLowerCase().includes('search-quer')) synth++; return { ok:true, content:'["q1"]', task:s.task }; },
      search: async () => [{ title: 't', url: 'https://x.com' }],
      fetch: async () => { throw new Error('offline'); },
      render: false,
    });
    expect(res.stoppedBy).toBe('no_sources');
    expect(synth).toBe(0); // synthesis never called
    expect(res.report).toMatch(/no sources/i);
  });
});
