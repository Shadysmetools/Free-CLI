"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gate = gate;
const classify_1 = require("./classify");
const prompt_1 = require("./prompt");
async function gate(toolName, args, ctx) {
    const verdict = (0, classify_1.classify)(toolName, args, ctx.rules.projectRoot, ctx.rules);
    if (verdict.decision === 'silent')
        return { allowed: true };
    if (verdict.decision === 'block') {
        return {
            allowed: false,
            reasonForModel: `Blocked by the user's permission rules: ${verdict.subject}. Do not attempt this; tell the user it was blocked and why.`,
        };
    }
    // decision === 'ask'
    if (ctx.sessionAllow.has(verdict.subject))
        return { allowed: true };
    if (!ctx.isInteractive) {
        if (ctx.rules.unattended === 'allow')
            return { allowed: true };
        return {
            allowed: false,
            reasonForModel: `Permission required for "${toolName}" but coderaw is running unattended (no human to confirm). Action skipped.`,
        };
    }
    const confirmFn = ctx.confirm ?? prompt_1.defaultConfirm;
    let choice;
    try {
        choice = await confirmFn({
            toolName,
            args,
            verdict,
            defaultApprove: verdict.severity === 'normal' && ctx.rules.confirmDefault === 'approve',
        });
    }
    catch {
        return { allowed: false, reasonForModel: 'Confirmation prompt was unavailable; action skipped for safety.' };
    }
    switch (choice.kind) {
        case 'yes':
            return { allowed: true };
        case 'session':
            ctx.sessionAllow.add(verdict.subject);
            return { allowed: true };
        case 'persist':
            try {
                ctx.persistAllow?.(verdict.subject);
            }
            catch { /* still allow this once */ }
            ctx.sessionAllow.add(verdict.subject);
            return { allowed: true };
        case 'no':
            return {
                allowed: false,
                reasonForModel: choice.reason
                    ? `The user declined this action. Their guidance: "${choice.reason}". Adjust your approach.`
                    : 'The user declined this action. Do not retry it; consider an alternative or ask what they want.',
            };
        default:
            return { allowed: false, reasonForModel: 'Action skipped.' };
    }
}
//# sourceMappingURL=gate.js.map