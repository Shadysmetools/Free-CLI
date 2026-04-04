/**
 * First-run setup wizard — Gemini CLI-style interactive selection
 * Uses inquirer arrow-key prompts instead of numbered text menus.
 */
export declare function isSetupComplete(): boolean;
export declare function autoDetectProvider(): Promise<{
    provider: string;
    model: string;
} | null>;
export declare function silentAutoDetect(): Promise<{
    provider: string;
    model: string;
} | null>;
export declare function runSetupWizard(force?: boolean): Promise<void>;
//# sourceMappingURL=wizard.d.ts.map