import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { Tool } from '../providers/index';
import { setPlan, normalizePlanItems, planToSteps, planSummary } from './plan';
import { executeWebSearch, executeWebFetch } from '../bot/web_tools';
import { getSkillsRuntime } from '../skills/runtime';

// ─── PDF / Excel lazy imports (runtime-only, avoid tsc issues) ────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PDFDocument = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelWorkbook = any;

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

/** Path to the bundled ripgrep binary, or null if unavailable. */
export function rgPath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@vscode/ripgrep') as { rgPath: string }).rgPath;
  } catch { return null; }
}

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
  {
    name: 'git_log',
    description: 'Show recent git commit history.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of commits to show (default: 10)' },
        file: { type: 'string', description: 'Filter commits by file path (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'generate_pdf',
    description: 'Generate a professional PDF document from a title and markdown content. IMPORTANT: Call this tool EXACTLY ONCE with ALL content combined — do NOT split into multiple calls or create multiple PDFs. Include the full document in a single call.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Document title (shown on the cover page)',
        },
        content: {
          type: 'string',
          description: 'COMPLETE document body in markdown. Include ALL sections in one string. Supports: # H1, ## H2, ### H3, **bold**, *italic*, - bullet lists, 1. numbered lists, ```code blocks```, --- horizontal rules, > blockquotes, | table | rows |. Do NOT truncate — include the entire content.',
        },
        output_path: {
          type: 'string',
          description: 'Where to save the PDF file, e.g. "report.pdf" or "docs/invoice.pdf"',
        },
        author: {
          type: 'string',
          description: 'Optional author name embedded in PDF metadata',
        },
        font_size: {
          type: 'number',
          description: 'Body font size in points (default: 12)',
        },
      },
      required: ['title', 'content', 'output_path'],
    },
  },
  {
    name: 'generate_diagram',
    description: 'Generate a diagram (flowchart, sequence, class, ER, Gantt, architecture, mindmap) using Mermaid.js and save it as a PNG or SVG file.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Diagram type',
          enum: ['flowchart', 'sequence', 'class', 'er', 'gantt', 'architecture', 'mindmap', 'timeline', 'mermaid'],
        },
        code: {
          type: 'string',
          description: 'Mermaid diagram code (without ```mermaid fences). Must start with the diagram directive e.g. "flowchart TD"',
        },
        output_path: {
          type: 'string',
          description: 'Where to save the output file, e.g. "diagrams/auth-flow.png" or "architecture.svg"',
        },
        format: {
          type: 'string',
          description: 'Output format: "png" (default) or "svg"',
          enum: ['png', 'svg'],
        },
        width: {
          type: 'number',
          description: 'Width in pixels (default: 1200)',
        },
      },
      required: ['code', 'output_path'],
    },
  },
  {
    name: 'generate_image',
    description: 'Generate an image using AI (DALL-E 3 with OPENAI_API_KEY, Stability AI with STABILITY_API_KEY, or a placeholder SVG if no key is set). Use for logos, illustrations, and concept art.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate',
        },
        output_path: {
          type: 'string',
          description: 'Where to save the image file, e.g. "assets/logo.png"',
        },
        size: {
          type: 'string',
          description: 'Image dimensions',
          enum: ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'],
        },
        quality: {
          type: 'string',
          description: '"standard" (default) or "hd" (DALL-E 3 only)',
          enum: ['standard', 'hd'],
        },
        style: {
          type: 'string',
          description: '"vivid" (dramatic, default) or "natural" (realistic)',
          enum: ['vivid', 'natural'],
        },
      },
      required: ['prompt', 'output_path'],
    },
  },
  {
    name: 'generate_excel',
    description: 'Generate an Excel (.xlsx) spreadsheet with one or more sheets of tabular data. Use for data exports, reports, and financial tables.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Workbook title (stored in metadata)',
        },
        sheets: {
          type: 'array',
          description: 'Array of sheets, each with a name, headers array, and rows array-of-arrays',
          items: { type: 'object' },
        },
        output_path: {
          type: 'string',
          description: 'Where to save the .xlsx file, e.g. "data.xlsx" or "reports/sales.xlsx"',
        },
        author: {
          type: 'string',
          description: 'Optional author name embedded in workbook metadata',
        },
      },
      required: ['title', 'sheets', 'output_path'],
    },
  },
  {
    name: 'update_plan',
    description: 'Create or update the task plan for the current turn (Claude-Code-style TODO list). Pass the COMPLETE list of steps each time — this REPLACES the current plan, it does not append. Mark exactly one step "in_progress" at a time, flip finished steps to "completed", and leave upcoming work "pending". Use this to break a non-trivial request into visible steps and keep the user informed of progress.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Ordered list of plan steps. Each item is an object: { "content": string, "status": "pending" | "in_progress" | "completed" }. Provide the full plan every call.',
          items: { type: 'object' },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'skill',
    description: "Load the full instructions for a named skill from the Available Skills list. Call this when a listed skill is relevant before starting the task.",
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The skill name from the Available Skills list' } },
      required: ['name'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for current information, docs, or any topic. Returns titles, snippets, and URLs.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'The search query. Be specific.' } }, required: ['query'] },
  },
  {
    name: 'web_fetch',
    description: 'Fetch a URL and return its readable text (HTML stripped). Use to read docs, articles, or pages.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full http(s) URL' }, max_chars: { type: 'number', description: 'Max chars to return (default 8000)' } }, required: ['url'] },
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
      case 'git_log': return gitLog(args as { limit?: number; file?: string }, cwd);
      case 'generate_pdf': return generatePdf(args as { title: string; content: string; output_path: string; author?: string; font_size?: number }, cwd);
      case 'generate_excel': return generateExcel(args as { title: string; sheets: SheetDef[]; output_path: string; author?: string }, cwd);
      case 'generate_diagram': return generateDiagram(args as { type?: string; code: string; output_path: string; format?: string; width?: number }, cwd);
      case 'generate_image': return generateImage(args as { prompt: string; output_path: string; size?: string; quality?: string; style?: string }, cwd);
      case 'update_plan': return updatePlan(args as { items: unknown });
      case 'skill': return loadSkill(args as { name: string });
      case 'spawn_agent':
      case 'run_parallel': {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { executeWorkflowTool } = require('../workflow/tools') as typeof import('../workflow/tools');
        return executeWorkflowTool(name, args, cwd);
      }
      case 'web_search': return executeWebSearch(String(args.query ?? ''));
      case 'web_fetch': return executeWebFetch(String(args.url ?? ''), typeof args.max_chars === 'number' ? (args.max_chars as number) : 8000);
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

