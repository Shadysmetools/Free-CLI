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

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectEntry {
  name: string;
  path?: string;
  stack?: string;
  description?: string;
}

export interface UserPreferences {
  language?: string;            // Preferred programming language
  style?: string;               // "concise" | "detailed explanations" | "step-by-step"
  review_strictness?: string;   // "low" | "medium" | "high"
  timezone?: string;
  expertise?: string;           // "junior" | "mid" | "senior" | "principal"
  [key: string]: string | undefined;
}

export interface UserProfile {
  name?: string;
  role?: string;
  email?: string;
  company?: string;
  preferences?: UserPreferences;
  projects?: ProjectEntry[];
  custom_instructions?: string; // free-form instructions injected verbatim
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA ?? os.homedir(), 'knowcap-code')
  : path.join(os.homedir(), '.knowcap-code');

const PROFILE_FILE = path.join(CONFIG_DIR, 'profile.yaml');

// ─── ProfileManager ───────────────────────────────────────────────────────────

export class ProfileManager {
  private profile: UserProfile = {};

  constructor() {
    this.profile = ProfileManager.load();
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  get(): UserProfile { return this.profile; }

  isEmpty(): boolean {
    return Object.keys(this.profile).length === 0;
  }

  getName(): string | undefined { return this.profile.name; }
  getRole(): string | undefined { return this.profile.role; }

  getPreference(key: keyof UserPreferences): string | undefined {
    return this.profile.preferences?.[key];
  }

  /** Find a project by name or by matching cwd */
  getProjectForCwd(cwd: string): ProjectEntry | undefined {
    if (!this.profile.projects?.length) return undefined;
    return this.profile.projects.find(p => {
      if (!p.path) return false;
      const expanded = p.path.replace(/^~/, os.homedir());
      return cwd.startsWith(expanded) || path.resolve(expanded) === cwd;
    });
  }

  // ── System Prompt Injection ────────────────────────────────────────────────

  /**
   * Build the identity block injected into system prompt.
   * Only includes non-empty fields.
   */
  buildSystemBlock(cwd?: string): string {
    if (this.isEmpty()) return '';

    const p = this.profile;
    const lines: string[] = ['## User Identity'];

    if (p.name) lines.push(`- **Name:** ${p.name}`);
    if (p.role) lines.push(`- **Role:** ${p.role}`);
    if (p.company) lines.push(`- **Company:** ${p.company}`);

    if (p.preferences && Object.keys(p.preferences).length > 0) {
      lines.push('\n### Preferences');
      const prefs = p.preferences;
      if (prefs.language) lines.push(`- **Preferred language:** ${prefs.language}`);
      if (prefs.style) lines.push(`- **Response style:** ${prefs.style}`);
      if (prefs.expertise) lines.push(`- **Expertise level:** ${prefs.expertise} — calibrate explanations accordingly`);
      if (prefs.review_strictness) lines.push(`- **Code review strictness:** ${prefs.review_strictness}`);
      // Any other prefs
      for (const [k, v] of Object.entries(prefs)) {
        if (!['language', 'style', 'expertise', 'review_strictness'].includes(k) && v) {
          lines.push(`- **${k.replace(/_/g, ' ')}:** ${v}`);
        }
      }
    }

    // Active project (by cwd match)
    const proj = cwd ? this.getProjectForCwd(cwd) : undefined;
    if (proj) {
      lines.push(`\n### Active Project: ${proj.name}`);
      if (proj.stack) lines.push(`- **Stack:** ${proj.stack}`);
      if (proj.description) lines.push(`- ${proj.description}`);
    } else if (p.projects?.length) {
      lines.push(`\n### Known Projects`);
      for (const proj of p.projects.slice(0, 5)) {
        const stack = proj.stack ? ` (${proj.stack})` : '';
        lines.push(`- **${proj.name}**${stack}`);
      }
    }

    if (p.custom_instructions) {
      lines.push('\n### Custom Instructions');
      lines.push(p.custom_instructions.trim());
    }

    return '\n' + lines.join('\n') + '\n';
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  set(update: Partial<UserProfile>): void {
    this.profile = deepMerge(this.profile, update);
    this.save();
  }

  setPreference(key: string, value: string): void {
    this.profile.preferences = this.profile.preferences ?? {};
    this.profile.preferences[key] = value;
    this.save();
  }

  addProject(proj: ProjectEntry): void {
    this.profile.projects = this.profile.projects ?? [];
    const idx = this.profile.projects.findIndex(p => p.name === proj.name);
    if (idx >= 0) {
      this.profile.projects[idx] = proj;
    } else {
      this.profile.projects.push(proj);
    }
    this.save();
  }

  private save(): void {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(PROFILE_FILE, yaml.stringify(this.profile), 'utf-8');
  }

  // ── Static ─────────────────────────────────────────────────────────────────

  static load(): UserProfile {
    if (!fs.existsSync(PROFILE_FILE)) return {};
    try {
      const raw = fs.readFileSync(PROFILE_FILE, 'utf-8');
      return (yaml.parse(raw) ?? {}) as UserProfile;
    } catch { return {}; }
  }

  static profilePath(): string { return PROFILE_FILE; }

  static createDefault(name: string, role?: string): void {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const profile: UserProfile = {
      name,
      ...(role ? { role } : {}),
      preferences: {
        language: 'TypeScript',
        style: 'concise',
        expertise: 'senior',
        review_strictness: 'medium',
      },
    };
    fs.writeFileSync(PROFILE_FILE, yaml.stringify(profile), 'utf-8');
  }

  /** Format profile for terminal display */
  format(): string {
    if (this.isEmpty()) {
      return [
        '',
        '  No profile configured.',
        `  Profile file: ${PROFILE_FILE}`,
        '',
        '  Create one with: /profile set name "Your Name"',
        '  Or edit directly: ' + PROFILE_FILE,
        '',
        '  Example:',
        '    name: "Your Name"',
        '    role: "Full-Stack Developer"',
        '    preferences:',
        '      language: TypeScript',
        '      style: concise',
        '      expertise: senior',
        '',
      ].join('\n');
    }

    const p = this.profile;
    const lines: string[] = [''];
    if (p.name) lines.push(`  👤  Name:    ${p.name}`);
    if (p.role) lines.push(`  💼  Role:    ${p.role}`);
    if (p.company) lines.push(`  🏢  Company: ${p.company}`);
    if (p.email) lines.push(`  📧  Email:   ${p.email}`);

    if (p.preferences && Object.keys(p.preferences).length > 0) {
      lines.push('');
      lines.push('  Preferences:');
      for (const [k, v] of Object.entries(p.preferences)) {
        if (v) lines.push(`    ${k.padEnd(22)} ${v}`);
      }
    }

    if (p.projects?.length) {
      lines.push('');
      lines.push('  Projects:');
      for (const proj of p.projects) {
        const stack = proj.stack ? ` — ${proj.stack}` : '';
        lines.push(`    ${proj.name}${stack}`);
      }
    }

    if (p.custom_instructions) {
      lines.push('');
      lines.push('  Custom instructions: (set)');
    }

    lines.push(`\n  File: ${PROFILE_FILE}`);
    lines.push('');
    return lines.join('\n');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    const val = source[key];
    if (val !== null && val !== undefined) {
      if (typeof val === 'object' && !Array.isArray(val) && typeof result[key] === 'object') {
        result[key] = deepMerge(result[key] as object, val as object) as T[typeof key];
      } else {
        result[key] = val as T[typeof key];
      }
    }
  }
  return result;
}
