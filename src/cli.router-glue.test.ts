import { describe, it, expect } from 'vitest';
import { defaultGoalAllowList, routerNotice } from './cli';

describe('router glue helpers', () => {
  it('defaultGoalAllowList covers the standard safe tool set', () => {
    expect(defaultGoalAllowList()).toEqual(
      ['run_command', 'read_file', 'write_file', 'edit_file', 'search_files', 'list_files'],
    );
  });
  it('routerNotice renders kind + target + reason; never for chat callers', () => {
    expect(routerNotice({ kind: 'workflow', target: 'deploy-app', reason: 'matched workflow "deploy-app"' }))
      .toContain('deploy-app');
    expect(routerNotice({ kind: 'research', reason: 'research verb' })).toContain('research');
  });
});
