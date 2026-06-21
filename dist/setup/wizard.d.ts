/**
 * First-run setup wizard — Gemini CLI-style interactive selection
 * Uses inquirer arrow-key prompts instead of numbered text menus.
 */
import { Settings } from '../config/settings';
/**
 * The answers collected by the onboarding wizard prompts.
 * Kept deliberately small — the interactive inquirer flow is a thin wrapper
 * around the pure mapping below.
 */
export interface WizardAnswers {
    /** Chosen provider id: 'ollama' | 'anthropic' | 'openai' | 'google' | 'groq' | 'openrouter' | 'custom' */
    provider: string;
    /** Selected/confirmed model. Falls back to the provider's default when omitted. */
    model?: string;
    /** API key — required for cloud/custom providers, absent for local Ollama. */
    apiKey?: string;
    /** Base URL — used by the custom OpenAI-compatible provider. */
    baseUrl?: string;
}
/**
 * Pure mapping: wizard answers → a valid Settings object.
 *
 * Starts from the built-in defaults (so every untouched provider, the ui block,
 * permissions, etc. are preserved) and overlays only what the user chose:
 *   - selects the provider as the default
 *   - places the model on both `defaultModel` and the provider config
 *   - places the api key (cloud/custom) and base URL (custom) on the provider
 *
 * No file or environment reads — fully unit-testable.
 */
export declare function buildSettingsFromAnswers(answers: WizardAnswers): Settings;
/**
 * True only on a genuine first run — when NO config file exists yet AND the
 * setup-complete marker is absent. Conservative by design: if either artifact
 * is present, an existing user has already configured coderaw and the wizard
 * must NOT fire (it would otherwise overwrite a working %APPDATA%\coderaw setup).
 */
export declare function isFirstRun(): boolean;
export declare function isSetupComplete(): boolean;
export declare function autoDetectProvider(): Promise<{
    provider: string;
    model: string;
} | null>;
export declare function silentAutoDetect(): Promise<{
    provider: string;
    model: string;
} | null>;
/**
 * Friendly first-run onboarding. Collects answers via inquirer, maps them with
 * the pure `buildSettingsFromAnswers`, persists via `saveSettings`, writes the
 * setup-complete marker, prints a confirmation, then returns so the caller can
 * fall through into the normal session.
 */
export declare function runOnboardingWizard(): Promise<void>;
export declare function runSetupWizard(force?: boolean): Promise<void>;
//# sourceMappingURL=wizard.d.ts.map