/** Load a skill's full body on demand. Reaches the SkillsManager via the runtime holder. */
export function loadSkill(args: { name: string }): { content: string; isError?: boolean } {
  const mgr = getSkillsRuntime();
  if (!mgr) return { content: 'Skills are not available in this context.', isError: true };
  const name = String(args.name ?? '');
  const s = mgr.activate(name);
  if (!s) return { content: `Unknown skill "${name}". Available: ${mgr.list().map(x => x.name).join(', ')}`, isError: true };
  return { content: s.body };
}

// ─── Plan / TODO ────────────────────────────────────────────────────────────────

/**
 * Maintain the agent's task plan for the current turn. The full list is passed
 * each call and REPLACES the stored plan. Renders the plan with the existing
 * printPlanBox helper and returns a compact textual summary for the model.
 */
function updatePlan(args: { items: unknown }): ToolResult {
  const items = normalizePlanItems(args.items);
  if (items.length === 0) {
    return { content: 'No valid plan items provided. Each item needs a non-empty "content" string and an optional status of pending | in_progress | completed.', isError: true };
  }
  setPlan(items);

  // Render with the existing terminal helper (lazy import keeps this module
  // free of UI side effects when imported by tests).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { printPlanBox } = require('../ui/terminal') as typeof import('../ui/terminal');
    printPlanBox('Plan', planToSteps(items), planSummary(items));
  } catch {
    // UI rendering is best-effort; never fail the tool because of it.
  }

  const lines = items.map((it, i) => `  ${i + 1}. [${it.status}] ${it.content}`);
  return { content: `Plan updated (${planSummary(items)}):\n${lines.join('\n')}` };
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

