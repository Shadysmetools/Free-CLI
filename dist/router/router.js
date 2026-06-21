"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyIntent = classifyIntent;
exports.applyRouterCommand = applyRouterCommand;
/** Natural-language intent router — layered local heuristic + hybrid matcher. Never throws. */
const hybrid_1 = require("../match/hybrid");
const RESEARCH_RE = /\b(research|look it up|look up|find out|search the web|google|what'?s the latest|latest on|investigate online)\b/i;
const GOAL_RE = /\b(keep going until|autonomously|do everything|pursue|accomplish|implement .* and|build .* and|make .* work)\b/i;
const GOAL_VERB_RE = /\b(build|implement|create|refactor|fix|add)\b/i;
const CODE_RE = /(=>|;\s*$|\{[\s\S]*\}|```|\bfunction\b|\bconst\b\s+\w+\s*=)/;
// Invocation cues — the user must signal they want to run/use a named thing.
// hybridSearch normalizes its top hit to 1.0, so the score alone cannot gate
// routing; without an explicit cue, bare token overlap would hijack chat.
// Cues are explicit invocation VERBS only — a bare noun like "pipeline" in conversational text must NOT auto-run anything (conservative: never hijack chat).
const INVOKE_RE = /\b(run|use|execute|start|launch|invoke|trigger|apply)\b/i;
const RESEARCH_CONF = 0.75;
const GOAL_STRONG_CONF = 0.7;
const GOAL_WEAK_CONF = 0.62;
function chat(reason) { return { kind: 'chat', confidence: 1, reason }; }
async function classifyIntent(text, ctx, deps = {}) {
    try {
        const t = (text || '').trim();
        // 1. Chat guard — never hijack normal usage.
        if (t.length < 3)
            return chat('empty or too short');
        if (CODE_RE.test(t))
            return chat('looks like code');
        if (t.endsWith('?') && !RESEARCH_RE.test(t))
            return chat('plain question');
        // 2. Intent signals (regex, local). Strong signals short-circuit before hybrid.
        if (RESEARCH_RE.test(t))
            return { kind: 'research', confidence: RESEARCH_CONF, reason: 'research verb' };
        if (GOAL_RE.test(t))
            return { kind: 'goal', confidence: GOAL_STRONG_CONF, reason: 'autonomous-goal phrasing' };
        const candidates = [];
        if (GOAL_VERB_RE.test(t))
            candidates.push({ kind: 'goal', confidence: GOAL_WEAK_CONF, reason: 'build/implement verb' });
        // 3. Named-item match via hybrid over workflows + skills.
        const hybrid = deps.hybrid ?? hybrid_1.hybridSearch;
        const wfNames = new Set(ctx.workflows.map(w => w.name));
        const docs = [
            ...ctx.workflows.map(w => ({ id: w.name, text: `${w.name} ${w.description ?? ''}` })),
            ...ctx.skills.map(s => ({ id: s.name, text: `${s.name} ${s.description}` })),
        ];
        // Only when the text reads as an explicit invocation (cue word present).
        if (docs.length > 0 && INVOKE_RE.test(t)) {
            const hits = await hybrid(t, docs, { embed: ctx.embed, topK: 1 });
            const top = hits[0];
            if (top && top.score >= ctx.threshold) {
                const kind = wfNames.has(top.id) ? 'workflow' : 'skill';
                candidates.push({ kind, target: top.id, confidence: top.score, reason: `matched ${kind} "${top.id}"` });
            }
        }
        // 4. Fuse + threshold: highest confidence ≥ threshold wins; tie → named-item (has target).
        const eligible = candidates.filter(c => c.confidence >= ctx.threshold);
        if (eligible.length === 0)
            return chat('no confident match');
        eligible.sort((a, b) => (b.confidence - a.confidence) || ((b.target ? 1 : 0) - (a.target ? 1 : 0)));
        return eligible[0];
    }
    catch {
        return chat('router error');
    }
}
/** Pure helper for the `/router on|off|status` slash command. Mutates settings.router in place. */
function applyRouterCommand(settings, arg) {
    settings.router = settings.router ?? {};
    const a = (arg || '').toLowerCase();
    if (a === 'on') {
        settings.router.enabled = true;
        return { message: 'Router enabled.', changed: true };
    }
    if (a === 'off') {
        settings.router.enabled = false;
        return { message: 'Router disabled.', changed: true };
    }
    const state = settings.router.enabled === false ? 'off' : 'on';
    const thr = settings.router.confidenceThreshold ?? 0.6;
    return { message: `Router is ${state} (confidence threshold ${thr}). Usage: /router on|off|status`, changed: false };
}
//# sourceMappingURL=router.js.map