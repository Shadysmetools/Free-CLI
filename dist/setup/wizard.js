"use strict";
/**
 * First-run setup wizard for knowcap-code
 *
 * Behavior:
 *   1. Auto-detect what's available (Ollama, env vars, saved config)
 *   2. If something works → start immediately, zero config
 *   3. If nothing works → show interactive guided setup, save result
 *
 * Re-run: `kcc setup` or `kcc --setup`
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSetupComplete = isSetupComplete;
exports.autoDetectProvider = autoDetectProvider;
exports.silentAutoDetect = silentAutoDetect;
exports.runSetupWizard = runSetupWizard;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const http = __importStar(require("http"));
const os = __importStar(require("os"));
const chalk_1 = __importDefault(require("chalk"));
const settings_1 = require("../config/settings");
const CONFIG_DIR = process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? os.homedir(), 'knowcap-code')
    : path.join(os.homedir(), '.knowcap-code');
const SETUP_DONE_FILE = path.join(CONFIG_DIR, '.setup-complete');
async function detectOllama(baseUrl = 'http://localhost:11434') {
    return new Promise(resolve => {
        const req = http.get(`${baseUrl}/api/tags`, { timeout: 2000 }, res => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const models = (json.models ?? []).map(m => m.name);
                    resolve({ available: true, models });
                }
                catch {
                    resolve({ available: false, models: [] });
                }
            });
        });
        req.on('error', () => resolve({ available: false, models: [] }));
        req.on('timeout', () => { req.destroy(); resolve({ available: false, models: [] }); });
    });
}
async function detectProviders() {
    const results = [];
    // Ollama
    const ollama = await detectOllama();
    const ollamaModel = ollama.models.find(m => m.includes('qwen') || m.includes('llama') || m.includes('coder')) ?? ollama.models[0];
    results.push({
        id: 'ollama',
        label: 'Ollama (local, free)',
        available: ollama.available,
        free: true,
        model: ollamaModel,
        reason: ollama.available
            ? (ollamaModel ? `${ollamaModel} ready` : 'running but no models installed')
            : 'not running on localhost:11434',
    });
    // Groq
    const groqKey = process.env.GROQ_API_KEY;
    results.push({
        id: 'groq',
        label: 'Groq (free cloud, fast)',
        available: !!groqKey,
        free: true,
        model: 'llama-3.3-70b-versatile',
        reason: groqKey ? 'GROQ_API_KEY found' : 'no GROQ_API_KEY set',
    });
    // Google
    const googleKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    results.push({
        id: 'google',
        label: 'Google Gemini (free tier)',
        available: !!googleKey,
        free: true,
        model: 'gemini-2.5-flash',
        reason: googleKey ? 'GOOGLE_API_KEY found' : 'no GOOGLE_API_KEY set',
    });
    // Anthropic
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    results.push({
        id: 'anthropic',
        label: 'Anthropic Claude (BYOK)',
        available: !!anthropicKey,
        free: false,
        model: 'claude-3-5-haiku-20241022',
        reason: anthropicKey ? 'ANTHROPIC_API_KEY found' : 'no ANTHROPIC_API_KEY set',
    });
    // OpenAI
    const openaiKey = process.env.OPENAI_API_KEY;
    results.push({
        id: 'openai',
        label: 'OpenAI GPT (BYOK)',
        available: !!openaiKey,
        free: false,
        model: 'gpt-4o-mini',
        reason: openaiKey ? 'OPENAI_API_KEY found' : 'no OPENAI_API_KEY set',
    });
    return results;
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Returns true if setup has been completed and a provider is configured.
 */
function isSetupComplete() {
    if (!fs.existsSync(SETUP_DONE_FILE))
        return false;
    const settings = (0, settings_1.loadSettings)();
    // Check if at least one provider can work
    const prov = settings.defaultProvider;
    if (prov === 'ollama')
        return true; // Always attempt ollama
    const apiKey = settings.providers[prov]?.apiKey;
    return !!apiKey;
}
/**
 * Auto-detect: pick the best available provider without asking anything.
 * Returns the provider id to use, or null if nothing works.
 */
