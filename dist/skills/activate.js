"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateSkill = activateSkill;
function activateSkill(skills, name, conversation) {
    const s = skills.activate(name);
    if (!s) {
        return { ok: false, message: `Unknown skill "${name}". Try /skills to list available skills.` };
    }
    conversation.messages.push({ role: 'system', content: `[Active Skill: ${s.name}]\n${s.body}` });
    return { ok: true, message: `Activated skill: ${s.name}` };
}
//# sourceMappingURL=activate.js.map