// src/workflow/runner.test.ts
import { describe, it, expect } from 'vitest';
import { runSubAgent, buildScopedRegistry, RunnerContext } from './runner';
import { createDefaultRegistry } from '../registry/index';
import type { Provider, CompletionOptions, CompletionResult } from '../providers/index';
import { getDefaultSettings } from '../config/settings';

/** Fake provider: records the last CompletionOptions and returns a canned final answer (no tool calls). */
function fakeProvider(reply = 'done'): Provider & { last?: CompletionOptions } {
  const p: any = {
    name: 'fake', model: 'fake-1',
    async isAvailable() { return true; },
    async complete(o: CompletionOptions): Promise<CompletionResult> {
      p.last = o;
      return { content: reply, usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } };
    },
  };
  return p;
}

function baseCtx(provider: Provider): RunnerContext {
  return {
    settings: getDefaultSettings(),
    defaultProviderName: 'ollama',
    parentRegistry: createDefaultRegistry(),
    cwd: process.cwd(),
    providerFactory: () => provider,
  };
}

describe('buildScopedRegistry', () => {
  it('keeps only the allowed tools', () => {
    const parent = createDefaultRegistry();
    const scoped = buildScopedRegistry(parent, ['read_file', 'list_files']);
    const names = scoped.getEnabled().map(t => t.name).sort();
    expect(names).toEqual(['list_files', 'read_file']);
  });
  it('falls back to the parent enabled set when allowed is undefined', () => {
    const parent = createDefaultRegistry();
    const scoped = buildScopedRegistry(parent, undefined);
    expect(scoped.getEnabled().length).toBe(parent.getEnabled().length);
  });
});

describe('runSubAgent', () => {
  it('resolves a role system prompt and returns final text', async () => {
    const p = fakeProvider('architecture is good');
    const res = await runSubAgent({ role: 'architect', task: 'Design a thing' }, baseCtx(p));
    expect(res.ok).toBe(true);
    expect(res.content).toBe('architecture is good');
    expect(res.role).toBe('architect');
    // architect's systemPrompt was injected as the first system message
    expect(p.last!.messages[0].role).toBe('system');
    expect(p.last!.messages[0].content).toContain('senior software architect');
    // architect.allowedTools restricts the scoped tool list
    const toolNames = (p.last!.tools ?? []).map(t => t.name).sort();
    expect(toolNames).toEqual(['list_files', 'read_file', 'search_files']);
  });

  it('honors an inline systemPrompt + tools override', async () => {
    const p = fakeProvider();
    await runSubAgent({ systemPrompt: 'You are X.', tools: ['read_file'], task: 'go' }, baseCtx(p));
    expect(p.last!.messages[0].content).toBe('You are X.');
    expect((p.last!.tools ?? []).map(t => t.name)).toEqual(['read_file']);
  });

  it('returns ok:false on provider throw, never throwing', async () => {
    const p: any = { name: 'boom', model: 'x', async isAvailable() { return true; },
      async complete() { throw new Error('provider exploded'); } };
    const res = await runSubAgent({ task: 'go' }, baseCtx(p));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('provider exploded');
  });
});
