import { describe, it, expect } from 'vitest';
import { registerTools, MCPTool } from './client';

function tool(name: string): MCPTool {
  return { name, description: name, inputSchema: { type: 'object', properties: {} } };
}

describe('registerTools', () => {
  it('registers non-colliding tools', () => {
    const reg = new Map();
    const { registered, skipped } = registerTools(reg, 'srv', [tool('foo'), tool('bar')], new Set());
    expect(registered).toEqual(['foo', 'bar']);
    expect(skipped).toEqual([]);
    expect(reg.size).toBe(2);
  });

  it('skips a tool that shadows a reserved (built-in) name', () => {
    const reg = new Map();
    const { registered, skipped } = registerTools(reg, 'srv', [tool('read_file'), tool('ok')], new Set(['read_file']));
    expect(registered).toEqual(['ok']);
    expect(skipped[0]).toEqual({ name: 'read_file', reason: 'shadows a built-in tool' });
    expect(reg.has('read_file')).toBe(false);
  });

  it('skips a tool already provided by another server', () => {
    const reg = new Map();
    registerTools(reg, 'srvA', [tool('dup')], new Set());
    const { registered, skipped } = registerTools(reg, 'srvB', [tool('dup')], new Set());
    expect(registered).toEqual([]);
    expect(skipped[0].name).toBe('dup');
    expect(skipped[0].reason).toMatch(/srvA/);
    expect(reg.get('dup')!.serverName).toBe('srvA'); // first server wins
  });
});
