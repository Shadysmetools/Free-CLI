import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseWorkflow, loadWorkflows } from './loader';

describe('parseWorkflow', () => {
  it('parses valid YAML into a WorkflowDef', () => {
    const r = parseWorkflow('name: demo\nsteps:\n  - id: a\n    type: agent\n    task: hello');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.def.name).toBe('demo');
  });
  it('reports validation errors for bad YAML content', () => {
    const r = parseWorkflow('name: bad\nsteps: []');
    expect(r.ok).toBe(false);
  });
});

describe('loadWorkflows', () => {
  let dirA: string, dirB: string;
  beforeEach(() => {
    dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'wfa-'));
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wfb-'));
    fs.writeFileSync(path.join(dirA, 'shared.yaml'), 'name: shared\nsteps:\n  - id: a\n    type: agent\n    task: from-A');
    fs.writeFileSync(path.join(dirB, 'shared.yaml'), 'name: shared\nsteps:\n  - id: a\n    type: agent\n    task: from-B');
    fs.writeFileSync(path.join(dirB, 'extra.yaml'), 'name: extra\nsteps:\n  - id: a\n    type: agent\n    task: t');
  });
  afterEach(() => { fs.rmSync(dirA, { recursive: true, force: true }); fs.rmSync(dirB, { recursive: true, force: true }); });

  it('loads all valid workflows; later dirs override earlier on name collision', () => {
    const map = loadWorkflows([dirA, dirB]); // dirB wins
    expect(map.size).toBe(2);
    expect(map.get('shared')!.steps[0].task).toBe('from-B');
    expect(map.has('extra')).toBe(true);
  });
  it('returns empty map for non-existent dirs', () => {
    expect(loadWorkflows(['/no/such/dir']).size).toBe(0);
  });
});
