import { describe, it, expect } from 'vitest';
import { BM25, tokenize } from './bm25';

describe('tokenize', () => {
  it('lowercases, splits on non-alphanumerics, drops short tokens + stopwords', () => {
    expect(tokenize('The Quick a brown fox-jumps!')).toEqual(['quick', 'brown', 'fox', 'jumps']);
  });
  it('returns [] for empty/garbage input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('!! a to of')).toEqual([]);
  });
});

describe('BM25', () => {
  it('returns [] for empty corpus or empty query', () => {
    const bm = new BM25();
    expect(bm.search('anything')).toEqual([]);
    bm.add('d1', 'hello world');
    expect(bm.search('')).toEqual([]);
  });

  it('IDF: a rare query term outranks a common one', () => {
    const bm = new BM25();
    bm.add('rare', 'zebra alpha beta');      // 'zebra' appears in 1 doc
    bm.add('common1', 'alpha code review');
    bm.add('common2', 'alpha deploy build');
    bm.add('common3', 'alpha test suite');
    const top = bm.search('zebra alpha')[0];
    expect(top.id).toBe('rare');             // rare term dominates via IDF
  });

  it('TF: more occurrences of a query term scores higher', () => {
    const bm = new BM25();
    bm.add('once', 'login flow handler');
    bm.add('twice', 'login login flow handler');
    const res = bm.search('login');
    const once = res.find(r => r.id === 'once')!;
    const twice = res.find(r => r.id === 'twice')!;
    expect(twice.score).toBeGreaterThan(once.score);
  });

  it('length-norm: a shorter doc outranks a longer doc with the same term count', () => {
    const bm = new BM25();
    bm.add('short', 'deploy server');
    bm.add('long', 'deploy server ' + 'filler word here extra padding more tokens '.repeat(4));
    const res = bm.search('deploy');
    expect(res[0].id).toBe('short');
  });

  it('respects topK', () => {
    const bm = new BM25();
    for (let i = 0; i < 5; i++) bm.add('d' + i, 'deploy server number ' + i);
    expect(bm.search('deploy', 2).length).toBe(2);
  });
});
