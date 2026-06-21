import { describe, it, expect } from 'vitest';
import { SkillsManager } from './index';

// Loads the real builtin skills (src/skills/builtins/*) — github, npm, docker, debug, git-workflow.
function loaded(): SkillsManager {
  const m = new SkillsManager(process.cwd());
  m.loadAll();
  return m;
}

describe('SkillsManager.getCatalog', () => {
  it('lists name — description lines for enabled skills, no bodies', () => {
    const m = loaded();
    const cat = m.getCatalog();
    expect(cat).toContain('## Available Skills');
    expect(cat).toContain('- github —');           // a stable builtin name
    expect(cat).toContain('skill'); // mentions how to load (the `skill` tool / /skill)
    // bodies are markdown headings inside SKILL.md; the catalog must not inline them:
    const github = m.get('github')!;
    const firstBodyLine = github.body.split('\n').find(l => l.trim().length > 0) ?? 'BODYLINE';
    expect(cat).not.toContain(firstBodyLine);
  });

  it('excludes a disabled skill', () => {
    const m = loaded();
    m.disable('github');
    expect(m.getCatalog()).not.toContain('- github —');
  });
});

describe('SkillsManager.activate', () => {
  it('returns the skill (with body) for a known name', () => {
    const s = loaded().activate('github');
    expect(s).toBeDefined();
    expect(s!.name).toBe('github');
    expect(s!.body.length).toBeGreaterThan(0);
  });
  it('returns undefined for an unknown name', () => {
    expect(loaded().activate('does-not-exist')).toBeUndefined();
  });
});
