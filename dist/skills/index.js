"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillsManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const YAML = __importStar(require("yaml"));
class SkillsManager {
    constructor(cwd) {
        this.skills = new Map();
        this.projectSkillsDir = path.join(cwd, 'skills');
        this.userSkillsDir = path.join(os.homedir(), '.coderaw', 'skills');
        // __dirname at runtime = dist/skills, so go up one level to find builtins
        this.builtinSkillsDir = path.join(__dirname, 'builtins');
    }
    // ─── Load ──────────────────────────────────────────────────────────────────
    /** Scan and load all skills from all sources. Later sources override earlier ones. */
    loadAll() {
        this.skills.clear();
        this.loadFromDir(this.builtinSkillsDir, 'builtin');
        this.loadFromDir(this.projectSkillsDir, 'project');
        this.loadFromDir(this.userSkillsDir, 'user');
    }
    loadFromDir(dir, source) {
        if (!fs.existsSync(dir))
            return;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const skillMd = path.join(dir, entry.name, 'SKILL.md');
            if (!fs.existsSync(skillMd))
                continue;
            const skill = this.parse(skillMd, entry.name, source);
            if (skill) {
                this.skills.set(skill.name, skill);
            }
        }
    }
    parse(filePath, folderName, source) {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const { frontmatter, body } = splitFrontmatter(raw);
            let name = folderName;
            let description = '';
            if (frontmatter) {
                try {
                    const meta = YAML.parse(frontmatter);
                    if (typeof meta.name === 'string')
                        name = meta.name;
                    if (typeof meta.description === 'string')
                        description = meta.description;
                }
                catch {
                    // Fall back to folder name if YAML parse fails
                }
            }
            // If no frontmatter description, try to extract from first non-heading paragraph
            if (!description) {
                const lines = body.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
                        description = trimmed;
                        break;
                    }
                }
            }
            return { name, description, body: body.trim(), source, filePath, enabled: true };
        }
        catch {
            return null;
        }
    }
    // ─── Query ─────────────────────────────────────────────────────────────────
    list() {
        return Array.from(this.skills.values());
    }
    get(name) {
        return this.skills.get(name);
    }
    /**
     * Auto-detect skills relevant to the user's message.
     * Uses keyword matching against name + description fields.
     */
    detectRelevant(userMessage) {
        const msgLower = userMessage.toLowerCase();
        const scored = [];
        for (const skill of this.skills.values()) {
            if (!skill.enabled)
                continue;
            const haystack = `${skill.name} ${skill.description}`.toLowerCase();
            const keywords = extractKeywords(haystack);
            const matches = keywords.filter(kw => msgLower.includes(kw));
            if (matches.length > 0) {
                scored.push({ skill, score: matches.length });
            }
        }
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, 2) // max 2 skills to avoid context bloat
            .map(s => s.skill);
    }
    // ─── System Prompt Context ─────────────────────────────────────────────────
    /**
     * Returns skill instructions for injection into the system prompt.
     * Called per-message with the user's input to detect relevant skills.
     */
    getSkillContext(userMessage) {
        const relevant = this.detectRelevant(userMessage);
        if (relevant.length === 0)
            return '';
        let context = '\n\n## Active Skills\n';
        for (const skill of relevant) {
            context += `\n### ${skill.name}\n${skill.body}\n`;
        }
        return context;
    }
    // ─── Management ────────────────────────────────────────────────────────────
    enable(name) {
        const skill = this.skills.get(name);
        if (!skill)
            return false;
        skill.enabled = true;
        return true;
    }
    disable(name) {
        const skill = this.skills.get(name);
        if (!skill)
            return false;
        skill.enabled = false;
        return true;
    }
    /**
     * Create a new custom skill skeleton in the project's skills/ folder.
     * Returns the path to the new SKILL.md.
     */
    createSkill(name, cwd) {
        const skillDir = path.join(cwd, 'skills', name);
        if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
        }
        const skillFile = path.join(skillDir, 'SKILL.md');
        fs.writeFileSync(skillFile, skillTemplate(name), 'utf-8');
        return skillFile;
    }
}
exports.SkillsManager = SkillsManager;
// ─── Helpers ────────────────────────────────────────────────────────────────
/** Split raw SKILL.md into frontmatter YAML + body markdown */
function splitFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (match) {
        return { frontmatter: match[1], body: match[2] };
    }
    return { frontmatter: null, body: raw };
}
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'when', 'use',
    'you', 'are', 'have', 'will', 'your', 'can', 'how', 'what', 'which',
    'via', 'not', 'any', 'run', 'get', 'all', 'its', 'but', 'also',
]);
function extractKeywords(text) {
    return text
        .replace(/[^a-z0-9\s\-_]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !STOP_WORDS.has(w));
}
function skillTemplate(name) {
    return `---
name: ${name}
description: "Describe what this skill does and when to use it in one sentence."
---

# ${name}

## When to Use
List trigger conditions, keywords, or scenarios when this skill applies.

## Instructions
Step-by-step instructions for the AI when this skill is active.

## Examples
\`\`\`bash
# Example commands or code
\`\`\`
`;
}
//# sourceMappingURL=index.js.map