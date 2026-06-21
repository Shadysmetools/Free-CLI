"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPreview = buildPreview;
exports.defaultConfirm = defaultConfirm;
const chalk_1 = __importDefault(require("chalk"));
function buildPreview(toolName, args, verdict) {
    const lines = [];
    if (verdict.severity === 'warn') {
        lines.push(chalk_1.default.red.bold(`⚠  ${verdict.reasons.join(' · ')}`));
    }
    if (toolName === 'run_command') {
        lines.push(chalk_1.default.bold('coderaw wants to run a shell command:'));
        lines.push(chalk_1.default.yellow(`  $ ${String(args.command ?? '')}`));
        if (args.cwd)
            lines.push(chalk_1.default.dim(`  in: ${String(args.cwd)}`));
    }
    else if (toolName === 'git_commit') {
        lines.push(chalk_1.default.bold('coderaw wants to create a git commit:'));
        lines.push(chalk_1.default.dim(`  message: ${String(args.message ?? '')}`));
        if (args.files)
            lines.push(chalk_1.default.dim(`  files: ${String(args.files)}`));
    }
    else if (toolName === 'edit_file') {
        lines.push(chalk_1.default.bold(`coderaw wants to edit ${String(args.path ?? '')}:`));
        String(args.old_text ?? '').split('\n').slice(0, 6).forEach(l => lines.push(chalk_1.default.red(`  - ${l}`)));
        String(args.new_text ?? '').split('\n').slice(0, 6).forEach(l => lines.push(chalk_1.default.green(`  + ${l}`)));
    }
    else if (toolName === 'write_file') {
        const content = String(args.content ?? '');
        lines.push(chalk_1.default.bold(`coderaw wants to write ${String(args.path ?? '')}:`));
        lines.push(chalk_1.default.dim(`  ${content.length} bytes, ${content.split('\n').length} lines`));
        content.split('\n').slice(0, 8).forEach(l => lines.push(chalk_1.default.dim(`  │ ${l}`)));
    }
    else {
        lines.push(chalk_1.default.bold(`coderaw wants to use "${toolName}":`));
        lines.push(chalk_1.default.dim('  ' + JSON.stringify(args).slice(0, 300)));
    }
    return lines.join('\n');
}
async function defaultConfirm(req) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const inq = require('inquirer');
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
    if (choice === 'yes')
        return { kind: 'yes' };
    if (choice === 'session')
        return { kind: 'session' };
    if (choice === 'persist')
        return { kind: 'persist' };
    return { kind: 'no' };
}
//# sourceMappingURL=prompt.js.map