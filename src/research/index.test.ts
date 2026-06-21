import { describe, it, expect } from 'vitest';
import { parseQueries } from './index';

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
