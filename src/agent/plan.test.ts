import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setPlan,
  getPlan,
  clearPlan,
  normalizePlanItems,
  planToSteps,
  STATUS_ICON,
  type PlanItem,
} from './plan';
import { executeTool, TOOLS } from './tools';

describe('plan state', () => {
  beforeEach(() => clearPlan());

  it('starts empty', () => {
    expect(getPlan()).toEqual([]);
  });

  it('stores and returns a plan', () => {
    const items: PlanItem[] = [
      { content: 'Write tests', status: 'completed' },
      { content: 'Implement feature', status: 'in_progress' },
      { content: 'Type-check', status: 'pending' },
    ];
    setPlan(items);
    expect(getPlan()).toEqual(items);
  });

  it('returns a copy from getPlan (no external mutation leaks in)', () => {
    setPlan([{ content: 'A', status: 'pending' }]);
    const p = getPlan();
    p.push({ content: 'B', status: 'pending' });
    expect(getPlan()).toHaveLength(1);
  });

  it('setPlan copies input (later mutation of the source does not change state)', () => {
    const items: PlanItem[] = [{ content: 'A', status: 'pending' }];
    setPlan(items);
    items.push({ content: 'B', status: 'pending' });
    expect(getPlan()).toHaveLength(1);
  });

  it('clearPlan empties the plan', () => {
    setPlan([{ content: 'A', status: 'pending' }]);
    clearPlan();
    expect(getPlan()).toEqual([]);
  });
});

describe('normalizePlanItems', () => {
  it('keeps valid items and defaults status to pending', () => {
    const out = normalizePlanItems([
      { content: 'task one' },
      { content: 'task two', status: 'completed' },
    ]);
    expect(out).toEqual([
      { content: 'task one', status: 'pending' },
      { content: 'task two', status: 'completed' },
    ]);
  });

  it('coerces unknown status values to pending', () => {
    const out = normalizePlanItems([{ content: 'x', status: 'bogus' }]);
    expect(out[0].status).toBe('pending');
  });

  it('drops items without string content', () => {
    const out = normalizePlanItems([
      { content: 'keep', status: 'pending' },
      { status: 'pending' },
      { content: 42 },
      null,
      'not an object',
    ]);
    expect(out).toEqual([{ content: 'keep', status: 'pending' }]);
  });

  it('trims surrounding whitespace from content', () => {
    const out = normalizePlanItems([{ content: '  spaced  ', status: 'pending' }]);
    expect(out[0].content).toBe('spaced');
  });

  it('returns [] for a non-array input', () => {
    expect(normalizePlanItems(undefined)).toEqual([]);
    expect(normalizePlanItems('nope')).toEqual([]);
  });
});

describe('planToSteps (render adapter for printPlanBox)', () => {
  it('maps each item to a PlanStep with a status icon', () => {
    const steps = planToSteps([
      { content: 'done', status: 'completed' },
      { content: 'doing', status: 'in_progress' },
      { content: 'todo', status: 'pending' },
    ]);
    expect(steps).toHaveLength(3);
    expect(steps[0].num).toBe(1);
    expect(steps[1].num).toBe(2);
    expect(steps[2].num).toBe(3);
    expect(steps[0].icon).toBe(STATUS_ICON.completed);
    expect(steps[1].icon).toBe(STATUS_ICON.in_progress);
    expect(steps[2].icon).toBe(STATUS_ICON.pending);
    expect(steps[0].description).toBe('done');
    expect(steps[0].role).toBe('task');
  });
});

describe('update_plan tool', () => {
  beforeEach(() => {
    clearPlan();
    // printPlanBox writes to stdout; silence it during tests.
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('is registered in the TOOLS array with the items param required', () => {
    const tool = TOOLS.find((t) => t.name === 'update_plan');
    expect(tool).toBeDefined();
    expect(tool?.parameters.required).toContain('items');
    expect(tool?.parameters.properties.items?.type).toBe('array');
  });

  it('stores the plan and reports a summary', async () => {
    const res = await executeTool(
      'update_plan',
      {
        items: [
          { content: 'Write tests', status: 'completed' },
          { content: 'Implement', status: 'in_progress' },
          { content: 'Type-check', status: 'pending' },
        ],
      },
      process.cwd(),
    );
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('1/3 done');
    expect(res.content).toContain('Implement');
    expect(getPlan()).toEqual([
      { content: 'Write tests', status: 'completed' },
      { content: 'Implement', status: 'in_progress' },
      { content: 'Type-check', status: 'pending' },
    ]);
  });

  it('replaces (does not append to) the existing plan', async () => {
    setPlan([{ content: 'old', status: 'pending' }]);
    await executeTool('update_plan', { items: [{ content: 'new', status: 'pending' }] }, process.cwd());
    expect(getPlan()).toEqual([{ content: 'new', status: 'pending' }]);
  });

  it('errors when no valid items are supplied', async () => {
    const res = await executeTool('update_plan', { items: [] }, process.cwd());
    expect(res.isError).toBe(true);
    expect(getPlan()).toEqual([]);
  });
});
