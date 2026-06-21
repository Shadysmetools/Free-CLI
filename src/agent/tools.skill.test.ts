import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSkill } from './tools';
import { setSkillsRuntime, clearSkillsRuntime } from '../skills/runtime';
import { SkillsManager } from '../skills/index';

describe('loadSkill (skill tool)', () => {
  beforeEach(() => {
    const m = new SkillsManager(process.cwd());
    m.loadAll();
    setSkillsRuntime(m);
  });
  afterEach(() => clearSkillsRuntime());

  it('returns the full body for a known skill', () => {
    const r = loadSkill({ name: 'github' });
    expect(r.isError).toBeFalsy();
    expect(r.content.length).toBeGreaterThan(0);
  });

  it('returns an isError result + available list for an unknown skill', () => {
    const r = loadSkill({ name: 'nope' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('Unknown skill');
    expect(r.content).toContain('github'); // lists what IS available
  });

  it('degrades gracefully when no runtime is set', () => {
    clearSkillsRuntime();
    const r = loadSkill({ name: 'github' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('not available');
  });
});
