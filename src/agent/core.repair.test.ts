import { describe, it, expect } from 'vitest';
import { looksLikeToolAttempt } from './core';

describe('looksLikeToolAttempt', () => {
  it('true for a JSON object mentioning name+arguments', () => {
    expect(looksLikeToolAttempt('{"name":"read_file","arguments":{')).toBe(true);
  });
  it('true for a <tool_call> opener', () => {
    expect(looksLikeToolAttempt('<tool_call>{"name":')).toBe(true);
  });
  it('false for ordinary prose', () => {
    expect(looksLikeToolAttempt('The file contains a config object.')).toBe(false);
  });
});
