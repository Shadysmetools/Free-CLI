export type Decision = 'silent' | 'ask' | 'block';
export type Severity = 'normal' | 'warn';
export interface Verdict {
    decision: Decision;
    severity: Severity;
    reasons: string[];
    subject: string;
}
export interface Rules {
    enabled: boolean;
    projectRoot: string;
    allow: string[];
    ask: string[];
    deny: string[];
    unattended: 'deny' | 'allow';
    confirmDefault: 'approve' | 'skip';
}
export type ConfirmChoice = {
    kind: 'yes';
} | {
    kind: 'session';
} | {
    kind: 'persist';
} | {
    kind: 'no';
    reason?: string;
};
export interface ConfirmRequest {
    toolName: string;
    args: Record<string, unknown>;
    verdict: Verdict;
    defaultApprove: boolean;
}
export type ConfirmFn = (req: ConfirmRequest) => Promise<ConfirmChoice>;
export interface GateContext {
    cwd: string;
    rules: Rules;
    isInteractive: boolean;
    sessionAllow: Set<string>;
    confirm?: ConfirmFn;
    persistAllow?: (pattern: string) => void;
}
export interface GateResult {
    allowed: boolean;
    reasonForModel?: string;
}
//# sourceMappingURL=types.d.ts.map