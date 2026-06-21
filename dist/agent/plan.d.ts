/**
 * Plan / TODO state — a Claude-Code-style task plan the agent maintains
 * during a turn.
 *
 * Pure and testable: the current plan lives in a single module-level variable,
 * mutated only through setPlan/clearPlan and read (defensively copied) through
 * getPlan. The render adapter (planToSteps) maps items onto the existing
 * PlanStep shape so the UI can draw them with printPlanBox.
 */
import type { PlanStep } from '../ui/terminal';
export type PlanStatus = 'pending' | 'in_progress' | 'completed';
export interface PlanItem {
    content: string;
    status: PlanStatus;
}
/** Status → checkbox-style icon used when rendering the plan box. */
export declare const STATUS_ICON: Record<PlanStatus, string>;
/** Replace the current plan. Stores a defensive copy of the items. */
export declare function setPlan(items: PlanItem[]): void;
/** Return a defensive copy of the current plan (callers cannot mutate state). */
export declare function getPlan(): PlanItem[];
/** Reset the plan to empty. */
export declare function clearPlan(): void;
/**
 * Coerce arbitrary tool input into a clean PlanItem[].
 *
 * Rules:
 *   • input must be an array (otherwise → [])
 *   • each entry must be an object with a non-empty string `content`
 *   • `status` defaults to "pending" and unknown values are coerced to "pending"
 *   • content is trimmed
 */
export declare function normalizePlanItems(raw: unknown): PlanItem[];
/**
 * Render adapter: map plan items to the existing PlanStep shape consumed by
 * printPlanBox in src/ui/terminal.ts.
 */
export declare function planToSteps(items: PlanItem[]): PlanStep[];
/** One-line progress summary, e.g. "1/3 done · 1 in progress". */
export declare function planSummary(items: PlanItem[]): string;
//# sourceMappingURL=plan.d.ts.map