import chalk from 'chalk';
import { ConfirmRequest, ConfirmChoice, Verdict } from './types';

export function buildPreview(toolName: string, args: Record<string, unknown>, verdict: Verdict): string {
  const lines: string[] = [];
  if (verdict.severity === 'warn') {
    lines.push(chalk.red.bold(`⚠  ${verdict.reasons.join(' · ')}`));
  }
  if (toolName === 'run_command') {
    lines.push(chalk.bold('coderaw wants to run a shell command:'));
    lines.push(chalk.yellow(`  $ ${String(args.command ?? '')}`));
    if (args.cwd) lines.push(chalk.dim(`  in: ${String(args.cwd)}`));
  } else if (toolName === 'git_commit') {
    lines.push(chalk.bold('coderaw wants to create a git commit:'));
    lines.push(chalk.dim(`  message: ${String(args.message ?? '')}`));
    if (args.files) lines.push(chalk.dim(`  files: ${String(args.files)}`));
  } else if (toolName === 'edit_file') {
    lines.push(chalk.bold(`coderaw wants to edit ${String(args.path ?? '')}:`));
    String(args.old_text ?? '').split('\n').slice(0, 6).forEach(l => lines.push(chalk.red(`  - ${l}`)));
    String(args.new_text ?? '').split('\n').slice(0, 6).forEach(l => lines.push(chalk.green(`  + ${l}`)));
  } else if (toolName === 'write_file') {
    const content = String(args.content ?? '');
    lines.push(chalk.bold(`coderaw wants to write ${String(args.path ?? '')}:`));
    lines.push(chalk.dim(`  ${content.length} bytes, ${content.split('\n').length} lines`));
    content.split('\n').slice(0, 8).forEach(l => lines.push(chalk.dim(`  │ ${l}`)));
  } else {
    lines.push(chalk.bold(`coderaw wants to use "${toolName}":`));
    lines.push(chalk.dim('  ' + JSON.stringify(args).slice(0, 300)));
  }
  return lines.join('\n');
}

export async function defaultConfirm(req: ConfirmRequest): Promise<ConfirmChoice> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const inq = require('inquirer') as any;
  console.log('\n' + buildPreview(req.toolName, req.args, req.verdict) + '\n');
  const { choice } = await inq.prompt([{
    type: 'expand',
    name: 'choice',
    message: 'Allow this action?',
    default: req.defaultApprove ? 'y' : 'n',
    choices: [
      { key: 'y', name: 'Yes, once', value: 'yes' },
      { key: 'a', name: 'Yes — allow this for the rest of the session', value: 'session' },
      { key: 's', name: 'Yes — save as an allow rule (persists to config)', value: 'persist' },
      { key: 'n', name: 'No, skip', value: 'no' },
      { key: 'e', name: 'No — and tell the agent what to do instead', value: 'reason' },
    ],
  }]);
  if (choice === 'reason') {
    const { reason } = await inq.prompt([{ type: 'input', name: 'reason', message: 'What should it do instead?' }]);
    return { kind: 'no', reason: String(reason ?? '') };
  }
  if (choice === 'yes') return { kind: 'yes' };
  if (choice === 'session') return { kind: 'session' };
  if (choice === 'persist') return { kind: 'persist' };
  return { kind: 'no' };
}
