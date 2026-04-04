export interface CLIOptions {
    provider?: string;
    model?: string;
    cwd?: string;
    noColor?: boolean;
    oneShot?: string;
    resumeSession?: string;
    noHistory?: boolean;
}
export declare function startCLI(opts?: CLIOptions): Promise<void>;
//# sourceMappingURL=cli.d.ts.map