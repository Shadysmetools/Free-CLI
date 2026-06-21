"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePlan = parsePlan;
exports.runGoal = runGoal;
/**
 * Layer 3b — the autonomous goal loop: plan -> execute -> VERIFY (sound external
 * check) -> re-plan. Verification runs a real command (tests/tsc/lint) and reads
 * its exit status; the generating model never judges its own output. The loop
 * stops on a passing external check, a maxRounds cap, or a budget cap, and only
 * re-plans AFTER a verification failure (difficulty-gated critique).
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const runner_1 = require("./runner");
const plan_1 = require("../agent/plan");
const terminal_1 = require("../ui/terminal");
const tools_1 = require("../agent/tools");
const permissions_1 = require("../permissions");
/** Parse a planner's free text into plan items: JSON array first, else numbered/bulleted lines. */
function parsePlan(text) {
    const t = text.trim();
    try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr))
            return arr.map(x => ({ content: String(x.content ?? x).trim(), status: 'pending' })).filter(i => i.content);
    }
    catch { /* fall through */ }
    return t.split('\n')
        .map(l => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
        .filter(l => l.length > 0)
        .map(content => ({ content, status: 'pending' }));
}
/** Default external verifier: run the command via run_command, pass = non-error exit.
 *  When a permissions Rules object is available, the command is routed through gate()
 *  so that the user's allow-list and deny rules are honoured. If permissions are disabled
 *  (rules === undefined) the call falls back to the original ungated behaviour.
 *
 *  Allow-entry semantics for run_command:
 *    - The gate's classify() uses the command string as the subject (not the tool name).
 *    - opts.allow entries are merged into both rules.allow (for glob matching) and
 *      sessionAllow (for exact matching).
 *    - A bare 'run_command' entry in opts.allow does NOT match via glob (the subject is
 *      the command string, not the tool name). To bridge this, if 'run_command' appears
 *      in sessionAllow (indicating a broad pre-authorisation of shell commands for this
 *      goal run), the specific verify command is added to sessionAllow so the gate lets
 *      it through silently. */