/**
 * Pure edit helper. Refuses ambiguous edits (old_text matching 0 or >1 places)
 * instead of silently replacing the first match and corrupting the file.
 */
export function applyEdit(
  content: string,
  oldText: string,
  newText: string,
): { ok: true; content: string } | { ok: false; error: string } {
  if (oldText.length === 0) {
    return { ok: false, error: 'old_text is empty; provide the exact text to replace.' };
  }
  const occurrences = content.split(oldText).length - 1;
  if (occurrences === 0) {
    return { ok: false, error: 'Could not find the specified text.' };
  }
  if (occurrences > 1) {
    return {
      ok: false,
      error: `Found ${occurrences} occurrences of that text; the edit is ambiguous. Provide a larger, unique old_text snippet (include surrounding lines).`,
    };
  }
  return { ok: true, content: content.replace(oldText, newText) };
}

function editFile(args: { path: string; old_text: string; new_text: string }, cwd: string): ToolResult {
  const fullPath = resolvePath(args.path, cwd);
  if (!fs.existsSync(fullPath)) {
    return { content: `File not found: ${args.path}`, isError: true };
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const result = applyEdit(content, args.old_text, args.new_text);
  if (!result.ok) {
    return { content: `${result.error} (in ${args.path})`, isError: true };
  }
  fileChanges.push({ path: fullPath, originalContent: content, action: 'edit' });
  fs.writeFileSync(fullPath, result.content, 'utf-8');
  return { content: `✓ Edited ${args.path}` };
}

function searchFiles(args: { pattern: string; path?: string; file_pattern?: string; case_sensitive?: string }, cwd: string): ToolResult {
  const searchPath = args.path ? resolvePath(args.path, cwd) : cwd;
  const caseSensitive = args.case_sensitive === 'true';
  const rg = rgPath();
  if (rg) {
    // execFileSync with an argv array bypasses the shell entirely — no quoting
    // bugs, no metacharacter injection, works the same on cmd.exe and sh.
    const rgArgs = [
      '--line-number', '--no-heading', '--color', 'never',
      caseSensitive ? '--case-sensitive' : '--ignore-case',
      '--glob', '!node_modules', '--glob', '!.git', '--glob', '!dist',
      '--max-count', '50',
    ];
    if (args.file_pattern) rgArgs.push('--glob', args.file_pattern);
    rgArgs.push(args.pattern, searchPath);
    try {
      const out = child_process.execFileSync(rg, rgArgs, {
        encoding: 'utf-8', timeout: 15000, maxBuffer: 1024 * 1024 * 8, windowsHide: true,
      });
      return { content: out.trim() || 'No matches found' };
    } catch (err) {
      const out = (err as { stdout?: string }).stdout;
      return { content: (out && out.trim()) || 'No matches found' };
    }
  }
  return searchFilesFallback(args, searchPath, caseSensitive);
}

function searchFilesFallback(args: { pattern: string; file_pattern?: string }, searchPath: string, caseSensitive: boolean): ToolResult {
  try {
    const isWin = process.platform === 'win32';
    let cmd: string;
    if (isWin) {
      // Windows: use findstr
      const flag = caseSensitive ? '' : '/I';
      cmd = `findstr /S /N ${flag} "${args.pattern}" "${searchPath}\\*"`;
    } else {
      if (args.file_pattern) cmd = `grep -r${caseSensitive ? '' : 'i'} --include="${args.file_pattern}" -n`;
      else cmd = `grep -r${caseSensitive ? '' : 'i'} -n --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist`;
      cmd += ` "${args.pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -50`;
    }

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
  const isWindows = process.platform === 'win32';

  try {
    const result = child_process.execSync(args.command, {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 5, // 5MB
      // Use cmd.exe on Windows, sh on Unix
      shell: isWindows ? 'cmd.exe' : '/bin/sh',
      windowsHide: true,        // don't flash a console window per command
      killSignal: 'SIGKILL',    // SIGTERM is ignored on Windows; force-kill on timeout
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

function gitLog(args: { limit?: number; file?: string }, cwd: string): ToolResult {
  try {
    const limit = args.limit ?? 10;
    const file = args.file ? ` -- "${args.file}"` : '';
    const result = child_process.execSync(
      `git log --oneline -${limit}${file}`,
      { cwd, encoding: 'utf-8', timeout: 5000 }
    );
    return { content: result || 'No commits found' };
  } catch {
    return { content: 'Not a git repository or git error', isError: true };
  }
}

function gitCommit(args: { message: string; files?: string }, cwd: string): ToolResult {
  try {
    // execFileSync with an argv array bypasses the shell — no quote-escaping bugs
    // and no injection via the commit message or file names.
    const files = args.files && args.files.trim() ? args.files.trim().split(/\s+/) : ['.'];
    child_process.execFileSync('git', ['add', ...files], { cwd, encoding: 'utf-8' });
    const result = child_process.execFileSync('git', ['commit', '-m', args.message], {
      cwd, encoding: 'utf-8', timeout: 10000,
    });
    return { content: result };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    return { content: error.stderr || error.stdout || error.message || 'Commit failed', isError: true };
  }
}

// ─── PDF Generation ───────────────────────────────────────────────────────────

async function generatePdf(
  args: { title: string; content: string; output_path: string; author?: string; font_size?: number },
  cwd: string,
): Promise<ToolResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PDFDocumentClass = require('pdfkit') as new (opts: object) => PDFDocument;
    const fullPath = resolvePath(args.output_path, cwd);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const bodySize = args.font_size ?? 11;
    const h1Size = 22;
    const h2Size = 17;
    const h3Size = 14;
    const margin = 72; // 1 inch

    const doc: PDFDocument = new PDFDocumentClass({
      size: 'A4',
      bufferPages: true,
      autoFirstPage: false,
      margins: { top: margin, bottom: margin, left: margin, right: margin },
      info: {
        Title: args.title,
        Author: args.author ?? 'coderaw',
        Creator: 'coderaw AI Assistant',
        Producer: 'PDFKit',
      },
    });

    const stream = fs.createWriteStream(fullPath);
    doc.pipe(stream);

    // ── Cover page ────────────────────────────────────────────────────────────
    doc.addPage();
    const pageWidth = doc.page.width - margin * 2;
    const pageHeight = doc.page.height;

    // Dark background banner (top third)
    doc.rect(0, 0, doc.page.width, pageHeight * 0.45).fill('#1a1a2e');

    // Title (white, centered, vertically ~20% down)
    const titleY = pageHeight * 0.15;
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#ffffff')
      .text(args.title, margin, titleY, { align: 'center', width: pageWidth });

    // Accent rule under title
    const ruleY = titleY + 28 * 1.4 + 10;
    doc.moveTo(margin + pageWidth * 0.25, ruleY)
      .lineTo(margin + pageWidth * 0.75, ruleY)
      .strokeColor('#e94560').lineWidth(2).stroke();

    // Subtitle / date
    const dateStr = new Date().toLocaleDateString('en-GB', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    doc.fontSize(11).font('Helvetica').fillColor('#cccccc')
      .text(dateStr, margin, ruleY + 20, { align: 'center', width: pageWidth });

    // Author
    const authorName = args.author ?? 'coderaw';
    doc.fontSize(10).font('Helvetica').fillColor('#aaaaaa')
      .text(`Prepared by: ${authorName}`, margin, ruleY + 44, { align: 'center', width: pageWidth });

    // Bottom footer on cover
    doc.fontSize(8).font('Helvetica').fillColor('#999999')
      .text('Generated by coderaw', margin, pageHeight - 50, { align: 'center', width: pageWidth });

    // Reset fill color
    doc.fillColor('#000000');

    // ── Helper: horizontal rule ──────────────────────────────────────────────
    const hrule = (color = '#dddddd', width = 0.5) => {
      doc.moveTo(margin, doc.y)
        .lineTo(doc.page.width - margin, doc.y)
        .strokeColor(color).lineWidth(width).stroke();
    };

    // ── Start content on a new page ──────────────────────────────────────────
    doc.addPage();

    // ── Parse and render markdown ────────────────────────────────────────────
    const rawLines = args.content.split('\n');
    let inCodeBlock = false;
    let codeLang = '';
    const codeBuffer: string[] = [];

    const flushCode = () => {
      if (codeBuffer.length === 0) return;
      // Code block box
      const codeText = codeBuffer.join('\n');
      const codeHeight = codeBuffer.length * (bodySize - 1) * 1.4 + 16;
      doc.rect(margin - 8, doc.y - 2, pageWidth + 16, codeHeight + 4)
        .fill('#f5f5f5');
      if (codeLang) {
        doc.fontSize(7).font('Helvetica').fillColor('#999999')
          .text(codeLang.toUpperCase(), margin - 4, doc.y, { continued: false });
      }
      doc.fontSize(bodySize - 1).font('Courier').fillColor('#333333')
        .text(codeText, margin - 4, doc.y, { width: pageWidth + 8, lineGap: 2 });
      doc.fillColor('#000000');
      doc.moveDown(0.8);
      codeBuffer.length = 0;
      codeLang = '';
    };

    for (const raw of rawLines) {
      const line = raw.trimEnd();

      // ── Code fence ────────────────────────────────────────────────────────
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLang = line.slice(3).trim();
        } else {
          inCodeBlock = false;
          flushCode();
        }
        continue;
      }
      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      // ── H1 ────────────────────────────────────────────────────────────────
      if (line.startsWith('# ') && !line.startsWith('## ')) {
        doc.moveDown(0.8);
        doc.fontSize(h1Size).font('Helvetica-Bold').fillColor('#1a1a2e')
          .text(line.slice(2));
        doc.moveDown(0.2);
        hrule('#e94560', 2);
        doc.moveDown(0.5);
        doc.fillColor('#000000');
        continue;
      }

      // ── H2 ────────────────────────────────────────────────────────────────
      if (line.startsWith('## ')) {
        doc.moveDown(0.7);
        doc.fontSize(h2Size).font('Helvetica-Bold').fillColor('#16213e')
          .text(line.slice(3));
        doc.moveDown(0.15);
        hrule('#cccccc', 0.5);
        doc.moveDown(0.4);
        doc.fillColor('#000000');
        continue;
      }

      // ── H3 ────────────────────────────────────────────────────────────────
      if (line.startsWith('### ')) {
        doc.moveDown(0.5);
        doc.fontSize(h3Size).font('Helvetica-Bold').fillColor('#0f3460')
          .text(line.slice(4));
        doc.moveDown(0.3);
        doc.fillColor('#000000');
        continue;
      }

      // ── Horizontal rule ───────────────────────────────────────────────────
      if (/^---+$/.test(line)) {
        doc.moveDown(0.3);
        hrule('#eeeeee', 0.5);
        doc.moveDown(0.3);
        continue;
      }

      // ── Blank line ────────────────────────────────────────────────────────
      if (line === '') {
        doc.moveDown(0.4);
        continue;
      }

      // ── Bullet list ───────────────────────────────────────────────────────
      if (line.startsWith('- ') || line.startsWith('* ')) {
        doc.fontSize(bodySize).font('Helvetica')
          .text('•', margin, doc.y, { continued: true, width: 14 });
        renderInlinePdf(doc, line.slice(2), bodySize, margin + 14, pageWidth - 14);
        doc.moveDown(0.15);
        continue;
      }

      // ── Numbered list ─────────────────────────────────────────────────────
      const numMatch = line.match(/^(\d+)\.\s+(.+)/);
      if (numMatch) {
        doc.fontSize(bodySize).font('Helvetica')
          .text(numMatch[1] + '.', margin, doc.y, { continued: true, width: 20 });
        renderInlinePdf(doc, numMatch[2], bodySize, margin + 20, pageWidth - 20);
        doc.moveDown(0.15);
        continue;
      }

      // ── Blockquote ────────────────────────────────────────────────────────
      if (line.startsWith('> ')) {
        doc.rect(margin - 8, doc.y - 2, 3, bodySize * 1.6).fill('#e94560');
        doc.fontSize(bodySize).font('Helvetica-Oblique').fillColor('#555555')
          .text(line.slice(2), margin + 8, doc.y - bodySize * 1.2, { width: pageWidth - 8 });
        doc.fillColor('#000000');
        doc.moveDown(0.3);
        continue;
      }

      // ── Inline code line ──────────────────────────────────────────────────
      if (line.startsWith('    ') || line.startsWith('\t')) {
        doc.fontSize(bodySize - 1).font('Courier').fillColor('#333333')
          .text(line.replace(/^\t/, '  ').replace(/^    /, '  '), { indent: 4 });
        doc.fillColor('#000000');
        continue;
      }

      // ── Table row ─────────────────────────────────────────────────────────
      if (line.startsWith('|') && line.endsWith('|')) {
        if (/^[\|\s\-:]+$/.test(line)) continue; // separator row
        const cells = line.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim());
        const colW = Math.floor(pageWidth / Math.max(cells.length, 1));
        const isHeader = doc.y < margin + h1Size + 60; // rough heuristic
        if (isHeader) {
          doc.rect(margin, doc.y - 2, pageWidth, bodySize * 1.8)
            .fill('#1a1a2e');
          doc.fillColor('#ffffff');
        }
        cells.forEach((cell, ci) => {
          doc.fontSize(isHeader ? bodySize : bodySize - 1)
            .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
            .text(cell, margin + ci * colW, doc.y - (isHeader ? bodySize * 1.4 : 0),
              { width: colW - 4, continued: ci < cells.length - 1 });
        });
        doc.fillColor('#000000');
        doc.moveDown(0.1);
        hrule('#eeeeee', 0.3);
        continue;
      }

      // ── Regular paragraph ─────────────────────────────────────────────────
      doc.fontSize(bodySize).font('Helvetica');
      renderInlinePdf(doc, line, bodySize, margin, pageWidth);
      doc.moveDown(0.25);
    }

    // Flush any unclosed code block
    if (inCodeBlock) flushCode();

    // ── Page footer on all content pages (skip cover = page 0) ──────────────
    const range = doc.bufferedPageRange(); // { start: 0, count: N }
    const totalPages = range.count;
    // Content pages start at index 1 (index 0 is the cover)
    for (let i = 1; i < totalPages; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - margin * 0.65;
      doc.save();
      doc.fontSize(8).font('Helvetica').fillColor('#999999')
        .text('Generated by coderaw', margin, footerY,
          { align: 'left', continued: true, width: pageWidth / 2 })
        .text(`Page ${i} of ${totalPages - 1}`, margin + pageWidth / 2, footerY,
          { align: 'right', width: pageWidth / 2 });
      doc.restore();
    }

    doc.end();

    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    const stat = fs.statSync(fullPath);
    const kb = (stat.size / 1024).toFixed(1);
    return {
      content: `✓ PDF created: ${args.output_path} (${kb} KB)\n  Title: "${args.title}"`,
    };

  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Cannot find module 'pdfkit'")) {
      return { content: 'pdfkit not installed. Run: npm install pdfkit', isError: true };
    }
    return { content: `PDF generation failed: ${msg}`, isError: true };
  }
}

/**
 * Render a text line that may contain **bold** and *italic* inline markers.
 * Uses pdfkit's `continued` option to chain text segments on the same line.
 */
function renderInlinePdf(
  doc: PDFDocument,
  text: string,
  fontSize: number,
  x: number,
  width: number,
): void {
  // Split on **bold** and *italic*
  const segments = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  if (segments.length === 1) {
    doc.fontSize(fontSize).font('Helvetica').text(text, x, doc.y, { width, lineGap: 3 });
    return;
  }
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    if (!seg) continue;
    if (seg.startsWith('**') && seg.endsWith('**')) {
      doc.fontSize(fontSize).font('Helvetica-Bold')
        .text(seg.slice(2, -2), x, doc.y, { continued: !isLast, lineBreak: isLast, width });
    } else if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) {
      doc.fontSize(fontSize).font('Helvetica-Oblique')
        .text(seg.slice(1, -1), x, doc.y, { continued: !isLast, lineBreak: isLast, width });
    } else {
      doc.fontSize(fontSize).font('Helvetica')
        .text(seg, x, doc.y, { continued: !isLast, lineBreak: isLast, width });
    }
    x = doc.x; // after first segment, continue from pdfkit cursor
  }
}

