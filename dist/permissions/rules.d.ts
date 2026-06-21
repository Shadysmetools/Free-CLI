import { Rules } from './types';
/** Catastrophic patterns blocked by default. User `allow` rules can override these. */
export declare const DEFAULT_DENY: string[];
export declare function defaultRules(projectRoot: string): Rules;
type PermsLayer = Partial<Omit<Rules, 'projectRoot'>> & {
    projectRoot?: string;
};
export declare function loadPermissionRules(cwd: string, globalPerms?: PermsLayer): Rules;
/** Glob-ish: '*' wildcard, case-insensitive, full match, trimmed. */
export declare function matchPattern(pattern: string, subject: string): boolean;
export declare function matchesAny(patterns: string[], subjects: string[]): boolean;
/** Append a pattern to the global config's permissions.allow and save. */
export declare function persistAllowPattern(pattern: string): void;
export {};
//# sourceMappingURL=rules.d.ts.map