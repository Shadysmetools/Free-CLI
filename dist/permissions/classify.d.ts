import { Rules, Verdict } from './types';
export declare function isInside(root: string, target: string): boolean;
export declare function subjectsFor(toolName: string, args: Record<string, unknown>, root: string): string[];
export declare function classify(toolName: string, args: Record<string, unknown>, root: string, rules: Rules): Verdict;
//# sourceMappingURL=classify.d.ts.map