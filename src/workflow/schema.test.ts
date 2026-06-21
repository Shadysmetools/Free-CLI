import { describe, it, expect } from 'vitest';
import { validateWorkflow, topoOrder } from './schema';

const good = {
  name: 'review-and-fix',
  inputs: ['path'],
  steps: [
    { id: 'find', type: 'agent', role: 'reviewer', task: 'Review {{path}}' },
    { id: 'fix', type: 'agent', role: 'coder', task: 'Fix {{steps.find.output}}', depends_on: ['find'] },
  ],
};

describe('validateWorkflow', () => {
  it('accepts a well-formed def', () => {
    const r = validateWorkflow(good);
    expect(r.ok).toBe(true);
  });
  it('rejects missing name / empty steps', () => {
    expect(validateWorkflow({ steps: [] }).ok).toBe(false);
    expect(validateWorkflow({ name: 'x', steps: [] }).ok).toBe(false);
  });
  it('rejects duplicate step ids', () => {
    const r = validateWorkflow({ name: 'x', steps: [{ id: 'a', type: 'agent', task: 't' }, { id: 'a', type: 'agent', task: 't' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/duplicate/i);
  });
  it('rejects an unknown depends_on target', () => {
    const r = validateWorkflow({ name: 'x', steps: [{ id: 'a', type: 'agent', task: 't', depends_on: ['ghost'] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/ghost/);
  });
  it('rejects a dependency cycle', () => {
    const r = validateWorkflow({ name: 'x', steps: [
      { id: 'a', type: 'agent', task: 't', depends_on: ['b'] },
      { id: 'b', type: 'agent', task: 't', depends_on: ['a'] },
    ]});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/cycle/i);
  });
});

describe('topoOrder', () => {
  it('groups independent steps into the same level', () => {
    const levels = topoOrder([
      { id: 'a', type: 'agent', task: 't' },
      { id: 'b', type: 'agent', task: 't' },
      { id: 'c', type: 'agent', task: 't', depends_on: ['a', 'b'] },
    ]);
    expect(levels[0].sort()).toEqual(['a', 'b']);
    expect(levels[1]).toEqual(['c']);
  });
});
