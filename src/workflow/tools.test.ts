import { describe, it, expect, beforeEach } from 'vitest';
import { setWorkflowRuntime, getWorkflowRuntime, clearWorkflowRuntime } from './runtime';
import { registerWorkflowTools, executeWorkflowTool, WORKFLOW_TOOLS } from './tools';
import { ToolRegistry } from '../registry/index';
import { getDefaultSettings } from '../config/settings';
import type { Provider, CompletionOptions, CompletionResult } from '../providers/index';

function fakeProvider(reply: string): Provider {
  return { name: 'fake', model: 'x', async isAvailable() { return true; },
    async complete(_o: CompletionOptions): Promise<CompletionResult> { return { content: reply, usage: { prompt_tokens:1, completion_tokens:1, total_tokens:2 } }; } };
}

describe('workflow runtime + dynamic tools', () => {
  beforeEach(() => clearWorkflowRuntime());

  it('registers spawn_agent and run_parallel as custom tools', () => {
    const reg = new ToolRegistry();
    registerWorkflowTools(reg);
    const names = reg.list().map(t => t.name);
    expect(names).toContain('spawn_agent');
    expect(names).toContain('run_parallel');
    expect(WORKFLOW_TOOLS.length).toBe(2);
  });

  it('spawn_agent errors cleanly when no runtime is set', async () => {
    const res = await executeWorkflowTool('spawn_agent', { role: 'coder', task: 't' }, process.cwd());
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/runtime/i);
  });

  it('spawn_agent runs a sub-agent via the active runtime', async () => {
    setWorkflowRuntime({
      settings: getDefaultSettings(), defaultProviderName: 'ollama',
      parentRegistry: (() => { const r = new ToolRegistry(); return r; })(),
      cwd: process.cwd(), providerFactory: () => fakeProvider('sub-agent says hi'),
    });
    const res = await executeWorkflowTool('spawn_agent', { role: 'coder', task: 'do it' }, process.cwd());
    expect(res.isError).toBeFalsy();
    expect(res.content).toBe('sub-agent says hi');
  });
});
