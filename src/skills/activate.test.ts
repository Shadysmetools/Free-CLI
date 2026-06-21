import { describe, it, expect } from 'vitest';
import { activateSkill } from './activate';
import { SkillsManager } from './index';
import type { Conversation } from '../agent/conversation';

function loaded(): SkillsManager {
  const m = new SkillsManager(process.cwd());
  m.loadAll();
  return m;
}
const fakeConv = (): Conversation => ({ messages: [] } as unknown as Conversation);

describe('activateSkill', () => {
  it('injects the skill body and reports success for a known skill', () => {
    const conv = fakeConv();
    const r = activateSkill(loaded(), 'github', conv);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('github');
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].role).toBe('system');
    expect(conv.messages[0].content).toContain('[Active Skill: github]');
  });

  it('reports failure and does not mutate the conversation for an unknown skill', () => {
    const conv = fakeConv();
    const r = activateSkill(loaded(), 'nope', conv);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Unknown skill');
    expect(conv.messages).toHaveLength(0);
  });
});