// ─── Excel Generation ─────────────────────────────────────────────────────────

interface SheetDef {
  name: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
}

async function generateExcel(
  args: { title: string; sheets: SheetDef[]; output_path: string; author?: string },
  cwd: string
): Promise<ToolResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExcelJS = require('exceljs') as { Workbook: new () => ExcelWorkbook };
    const fullPath = resolvePath(args.output_path, cwd);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const workbook: ExcelWorkbook = new ExcelJS.Workbook();
    workbook.creator = args.author ?? 'coderaw';
    workbook.lastModifiedBy = 'coderaw AI Assistant';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.title = args.title;

    const sheets: SheetDef[] = Array.isArray(args.sheets) ? args.sheets : [];
    if (sheets.length === 0) {
      return { content: 'No sheets provided. Specify at least one sheet with name, headers, and rows.', isError: true };
    }

    let totalRows = 0;

    for (const sheetDef of sheets) {
      const sheetName = (sheetDef.name || 'Sheet').slice(0, 31);
      const ws = workbook.addWorksheet(sheetName);

      const headers: string[] = Array.isArray(sheetDef.headers) ? sheetDef.headers : [];
      const rows: (string | number | boolean | null)[][] = Array.isArray(sheetDef.rows) ? sheetDef.rows : [];
      const colCount = Math.max(headers.length, rows[0]?.length ?? 1, 1);

      // ── Title row (row 1) — merged across all columns ─────────────────────
      const titleCell = ws.getCell('A1');
      titleCell.value = args.title;
      titleCell.font = { bold: true, size: 14, color: { argb: 'FF1A1A2E' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
      if (colCount > 1) {
        ws.mergeCells(1, 1, 1, colCount);
      }
      ws.getRow(1).height = 28;

      // ── Column definitions (applied to header row = row 2) ────────────────
      ws.columns = headers.length > 0
        ? headers.map((h, i) => ({
            header: String(h),
            key: `col${i}`,
            width: Math.max(12, String(h).length + 4),
          }))
        : Array.from({ length: colCount }, (_, i) => ({ key: `col${i}`, width: 14 }));

      // ── Header row (row 2) ────────────────────────────────────────────────
      if (headers.length > 0) {
        // ws.columns sets row 1 as headers by default — shift them to row 2
        // Remove the auto-added header row (row 1 got overwritten by title merge)
        // Re-add headers explicitly as row 2
        ws.spliceRows(2, 0, headers); // insert a row at position 2
        const headerRow = ws.getRow(2);
        headerRow.eachCell((cell: ExcelWorkbook) => {
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.border = { bottom: { style: 'medium', color: { argb: 'FF4A90D9' } } };
        });
        headerRow.height = 22;
      }

      // ── Data rows ─────────────────────────────────────────────────────────
      const dataStartRow = headers.length > 0 ? 3 : 2;
      for (let i = 0; i < rows.length; i++) {
        const rowData = rows[i];
        if (!Array.isArray(rowData)) continue;
        const dataRow = ws.getRow(dataStartRow + i);
        rowData.forEach((val, ci) => { dataRow.getCell(ci + 1).value = val; });
        dataRow.commit();
        totalRows++;

        // Zebra striping
        if (i % 2 === 1) {
          dataRow.eachCell({ includeEmpty: true }, (cell: ExcelWorkbook) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FF' } };
          });
        }
        dataRow.eachCell({ includeEmpty: true }, (cell: ExcelWorkbook) => {
          cell.border = { bottom: { style: 'thin', color: { argb: 'FFE8E8E8' } } };
          if (typeof cell.value === 'number') cell.alignment = { horizontal: 'right' };
          // Auto-format: currency detection
          if (typeof cell.value === 'number') {
            const key = headers[cell._column?.number - 1] ?? '';
            if (/price|cost|amount|total|salary|pay|revenue|usd|\$|eur|gbp/i.test(key)) {
              cell.numFmt = '#,##0.00';
            } else if (/percent|rate|%/i.test(key)) {
              cell.numFmt = '0.00%';
            }
          }
        });
      }

      // ── Auto-fit column widths ─────────────────────────────────────────────
      ws.columns.forEach((col: ExcelWorkbook) => {
        if (!col.key) return;
        let maxLen = col.header ? String(col.header).length : 10;
        ws.getColumn(col.key).eachCell({ includeEmpty: false }, (cell: ExcelWorkbook) => {
          if (cell.value != null) {
            const len = String(cell.value).length;
            if (len > maxLen) maxLen = len;
          }
        });
        col.width = Math.min(maxLen + 4, 55);
      });

      // ── Freeze header rows (title + header = row 3) ───────────────────────
      ws.views = [{
        state: 'frozen',
        xSplit: 0,
        ySplit: headers.length > 0 ? 2 : 1,
        activeCell: `A${headers.length > 0 ? 3 : 2}`,
      }];
    }

    await workbook.xlsx.writeFile(fullPath);

    const stat = fs.statSync(fullPath);
    const kb = (stat.size / 1024).toFixed(1);
    const sheetNames = sheets.map(s => s.name).join(', ');
    return {
      content: `✓ Excel created: ${args.output_path} (${kb} KB)\n  Sheets: ${sheets.length} (${sheetNames}) · Rows: ${totalRows}`,
    };

  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Cannot find module 'exceljs'")) {
      return { content: 'exceljs not installed. Run: npm install exceljs', isError: true };
    }
    return { content: `Excel generation failed: ${msg}`, isError: true };
  }
}

