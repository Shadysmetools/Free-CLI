import { describe, it, expect } from 'vitest';
import { StreamFilter, looksLikeToolCallStart } from './stream-filter';

// Helper: feed a string to the filter one char at a time (worst case for a
// streaming token filter) and collect everything it chose to show the user.
function runCharByChar(text: string): string {
  const f = new StreamFilter();
  let shown = '';
  for (const ch of text) shown += f.push(ch);
  shown += f.flush();
  return shown;
}

// Helper: feed in arbitrary chunk boundaries.
function runChunks(chunks: string[]): string {
  const f = new StreamFilter();
  let shown = '';
  for (const c of chunks) shown += f.push(c);
  shown += f.flush();
  return shown;
}

describe('looksLikeToolCallStart', () => {
  it('flags a leading JSON object that looks like a tool call', () => {
    expect(looksLikeToolCallStart('{"name": "list_files"')).toBe(true);
  });
  it('flags a <tool_call> tag', () => {
    expect(looksLikeToolCallStart('<tool_call>')).toBe(true);
  });
  it('flags a ```json fence', () => {
    expect(looksLikeToolCallStart('```json\n{')).toBe(true);
  });
  it('does NOT flag ordinary prose', () => {
    expect(looksLikeToolCallStart('The answer is 4.')).toBe(false);
  });
  it('does NOT flag prose that merely mentions name and arguments', () => {
    expect(looksLikeToolCallStart('pass a name and arguments field')).toBe(false);
  });
});

describe('StreamFilter', () => {
  it('shows plain prose verbatim (char by char)', () => {
    expect(runCharByChar('The answer is 4.')).toBe('The answer is 4.');
  });

  it('shows plain prose verbatim (single chunk)', () => {
    expect(runChunks(['Hello, world!'])).toBe('Hello, world!');
  });

  it('suppresses a raw tool-call JSON blob entirely', () => {
    const tool = '{"name": "list_files", "arguments": {"path": "src"}}';
    expect(runCharByChar(tool)).toBe('');
  });

  it('suppresses a <tool_call>-wrapped blob', () => {
    const tool = '<tool_call>{"name":"read_file","arguments":{}}</tool_call>';
    expect(runCharByChar(tool)).toBe('');
  });

  it('suppresses a ```json fenced tool call', () => {
    const tool = '```json\n{"name":"list_files","arguments":{}}\n```';
    expect(runCharByChar(tool)).toBe('');
  });

  it('does not leak the tool JSON when it arrives split across chunks', () => {
    const shown = runChunks(['{"na', 'me": "list_', 'files", "argu', 'ments": {}}']);
    expect(shown).toBe('');
  });

  it('preserves leading whitespace/newlines before prose', () => {
    // a model may emit a leading space; prose must still come through
    expect(runChunks(['  ', 'Hi there'])).toBe('  Hi there');
  });

  it('shows prose even when it is a long answer with braces inside', () => {
    const prose = 'Use the object { count: 2 } in your code.';
    expect(runCharByChar(prose)).toBe(prose);
  });
});