async function autoDetectProvider() {
    const detected = await detectProviders();
    const working = detected.filter(d => d.available && d.model);
    if (working.length === 0)
        return null;
    // Priority: ollama (local free) > groq (fast free) > google > anthropic > openai
    const priority = ['ollama', 'groq', 'google', 'anthropic', 'openai'];
    for (const id of priority) {
        const match = working.find(d => d.id === id);
        if (match?.model)
            return { provider: match.id, model: match.model };
    }
    return null;
}
/**
 * Silent startup: auto-detect, print one info line, return chosen provider.
 * Called at every startup when setup is already complete.
 */
async function silentAutoDetect() {
    const settings = (0, settings_1.loadSettings)();
    const prov = settings.defaultProvider;
    // If non-ollama provider is configured with a key, use it silently
    if (prov !== 'ollama' && settings.providers[prov]?.apiKey) {
        return { provider: prov, model: settings.providers[prov].model ?? '' };
    }
    // Try Ollama
    const ollama = await detectOllama(settings.providers.ollama?.baseUrl ?? 'http://localhost:11434');
    if (ollama.available && ollama.models.length > 0) {
        const preferredModel = settings.providers.ollama?.model ?? '';
        const model = ollama.models.find(m => m === preferredModel) ?? ollama.models[0];
        return { provider: 'ollama', model };
    }
    return null;
}
/**
 * Run the interactive first-run setup wizard.
 */