// ─── Diagram Generation ───────────────────────────────────────────────────────

async function generateDiagram(
  args: { type?: string; code: string; output_path: string; format?: string; width?: number },
  cwd: string
): Promise<ToolResult> {
  try {
    const { generateDiagram: renderDiagram, normaliseMermaid } = await import('../diagrams/index');
    const type = (args.type || 'mermaid') as import('../diagrams/index').DiagramType;
    const format = (args.format === 'svg' ? 'svg' : 'png') as 'png' | 'svg';
    const outPath = resolvePath(args.output_path, cwd);

    // Ensure .png or .svg extension
    const ext = path.extname(outPath);
    const finalOut = (ext === '.png' || ext === '.svg') ? outPath
      : outPath + '.' + format;

    const result = await renderDiagram({
      type,
      code: normaliseMermaid(args.code, type),
      outputPath: finalOut,
      format,
      width: args.width,
    });

    const kb = (result.sizeBytes / 1024).toFixed(1);
    const rel = path.relative(cwd, result.outputPath);
    return {
      content: `✓ Diagram saved: ${rel} (${kb} KB)\n  Type: ${result.type} · Format: ${result.format}\n  Code: ${result.mermaidCode.split('\n').length} lines`,
    };
  } catch (err) {
    const msg = (err as Error).message;
    return { content: `Diagram generation failed: ${msg}`, isError: true };
  }
}

