import { describe, it, expect } from 'vitest';
import { sanitizePaste, resolveSubmit } from './chat-input';

describe('sanitizePaste — preserves embedded newlines', () => {
  it('keeps newlines in pasted multi-line text', () => {
    expect(sanitizePaste('line1\nline2\nline3')).toBe('line1\nline2\nline3');
  });

  it('normalizes CRLF to LF (no bare carriage returns)', () => {
    expect(sanitizePaste('a\r\nb')).toBe('a\nb');
  });

  it('drops a lone trailing carriage return (terminal Enter artifact)', () => {
    expect(sanitizePaste('hello\r')).toBe('hello');
  });

  it('converts a lone CR (old-mac style) into a newline', () => {
    expect(sanitizePaste('a\rb')).toBe('a\nb');
  });

  it('strips terminal control / escape bytes but keeps newlines', () => {
    expect(sanitizePaste('a\x1b[200~b\nc')).toBe('ab\nc');
  });

  it('leaves ordinary single-line text untouched', () => {
    expect(sanitizePaste('just text')).toBe('just text');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizePaste('')).toBe('');
  });
});

describe('resolveSubmit — trailing-backslash continuation', () => {
  it('submits a plain single-line buffer', () => {
    const r = resolveSubmit('hello world');
    expect(r.submit).toBe(true);
    expect(r.buffer).toBe('hello world');
  });

  it('does NOT submit when the line ends with a backslash — starts a new line', () => {
    const r = resolveSubmit('first line\\');
    expect(r.submit).toBe(false);
    // the trailing backslash is consumed and replaced by a real newline
    expect(r.buffer).toBe('first line\n');
  });

  it('submits once a continued buffer no longer ends in a backslash', () => {
    const r = resolveSubmit('first line\nsecond line');
    expect(r.submit).toBe(true);
    expect(r.buffer).toBe('first line\nsecond line');
  });

  it('treats an EVEN number of trailing backslashes as literal and submits', () => {
    // source literal === "path C:\temp\\" — ends in TWO backslashes (even => literal)
    const r = resolveSubmit('path C:\\temp\\\\');
    expect(r.submit).toBe(true);
    expect(r.buffer).toBe('path C:\\temp\\\\');
  });

  it('treats an ODD number of trailing backslashes as continuation', () => {
    // source literal === "x\\\\\\" — THREE backslashes (odd => continue)
    const r = resolveSubmit('x\\\\\\');
    expect(r.submit).toBe(false);
    // the final continuation backslash is consumed, the escaped pair stays, newline added
    expect(r.buffer).toBe('x\\\\\n');
  });

  it('a buffer that already contains newlines but does not end in backslash submits as-is', () => {
    const r = resolveSubmit('a\nb\nc');
    expect(r.submit).toBe(true);
    expect(r.buffer).toBe('a\nb\nc');
  });
});
