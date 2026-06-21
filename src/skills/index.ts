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

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'yaml';
import { hybridSearch } from '../match/hybrid';

export type SkillSource = 'builtin' | 'project' | 'user';

export interface Skill {
  name: string;
  description: string;
  body: string;         // Full SKILL.md body (after frontmatter)
  source: SkillSource;
  filePath: string;
  enabled: boolean;
}

export class SkillsManager {
  private projectSkillsDir: string;
  private userSkillsDir: string;
  private builtinSkillsDir: string;
  private skills = new Map<string, Skill>();

  constructor(cwd: string) {
    this.projectSkillsDir = path.join(cwd, 'skills');
    this.userSkillsDir = path.join(os.homedir(), '.coderaw', 'skills');
    // __dirname at runtime = dist/skills, so go up one level to find builtins
    this.builtinSkillsDir = path.join(__dirname, 'builtins');
  }

  // ─── Load ──────────────────────────────────────────────────────────────────

  /** Scan and load all skills from all sources. Later sources override earlier ones. */
  loadAll(): void {
    this.skills.clear();
    this.loadFromDir(this.builtinSkillsDir, 'builtin');
    this.loadFromDir(this.projectSkillsDir, 'project');
    this.loadFromDir(this.userSkillsDir, 'user');
  }

  private loadFromDir(dir: string, source: SkillSource): void {
    if (!fs.existsSync(dir)) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;

      const skill = this.parse(skillMd, entry.name, source);
      if (skill) {
        this.skills.set(skill.name, skill);
      }
    }
  }

  private parse(filePath: string, folderName: string, source: SkillSource): Skill | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { frontmatter, body } = splitFrontmatter(raw);

      let name = folderName;
      let description = '';

      if (frontmatter) {
        try {
          const meta = YAML.parse(frontmatter) as Record<string, unknown>;
          if (typeof meta.name === 'string') name = meta.name;
          if (typeof meta.description === 'string') description = meta.description;
        } catch {
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
    } catch {
      return null;
    }
  }

  // ─── Query ─────────────────────────────────────────────────────────────────

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** Compact catalog (name — description) of enabled skills for the system prompt. '' when none. */
  getCatalog(): string {
    const enabled = this.list().filter(s => s.enabled);
    if (enabled.length === 0) return '';
    const lines = enabled.map(s => `- ${s.name} — ${s.description}`).join('\n');
    return `\n\n## Available Skills\nLoad a skill's full instructions with the \`skill\` tool (or /skill <name>) when one is relevant:\n${lines}\n`;
  }

  /** Look up + ensure enabled; returns the skill (with body) or undefined for an unknown name. */
  activate(name: string): Skill | undefined {
    const s = this.skills.get(name);
    if (!s) return undefined;
    s.enabled = true;
    return s;
  }

  /**
   * Auto-detect skills relevant to the user's message.
   * Uses keyword matching against name + description fields.
   */
  detectRelevant(userMessage: string): Skill[] {
    const msgLower = userMessage.toLowerCase();
    const scored: Array<{ skill: Skill; score: number }> = [];

    for (const skill of this.skills.values()) {
      if (!skill.enabled) continue;

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
  getSkillContext(userMessage: string): string {
    const relevant = this.detectRelevant(userMessage);
    if (relevant.length === 0) return '';

    let context = '\n\n## Active Skills\n';
    for (const skill of relevant) {
      context += `\n### ${skill.name}\n${skill.body}\n`;
    }
    return context;
  }

  /** Matcher-based relevance (BM25-only, top-1). Async; never throws — keyword fallback on error. */
  async detectRelevantHybrid(
    userMessage: string,
    deps: { hybrid?: typeof hybridSearch } = {},
  ): Promise<Skill[]> {
    try {
      const hybrid = deps.hybrid ?? hybridSearch;
      const enabled = this.list().filter(s => s.enabled);
      if (enabled.length === 0) return [];
      const docs = enabled.map(s => ({ id: s.name, text: `${s.name} ${s.description}` }));
      const hits = await hybrid(userMessage, docs, { topK: 1 });
      const top = hits[0];
      if (!top) return [];
      const skill = this.skills.get(top.id);
      return skill ? [skill] : [];
    } catch {
      return this.detectRelevant(userMessage).slice(0, 1); // keyword fallback, top-1
    }
  }

  /** Async skill context (top-1 body) for system-prompt injection. '' when nothing relevant. */
  async getSkillContextAsync(
    userMessage: string,
    deps: { hybrid?: typeof hybridSearch } = {},
  ): Promise<string> {
    const relevant = await this.detectRelevantHybrid(userMessage, deps);
    if (relevant.length === 0) return '';
    let context = '\n\n## Active Skills\n';
    for (const skill of relevant) {
      context += `\n### ${skill.name}\n${skill.body}\n`;
    }
    return context;
  }

  // ─── Management ────────────────────────────────────────────────────────────

  enable(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;
    skill.enabled = true;
    return true;
  }

  disable(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;
    skill.enabled = false;
    return true;
  }

  /**
   * Create a new custom skill skeleton in the project's skills/ folder.
   * Returns the path to the new SKILL.md.
   */
  createSkill(name: string, cwd: string): string {
    const skillDir = path.join(cwd, 'skills', name);
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }
    const skillFile = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillFile, skillTemplate(name), 'utf-8');
    return skillFile;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Split raw SKILL.md into frontmatter YAML + body markdown */
function splitFrontmatter(raw: string): { frontmatter: string | null; body: string } {
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

function extractKeywords(text: string): string[] {
  return text
    .replace(/[^a-z0-9\s\-_]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
}

function skillTemplate(name: string): string {
  return `---
name: ${name}
description: "Describe what this skill does and when to use it in one sentence."
---

# ${name}

## When to Use
List trigger conditions, keywords, or scenarios when this skill applies.

## Instructions
Step-by-step instructions for the AI when this skill is active.

## Resources
Bundle extra files in this skill's folder (e.g. references/notes.md, scripts/run.sh)
and point to them by relative path; the agent reads them on demand with read_file.

## Examples
\`\`\`bash
# Example commands or code
\`\`\`
`;
}
