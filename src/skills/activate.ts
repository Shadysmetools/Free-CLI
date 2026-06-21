/** Activate a skill by injecting its full body into the conversation as a system message. */
import { SkillsManager } from './index';
import { ConversationState } from '../agent/conversation';

export function activateSkill(
  skills: SkillsManager,
  name: string,
  conversation: ConversationState,
): { ok: boolean; message: string } {
  const s = skills.activate(name);
  if (!s) {
    return { ok: false, message: `Unknown skill "${name}". Try /skills to list available skills.` };
  }
  conversation.messages.push({ role: 'system', content: `[Active Skill: ${s.name}]\n${s.body}` });
  return { ok: true, message: `Activated skill: ${s.name}` };
}
