import { describe, it, expect, vi } from 'vitest';
import { classifyIntent, applyRouterCommand } from './router';

const ctx = {
  skills: [{ name: 'github', description: 'GitHub ops via gh CLI: issues, PRs, CI' }],
  workflows: [{ name: 'deploy-app', description: 'build, test and deploy the app' }],
  threshold: 0.6,
};
// Deterministic hybrid stub: returns a hit only when the query mentions the doc id.
const hybridStub = (target: string, score: number) =>
  vi.fn(async () => [{ id: target, score }]);

describe('classifyIntent — chat guard', () => {
  it('empty / whitespace → chat', async () => {
    expect((await classifyIntent('   ', ctx)).kind).toBe('chat');
  });
  it('a bare question with no research verb → chat', async () => {
    expect((await classifyIntent('what is a closure?', ctx)).kind).toBe('chat');
  });
  it('a code paste → chat', async () => {
    expect((await classifyIntent('const add = (a, b) => a + b;', ctx)).kind).toBe('chat');
  });
});

describe('classifyIntent — signals', () => {
  it('a research verb → research', async () => {
    const d = await classifyIntent('research the latest on rust async runtimes', ctx);
    expect(d.kind).toBe('research');
    expect(d.confidence).toBeGreaterThanOrEqual(0.6);
  });
  it('a goal verb → goal', async () => {
    const d = await classifyIntent('build a working login flow and keep going until tests pass', ctx);
    expect(d.kind).toBe('goal');
  });
});

describe('classifyIntent — named items via hybrid', () => {
  it('a strong workflow match → workflow target', async () => {
    const d = await classifyIntent('run the deploy-app pipeline', ctx, { hybrid: hybridStub('deploy-app', 0.9) });
    expect(d.kind).toBe('workflow');
    expect(d.target).toBe('deploy-app');
  });
  it('a strong skill match → skill target', async () => {
    const d = await classifyIntent('use the github skill to open a PR', ctx, { hybrid: hybridStub('github', 0.85) });
    expect(d.kind).toBe('skill');
    expect(d.target).toBe('github');
  });
  it('a below-threshold match → chat', async () => {
    const d = await classifyIntent('something only loosely related here', ctx, { hybrid: hybridStub('deploy-app', 0.3) });
    expect(d.kind).toBe('chat');
  });
});

describe('classifyIntent — never throws', () => {
  it('a throwing hybrid → chat', async () => {
    const hybrid = vi.fn(async () => { throw new Error('boom'); });
    expect((await classifyIntent('run the deploy-app pipeline', ctx, { hybrid })).kind).toBe('chat');
  });
});

describe('classifyIntent — invocation-cue gate (real hybrid)', () => {
  const realCtx = {
    skills: [],
    workflows: [{ name: 'deploy-app', description: 'deploy the application to production' }],
    threshold: 0.6,
  };
  it('bare description overlap WITHOUT an invocation cue → chat', async () => {
    const d = await classifyIntent('the application broke in production today', realCtx);
    expect(d.kind).toBe('chat');
  });
  it('an explicit invocation cue + real hybrid match → workflow', async () => {
    const d = await classifyIntent('run the deploy-app workflow', realCtx);
    expect(d.kind).toBe('workflow');
    expect(d.target).toBe('deploy-app');
  });
});

describe('applyRouterCommand', () => {
  it('on/off mutate settings; status reports', () => {
    const s: any = { router: { enabled: true } };
    expect(applyRouterCommand(s, 'off').changed).toBe(true);
    expect(s.router.enabled).toBe(false);
    expect(applyRouterCommand(s, 'on').changed).toBe(true);
    expect(s.router.enabled).toBe(true);
    expect(applyRouterCommand(s, 'status').changed).toBe(false);
    expect(applyRouterCommand(s, 'status').message.toLowerCase()).toContain('on');
  });

  it('initializes settings.router when absent', () => {
    const s: any = {};
    const r = applyRouterCommand(s, 'on');
    expect(r.changed).toBe(true);
    expect(s.router.enabled).toBe(true);
  });
});
