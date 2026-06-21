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
export const STATUS_ICON: Record<PlanStatus, string> = {
  pending: '☐',
  in_progress: '◐',
  completed: '☑',
};

const VALID_STATUSES: readonly PlanStatus[] = ['pending', 'in_progress', 'completed'];

// ─── Module-level state ────────────────────────────────────────────────────────
let currentPlan: PlanItem[] = [];

/** Replace the current plan. Stores a defensive copy of the items. */
export function setPlan(items: PlanItem[]): void {
  currentPlan = items.map((it) => ({ content: it.content, status: it.status }));
}

/** Return a defensive copy of the current plan (callers cannot mutate state). */
export function getPlan(): PlanItem[] {
  return currentPlan.map((it) => ({ content: it.content, status: it.status }));
}

/** Reset the plan to empty. */
export function clearPlan(): void {
  currentPlan = [];
}

/**
 * Coerce arbitrary tool input into a clean PlanItem[].
 *
 * Rules:
 *   • input must be an array (otherwise → [])
 *   • each entry must be an object with a non-empty string `content`
 *   • `status` defaults to "pending" and unknown values are coerced to "pending"
 *   • content is trimmed
 */
export function normalizePlanItems(raw: unknown): PlanItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    if (typeof obj.content !== 'string') continue;
    const content = obj.content.trim();
    if (content.length === 0) continue;
    const status = VALID_STATUSES.includes(obj.status as PlanStatus)
      ? (obj.status as PlanStatus)
      : 'pending';
    out.push({ content, status });
  }
  return out;
}

/**
 * Render adapter: map plan items to the existing PlanStep shape consumed by
 * printPlanBox in src/ui/terminal.ts.
 */
export function planToSteps(items: PlanItem[]): PlanStep[] {
  return items.map((it, i) => ({
    num: i + 1,
    icon: STATUS_ICON[it.status],
    role: 'task',
    description: it.content,
  }));
}

/** One-line progress summary, e.g. "1/3 done · 1 in progress". */
export function planSummary(items: PlanItem[]): string {
  const total = items.length;
  const done = items.filter((it) => it.status === 'completed').length;
  const active = items.filter((it) => it.status === 'in_progress').length;
  const activeStr = active > 0 ? ` · ${active} in progress` : '';
  return `${done}/${total} done${activeStr}`;
}
