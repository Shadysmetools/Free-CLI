/**
 * soul.ts — Bot personality system + onboarding flow
 *
 * Each user gets a "soul" — a persistent personality config that drives:
 *  - Bot name (what it calls itself)
 *  - User name (what the bot calls the user)
 *  - Role (coding / research / general / devops / data / creative)
 *  - Language (english / egyptian / franco / arabic / french / ...)
 *  - Verbosity, emoji toggle
 *  - A dynamically generated system prompt
 *
 * Souls are stored per-user in: ~/.coderaw/souls/{userId}.json
 *
 * Onboarding flow (multi-step):
 *   ask_name → ask_role → ask_language → ask_bot_name → done
 */
export type SoulRole = 'coding' | 'research' | 'general' | 'devops' | 'data' | 'creative' | 'custom';
export type SoulLanguage = 'english' | 'egyptian' | 'franco' | 'arabic' | 'saudi' | 'moroccan' | 'french' | 'spanish' | 'german' | 'turkish' | 'portuguese' | 'auto';
export type OnboardingStep = 'ask_name' | 'ask_role' | 'ask_language' | 'ask_bot_name' | 'done';
export interface BotSoul {
    botName: string;
    userName: string;
    role: SoulRole;
    customRole?: string;
    language: SoulLanguage;
    personality: string;
    emoji: boolean;
    verbosity: 'concise' | 'detailed' | 'balanced';
    capabilities: string[];
    systemPrompt: string;
    createdAt: string;
    updatedAt: string;
}
export interface OnboardingState {
    step: OnboardingStep;
    data: {
        userName?: string;
        role?: SoulRole;
        customRole?: string;
        language?: SoulLanguage;
        botName?: string;
    };
}
export declare const ROLE_DEFS: Record<SoulRole, {
    label: string;
    emoji: string;
    shortDesc: string;
    capabilities: string[];
    instructions: string;
}>;
export declare const LANGUAGE_DEFS: Record<SoulLanguage, {
    label: string;
    flag: string;
}>;
export declare function generateSystemPrompt(soul: BotSoul): string;
export declare function createSoul(params: {
    botName: string;
    userName: string;
    role: SoulRole;
    customRole?: string;
    language: SoulLanguage;
}): BotSoul;
export declare class SoulManager {
    private soulsDir;
    private pendingOnboarding;
    constructor();
    hasSoul(userId: number): boolean;
    getSoul(userId: number): BotSoul | null;
    saveSoul(userId: number, soul: BotSoul): void;
    updateSoul(userId: number, patch: Partial<BotSoul>): BotSoul | null;
    deleteSoul(userId: number): boolean;
    isOnboarding(userId: number): boolean;
    getOnboardingState(userId: number): OnboardingState | null;
    startOnboarding(userId: number): OnboardingState;
    advanceOnboarding(userId: number, update: Partial<OnboardingState['data']>, nextStep: OnboardingStep): OnboardingState;
    completeOnboarding(userId: number): BotSoul | null;
    cancelOnboarding(userId: number): void;
    private soulPath;
}
/** Format a soul for display */
export declare function formatSoul(soul: BotSoul): string;
/** Resolve a user-typed language string to a SoulLanguage */
export declare function resolveSoulLanguage(input: string): SoulLanguage | null;
/** Resolve a user-typed role string to a SoulRole */
export declare function resolveSoulRole(input: string): SoulRole | null;
//# sourceMappingURL=soul.d.ts.map