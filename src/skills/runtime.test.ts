import { describe, it, expect } from 'vitest';
import { setSkillsRuntime, getSkillsRuntime, clearSkillsRuntime } from './runtime';
import { SkillsManager } from './index';

describe('skills runtime holder', () => {
  it('set → get → clear', () => {
    expect(getSkillsRuntime()).toBeNull();
    const m = new SkillsManager(process.cwd());
    setSkillsRuntime(m);
    expect(getSkillsRuntime()).toBe(m);
    clearSkillsRuntime();
    expect(getSkillsRuntime()).toBeNull();
  });
});
