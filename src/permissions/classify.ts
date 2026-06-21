import * as path from 'path';
import { Rules, Verdict } from './types';
import { matchesAny, DEFAULT_DENY } from './rules';

const KNOWN_SAFE = new Set([
  'read_file', 'search_files', 'list_files',
  'git_status', 'git_diff', 'git_log', 'memory_search', 'memory_save',
  'web_search', 'web_fetch', 'skill',
]);

const DESTRUCTIVE: RegExp[] = [
  /\brm\s+-[rf]{1,2}\b/i, /\brm\s+-fr\b/i,
  /\bdel\s+\/s\b/i, /\bdel\s+\/q\b/i, /\brmdir\s+\/s\b/i, /\brd\s+\/s\b/i,
  /\bformat\b/i, /\bmkfs/i, /\bdd\s+if=/i, /\bshutdown\b/i, /\breg\s+delete\b/i,
  /:\(\)\s*\{/, />\s*\/dev\/sd/i,
];

export function isInside(root: string, target: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(target);
  const norm = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const rN = norm(r);
  const tN = norm(t);
  if (tN === rN) return true;
  return tN.startsWith(rN.endsWith(path.sep) ? rN : rN + path.sep);
}

function argPath(args: Record<string, unknown>): string | undefined {
  const p = args.path ?? args.output_path;
  return typeof p === 'string' ? p : undefined;
}

function resolveArg(p: string, root: string): string {
  return path.isAbsolute(p) ? p : path.resolve(root, p);
}

export function subjectsFor(toolName: string, args: Record<string, unknown>, root: string): string[] {
  if (toolName === 'run_command') return [String(args.command ?? '')];
  if (toolName === 'git_commit') return ['git_commit', 'git commit'];
  const p = argPath(args);
  if (p) {
    const resolved = resolveArg(p, root);
    return [`${toolName} ${resolved}`, resolved, `${toolName} ${p}`, p];
  }
  return [toolName, `${toolName} ${JSON.stringify(args)}`];
}

export function classify(
  toolName: string,
  args: Record<string, unknown>,
  root: string,
  rules: Rules,
): Verdict {
  const subjects = subjectsFor(toolName, args, root);
  const primary = subjects[0];

  if (!rules.enabled) {
    return { decision: 'silent', severity: 'normal', reasons: ['permissions disabled'], subject: primary };
  }
  if (matchesAny(rules.deny, subjects)) {
    return { decision: 'block', severity: 'warn', reasons: ['matched a user deny rule'], subject: primary };
  }
  if (matchesAny(rules.allow, subjects)) {
    return { decision: 'silent', severity: 'normal', reasons: ['matched a user allow rule'], subject: primary };
  }
  if (matchesAny(DEFAULT_DENY, subjects)) {
    return { decision: 'block', severity: 'warn', reasons: ['catastrophic action blocked by default'], subject: primary };
  }
  const forcedAsk = matchesAny(rules.ask, subjects);

  if (!forcedAsk && KNOWN_SAFE.has(toolName)) {
    return { decision: 'silent', severity: 'normal', reasons: ['read-only tool'], subject: primary };
  }

  if (toolName === 'run_command') {
    const cmd = String(args.command ?? '');
    const destructive = DESTRUCTIVE.some(re => re.test(cmd));
    const cwdArg = typeof args.cwd === 'string' ? args.cwd : undefined;
    const outside = cwdArg ? !isInside(root, resolveArg(cwdArg, root)) : false;
    const reasons = ['shell command'];
    if (destructive) reasons.push('destructive command pattern');
    if (outside) reasons.push('runs outside project root');
    return { decision: 'ask', severity: destructive || outside ? 'warn' : 'normal', reasons, subject: cmd };
  }

  if (toolName === 'write_file' || toolName === 'edit_file') {
    const p = argPath(args) ?? '';
    const resolved = resolveArg(p, root);
    const inside = isInside(root, resolved);
    if (inside && !forcedAsk) {
      return { decision: 'silent', severity: 'normal', reasons: ['in-project file change'], subject: resolved };
    }
    return {
      decision: 'ask',
      severity: inside ? 'normal' : 'warn',
      reasons: inside ? ['forced ask'] : ['writes outside project root'],
      subject: resolved,
    };
  }

  return { decision: 'ask', severity: 'normal', reasons: ['consequential / not a known-safe tool'], subject: primary };
}