// ─── Image Generation ─────────────────────────────────────────────────────────

async function generateImage(
  args: { prompt: string; output_path: string; size?: string; quality?: string; style?: string },
  cwd: string
): Promise<ToolResult> {
  try {
    const { generateImage: renderImage } = await import('../diagrams/index');
    const outPath = resolvePath(args.output_path, cwd);

    const result = await renderImage({
      prompt: args.prompt,
      outputPath: outPath,
      size: (args.size || '1024x1024') as '1024x1024',
      quality: (args.quality || 'standard') as 'standard' | 'hd',
      style: (args.style || 'vivid') as 'vivid' | 'natural',
    });

    const kb = (result.sizeBytes / 1024).toFixed(1);
    const rel = path.relative(cwd, result.outputPath);
    const providerLabel = result.provider === 'dalle' ? 'DALL-E 3' :
                          result.provider === 'stability' ? 'Stability AI' : 'Placeholder SVG';

    return {
      content: `✓ Image saved: ${rel} (${kb} KB)\n  Provider: ${providerLabel}\n  Prompt: "${args.prompt.slice(0, 80)}${args.prompt.length > 80 ? '…' : ''}"`,
    };
  } catch (err) {
    const msg = (err as Error).message;
    return { content: `Image generation failed: ${msg}`, isError: true };
  }
}
