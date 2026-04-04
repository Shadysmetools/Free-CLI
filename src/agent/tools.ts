import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { Tool } from '../providers/index';

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface FileChange {
  path: string;
  originalContent: string | null;
  action: 'create' | 'edit' | 'delete';
}

// Track file changes for undo
export const fileChanges: FileChange[] = [];

export const TOOLS: Tool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Use to examine existing code.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to read (relative to cwd)' },
        start_line: { type: 'number', description: 'Optional start line number (1-indexed)' },
        end_line: { type: 'number', description: 'Optional end line number (inclusive)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with new content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to write (relative to cwd)' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Edit a file by replacing exact text. Use for precise, surgical edits.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to edit' },
        old_text: { type: 'string', description: 'Exact text to find and replace' },
        new_text: { type: 'string', description: 'New text to replace with' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for text patterns across files in the project.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (grep-compatible)' },
        path: { type: 'string', description: 'Directory or file to search in (default: cwd)' },
        file_pattern: { type: 'string', description: 'File glob pattern (e.g. "*.ts", "*.py")' },
        case_sensitive: { type: 'string', description: 'true or false (default: false)', enum: ['true', 'false'] },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories in a path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to list (default: cwd)' },
        recursive: { type: 'string', description: 'true to recurse into subdirectories', enum: ['true', 'false'] },
        include_hidden: { type: 'string', description: 'true to include hidden files', enum: ['true', 'false'] },
      },
      required: [],
    },
  },
  {
    name: 'run_command',
    description: 'Execute a shell command. Use for running tests, builds, installs, etc.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        cwd: { type: 'string', description: 'Working directory (default: project root)' },
        timeout: { type: 'number', description: 'Timeout in seconds (default: 30)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'git_status',
    description: 'Show git status of the current repository.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'git_diff',
    description: 'Show git diff for staged or unstaged changes.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Specific file to diff (optional)' },
        staged: { type: 'string', description: 'true to show staged changes', enum: ['true', 'false'] },
      },
      required: [],
    },
  },
  {
    name: 'git_commit',
    description: 'Stage all changes and create a git commit.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
        files: { type: 'string', description: 'Files to stage (default: all changed files with ".")' },
      },
      required: ['message'],
    },
  },
];

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'read_file': return readFile(args as { path: string; start_line?: number; end_line?: number }, cwd);
      case 'write_file': return writeFile(args as { path: string; content: string }, cwd);
      case 'edit_file': return editFile(args as { path: string; old_text: string; new_text: string }, cwd);
      case 'search_files': return searchFiles(args as { pattern: string; path?: string; file_pattern?: string; case_sensitive?: string }, cwd);
      case 'list_files': return listFiles(args as { path?: string; recursive?: string; include_hidden?: string }, cwd);
      case 'run_command': return runCommand(args as { command: string; cwd?: string; timeout?: number }, cwd);
      case 'git_status': return gitStatus(cwd);
      case 'git_diff': return gitDiff(args as { file?: string; staged?: string }, cwd);
      case 'git_commit': return gitCommit(args as { message: string; files?: string }, cwd);
      default: return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: `Error in ${name}: ${(err as Error).message}`, isError: true };
  }
}

function resolvePath(filePath: string, cwd: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}

function readFile(args: { path: string; start_line?: number; end_line?: number }, cwd: string): ToolResult {
  const fullPath = resolvePath(args.path, cwd);
  if (!fs.existsSync(fullPath)) {
    return { content: `File not found: ${args.path}`, isError: true };
  }
  const stat = fs.statSync(fullPath);
  if (stat.size > 1024 * 1024) {
    return { content: `File too large (${Math.round(stat.size / 1024)}KB). Use search_files or read specific line ranges.`, isError: true };
  }
  let content = fs.readFileSync(fullPath, 'utf-8');
  if (args.start_line || args.end_line) {
    const lines = content.split('\n');
    const start = (args.start_line || 1) - 1;
    const end = args.end_line || lines.length;
    content = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
  }
  return { content: `File: ${args.path}\n\n${content}` };
}

function writeFile(args: { path: string; content: string }, cwd: string): ToolResult {
  const fullPath = resolvePath(args.path, cwd);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const existed = fs.existsSync(fullPath);
  const original = existed ? fs.readFileSync(fullPath, 'utf-8') : null;
  fileChanges.push({ path: fullPath, originalContent: original, action: existed ? 'edit' : 'create' });

  fs.writeFileSync(fullPath, args.content, 'utf-8');
  const lines = args.content.split('\n').length;
  return { content: `✓ ${existed ? 'Updated' : 'Created'} ${args.path} (${lines} lines)` };
}

