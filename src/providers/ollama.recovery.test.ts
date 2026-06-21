import { describe, it, expect } from 'vitest';
import { recoverToolCallsFromText } from './ollama';

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