async function runSetupWizard(force = false) {
    if (!force && isSetupComplete())
        return;
    console.log(`
${chalk_1.default.cyan('┌─────────────────────────────────────────────┐')}
${chalk_1.default.cyan('│')}  ${chalk_1.default.bold.cyan('⚡ Welcome to knowcap-code!')}                 ${chalk_1.default.cyan('│')}
${chalk_1.default.cyan('│')}  ${chalk_1.default.dim('Free AI Coding Assistant — Claude Code alt')}  ${chalk_1.default.cyan('│')}
${chalk_1.default.cyan('└─────────────────────────────────────────────┘')}
`);
    console.log(chalk_1.default.bold('🔍 Detecting AI providers...\n'));
    const detected = await detectProviders();
    for (const p of detected) {
        const icon = p.available ? chalk_1.default.green('  ✅') : chalk_1.default.red('  ❌');
        const label = p.available ? chalk_1.default.green(p.label) : chalk_1.default.dim(p.label);
        const reason = chalk_1.default.dim(` — ${p.reason}`);
        console.log(`${icon} ${label}${reason}`);
    }
    console.log();
    const working = detected.filter(d => d.available && d.model);
    // ── Something works → use it immediately ─────────────────────────────────
    if (working.length > 0) {
        const best = pickBest(working);
        console.log(chalk_1.default.green(`✅ Ready to go! Using ${chalk_1.default.bold(best.label)} (${best.model})`));
        console.log(chalk_1.default.dim('   Type your first message or /help for commands.\n'));
        const settings = (0, settings_1.loadSettings)();
        settings.defaultProvider = best.id;
        if (best.model)
            settings.providers[best.id] = { ...settings.providers[best.id], model: best.model };
        (0, settings_1.saveSettings)(settings);
        markSetupComplete();
        return;
    }
    // ── Nothing works → guided setup ─────────────────────────────────────────
    console.log(chalk_1.default.yellow('⚠  No AI providers detected. Let\'s set one up!\n'));
    const choice = await showProviderMenu();
    if (choice) {
        const settings = (0, settings_1.loadSettings)();
        settings.defaultProvider = choice.id;
        if (choice.apiKey) {
            settings.providers[choice.id] = settings.providers[choice.id] ?? {};
            settings.providers[choice.id].apiKey = choice.apiKey;
        }
        if (choice.model) {
            settings.providers[choice.id] = settings.providers[choice.id] ?? {};
            settings.providers[choice.id].model = choice.model;
        }
        (0, settings_1.saveSettings)(settings);
        markSetupComplete();
        console.log(chalk_1.default.green(`\n✅ Saved! Using ${choice.id}. Run 'kcc' to start.\n`));
    }
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function pickBest(providers) {
    const priority = ['ollama', 'groq', 'google', 'anthropic', 'openai'];
    for (const id of priority) {
        const match = providers.find(p => p.id === id);
        if (match)
            return match;
    }
    return providers[0];
}
function markSetupComplete() {
    if (!fs.existsSync(CONFIG_DIR))
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(SETUP_DONE_FILE, new Date().toISOString(), 'utf-8');
}
async function showProviderMenu() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));
    try {
        console.log(chalk_1.default.bold('📋 Quick Setup — choose a provider:\n'));
        console.log(`  ${chalk_1.default.cyan('1.')} 🆓 ${chalk_1.default.bold('Ollama')} — local, free, private`);
        console.log(`     ${chalk_1.default.dim('→ Install: curl -fsSL https://ollama.com/install.sh | sh')}`);
        console.log(`     ${chalk_1.default.dim('→ Then: ollama pull qwen2.5-coder:7b')}\n`);
        console.log(`  ${chalk_1.default.cyan('2.')} 🆓 ${chalk_1.default.bold('Groq')} — free cloud, ultra-fast`);
        console.log(`     ${chalk_1.default.dim('→ Get free key: https://console.groq.com')}\n`);
        console.log(`  ${chalk_1.default.cyan('3.')} 🆓 ${chalk_1.default.bold('Google Gemini')} — free tier`);
        console.log(`     ${chalk_1.default.dim('→ Get free key: https://aistudio.google.com')}\n`);
        console.log(`  ${chalk_1.default.cyan('4.')} 💰 ${chalk_1.default.bold('Anthropic Claude')} — BYOK`);
        console.log(`     ${chalk_1.default.dim('→ https://console.anthropic.com')}\n`);
        console.log(`  ${chalk_1.default.cyan('5.')} 💰 ${chalk_1.default.bold('OpenAI GPT')} — BYOK`);
        console.log(`     ${chalk_1.default.dim('→ https://platform.openai.com')}\n`);
        console.log(`  ${chalk_1.default.cyan('6.')} ⏭  ${chalk_1.default.bold('Skip')} — I\'ll configure later\n`);
        const answer = (await ask(chalk_1.default.cyan('  Choice [1]: '))).trim() || '1';
        switch (answer) {
            case '1':
                console.log(chalk_1.default.dim('\n  Install Ollama first, then re-run kcc.'));
                console.log(chalk_1.default.dim('  Quick start: ollama pull qwen2.5-coder:7b && kcc'));
                return { id: 'ollama', model: 'qwen2.5-coder:7b' };
            case '2': {
                const key = (await ask(chalk_1.default.cyan('  Groq API key: '))).trim();
                if (!key) {
                    console.log(chalk_1.default.red('  No key entered.'));
                    return null;
                }
                return { id: 'groq', model: 'llama-3.3-70b-versatile', apiKey: key };
            }
            case '3': {
                const key = (await ask(chalk_1.default.cyan('  Google API key: '))).trim();
                if (!key) {
                    console.log(chalk_1.default.red('  No key entered.'));
                    return null;
                }
                return { id: 'google', model: 'gemini-2.5-flash', apiKey: key };
            }
            case '4': {
                const key = (await ask(chalk_1.default.cyan('  Anthropic API key (sk-ant-...): '))).trim();
                if (!key) {
                    console.log(chalk_1.default.red('  No key entered.'));
                    return null;
                }
                return { id: 'anthropic', model: 'claude-3-5-haiku-20241022', apiKey: key };
            }
            case '5': {
                const key = (await ask(chalk_1.default.cyan('  OpenAI API key (sk-...): '))).trim();
                if (!key) {
                    console.log(chalk_1.default.red('  No key entered.'));
                    return null;
                }
                return { id: 'openai', model: 'gpt-4o-mini', apiKey: key };
            }
            default:
                console.log(chalk_1.default.dim('\n  Skipped. Run "kcc setup" to configure later.'));
                markSetupComplete();
                return null;
        }
    }
    finally {
        rl.close();
    }
}
//# sourceMappingURL=wizard.js.map