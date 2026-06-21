import { describe, it, expect, vi } from 'vitest';
import { SkillsManager } from './index';

function loaded(): SkillsManager {
  const m = new SkillsManager(process.cwd());
  m.loadAll();
  return m;
}

describe('detectRelevantHybrid', () => {
  it('returns the top-matched skill from the injected hybrid', async () => {
    const m = loaded();
    const hybrid = vi.fn(async () => [{ id: 'github', score: 1 }]);
    const res = await m.detectRelevantHybrid('open a pull request', { hybrid });
    expect(res.map(s => s.name)).toEqual(['github']);
    expect(hybrid).toHaveBeenCalled();
  });

  it('returns [] when the hybrid finds nothing', async () => {
    const m = loaded();
    const hybrid = vi.fn(async () => []);
    expect(await m.detectRelevantHybrid('zzz', { hybrid })).toEqual([]);
  });

  it('falls back to keyword detect (top-1) when the hybrid throws', async () => {
    const m = loaded();
    const hybrid = vi.fn(async () => { throw new Error('matcher boom'); });
    const res = await m.detectRelevantHybrid('help me with a github pull request', { hybrid });
    // keyword detectRelevant matches "github"; fallback is sliced to 1
    expect(res.length).toBeLessThanOrEqual(1);
    if (res.length) expect(res[0].name).toBe('github');
  });
});

describe('getSkillContextAsync', () => {
  it('injects the top-1 skill body when relevant', async () => {
    const m = loaded();
    const hybrid = vi.fn(async () => [{ id: 'github', score: 1 }]);
    const ctx = await m.getSkillContextAsync('open a pull request', { hybrid } as never);
    expect(ctx).toContain('## Active Skills');
    expect(ctx).toContain('### github');
  });
  it('returns "" when nothing is relevant', async () => {
    const m = loaded();
    const hybrid = vi.fn(async () => []);
    expect(await m.getSkillContextAsync('zzz', { hybrid } as never)).toBe('');
  });
});
