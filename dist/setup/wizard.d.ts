/**
 * First-run setup wizard for knowcap-code
 *
 * Behavior:
 *   1. Auto-detect what's available (Ollama, env vars, saved config)
 *   2. If something works → start immediately, zero config
 *   3. If nothing works → show interactive guided setup, save result
 *
 * Re-run: `kcc setup` or `kcc --setup`
 */
/**
 * Returns true if setup has been completed and a provider is configured.
 */
export declare function isSetupComplete(): boolean;
/**
 * Auto-detect: pick the best available provider without asking anything.
 * Returns the provider id to use, or null if nothing works.
 */
export declare function autoDetectProvider(): Promise<{
    provider: string;
    model: string;
} | null>;
/**
 * Silent startup: auto-detect, print one info line, return chosen provider.
 * Called at every startup when setup is already complete.
 */
export declare function silentAutoDetect(): Promise<{
    provider: string;
    model: string;
} | null>;
/**
 * Run the interactive first-run setup wizard.
 */
export declare function runSetupWizard(force?: boolean): Promise<void>;
//# sourceMappingURL=wizard.d.ts.map