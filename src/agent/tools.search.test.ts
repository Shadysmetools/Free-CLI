import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { executeTool } from './tools';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgtest-'));
  fs.writeFileSync(path.join(dir, 'a.ts'), 'const NEEDLE = 1;\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'no match here\n');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('search_files', () => {
  it('finds a pattern in the right file', async () => {
    const r = await executeTool('search_files', { pattern: 'NEEDLE', path: dir }, dir);
    expect(r.isError).not.toBe(true);
    expect(r.content).toMatch(/a\.ts/);
    expect(r.content).not.toMatch(/b\.txt/);
  });
  it('respects a file glob', async () => {
    const r = await executeTool('search_files', { pattern: 'match', path: dir, file_pattern: '*.txt' }, dir);
    expect(r.content).toMatch(/b\.txt/);
  });
});
