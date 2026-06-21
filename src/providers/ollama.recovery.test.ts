import { describe, it, expect } from 'vitest';
import { recoverToolCallsFromText, recoverFromStreamedContent } from './ollama';

const names = (r: ReturnType<typeof recoverToolCallsFromText>) => r.map(c => c.function.name);

describe('recoverToolCallsFromText', () => {
  it('recovers a bare object', () => {
    const r = recoverToolCallsFromText('{"name":"read_file","arguments":{"path":"a.ts"}}');
    expect(names(r)).toEqual(['read_file']);
    expect(JSON.parse(r[0].function.arguments)).toEqual({ path: 'a.ts' });
  });
  it('recovers from a ```json fence', () => {
    const r = recoverToolCallsFromText('```json\n{"name":"list_files","arguments":{}}\n```');
    expect(names(r)).toEqual(['list_files']);
  });
  it('recovers from <tool_call> tags', () => {
    const r = recoverToolCallsFromText('<tool_call>{"name":"git_status","arguments":{}}</tool_call>');
    expect(names(r)).toEqual(['git_status']);
  });
  it('tolerates leading prose', () => {
    const r = recoverToolCallsFromText('Sure! {"name":"read_file","arguments":{"path":"a"}}');
    expect(names(r)).toEqual(['read_file']);
  });
  it('recovers multiple bare calls', () => {
    const r = recoverToolCallsFromText('{"name":"a","arguments":{}} {"name":"b","arguments":{}}');
    expect(names(r)).toEqual(['a', 'b']);
  });
  it('returns [] for plain prose', () => {
    expect(recoverToolCallsFromText('The version is 1.0.0')).toEqual([]);
  });
  it('returns [] for malformed JSON', () => {
    expect(recoverToolCallsFromText('{"name":"read_file","arguments":{')).toEqual([]);
  });
});

describe('recoverFromStreamedContent', () => {
  it('extracts tool calls from accumulated streamed text', () => {
    const acc = 'Working on it...\n{"name":"read_file","arguments":{"path":"x"}}';
    const r = recoverFromStreamedContent(acc);
    expect(r.tool_calls?.map(c => c.function.name)).toEqual(['read_file']);
    expect(r.content).toBe('');
  });
  it('keeps content when there is no tool call', () => {
    const r = recoverFromStreamedContent('just an answer');
    expect(r.tool_calls).toBeUndefined();
    expect(r.content).toBe('just an answer');
  });
});
