"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOLS = exports.fileChanges = void 0;
exports.executeTool = executeTool;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process = __importStar(require("child_process"));
// Track file changes for undo
exports.fileChanges = [];
exports.TOOLS = [
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
        description: 'Generate a PDF document from a title and markdown/plain-text content. Use for reports, invoices, documentation, and summaries.',
        parameters: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Document title (shown at the top of the PDF)',
                },
                content: {
                    type: 'string',
                    description: 'Document body in plain text or simple markdown (## headings, **bold**, bullet lists with -)',
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
];
async function executeTool(name, args, cwd) {
    try {
        switch (name) {
            case 'read_file': return readFile(args, cwd);
            case 'write_file': return writeFile(args, cwd);
            case 'edit_file': return editFile(args, cwd);
            case 'search_files': return searchFiles(args, cwd);
            case 'list_files': return listFiles(args, cwd);
            case 'run_command': return runCommand(args, cwd);
            case 'git_status': return gitStatus(cwd);
            case 'git_diff': return gitDiff(args, cwd);
            case 'git_commit': return gitCommit(args, cwd);
            case 'git_log': return gitLog(args, cwd);
            case 'generate_pdf': return generatePdf(args, cwd);
            case 'generate_excel': return generateExcel(args, cwd);
            case 'generate_diagram': return generateDiagram(args, cwd);
            case 'generate_image': return generateImage(args, cwd);
            default: return { content: `Unknown tool: ${name}`, isError: true };
        }
    }
    catch (err) {
        return { content: `Error in ${name}: ${err.message}`, isError: true };
    }
}
function resolvePath(filePath, cwd) {
    if (path.isAbsolute(filePath))
        return filePath;
    return path.resolve(cwd, filePath);
}
function readFile(args, cwd) {
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
function writeFile(args, cwd) {
    const fullPath = resolvePath(args.path, cwd);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const existed = fs.existsSync(fullPath);
    const original = existed ? fs.readFileSync(fullPath, 'utf-8') : null;
    exports.fileChanges.push({ path: fullPath, originalContent: original, action: existed ? 'edit' : 'create' });
    fs.writeFileSync(fullPath, args.content, 'utf-8');
    const lines = args.content.split('\n').length;
    return { content: `✓ ${existed ? 'Updated' : 'Created'} ${args.path} (${lines} lines)` };
}
function editFile(args, cwd) {
    const fullPath = resolvePath(args.path, cwd);
    if (!fs.existsSync(fullPath)) {
        return { content: `File not found: ${args.path}`, isError: true };
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    if (!content.includes(args.old_text)) {
        return { content: `Could not find the specified text in ${args.path}. Text to find:\n${args.old_text}`, isError: true };
    }
    exports.fileChanges.push({ path: fullPath, originalContent: content, action: 'edit' });
    const newContent = content.replace(args.old_text, args.new_text);
    fs.writeFileSync(fullPath, newContent, 'utf-8');
    return { content: `✓ Edited ${args.path}` };
}
function searchFiles(args, cwd) {
    const searchPath = args.path ? resolvePath(args.path, cwd) : cwd;
    const caseSensitive = args.case_sensitive === 'true';
    try {
        let cmd = `grep -r${caseSensitive ? '' : 'i'} --include="*" -n -l`;
        if (args.file_pattern)
            cmd = `grep -r${caseSensitive ? '' : 'i'} --include="${args.file_pattern}" -n`;
        else
            cmd = `grep -r${caseSensitive ? '' : 'i'} -n --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist`;
        cmd += ` "${args.pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -50`;
        const result = child_process.execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
        return { content: result || 'No matches found' };
    }
    catch {
        return { content: 'No matches found' };
    }
}
function listFiles(args, cwd) {
    const targetPath = args.path ? resolvePath(args.path, cwd) : cwd;
    const recursive = args.recursive === 'true';
    const includeHidden = args.include_hidden === 'true';
    function walkDir(dir, depth = 0) {
        if (depth > 5)
            return [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const lines = [];
        for (const entry of entries) {
            if (!includeHidden && entry.name.startsWith('.'))
                continue;
            if (['node_modules', '.git', 'dist', '__pycache__', '.next'].includes(entry.name))
                continue;
            const indent = '  '.repeat(depth);
            if (entry.isDirectory()) {
                lines.push(`${indent}${entry.name}/`);
                if (recursive)
                    lines.push(...walkDir(path.join(dir, entry.name), depth + 1));
            }
            else {
                lines.push(`${indent}${entry.name}`);
            }
        }
        return lines;
    }
    const files = walkDir(targetPath);
    return { content: files.join('\n') || 'Empty directory' };
}
function runCommand(args, cwd) {
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
        });
        return { content: result || '(no output)' };
    }
    catch (err) {
        const error = err;
        const output = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
        return { content: output || 'Command failed', isError: true };
    }
}
function gitStatus(cwd) {
    try {
        const result = child_process.execSync('git status', { cwd, encoding: 'utf-8', timeout: 5000 });
        return { content: result };
    }
    catch {
        return { content: 'Not a git repository or git error', isError: true };
    }
}
function gitDiff(args, cwd) {
    try {
        const staged = args.staged === 'true' ? '--staged ' : '';
        const file = args.file ? ` -- "${args.file}"` : '';
        const result = child_process.execSync(`git diff ${staged}${file}`, {
            cwd, encoding: 'utf-8', timeout: 10000,
        });
        return { content: result || 'No changes' };
    }
    catch {
        return { content: 'Git diff failed', isError: true };
    }
}
function gitLog(args, cwd) {
    try {
        const limit = args.limit ?? 10;
        const file = args.file ? ` -- "${args.file}"` : '';
        const result = child_process.execSync(`git log --oneline -${limit}${file}`, { cwd, encoding: 'utf-8', timeout: 5000 });
        return { content: result || 'No commits found' };
    }
    catch {
        return { content: 'Not a git repository or git error', isError: true };
    }
}
function gitCommit(args, cwd) {
    try {
        const files = args.files || '.';
        child_process.execSync(`git add ${files}`, { cwd, encoding: 'utf-8' });
        const result = child_process.execSync(`git commit -m "${args.message.replace(/"/g, '\\"')}"`, {
            cwd, encoding: 'utf-8', timeout: 10000,
        });
        return { content: result };
    }
    catch (err) {
        const error = err;
        return { content: error.stderr || error.message || 'Commit failed', isError: true };
    }
}
// ─── PDF Generation ───────────────────────────────────────────────────────────
async function generatePdf(args, cwd) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const PDFDocumentClass = require('pdfkit');
        const fullPath = resolvePath(args.output_path, cwd);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        const fontSize = args.font_size ?? 12;
        const headingSize = Math.round(fontSize * 1.6);
        const subheadingSize = Math.round(fontSize * 1.3);
        const doc = new PDFDocumentClass({
            margin: 60,
            info: {
                Title: args.title,
                Author: args.author ?? 'knowcap-code',
                Creator: 'knowcap-code AI Assistant',
                Producer: 'pdfkit',
            },
        });
        const stream = fs.createWriteStream(fullPath);
        doc.pipe(stream);
        // ── Title block ──────────────────────────────────────────────────────────
        doc
            .fontSize(headingSize + 4)
            .font('Helvetica-Bold')
            .text(args.title, { align: 'center' });
        doc.moveDown(0.4);
        const dateLine = `Generated by knowcap-code · ${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}`;
        doc.fontSize(9).font('Helvetica').fillColor('#888888').text(dateLine, { align: 'center' });
        doc.fillColor('#000000');
        doc.moveDown(0.8);
        doc.moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .strokeColor('#cccccc').lineWidth(1).stroke();
        doc.moveDown(0.8);
        // ── Body: simple markdown → PDF ──────────────────────────────────────────
        const lines = args.content.split('\n');
        for (const raw of lines) {
            const line = raw.trimEnd();
            if (line.startsWith('## ')) {
                doc.moveDown(0.5);
                doc.fontSize(headingSize).font('Helvetica-Bold').fillColor('#1a1a2e')
                    .text(line.slice(3));
                doc.moveDown(0.15);
                doc.moveTo(doc.page.margins.left, doc.y)
                    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
                    .strokeColor('#dddddd').lineWidth(0.5).stroke();
                doc.moveDown(0.3);
                doc.fillColor('#000000');
            }
            else if (line.startsWith('### ')) {
                doc.moveDown(0.3);
                doc.fontSize(subheadingSize).font('Helvetica-Bold').fillColor('#2c2c54')
                    .text(line.slice(4));
                doc.moveDown(0.2);
                doc.fillColor('#000000');
            }
            else if (line.startsWith('- ') || line.startsWith('* ')) {
                // Bullet item — render inline bold via segments
                doc.fontSize(fontSize).font('Helvetica');
                renderInline(doc, '• ' + line.slice(2), fontSize);
                doc.moveDown(0.1);
            }
            else if (/^\d+\.\s/.test(line)) {
                // Numbered list
                doc.fontSize(fontSize).font('Helvetica');
                renderInline(doc, line, fontSize);
                doc.moveDown(0.1);
            }
            else if (line === '' || line === '---' || line.startsWith('---')) {
                if (line.startsWith('---')) {
                    doc.moveDown(0.3);
                    doc.moveTo(doc.page.margins.left, doc.y)
                        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
                        .strokeColor('#eeeeee').lineWidth(0.5).stroke();
                    doc.moveDown(0.3);
                }
                else {
                    doc.moveDown(0.4);
                }
            }
            else if (line.startsWith('    ') || line.startsWith('\t')) {
                // Code block style
                doc.fontSize(fontSize - 1).font('Courier').fillColor('#333333')
                    .text(line.replace(/^\t/, '    '), { indent: 8 });
                doc.fillColor('#000000');
            }
            else {
                doc.fontSize(fontSize).font('Helvetica');
                renderInline(doc, line, fontSize);
                doc.moveDown(0.2);
            }
        }
        doc.end();
        await new Promise((resolve, reject) => {
            stream.on('finish', resolve);
            stream.on('error', reject);
        });
        const stat = fs.statSync(fullPath);
        const kb = (stat.size / 1024).toFixed(1);
        return { content: `✓ PDF created: ${args.output_path} (${kb} KB)\n  Pages: ~${Math.ceil(lines.length / 50)} · Title: "${args.title}"` };
    }
    catch (err) {
        const msg = err.message;
        if (msg.includes("Cannot find module 'pdfkit'")) {
            return { content: 'pdfkit not installed. Run: npm install pdfkit', isError: true };
        }
        return { content: `PDF generation failed: ${msg}`, isError: true };
    }
}
/** Render a line that may contain **bold** markers via pdfkit's .text() continuation */
function renderInline(doc, text, fontSize) {
    // Split on **...**
    const segments = text.split(/(\*\*[^*]+\*\*)/g);
    if (segments.length === 1) {
        // No bold — simple write
        doc.fontSize(fontSize).font('Helvetica').text(text, { continued: false });
        return;
    }
    let first = true;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const isLast = i === segments.length - 1;
        if (!seg)
            continue;
        if (seg.startsWith('**') && seg.endsWith('**')) {
            doc.fontSize(fontSize).font('Helvetica-Bold')
                .text(seg.slice(2, -2), { continued: !isLast, lineBreak: isLast });
        }
        else {
            if (first) {
                doc.fontSize(fontSize).font('Helvetica')
                    .text(seg, { continued: !isLast, lineBreak: isLast });
            }
            else {
                doc.font('Helvetica').text(seg, { continued: !isLast, lineBreak: isLast });
            }
        }
        first = false;
    }
}
async function generateExcel(args, cwd) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ExcelJS = require('exceljs');
        const fullPath = resolvePath(args.output_path, cwd);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        const workbook = new ExcelJS.Workbook();
        workbook.creator = args.author ?? 'knowcap-code';
        workbook.lastModifiedBy = 'knowcap-code AI Assistant';
        workbook.created = new Date();
        workbook.modified = new Date();
        workbook.title = args.title;
        const sheets = Array.isArray(args.sheets) ? args.sheets : [];
        if (sheets.length === 0) {
            return { content: 'No sheets provided. Specify at least one sheet with name, headers, and rows.', isError: true };
        }
        let totalRows = 0;
        for (const sheetDef of sheets) {
            const sheetName = (sheetDef.name || 'Sheet').slice(0, 31); // Excel max 31 chars
            const ws = workbook.addWorksheet(sheetName);
            const headers = Array.isArray(sheetDef.headers) ? sheetDef.headers : [];
            const rows = Array.isArray(sheetDef.rows) ? sheetDef.rows : [];
            // ── Header row ────────────────────────────────────────────────────────
            if (headers.length > 0) {
                ws.columns = headers.map((h, i) => ({
                    header: String(h),
                    key: `col${i}`,
                    width: Math.max(12, String(h).length + 4),
                }));
                const headerRow = ws.getRow(1);
                headerRow.eachCell((cell) => {
                    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.border = {
                        bottom: { style: 'medium', color: { argb: 'FF4A90D9' } },
                    };
                });
                headerRow.height = 20;
            }
            // ── Data rows ─────────────────────────────────────────────────────────
            for (let i = 0; i < rows.length; i++) {
                const rowData = rows[i];
                if (!Array.isArray(rowData))
                    continue;
                const dataRow = ws.addRow(rowData);
                totalRows++;
                // Zebra striping
                if (i % 2 === 1) {
                    dataRow.eachCell({ includeEmpty: true }, (cell) => {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
                    });
                }
                // Auto-detect numbers for right-alignment
                dataRow.eachCell({ includeEmpty: true }, (cell) => {
                    if (typeof cell.value === 'number') {
                        cell.alignment = { horizontal: 'right' };
                    }
                });
            }
            // ── Auto-fit column widths based on content ────────────────────────────
            ws.columns.forEach((col) => {
                if (!col.key)
                    return;
                let maxLen = col.header ? String(col.header).length : 10;
                ws.getColumn(col.key).eachCell({ includeEmpty: false }, (cell) => {
                    if (cell.value) {
                        const len = String(cell.value).length;
                        if (len > maxLen)
                            maxLen = len;
                    }
                });
                col.width = Math.min(maxLen + 4, 60);
            });
            // ── Freeze header row ─────────────────────────────────────────────────
            ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, activeCell: 'A2' }];
        }
        await workbook.xlsx.writeFile(fullPath);
        const stat = fs.statSync(fullPath);
        const kb = (stat.size / 1024).toFixed(1);
        const sheetNames = sheets.map(s => s.name).join(', ');
        return {
            content: `✓ Excel created: ${args.output_path} (${kb} KB)\n  Sheets: ${sheets.length} (${sheetNames}) · Rows: ${totalRows}`,
        };
    }
    catch (err) {
        const msg = err.message;
        if (msg.includes("Cannot find module 'exceljs'")) {
            return { content: 'exceljs not installed. Run: npm install exceljs', isError: true };
        }
        return { content: `Excel generation failed: ${msg}`, isError: true };
    }
}
// ─── Diagram Generation ───────────────────────────────────────────────────────
async function generateDiagram(args, cwd) {
    try {
        const { generateDiagram: renderDiagram, normaliseMermaid } = await Promise.resolve().then(() => __importStar(require('../diagrams/index')));
        const type = (args.type || 'mermaid');
        const format = (args.format === 'svg' ? 'svg' : 'png');
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
    }
    catch (err) {
        const msg = err.message;
        return { content: `Diagram generation failed: ${msg}`, isError: true };
    }
}
// ─── Image Generation ─────────────────────────────────────────────────────────
async function generateImage(args, cwd) {
    try {
        const { generateImage: renderImage } = await Promise.resolve().then(() => __importStar(require('../diagrams/index')));
        const outPath = resolvePath(args.output_path, cwd);
        const result = await renderImage({
            prompt: args.prompt,
            outputPath: outPath,
            size: (args.size || '1024x1024'),
            quality: (args.quality || 'standard'),
            style: (args.style || 'vivid'),
        });
        const kb = (result.sizeBytes / 1024).toFixed(1);
        const rel = path.relative(cwd, result.outputPath);
        const providerLabel = result.provider === 'dalle' ? 'DALL-E 3' :
            result.provider === 'stability' ? 'Stability AI' : 'Placeholder SVG';
        return {
            content: `✓ Image saved: ${rel} (${kb} KB)\n  Provider: ${providerLabel}\n  Prompt: "${args.prompt.slice(0, 80)}${args.prompt.length > 80 ? '…' : ''}"`,
        };
    }
    catch (err) {
        const msg = err.message;
        return { content: `Image generation failed: ${msg}`, isError: true };
    }
}
//# sourceMappingURL=tools.js.map