/**
 * Skills Manager — models OpenClaw + ECC skill patterns
 *
 * Architecture:
 *   - Each skill is a folder with SKILL.md (YAML frontmatter + body)
 *   - Frontmatter: name + description (key for auto-detection)
 *   - Body loaded only when skill activates (progressive disclosure)
 *   - Sources: builtin → project → user (later sources win on same name)
 *
 * SKILL.md format:
 *   ---
 *   name: github
 *   description: "GitHub ops via gh CLI: issues, PRs, CI..."
 *   ---
 *   # Skill Body (instructions, examples, etc.)
 */
import { hybridSearch } from '../match/hybrid';
export type SkillSource = 'builtin' | 'project' | 'user';
export interface Skill {
    name: string;
    description: string;
    body: string;
    source: SkillSource;
    filePath: string;
    enabled: boolean;
}
export declare class SkillsManager {
    private projectSkillsDir;
    private userSkillsDir;
    private builtinSkillsDir;
    private skills;
    constructor(cwd: string);
    /** Scan and load all skills from all sources. Later sources override earlier ones. */
    loadAll(): void;
    private loadFromDir;
    private parse;
    list(): Skill[];
    get(name: string): Skill | undefined;
    /** Compact catalog (name — description) of enabled skills for the system prompt. '' when none. */
    getCatalog(): string;
    /** Look up + ensure enabled; returns the skill (with body) or undefined for an unknown name. */
    activate(name: string): Skill | undefined;
    /**
     * Auto-detect skills relevant to the user's message.
     * Uses keyword matching against name + description fields.
     */
    detectRelevant(userMessage: string): Skill[];
    /**
     * Returns skill instructions for injection into the system prompt.
     * Called per-message with the user's input to detect relevant skills.
     */
    getSkillContext(userMessage: string): string;
    /** Matcher-based relevance (BM25-only, top-1). Async; never throws — keyword fallback on error. */
    detectRelevantHybrid(userMessage: string, deps?: {
        hybrid?: typeof hybridSearch;
    }): Promise<Skill[]>;
    /** Async skill context (top-1 body) for system-prompt injection. '' when nothing relevant. */
    getSkillContextAsync(userMessage: string, deps?: {
        hybrid?: typeof hybridSearch;
    }): Promise<string>;
    enable(name: string): boolean;
    disable(name: string): boolean;
    /**
     * Create a new custom skill skeleton in the project's skills/ folder.
     * Returns the path to the new SKILL.md.
     */
    createSkill(name: string, cwd: string): string;
}
//# sourceMappingURL=index.d.ts.map