/** Pure helpers for the workflow slash commands (kept out of cli.ts so they're unit-testable). */
import { RunnerContext } from './runner';

export function parseInputArgs(args: string[]): { name: string; inputs: Record<string, string> } {
  const name = args[0] ?? '';
  const inputs: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      const eq = args[i + 1].indexOf('=');
      if (eq > 0) inputs[args[i + 1].slice(0, eq)] = args[i + 1].slice(eq + 1);
      i++;
    }
  }
  return { name, inputs };
}

/** Map the CLI's SlashCommandContext to a RunnerContext for the engine/runner. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildRunnerContext(ctx: any): RunnerContext {
  return {
    settings: ctx.settings,
    defaultProviderName: ctx.providerName,
    parentRegistry: ctx.registry,
    mcpClient: ctx.mcpClient,
    memory: ctx.memory,
    skills: ctx.skills,
    tokenTracker: ctx.tokenTracker,
    permissions: ctx.permissionRules,
    sessionAllow: ctx.sessionAllow,
    cwd: ctx.cwd,
  };
}
