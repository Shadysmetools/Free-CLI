export interface CLIOptions {
    provider?: string;
    model?: string;
    cwd?: string;
    noColor?: boolean;
    oneShot?: string;
    resumeSession?: string;
    noHistory?: boolean;
}
/** The pre-authorized safe tool set used when the router auto-pursues a goal. */
export declare function defaultGoalAllowList(): string[];
/** Dim one-line notice shown when the router takes a non-chat action. */
export declare function routerNotice(d: {
    kind: string;
    target?: string;
    reason: string;
}): string;
export declare function startCLI(opts?: CLIOptions): Promise<void>;
//# sourceMappingURL=cli.d.ts.map