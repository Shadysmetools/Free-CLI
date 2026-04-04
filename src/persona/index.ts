/**
 * Persona & Dialect System
 *
 * Lets the user switch the AI's response language/style on the fly.
 * Personas are injected into the system prompt each turn.
 *
 * Built-ins cover Arabic dialects, Franco-Arab (Arabizi), and major world languages.
 * Custom personas are stored in ~/.knowcap-code/personas/<name>.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Persona {
  id: string;
  name: string;
  nativeName?: string;   // e.g. "عامية مصرية"
  language: string;      // BCP-47 or custom tag
  flag?: string;         // emoji flag
  systemPrompt: string;
  source: 'builtin' | 'custom';
}

// ─── Built-in Personas ────────────────────────────────────────────────────────

export const BUILTIN_PERSONAS: Persona[] = [
  {
    id: 'english',
    name: 'English',
    nativeName: 'English',
    language: 'en',
    flag: '🇬🇧',
    source: 'builtin',
    systemPrompt: 'Respond in clear, professional English. This is the default language.',
  },
  {
    id: 'egyptian',
    name: 'Egyptian Arabic',
    nativeName: 'عامية مصرية',
    language: 'ar-EG',
    flag: '🇪🇬',
    source: 'builtin',
    systemPrompt: `Respond exclusively in Egyptian Arabic dialect (عامية مصرية).
Use authentic Egyptian colloquial expressions, not Modern Standard Arabic (فصحى).
Examples of style:
- "ايه الموضوع؟" not "ما هو الأمر؟"
- "هعمل" not "سأفعل"
- "معنديش مشكلة" not "لا مشكلة لدي"
- "بقى" as a filler, "يعني" for "like/meaning", "خلاص" for "ok/done"
When writing code comments or identifiers, use English as usual.
Keep technical terms (function, API, endpoint, etc.) in English.`,
  },
  {
    id: 'franco',
    name: 'Franco-Arab (Arabizi)',
    nativeName: 'فرانكو عربي',
    language: 'ar-franco',
    flag: '🔤',
    source: 'builtin',
    systemPrompt: `Respond in Franco-Arab (Arabizi / فرانكو عربي) — write Arabic phonetically using Latin letters and numbers.

Number substitutions (mandatory):
  2 = ء / أ  (glottal stop / hamza)
  3 = ع  (ayin)
  5 = خ  (kha)
  6 = ط  (taa)
  7 = ح  (ha)
  8 = غ  (ghayn)
  9 = ق  (qaf)

Style: casual Egyptian Franco. Conversational, helpful, friendly.

Examples:
  "7ader, ha3melak el API dah."          (حاضر، هعملك الـ API ده)
  "A7san 7aga n3melha keda."            (أحسن حاجة نعملها كده)
  "3andi fekra a7san — n7ot middleware." (عندي فكرة أحسن — نحط middleware)
  "El code dah mesh sha8'al, 5alena n3dlo." (الكود ده مش شغال، خلينا نعدله)
  "Law 3ayez performance a7san, 3'ayyar da." (لو عايز performance أحسن، غير ده)

Keep code, variable names, and technical terms in English as always.
Mix English tech terms naturally: "el function di bt3mel X", "el API byt3'aza".`,
  },
  {
    id: 'saudi',
    name: 'Saudi Arabic',
    nativeName: 'اللهجة السعودية',
    language: 'ar-SA',
    flag: '🇸🇦',
    source: 'builtin',
    systemPrompt: `Respond in Saudi Arabic dialect (لهجة سعودية / نجدية أو حجازية).
Use authentic Gulf-Saudi expressions:
- "وش الموضوع؟" not "ما الأمر؟"
- "بسوي" not "سأفعل" or "هعمل"
- "زين" for "good/ok", "عاد" as a filler, "والله" for emphasis
- "ماعندي مشكلة", "كيف حالك يا صديقي"
Keep technical terms and code in English.`,
  },
  {
    id: 'moroccan',
    name: 'Moroccan Darija',
    nativeName: 'الدارجة المغربية',
    language: 'ar-MA',
    flag: '🇲🇦',
    source: 'builtin',
    systemPrompt: `Respond in Moroccan Darija (الدارجة المغربية).
Use authentic Moroccan expressions mixed with French loanwords as naturally spoken:
- "كيداير / labas" for greetings
- "واخا" for ok/agreed, "زعما" for "like/apparently"
- "بغيت" not "أريد", "كنعمل" not "أفعل"
- Mix French tech terms naturally (e.g. "le function", "la base de données")
Keep code identifiers in English.`,
  },
  {
    id: 'french',
    name: 'French',
    nativeName: 'Français',
    language: 'fr',
    flag: '🇫🇷',
    source: 'builtin',
    systemPrompt: `Répondez en français naturel et professionnel.
Utilisez le vouvoiement par défaut. Adaptez le registre selon le contexte.
Pour les termes techniques (function, API, endpoint, etc.), gardez l'anglais.
Exemple : "Je vais créer une fonction pour l'authentification."`,
  },
  {
    id: 'spanish',
    name: 'Spanish',
    nativeName: 'Español',
    language: 'es',
    flag: '🇪🇸',
    source: 'builtin',
    systemPrompt: `Responde en español claro y profesional.
Usa un tono amigable y natural. Mantén los términos técnicos en inglés.
Ejemplo: "Voy a crear una función para la autenticación."`,
  },
  {
    id: 'german',
    name: 'German',
    nativeName: 'Deutsch',
    language: 'de',
    flag: '🇩🇪',
    source: 'builtin',
    systemPrompt: `Antworte auf Deutsch in klarer, professioneller Sprache.
Verwende höfliche Sie-Form standardmäßig. Technische Begriffe bleiben auf Englisch.
Beispiel: "Ich erstelle eine Funktion für die Authentifizierung."`,
  },
  {
    id: 'portuguese',
    name: 'Portuguese',
    nativeName: 'Português',
    language: 'pt',
    flag: '🇧🇷',
    source: 'builtin',
    systemPrompt: `Responda em português brasileiro claro e profissional.
Use um tom amigável e natural. Mantenha termos técnicos em inglês.`,
  },
  {
    id: 'turkish',
    name: 'Turkish',
    nativeName: 'Türkçe',
    language: 'tr',
    flag: '🇹🇷',
    source: 'builtin',
    systemPrompt: `Türkçe, açık ve profesyonel bir dilde yanıt verin.
Teknik terimleri İngilizce olarak koruyun. Örnek: "Kimlik doğrulama için bir fonksiyon oluşturacağım."`,
  },
];

// ─── Paths ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA ?? os.homedir(), 'knowcap-code')
  : path.join(os.homedir(), '.knowcap-code');

const PERSONAS_DIR = path.join(CONFIG_DIR, 'personas');
const ACTIVE_FILE = path.join(CONFIG_DIR, 'active-persona.txt');

// ─── PersonaManager ───────────────────────────────────────────────────────────

export class PersonaManager {
  private all: Map<string, Persona> = new Map();
  private activeId: string = 'english';

  constructor() {
    // Load builtins
    for (const p of BUILTIN_PERSONAS) {
      this.all.set(p.id, p);
    }
    // Load custom personas from disk
    this.loadCustom();
    // Restore last active
    this.activeId = this.loadActiveId();
  }

  // ── Active persona ─────────────────────────────────────────────────────────

  getActive(): Persona {
    return this.all.get(this.activeId) ?? this.all.get('english')!;
  }

  setActive(id: string): Persona | null {
    const persona = this.find(id);
    if (!persona) return null;
    this.activeId = persona.id;
    this.saveActiveId(persona.id);
    return persona;
  }

  isDefault(): boolean {
    return this.activeId === 'english';
  }

  /** Return system-prompt injection block for current persona */
  buildSystemBlock(): string {
    const p = this.getActive();
    if (p.id === 'english') return ''; // default — no injection needed
    return `\n## Active Language / Persona: ${p.name}${p.nativeName ? ` (${p.nativeName})` : ''}\n${p.systemPrompt}\n`;
  }

  // ── List / Find ────────────────────────────────────────────────────────────

  list(): Persona[] {
    return Array.from(this.all.values());
  }

  find(query: string): Persona | undefined {
    const q = query.toLowerCase().trim();
    // Exact id match
    if (this.all.has(q)) return this.all.get(q);
    // Partial id / name match
    for (const p of this.all.values()) {
      if (p.id.startsWith(q) || p.name.toLowerCase().includes(q) ||
          (p.nativeName && p.nativeName.includes(query))) {
        return p;
      }
    }
    // Language code match
    for (const p of this.all.values()) {
      if (p.language.toLowerCase().startsWith(q)) return p;
    }
    return undefined;
  }

  // ── Custom Persona CRUD ────────────────────────────────────────────────────

  createCustom(id: string, name: string, language: string, systemPrompt: string, flag?: string): Persona {
    if (!fs.existsSync(PERSONAS_DIR)) fs.mkdirSync(PERSONAS_DIR, { recursive: true });

    const persona: Persona = {
      id: id.toLowerCase().replace(/\s+/g, '-'),
      name,
      language,
      flag: flag ?? '🌐',
      systemPrompt,
      source: 'custom',
    };

    const filePath = path.join(PERSONAS_DIR, `${persona.id}.yaml`);
    fs.writeFileSync(filePath, yaml.stringify({
      name, language, flag: persona.flag, system_prompt: systemPrompt,
    }), 'utf-8');

    this.all.set(persona.id, persona);
    return persona;
  }

  deleteCustom(id: string): boolean {
    const persona = this.all.get(id);
    if (!persona || persona.source !== 'custom') return false;
    const filePath = path.join(PERSONAS_DIR, `${id}.yaml`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    this.all.delete(id);
    if (this.activeId === id) {
      this.activeId = 'english';
      this.saveActiveId('english');
    }
    return true;
  }

  // ── Format for display ─────────────────────────────────────────────────────

  formatList(): string {
    const lines: string[] = [''];
    const active = this.getActive();

    const builtins = this.list().filter(p => p.source === 'builtin');
    const customs = this.list().filter(p => p.source === 'custom');

    lines.push('  Built-in personas:');
    for (const p of builtins) {
      const isCurrent = p.id === active.id;
      const marker = isCurrent ? chalk.green(' ← active') : '';
      const native = p.nativeName ? chalk.dim(` (${p.nativeName})`) : '';
      const flag = p.flag ?? '  ';
      lines.push(`  ${flag}  ${chalk.bold(p.id.padEnd(12))} ${p.name}${native}${marker}`);
    }

    if (customs.length > 0) {
      lines.push('');
      lines.push('  Custom personas:');
      for (const p of customs) {
        const isCurrent = p.id === active.id;
        const marker = isCurrent ? chalk.green(' ← active') : '';
        lines.push(`  🌐  ${chalk.bold(p.id.padEnd(12))} ${p.name}${marker}`);
      }
    }

    lines.push('');
    lines.push(`  Usage: /persona set <id>  |  /persona create <id> <name> <lang>`);
    lines.push('');
    return lines.join('\n');
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private loadCustom(): void {
    if (!fs.existsSync(PERSONAS_DIR)) return;
    try {
      const files = fs.readdirSync(PERSONAS_DIR).filter(f => f.endsWith('.yaml'));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(PERSONAS_DIR, file), 'utf-8');
          const data = yaml.parse(raw) as {
            name?: string; language?: string; flag?: string; system_prompt?: string;
          };
          const id = path.basename(file, '.yaml');
          if (data.name && data.system_prompt) {
            this.all.set(id, {
              id,
              name: data.name,
              language: data.language ?? 'unknown',
              flag: data.flag ?? '🌐',
              systemPrompt: data.system_prompt,
              source: 'custom',
            });
          }
        } catch { /* skip bad files */ }
      }
    } catch { /* skip */ }
  }

  private loadActiveId(): string {
    try {
      if (fs.existsSync(ACTIVE_FILE)) {
        const id = fs.readFileSync(ACTIVE_FILE, 'utf-8').trim();
        if (this.all.has(id)) return id;
      }
    } catch { /* ignore */ }
    return 'english';
  }

  private saveActiveId(id: string): void {
    try {
      if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(ACTIVE_FILE, id, 'utf-8');
    } catch { /* non-fatal */ }
  }
}

// ─── chalk (re-export for use inside this module) ─────────────────────────────
import chalk from 'chalk';

// ─── Quick language-code → persona-id mapping ─────────────────────────────────

const LANG_ALIASES: Record<string, string> = {
  'en': 'english', 'english': 'english',
  'ar': 'egyptian', 'arabic': 'egyptian',
  'ar-eg': 'egyptian', 'eg': 'egyptian', 'egypt': 'egyptian',
  'ar-sa': 'saudi', 'sa': 'saudi', 'saudi': 'saudi',
  'ar-ma': 'moroccan', 'ma': 'moroccan', 'moroccan': 'moroccan',
  'franco': 'franco', 'arabizi': 'franco', 'franko': 'franco',
  'fr': 'french', 'french': 'french',
  'es': 'spanish', 'spanish': 'spanish',
  'de': 'german', 'german': 'german',
  'pt': 'portuguese', 'portuguese': 'portuguese',
  'tr': 'turkish', 'turkish': 'turkish',
};

export function resolvePersonaId(input: string): string {
  return LANG_ALIASES[input.toLowerCase()] ?? input.toLowerCase();
}
