import { describe, it, expect } from 'vitest';
import { parseInputArgs } from './cli-helpers';

describe('parseInputArgs', () => {
  it('extracts workflow name + --input k=v pairs', () => {
    const r = parseInputArgs(['review-and-fix', '--input', 'path=src/a.ts', '--input', 'mode=strict']);
    expect(r.name).toBe('review-and-fix');
    expect(r.inputs).toEqual({ path: 'src/a.ts', mode: 'strict' });
  });
  it('handles a name with no inputs', () => {
    expect(parseInputArgs(['demo'])).toEqual({ name: 'demo', inputs: {} });
  });
  it('supports key=value with = in the value', () => {
    expect(parseInputArgs(['w', '--input', 'q=a=b']).inputs).toEqual({ q: 'a=b' });
  });
});
