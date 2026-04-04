"use strict";
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
exports.SoulManager = exports.LANGUAGE_DEFS = exports.ROLE_DEFS = void 0;
exports.generateSystemPrompt = generateSystemPrompt;
exports.createSoul = createSoul;
exports.formatSoul = formatSoul;
exports.resolveSoulLanguage = resolveSoulLanguage;
exports.resolveSoulRole = resolveSoulRole;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const index_1 = require("../persona/index");
// ─── Role metadata ─────────────────────────────────────────────────────────────
exports.ROLE_DEFS = {
    coding: {
        label: 'Coding Assistant',
        emoji: '🧑‍💻',
        shortDesc: 'Write, review, and debug code',
        capabilities: [
            '• Write, review, and debug code in any language',
            '• Execute shell commands and scripts',
            '• Read and create files',
            '• Search the web for solutions and docs',
            '• Explain code and architecture decisions',
            '• Git operations and version control',
        ],
        instructions: `You are an expert software engineer. Help with writing, reviewing, and debugging code.
Always read existing code before modifying it.
Prefer clean, readable code over clever tricks.
Run tests or verify logic after making changes when asked.
Use shell tools to investigate before answering uncertain questions.`,
    },
    research: {
        label: 'Research Assistant',
        emoji: '📚',
        shortDesc: 'Search, analyze, and summarize',
        capabilities: [
            '• Search the web for current information',
            '• Fetch and analyze web pages',
            '• Summarize articles and documents',
            '• Fact-check claims with sources',
            '• Compare options and make recommendations',
            '• Save research notes to memory',
        ],
        instructions: `You are a thorough research assistant. Always search the web to get current, accurate information.
Cite your sources. Summarize clearly and concisely.
When comparing options, give pros/cons with concrete data.
Save important findings to memory for future reference.`,
    },
    general: {
        label: 'General AI',
        emoji: '🤖',
        shortDesc: 'Chat, answer questions, help with anything',
        capabilities: [
            '• Answer questions on any topic',
            '• Search the web when needed',
            '• Help with writing and editing',
            '• Solve problems step by step',
            '• Remember context across conversations',
            '• Execute commands when needed',
        ],
        instructions: `You are a helpful general-purpose AI assistant.
Answer questions thoroughly but concisely.
Use tools to get fresh information when knowledge may be outdated.
Be conversational and friendly.`,
    },
    devops: {
        label: 'DevOps Bot',
        emoji: '🛠️',
        shortDesc: 'Server management, deployment, monitoring',
        capabilities: [
            '• Run shell commands and scripts',
            '• Manage files and directories',
            '• Analyze logs and system output',
            '• Help with Docker, CI/CD, cloud platforms',
            '• Monitor system resources',
            '• Write deployment configs and scripts',
        ],
        instructions: `You are a DevOps and infrastructure expert.
Help with server management, deployments, CI/CD pipelines, and cloud platforms.
Always verify commands are safe before running them.
Explain what each command does before executing.
Focus on reliability, security, and automation.`,
    },
    data: {
        label: 'Data Analyst',
        emoji: '📊',
        shortDesc: 'Excel, charts, data processing',
        capabilities: [
            '• Analyze data files (CSV, Excel, JSON)',
            '• Write data processing scripts',
            '• Generate statistics and summaries',
            '• Create charts and visualizations',
            '• SQL queries and database analysis',
            '• Clean and transform datasets',
        ],
        instructions: `You are a data analyst expert.
Help with data analysis, visualization, and processing.
Write clean Python/SQL for data tasks.
Always describe what the data shows, not just the numbers.
Suggest the best visualization for each use case.`,
    },
    creative: {
        label: 'Creative Assistant',
        emoji: '🎨',
        shortDesc: 'Writing, brainstorming, content creation',
        capabilities: [
            '• Write and edit content (blogs, emails, docs)',
            '• Brainstorm ideas and concepts',
            '• Create structured outlines',
            '• Generate marketing copy',
            '• Suggest improvements to writing',
            '• Search for inspiration and references',
        ],
        instructions: `You are a creative writing and content assistant.
Help with writing, editing, brainstorming, and content creation.
Match the user's tone and style.
Be creative and suggest unexpected angles.
Focus on clarity, engagement, and impact.`,
    },
    custom: {
        label: 'Custom Role',
        emoji: '⚙️',
        shortDesc: 'Your custom role',
        capabilities: [
            '• Tailored to your specific needs',
            '• Full access to all tools',
            '• Custom personality and instructions',
        ],
        instructions: '',
    },
};
// ─── Language display metadata ─────────────────────────────────────────────────
exports.LANGUAGE_DEFS = {
    english: { label: 'English', flag: '🇬🇧' },
    egyptian: { label: 'Egyptian Arabic (عامية)', flag: '🇪🇬' },
    franco: { label: 'Franco/Arabizi (3araby)', flag: '🔤' },
    arabic: { label: 'Arabic (فصحى)', flag: '🇸🇦' },
    saudi: { label: 'Saudi Arabic', flag: '🇸🇦' },
    moroccan: { label: 'Moroccan Darija', flag: '🇲🇦' },
    french: { label: 'French', flag: '🇫🇷' },
    spanish: { label: 'Spanish', flag: '🇪🇸' },
    german: { label: 'German', flag: '🇩🇪' },
    turkish: { label: 'Turkish', flag: '🇹🇷' },
    portuguese: { label: 'Portuguese', flag: '🇧🇷' },
    auto: { label: 'Auto-detect', flag: '🌍' },
};
// ─── System prompt generator ───────────────────────────────────────────────────
function generateSystemPrompt(soul) {
    const roleDef = exports.ROLE_DEFS[soul.role];
    const roleLabel = soul.role === 'custom' && soul.customRole
        ? soul.customRole
        : roleDef.label;
    const emojiNote = soul.emoji
        ? "Use emojis naturally to enhance friendliness, but don't overdo it."
        : 'Do not use emojis in your responses.';
    const verbosityNote = soul.verbosity === 'concise' ? 'Be concise and direct. No fluff, no padding.' :
        soul.verbosity === 'detailed' ? 'Be thorough and detailed in your explanations.' :
            'Balance brevity with completeness — give enough detail to be useful.';
    const capabilities = soul.capabilities.join('\n');
    // Language prompt from persona system
    const langPersonaId = (0, index_1.resolvePersonaId)(soul.language === 'arabic' ? 'egyptian' : soul.language);
    const langPersona = index_1.BUILTIN_PERSONAS.find(p => p.id === langPersonaId);
    const languageBlock = langPersona && langPersona.id !== 'english'
        ? `\n\n## Language & Communication Style\n${langPersona.systemPrompt}`
        : soul.language === 'auto'
            ? `\n\n## Language Detection\nDetect the user's language from their messages and respond in the same language. If they write Franco/Arabizi (3araby), respond in Franco. If Arabic script, respond in Arabic. Match their exact style.`
            : '';
    const roleInstructions = soul.role === 'custom' && soul.customRole
        ? `You are a ${soul.customRole} assistant. Help with everything related to ${soul.customRole}.`
        : roleDef.instructions;
    return `You are ${soul.botName}, a ${roleLabel} assistant for ${soul.userName}.

## Your Capabilities
${capabilities}

## Response Style
- ${emojiNote}
- ${verbosityNote}
- Address the user as "${soul.userName}".

## Your Role
${roleInstructions}${languageBlock}`;
}
// ─── Soul factory ──────────────────────────────────────────────────────────────
function createSoul(params) {
    const roleDef = exports.ROLE_DEFS[params.role];
    const now = new Date().toISOString();
    const soul = {
        botName: params.botName || 'coderaw',
        userName: params.userName || 'friend',
        role: params.role,
        customRole: params.customRole,
        language: params.language,
        personality: 'friendly',
        emoji: true,
        verbosity: 'balanced',
        capabilities: roleDef.capabilities,
        systemPrompt: '',
        createdAt: now,
        updatedAt: now,
    };
    soul.systemPrompt = generateSystemPrompt(soul);
    return soul;
}
// ─── SoulManager ──────────────────────────────────────────────────────────────
class SoulManager {
    constructor() {
        this.pendingOnboarding = new Map();
        this.soulsDir = path.join(os.homedir(), '.coderaw', 'souls');
        fs.mkdirSync(this.soulsDir, { recursive: true });
    }
    // ── Soul CRUD ──────────────────────────────────────────────────────────────
    hasSoul(userId) {
        return fs.existsSync(this.soulPath(userId));
    }
    getSoul(userId) {
        const p = this.soulPath(userId);
        if (!fs.existsSync(p))
            return null;
        try {
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
        }
        catch {
            return null;
        }
    }
    saveSoul(userId, soul) {
        soul.updatedAt = new Date().toISOString();
        soul.systemPrompt = generateSystemPrompt(soul);
        fs.writeFileSync(this.soulPath(userId), JSON.stringify(soul, null, 2), 'utf-8');
    }
    updateSoul(userId, patch) {
        const soul = this.getSoul(userId);
        if (!soul)
            return null;
        const updated = { ...soul, ...patch };
        updated.systemPrompt = generateSystemPrompt(updated);
        this.saveSoul(userId, updated);
        return updated;
    }
    deleteSoul(userId) {
        const p = this.soulPath(userId);
        if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            return true;
        }
        return false;
    }
    // ── Onboarding state ───────────────────────────────────────────────────────
    isOnboarding(userId) {
        return this.pendingOnboarding.has(userId);
    }
    getOnboardingState(userId) {
        return this.pendingOnboarding.get(userId) ?? null;
    }
    startOnboarding(userId) {
        const state = { step: 'ask_name', data: {} };
        this.pendingOnboarding.set(userId, state);
        return state;
    }
    advanceOnboarding(userId, update, nextStep) {
        const current = this.pendingOnboarding.get(userId) ?? { step: 'ask_name', data: {} };
        const next = {
            step: nextStep,
            data: { ...current.data, ...update },
        };
        this.pendingOnboarding.set(userId, next);
        return next;
    }
    completeOnboarding(userId) {
        const state = this.pendingOnboarding.get(userId);
        if (!state)
            return null;
        this.pendingOnboarding.delete(userId);
        const soul = createSoul({
            botName: state.data.botName || 'coderaw',
            userName: state.data.userName || 'friend',
            role: state.data.role || 'general',
            customRole: state.data.customRole,
            language: state.data.language || 'english',
        });
        this.saveSoul(userId, soul);
        return soul;
    }
    cancelOnboarding(userId) {
        this.pendingOnboarding.delete(userId);
    }
    // ── Path ───────────────────────────────────────────────────────────────────
    soulPath(userId) {
        return path.join(this.soulsDir, `${userId}.json`);
    }
}
exports.SoulManager = SoulManager;
// ─── Helpers ───────────────────────────────────────────────────────────────────
/** Format a soul for display */
function formatSoul(soul) {
    const roleDef = exports.ROLE_DEFS[soul.role];
    const langDef = exports.LANGUAGE_DEFS[soul.language];
    const roleLabel = soul.role === 'custom' && soul.customRole
        ? soul.customRole
        : `${roleDef.emoji} ${roleDef.label}`;
    return `<b>🪬 Bot Soul Config</b>

<b>Bot name:</b> ${soul.botName}
<b>Your name:</b> ${soul.userName}
<b>Role:</b> ${roleLabel}
<b>Language:</b> ${langDef.flag} ${langDef.label}
<b>Emoji:</b> ${soul.emoji ? '✅ On' : '❌ Off'}
<b>Verbosity:</b> ${soul.verbosity}
<b>Created:</b> ${new Date(soul.createdAt).toLocaleDateString()}

<i>Use /name, /role, /language to change settings.</i>`;
}
/** Resolve a user-typed language string to a SoulLanguage */
function resolveSoulLanguage(input) {
    const aliases = {
        'en': 'english', 'english': 'english',
        'ar': 'arabic', 'arabic': 'arabic', 'fusha': 'arabic',
        'eg': 'egyptian', 'egyptian': 'egyptian', 'amiya': 'egyptian', 'masri': 'egyptian',
        'franco': 'franco', 'arabizi': 'franco', 'franko': 'franco', '3araby': 'franco',
        'sa': 'saudi', 'saudi': 'saudi', 'gulf': 'saudi',
        'ma': 'moroccan', 'moroccan': 'moroccan', 'darija': 'moroccan',
        'fr': 'french', 'french': 'french',
        'es': 'spanish', 'spanish': 'spanish',
        'de': 'german', 'german': 'german',
        'tr': 'turkish', 'turkish': 'turkish',
        'pt': 'portuguese', 'portuguese': 'portuguese',
        'auto': 'auto', 'detect': 'auto', 'auto-detect': 'auto',
    };
    return aliases[input.toLowerCase().trim()] ?? null;
}
/** Resolve a user-typed role string to a SoulRole */
function resolveSoulRole(input) {
    const aliases = {
        'coding': 'coding', 'code': 'coding', 'developer': 'coding', 'dev': 'coding', 'programmer': 'coding',
        'research': 'research', 'researcher': 'research',
        'general': 'general', 'chat': 'general', 'assistant': 'general',
        'devops': 'devops', 'ops': 'devops', 'infrastructure': 'devops', 'server': 'devops',
        'data': 'data', 'analyst': 'data', 'analytics': 'data',
        'creative': 'creative', 'writing': 'creative', 'writer': 'creative', 'content': 'creative',
        'custom': 'custom',
    };
    return aliases[input.toLowerCase().trim()] ?? null;
}
//# sourceMappingURL=soul.js.map