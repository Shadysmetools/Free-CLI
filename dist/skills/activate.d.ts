/** Activate a skill by injecting its full body into the conversation as a system message. */
import { SkillsManager } from './index';
import { ConversationState } from '../agent/conversation';
export declare function activateSkill(skills: SkillsManager, name: string, conversation: ConversationState): {
    ok: boolean;
    message: string;
};
//# sourceMappingURL=activate.d.ts.map