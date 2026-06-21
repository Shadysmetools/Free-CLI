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
  it('false for prose that merely mentions name and arguments fields', () => {
    expect(looksLikeToolAttempt('To call it, pass a "name" and an "arguments" field.')).toBe(false);
  });
  it('true for a ```json fenced tool call', () => {
    expect(looksLikeToolAttempt('```json\n{"name":"read_file","arguments":{"path":"a"}}')).toBe(true);
  });
});
