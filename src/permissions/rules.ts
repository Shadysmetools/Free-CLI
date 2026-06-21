import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { loadSettings, saveSettings } from '../config/settings';
import { Rules } from './types';

/** Catastrophic patterns blocked by default. User `allow` rules can override these. */
export const DEFAULT_DENY: string[] = [
  'rm -rf /', 'rm -rf /*', 'rm -rf ~', 'rm -rf ~/*', 'rm -fr /',
  'mkfs*', 'format *', 'del /s /q c:\\*', 'rd /s /q c:\\*',
];

export function defaultRules(projectRoot: string): Rules {
  return {
    enabled: true,
    projectRoot: path.resolve(projectRoot),
    allow: [],
    ask: [],
    deny: [],
    unattended: 'deny',
    confirmDefault: 'approve',
  };
}

type PermsLayer = Partial<Omit<Rules, 'projectRoot'>> & { projectRoot?: string };

function applyLayer(base: Rules, layer?: PermsLayer): Rules {
  if (!layer) return base;
  return {
    enabled: layer.enabled ?? base.enabled,
    projectRoot: base.projectRoot,
    allow: [...base.allow, ...(layer.allow ?? [])],
    ask: [...base.ask, ...(layer.ask ?? [])],
    deny: [...base.deny, ...(layer.deny ?? [])],
    unattended: layer.unattended ?? base.unattended,
    confirmDefault: layer.confirmDefault ?? base.confirmDefault,
  };
}

export function loadPermissionRules(cwd: string, globalPerms?: PermsLayer): Rules {
  let merged = applyLayer(defaultRules(cwd), globalPerms);

  const projFile = path.join(cwd, '.coderaw', 'permissions.yaml');
  if (fs.existsSync(projFile)) {
    try {
      const raw = yaml.parse(fs.readFileSync(projFile, 'utf-8')) as PermsLayer;
      merged = applyLayer(merged, raw);
    } catch { /* ignore invalid project rules file */ }
  }

  if (globalPerms?.projectRoot && globalPerms.projectRoot !== 'auto') {
    merged.projectRoot = path.resolve(globalPerms.projectRoot);
  } else {
    merged.projectRoot = path.resolve(cwd);
  }
  return merged;
}

/** Glob-ish: '*' wildcard, case-insensitive, full match, trimmed. */
export function matchPattern(pattern: string, subject: string): boolean {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`, 'i').test(subject.trim());
}

export function matchesAny(patterns: string[], subjects: string[]): boolean {
  return patterns.some(p => subjects.some(s => matchPattern(p, s)));
}

/** Append a pattern to the global config's permissions.allow and save. */
export function persistAllowPattern(pattern: string): void {
  const settings = loadSettings();
  settings.permissions = settings.permissions ?? {};
  settings.permissions.allow = settings.permissions.allow ?? [];
  if (!settings.permissions.allow.includes(pattern)) {
    settings.permissions.allow.push(pattern);
    saveSettings(settings);
  }
}
