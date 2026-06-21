/** Pure helpers for the workflow slash commands (kept out of cli.ts so they're unit-testable). */
import { RunnerContext } from './runner';
export declare function parseInputArgs(args: string[]): {
    name: string;
    inputs: Record<string, string>;
};
/** Map the CLI's SlashCommandContext to a RunnerContext for the engine/runner. */
export declare function buildRunnerContext(ctx: any): RunnerContext;
//# sourceMappingURL=cli-helpers.d.ts.map