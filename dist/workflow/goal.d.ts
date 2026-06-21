import { RunnerContext, SubAgentSpec, SubAgentResult } from './runner';
import { PlanItem } from '../agent/plan';
export interface GoalOptions {
    goal: string;
    allow: string[];
    verifyCommand?: string;
    maxRounds?: number;
    budgetUsd?: number;
}
export interface GoalResult {
    ok: boolean;
    rounds: number;
    plan: PlanItem[];
    summary: string;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    stoppedBy: 'verified' | 'maxRounds' | 'budget' | 'error';
}
export interface GoalDeps {
    runSubAgent?: (s: SubAgentSpec, c: RunnerContext) => Promise<SubAgentResult>;
    verify?: (cmd: string, cwd: string) => Promise<{
        passed: boolean;
        output: string;
    }>;
    detectVerifyCommand?: (cwd: string) => string | null;
    render?: boolean;
}
/** Parse a planner's free text into plan items: JSON array first, else numbered/bulleted lines. */
export declare function parsePlan(text: string): PlanItem[];
export declare function runGoal(opts: GoalOptions, ctx: RunnerContext, deps?: GoalDeps): Promise<GoalResult>;
//# sourceMappingURL=goal.d.ts.map