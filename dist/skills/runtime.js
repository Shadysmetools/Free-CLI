"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSkillsRuntime = setSkillsRuntime;
exports.getSkillsRuntime = getSkillsRuntime;
exports.clearSkillsRuntime = clearSkillsRuntime;
let current = null;
function setSkillsRuntime(m) {
    current = m;
}
function getSkillsRuntime() {
    return current;
}
function clearSkillsRuntime() {
    current = null;
}
//# sourceMappingURL=runtime.js.map