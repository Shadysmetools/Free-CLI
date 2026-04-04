/**
 * Persona & Dialect System
 *
 * Lets the user switch the AI's response language/style on the fly.
 * Personas are injected into the system prompt each turn.
 *
 * Built-ins cover Arabic dialects, Franco-Arab (Arabizi), and major world languages.
 * Custom personas are stored in ~/.coderaw/personas/<name>.yaml
 */
export interface Persona {
    id: string;
    name: string;
    nativeName?: string;
    language: string;
    flag?: string;
    systemPrompt: string;
    source: 'builtin' | 'custom';
}
export declare const BUILTIN_PERSONAS: Persona[];
export declare class PersonaManager {
    private all;
    private activeId;
    constructor();
    getActive(): Persona;
    setActive(id: string): Persona | null;
    isDefault(): boolean;
    /** Return system-prompt injection block for current persona */
    buildSystemBlock(): string;
    list(): Persona[];
    find(query: string): Persona | undefined;
    createCustom(id: string, name: string, language: string, systemPrompt: string, flag?: string): Persona;
    deleteCustom(id: string): boolean;
    formatList(): string;
    private loadCustom;
    private loadActiveId;
    private saveActiveId;
}
export declare function resolvePersonaId(input: string): string;
//# sourceMappingURL=index.d.ts.map