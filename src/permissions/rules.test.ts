import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { matchPattern, matchesAny, defaultRules, loadPermissionRules, DEFAULT_DENY } from './rules';

describe('matchPattern', () => {
  it('matches a literal command', () => {
    expect(matchPattern('npm test', 'npm test')).toBe(true);
  });
  it('supports * wildcard', () => {
    expect(matchPattern('npm *', 'npm run build')).toBe(true);
    expect(matchPattern('git push *', 'git push origin main')).toBe(true);
  });
  it('is case-insensitive and trims', () => {
    expect(matchPattern('NPM TEST', '  npm test  ')).toBe(true);
  });
  it('does not match a different command', () => {
    expect(matchPattern('npm test', 'rm -rf /')).toBe(false);
  });
});

describe('matchesAny', () => {
  it('true when any pattern matches any subject', () => {
    expect(matchesAny(['git status', 'npm *'], ['run_command npm test', 'npm test'])).toBe(true);
  });
  it('false when none match', () => {
    expect(matchesAny(['git *'], ['npm test'])).toBe(false);
  });
});

describe('defaultRules', () => {
  it('enabled, deny empty (catastrophic lives in DEFAULT_DENY), unattended deny', () => {
    const r = defaultRules('C:/proj');
    expect(r.enabled).toBe(true);
    expect(r.deny).toEqual([]);
    expect(r.unattended).toBe('deny');
    expect(r.confirmDefault).toBe('approve');
    expect(DEFAULT_DENY.length).toBeGreaterThan(0);
  });
});

describe('loadPermissionRules', () => {
  it('merges a global perms layer over defaults, concatenating arrays', () => {
    const r = loadPermissionRules('C:/proj', { allow: ['npm *'], unattended: 'allow' });
    expect(r.allow).toContain('npm *');
    expect(r.unattended).toBe('allow');
    expect(r.projectRoot).toBe(path.resolve('C:/proj'));
  });
  it("respects explicit projectRoot when not 'auto'", () => {
    const r = loadPermissionRules('C:/proj', { projectRoot: 'D:/other' });
    expect(r.projectRoot).toBe(path.resolve('D:/other'));
  });
});
