import { describe, it, expect } from 'vitest';
import { parseBraveJson, parseDdgHtml, webSearchStructured } from './search';

describe('parseBraveJson', () => {
  it('extracts title/url/snippet from Brave web.results', () => {
    const raw = { web: { results: [
      { title: 'TS Handbook', url: 'https://ts.dev/h', description: 'docs' },
      { title: 'Vitest', url: 'https://vitest.dev', description: 'testing' },
    ]}};
    expect(parseBraveJson(raw, 5)).toEqual([
      { title: 'TS Handbook', url: 'https://ts.dev/h', snippet: 'docs' },
      { title: 'Vitest', url: 'https://vitest.dev', snippet: 'testing' },
    ]);
  });
  it('caps at limit and never throws on malformed input', () => {
    expect(parseBraveJson({ web: { results: [{title:'a',url:'u1'},{title:'b',url:'u2'}] } }, 1).length).toBe(1);
    expect(parseBraveJson(null, 5)).toEqual([]);
    expect(parseBraveJson({}, 5)).toEqual([]);
  });
});

describe('parseDdgHtml', () => {
  const html = `
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=x">Example A</a>
    <a class="result__snippet">Snippet A</a>
    <a class="result__a" href="https://direct.example.org/b">Direct B</a>`;
  it('extracts results and decodes DDG redirect (uddg) hrefs', () => {
    const out = parseDdgHtml(html, 5);
    expect(out[0]).toEqual({ title: 'Example A', url: 'https://example.com/a', snippet: 'Snippet A' });
    expect(out[1].url).toBe('https://direct.example.org/b');
    expect(out[1].title).toBe('Direct B');
    expect(out[1]).toEqual({ title: 'Direct B', url: 'https://direct.example.org/b' });
  });
  it('caps at limit; empty/garbage → []', () => {
    expect(parseDdgHtml(html, 1).length).toBe(1);
    expect(parseDdgHtml('', 5)).toEqual([]);
    expect(parseDdgHtml('<div>no results</div>', 5)).toEqual([]);
  });
  it('keeps snippet aligned to the kept result when a non-http anchor is skipped', () => {
    const html = `
      <a class="result__a" href="javascript:void(0)">Skip me</a>
      <a class="result__a" href="https://real.example/1">Real One</a>
      <a class="result__snippet">Snippet for Real One</a>`;
    expect(parseDdgHtml(html, 5)).toEqual([
      { title: 'Real One', url: 'https://real.example/1', snippet: 'Snippet for Real One' },
    ]);
  });
});

describe('webSearchStructured', () => {
  const braveData = { web: { results: [{ title: 'B', url: 'https://b.com', description: 'd' }] } };
  const ddgHtml = '<a class="result__a" href="https://d.com/x">DDG X</a>';

  it('uses Brave when BRAVE_SEARCH_KEY is set', async () => {
    const prev = process.env.BRAVE_SEARCH_KEY;
    process.env.BRAVE_SEARCH_KEY = 'k';
    const out = await webSearchStructured('q', 5, { httpGet: async () => ({ data: braveData }) });
    if (prev === undefined) delete process.env.BRAVE_SEARCH_KEY; else process.env.BRAVE_SEARCH_KEY = prev;
    expect(out).toEqual([{ title: 'B', url: 'https://b.com', snippet: 'd' }]);
  });

  it('falls back to DDG HTML when no key', async () => {
    const prev = process.env.BRAVE_SEARCH_KEY;
    delete process.env.BRAVE_SEARCH_KEY;
    const out = await webSearchStructured('q', 5, { httpGet: async () => ({ data: ddgHtml }) });
    if (prev !== undefined) process.env.BRAVE_SEARCH_KEY = prev;
    expect(out).toEqual([{ title: 'DDG X', url: 'https://d.com/x' }]);
  });

  it('returns [] (never throws) on http error', async () => {
    const out = await webSearchStructured('q', 5, { httpGet: async () => { throw new Error('net'); } });
    expect(out).toEqual([]);
  });
});