function editFile(args: { path: string; old_text: string; new_text: string }, cwd: string): ToolResult {
  const fullPath = resolvePath(args.path, cwd);
  if (!fs.existsSync(fullPath)) {
    return { content: `File not found: ${args.path}`, isError: true };
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  if (!content.includes(args.old_text)) {
    return { content: `Could not find the specified text in ${args.path}. Text to find:\n${args.old_text}`, isError: true };
  }
  fileChanges.push({ path: fullPath, originalContent: content, action: 'edit' });
  const newContent = content.replace(args.old_text, args.new_text);
  fs.writeFileSync(fullPath, newContent, 'utf-8');
  return { content: `✓ Edited ${args.path}` };
}

function searchFiles(args: { pattern: string; path?: string; file_pattern?: string; case_sensitive?: string }, cwd: string): ToolResult {
  const searchPath = args.path ? resolvePath(args.path, cwd) : cwd;
  const caseSensitive = args.case_sensitive === 'true';

  try {
    let cmd = `grep -r${caseSensitive ? '' : 'i'} --include="*" -n -l`;
    if (args.file_pattern) cmd = `grep -r${caseSensitive ? '' : 'i'} --include="${args.file_pattern}" -n`;
    else cmd = `grep -r${caseSensitive ? '' : 'i'} -n --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist`;
    cmd += ` "${args.pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -50`;

    const result = child_process.execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
    return { content: result || 'No matches found' };
  } catch {
    return { content: 'No matches found' };
  }
}

function listFiles(args: { path?: string; recursive?: string; include_hidden?: string }, cwd: string): ToolResult {
  const targetPath = args.path ? resolvePath(args.path, cwd) : cwd;
  const recursive = args.recursive === 'true';
  const includeHidden = args.include_hidden === 'true';

  function walkDir(dir: string, depth: number = 0): string[] {
    if (depth > 5) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const lines: string[] = [];
    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith('.')) continue;
      if (['node_modules', '.git', 'dist', '__pycache__', '.next'].includes(entry.name)) continue;
      const indent = '  '.repeat(depth);
      if (entry.isDirectory()) {
        lines.push(`${indent}${entry.name}/`);
        if (recursive) lines.push(...walkDir(path.join(dir, entry.name), depth + 1));
      } else {
        lines.push(`${indent}${entry.name}`);
      }
    }
    return lines;
  }

  const files = walkDir(targetPath);
  return { content: files.join('\n') || 'Empty directory' };
}

function runCommand(args: { command: string; cwd?: string; timeout?: number }, cwd: string): ToolResult {
  const workDir = args.cwd ? resolvePath(args.cwd, cwd) : cwd;
  const timeoutMs = (args.timeout || 30) * 1000;

  try {
    const result = child_process.execSync(args.command, {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 5, // 5MB
    });
    return { content: result || '(no output)' };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const output = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
    return { content: output || 'Command failed', isError: true };
  }
}

function gitStatus(cwd: string): ToolResult {
  try {
    const result = child_process.execSync('git status', { cwd, encoding: 'utf-8', timeout: 5000 });
    return { content: result };
  } catch {
    return { content: 'Not a git repository or git error', isError: true };
  }
}

function gitDiff(args: { file?: string; staged?: string }, cwd: string): ToolResult {
  try {
    const staged = args.staged === 'true' ? '--staged ' : '';
    const file = args.file ? ` -- "${args.file}"` : '';
    const result = child_process.execSync(`git diff ${staged}${file}`, {
      cwd, encoding: 'utf-8', timeout: 10000,
    });
    return { content: result || 'No changes' };
  } catch {
    return { content: 'Git diff failed', isError: true };
  }
}

function gitCommit(args: { message: string; files?: string }, cwd: string): ToolResult {
  try {
    const files = args.files || '.';
    child_process.execSync(`git add ${files}`, { cwd, encoding: 'utf-8' });
    const result = child_process.execSync(`git commit -m "${args.message.replace(/"/g, '\\"')}"`, {
      cwd, encoding: 'utf-8', timeout: 10000,
    });
    return { content: result };
  } catch (err) {
    const error = err as { stderr?: string; message?: string };
    return { content: error.stderr || error.message || 'Commit failed', isError: true };
  }
}
