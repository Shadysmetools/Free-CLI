/**
 * Discover + parse YAML workflow files. Search order (later wins on name
 * collision): user dir (~/.coderaw/workflows or %APPDATA%\coderaw\workflows)
 * then the project dir (./.coderaw/workflows). Invalid files are skipped.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { validateWorkflow, WorkflowDef } from './schema';

export function parseWorkflow(text: string): { ok: true; def: WorkflowDef } | { ok: false; errors: string[] } {
  let raw: unknown;
  try { raw = yaml.parse(text); } catch (e) { return { ok: false, errors: [`YAML parse error: ${(e as Error).message}`] }; }
  return validateWorkflow(raw);
}

export function workflowDirs(cwd: string): string[] {
  const userBase = process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? os.homedir(), 'coderaw')
    : path.join(os.homedir(), '.coderaw');
  return [path.join(userBase, 'workflows'), path.join(cwd, '.coderaw', 'workflows')];
}

export function loadWorkflows(dirs: string[]): Map<string, WorkflowDef> {
  const map = new Map<string, WorkflowDef>();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.ya?ml$/i.test(file)) continue;
      try {
        const r = parseWorkflow(fs.readFileSync(path.join(dir, file), 'utf-8'));
        if (r.ok) map.set(r.def.name, r.def);
      } catch { /* skip unreadable file */ }
    }
  }
  return map;
}
