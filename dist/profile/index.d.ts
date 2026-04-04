/**
 * User Identity & Profile
 *
 * Stored at ~/.knowcap-code/profile.yaml
 * Injected into the system prompt so the AI knows who it's talking to.
 *
 * Example profile.yaml:
 *
 *   name: "Shady"
 *   role: "AI Product Manager"
 *   preferences:
 *     language: "TypeScript"
 *     style: "detailed explanations"
 *     review_strictness: "high"
 *   projects:
 *     - name: "knowcap"
 *       path: "~/knowcap"
 *       stack: "React, Node.js, Supabase"
 */
export interface ProjectEntry {
    name: string;
    path?: string;
    stack?: string;
    description?: string;
}
export interface UserPreferences {
    language?: string;
    style?: string;
    review_strictness?: string;
    timezone?: string;
    expertise?: string;
    [key: string]: string | undefined;
}
export interface UserProfile {
    name?: string;
    role?: string;
    email?: string;
    company?: string;
    preferences?: UserPreferences;
    projects?: ProjectEntry[];
    custom_instructions?: string;
}
export declare class ProfileManager {
    private profile;
    constructor();
    get(): UserProfile;
    isEmpty(): boolean;
    getName(): string | undefined;
    getRole(): string | undefined;
    getPreference(key: keyof UserPreferences): string | undefined;
    /** Find a project by name or by matching cwd */
    getProjectForCwd(cwd: string): ProjectEntry | undefined;
    /**
     * Build the identity block injected into system prompt.
     * Only includes non-empty fields.
     */
    buildSystemBlock(cwd?: string): string;
    set(update: Partial<UserProfile>): void;
    setPreference(key: string, value: string): void;
    addProject(proj: ProjectEntry): void;
    private save;
    static load(): UserProfile;
    static profilePath(): string;
    static createDefault(name: string, role?: string): void;
    /** Format profile for terminal display */
    format(): string;
}
//# sourceMappingURL=index.d.ts.map