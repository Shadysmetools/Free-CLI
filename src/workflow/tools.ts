// src/workflow/tools.ts
/**
 * Layer 3a — dynamic orchestration tools. These let the main agent decompose
 * work at runtime. Execution reads the active RunnerContext from runtime.ts and
 * delegates to runSubAgent. They are gated like any tool (consequential) via the
 * core.ts gate() choke point before executeTool dispatches here.
 */
import { Tool } from '../providers/index';
import { ToolRegistry } from '../registry/index';
import { ToolResult } from '../agent/tools';
import { parallel } from './primitives';
import { runSubAgent } from './runner';
import { getWorkflowRuntime } from './runtime';

export const WORKFLOW_TOOLS: Tool[] = [
  {
    name: 'spawn_agent',
    description: 'Delegate a self-contained sub-task to a fresh sub-agent (its own context + minimal tools). The task string MUST include all context the sub-agent needs. Returns the sub-agent\'s final answer.',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Sub-agent role id (e.g. coder, reviewer, architect, tester, documenter)' },
        task: { type: 'string', description: 'Self-contained instruction with ALL needed context' },
        tools: { type: 'array', description: 'Optional minimal tool-name allow-list for the sub-agent', items: { type: 'string' } },
      },
      required: ['task'],
    },
  },
  {
    name: 'run_parallel',
    description: 'Run several INDEPENDENT sub-tasks concurrently (bounded; local backend serializes). Each task must be self-contained. Returns the joined results.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'List of { role?, task } objects — must be mutually independent',
          items: { type: 'object' },
        },
      },
      required: ['tasks'],
    },
  },
];

export function registerWorkflowTools(registry: ToolRegistry): void {
  for (const t of WORKFLOW_TOOLS) registry.register(t, 'custom', 'custom');
}

export async function executeWorkflowTool(name: string, args: Record<string, unknown>, _cwd: string): Promise<ToolResult> {
  const ctx = getWorkflowRuntime();
  if (!ctx) return { content: 'Orchestration unavailable: no active workflow runtime.', isError: true };

  if (name === 'spawn_agent') {
    const res = await runSubAgent({ role: args.role as string | undefined, task: String(args.task ?? ''), tools: args.tools as string[] | undefined }, ctx);
    return { content: res.content, isError: !res.ok };
  }
  if (name === 'run_parallel') {
    const tasks = Array.isArray(args.tasks) ? (args.tasks as Array<{ role?: string; task: string }>) : [];
    if (tasks.length === 0) return { content: 'run_parallel: tasks[] is required and must be non-empty.', isError: true };
    const conc = ctx.defaultProviderName === 'ollama' ? 1 : 4;
    const results = await parallel(tasks.map(t => () => runSubAgent({ role: t.role, task: t.task }, ctx)), { concurrency: conc });
    const joined = results.map((r, i) => `### Sub-agent ${i + 1}${r?.role ? ` (${r.role})` : ''}\n${r?.content ?? '[failed]'}`).join('\n\n');
    return { content: joined, isError: results.some(r => !r || !r.ok) };
  }
  return { content: `Unknown workflow tool: ${name}`, isError: true };
}