async function defaultVerify(cmd, cwd, goalCtx) {
    if (goalCtx?.permissions) {
        // Clone sessionAllow so we don't mutate the shared set; if 'run_command' was
        // pre-authorised as a blanket grant, also admit the specific command string.
        const sessionAllow = new Set(goalCtx.sessionAllow ?? []);
        // Bridge: a pre-authorized 'run_command' grant covers THIS verify command
        // (including an auto-detected one like `npm test`). The gate matches run_command
        // by command string, so add the concrete command to the goal-local allow set.
        if (sessionAllow.has('run_command'))
            sessionAllow.add(cmd);
        const gateCtx = {
            cwd: goalCtx.cwd,
            rules: goalCtx.permissions,
            isInteractive: Boolean(process.stdout.isTTY) && !goalCtx.unattended,
            sessionAllow,
            persistAllow: permissions_1.persistAllowPattern,
        };
        const decision = await (0, permissions_1.gate)('run_command', { command: cmd }, gateCtx);
        if (!decision.allowed) {
            return { passed: false, output: `verify command not permitted by gate: ${decision.reasonForModel ?? ''}` };
        }
    }
    const res = await (0, tools_1.executeTool)('run_command', { command: cmd }, cwd);
    return { passed: !res.isError, output: res.content };
}
/** Auto-detect a sound verify command from the project. */
function defaultDetect(cwd) {
    const pkg = path.join(cwd, 'package.json');
    if (fs.existsSync(pkg)) {
        try {
            if (JSON.parse(fs.readFileSync(pkg, 'utf-8')).scripts?.test)
                return 'npm test';
        }
        catch { /* ignore */ }
    }
    if (fs.existsSync(path.join(cwd, 'tsconfig.json')))
        return 'npx tsc --noEmit';
    return null;
}
async function runGoal(opts, ctx, deps = {}) {
    const runSubAgent = deps.runSubAgent ?? runner_1.runSubAgent;
    const detect = deps.detectVerifyCommand ?? defaultDetect;
    const render = deps.render !== false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wf = ctx.settings.workflows;
    const maxRounds = opts.maxRounds ?? wf?.goal?.maxRounds ?? 5;
    const budgetUsd = opts.budgetUsd ?? wf?.goal?.budgetUsd ?? ctx.settings.budget;
    const verifyCommand = opts.verifyCommand ?? detect(ctx.cwd) ?? null;
    // Pre-authorized allow-list for this goal: extend the gate's session allow set.
    const sessionAllow = new Set(ctx.sessionAllow ?? []);
    for (const a of opts.allow)
        sessionAllow.add(a);
    const goalCtx = { ...ctx, sessionAllow };
    // Resolve verify after goalCtx so the default path can pass it to the gate.
    const verify = deps.verify ?? ((cmd, cwd) => defaultVerify(cmd, cwd, goalCtx));
    const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const addUsage = (u) => { if (u) {
        usage.prompt_tokens += u.prompt_tokens;
        usage.completion_tokens += u.completion_tokens;
        usage.total_tokens += u.total_tokens;
    } };
    // Local (ollama) is free; nominal cloud rate keeps the budget guard meaningful.
    const costUsd = () => (goalCtx.defaultProviderName === 'ollama' ? 0 : usage.total_tokens / 1000 * 0.001);
    let plan = [];
    let stoppedBy = 'maxRounds';
    let rounds = 0;
    let feedback = '';
    for (rounds = 1; rounds <= maxRounds; rounds++) {
        // 1) PLAN (or re-plan with verifier feedback)
        const planTask = `Goal: ${opts.goal}\n\nProduce a short ordered list of concrete steps to achieve this goal.${feedback ? `\n\nThe previous attempt FAILED verification:\n${feedback}\nRevise the plan to fix it.` : ''}\nReturn a numbered list, one step per line.`;
        const planRes = await runSubAgent({ role: 'planner', task: planTask }, goalCtx);
        addUsage(planRes.usage);
        plan = parsePlan(planRes.content);
        if (render) {
            (0, plan_1.setPlan)(plan);
            (0, terminal_1.printPlanBox)(`🎯 Goal (round ${rounds})`, (0, plan_1.planToSteps)(plan), (0, plan_1.planSummary)(plan));
        }
        // 2) EXECUTE each step
        for (let i = 0; i < plan.length; i++) {
            plan[i] = { ...plan[i], status: 'in_progress' };
            if (render) {
                (0, plan_1.setPlan)(plan);
            }
            const stepTask = `Goal: ${opts.goal}\nStep ${i + 1} of ${plan.length}: ${plan[i].content}\n\nComplete ONLY this step.`;
            const r = await runSubAgent({ role: 'coder', task: stepTask }, goalCtx);
            addUsage(r.usage);
            plan[i] = { ...plan[i], status: 'completed' };
            if (render) {
                (0, plan_1.setPlan)(plan);
                (0, terminal_1.printPlanBox)(`🎯 Goal (round ${rounds})`, (0, plan_1.planToSteps)(plan), (0, plan_1.planSummary)(plan));
            }
            if (budgetUsd != null && costUsd() >= budgetUsd) {
                return { ok: false, rounds, plan, summary: `Stopped: budget $${budgetUsd} reached.`, usage, stoppedBy: 'budget' };
            }
        }
        // 3) VERIFY — sound external check (NOT an LLM judging its own work)
        if (!verifyCommand) {
            // No sound external check available → cannot confirm completion objectively; stop and report.
            stoppedBy = 'maxRounds';
            if (render)
                (0, terminal_1.printInfo)('No external verify command found; cannot confirm completion objectively.');
            break;
        }
        if (render)
            (0, terminal_1.printInfo)(`Verifying: ${verifyCommand}`);
        const v = await verify(verifyCommand, goalCtx.cwd);
        if (v.passed) {
            stoppedBy = 'verified';
            break;
        }
        feedback = v.output.slice(0, 800);
        if (budgetUsd != null && costUsd() >= budgetUsd) {
            stoppedBy = 'budget';
            break;
        }
    }
    if (rounds > maxRounds)
        rounds = maxRounds;
    const ok = stoppedBy === 'verified';
    return {
        ok, rounds, plan, usage, stoppedBy,
        summary: ok ? `Goal verified after ${rounds} round(s) via "${verifyCommand}".` : `Goal not verified (stopped by ${stoppedBy}) after ${rounds} round(s).`,
    };
}
//# sourceMappingURL=goal.js.map