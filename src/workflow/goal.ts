/**
 * Layer 3b — the autonomous goal loop: plan -> execute -> VERIFY (sound external
 * check) -> re-plan. Verification runs a real command (tests/tsc/lint) and reads
 * its exit status; the generating model never judges its own output. The loop
 * stops on a passing external check, a maxRounds cap, or a budget cap, and only
 * re-plans AFTER a verification failure (difficulty-gated critique).
 */
import * as fs from 'fs';
import * as path from 'path';
import { RunnerContext, SubAgentSpec, SubAgentResult, runSubAgent as realRunSubAgent } from './runner';
import { PlanItem, setPlan, planToSteps, planSummary } from '../agent/plan';
import { printPlanBox, printInfo } from '../ui/terminal';
import { executeTool } from '../agent/tools';

export interface GoalOptions { goal: string; allow: string[]; verifyCommand?: string; maxRounds?: number; budgetUsd?: number }
export interface GoalResult {
  ok: boolean; rounds: number; plan: PlanItem[]; summary: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  stoppedBy: 'verified' | 'maxRounds' | 'budget' | 'error';
}
export interface GoalDeps {
  runSubAgent?: (s: SubAgentSpec, c: RunnerContext) => Promise<SubAgentResult>;
  verify?: (cmd: string, cwd: string) => Promise<{ passed: boolean; output: string }>;
  detectVerifyCommand?: (cwd: string) => string | null;
  render?: boolean;
}

/** Parse a planner's free text into plan items: JSON array first, else numbered/bulleted lines. */
export function parsePlan(text: string): PlanItem[] {
  const t = text.trim();
  try {
    const arr = JSON.parse(t);
    if (Array.isArray(arr)) return arr.map(x => ({ content: String(x.content ?? x).trim(), status: 'pending' as const })).filter(i => i.content);
  } catch { /* fall through */ }
  return t.split('\n')
    .map(l => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(l => l.length > 0)
    .map(content => ({ content, status: 'pending' as const }));
}

/** Default external verifier: run the command via run_command, pass = non-error exit. */
async function defaultVerify(cmd: string, cwd: string): Promise<{ passed: boolean; output: string }> {
  const res = await executeTool('run_command', { command: cmd }, cwd);
  return { passed: !res.isError, output: res.content };
}

/** Auto-detect a sound verify command from the project. */
function defaultDetect(cwd: string): string | null {
  const pkg = path.join(cwd, 'package.json');
  if (fs.existsSync(pkg)) {
    try { if (JSON.parse(fs.readFileSync(pkg, 'utf-8')).scripts?.test) return 'npm test'; } catch { /* ignore */ }
  }
  if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) return 'npx tsc --noEmit';
  return null;
}

export async function runGoal(opts: GoalOptions, ctx: RunnerContext, deps: GoalDeps = {}): Promise<GoalResult> {
  const runSubAgent = deps.runSubAgent ?? realRunSubAgent;
  const verify = deps.verify ?? defaultVerify;
  const detect = deps.detectVerifyCommand ?? defaultDetect;
  const render = deps.render !== false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wf = (ctx.settings as any).workflows;
  const maxRounds = opts.maxRounds ?? wf?.goal?.maxRounds ?? 5;
  const budgetUsd = opts.budgetUsd ?? wf?.goal?.budgetUsd ?? ctx.settings.budget;
  const verifyCommand = opts.verifyCommand ?? detect(ctx.cwd) ?? null;

  // Pre-authorized allow-list for this goal: extend the gate's session allow set.
  const sessionAllow = new Set<string>(ctx.sessionAllow ?? []);
  for (const a of opts.allow) sessionAllow.add(a);
  const goalCtx: RunnerContext = { ...ctx, sessionAllow };

  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const addUsage = (u?: SubAgentResult['usage']) => { if (u) { usage.prompt_tokens += u.prompt_tokens; usage.completion_tokens += u.completion_tokens; usage.total_tokens += u.total_tokens; } };
  // Local (ollama) is free; nominal cloud rate keeps the budget guard meaningful.
  const costUsd = () => (goalCtx.defaultProviderName === 'ollama' ? 0 : usage.total_tokens / 1000 * 0.001);

  let plan: PlanItem[] = [];
  let stoppedBy: GoalResult['stoppedBy'] = 'maxRounds';
  let rounds = 0;
  let feedback = '';

  for (rounds = 1; rounds <= maxRounds; rounds++) {
    // 1) PLAN (or re-plan with verifier feedback)
    const planTask = `Goal: ${opts.goal}\n\nProduce a short ordered list of concrete steps to achieve this goal.${feedback ? `\n\nThe previous attempt FAILED verification:\n${feedback}\nRevise the plan to fix it.` : ''}\nReturn a numbered list, one step per line.`;
    const planRes = await runSubAgent({ role: 'planner', task: planTask }, goalCtx);
    addUsage(planRes.usage);
    plan = parsePlan(planRes.content);
    if (render) { setPlan(plan); printPlanBox(`🎯 Goal (round ${rounds})`, planToSteps(plan), planSummary(plan)); }

    // 2) EXECUTE each step
    for (let i = 0; i < plan.length; i++) {
      plan[i] = { ...plan[i], status: 'in_progress' };
      if (render) { setPlan(plan); }
      const stepTask = `Goal: ${opts.goal}\nStep ${i + 1} of ${plan.length}: ${plan[i].content}\n\nComplete ONLY this step.`;
      const r = await runSubAgent({ role: 'coder', task: stepTask }, goalCtx);
      addUsage(r.usage);
      plan[i] = { ...plan[i], status: 'completed' };
      if (render) { setPlan(plan); printPlanBox(`🎯 Goal (round ${rounds})`, planToSteps(plan), planSummary(plan)); }
      if (budgetUsd != null && costUsd() >= budgetUsd) {
        return { ok: false, rounds, plan, summary: `Stopped: budget $${budgetUsd} reached.`, usage, stoppedBy: 'budget' };
      }
    }

    // 3) VERIFY — sound external check (NOT an LLM judging its own work)
    if (!verifyCommand) {
      // No sound external check available → cannot confirm completion objectively; stop and report.
      stoppedBy = 'maxRounds';
      if (render) printInfo('No external verify command found; cannot confirm completion objectively.');
      break;
    }
    if (render) printInfo(`Verifying: ${verifyCommand}`);
    const v = await verify(verifyCommand, goalCtx.cwd);
    if (v.passed) { stoppedBy = 'verified'; break; }
    feedback = v.output.slice(0, 800);

    if (budgetUsd != null && costUsd() >= budgetUsd) { stoppedBy = 'budget'; break; }
  }
  if (rounds > maxRounds) rounds = maxRounds;

  const ok = stoppedBy === 'verified';
  return {
    ok, rounds, plan, usage, stoppedBy,
    summary: ok ? `Goal verified after ${rounds} round(s) via "${verifyCommand}".` : `Goal not verified (stopped by ${stoppedBy}) after ${rounds} round(s).`,
  };
}
