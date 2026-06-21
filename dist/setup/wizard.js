"use strict";
/**
 * First-run setup wizard — Gemini CLI-style interactive selection
 * Uses inquirer arrow-key prompts instead of numbered text menus.
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
exports.buildSettingsFromAnswers = buildSettingsFromAnswers;
exports.isFirstRun = isFirstRun;
exports.isSetupComplete = isSetupComplete;
exports.autoDetectProvider = autoDetectProvider;
exports.silentAutoDetect = silentAutoDetect;
exports.runOnboardingWizard = runOnboardingWizard;
exports.runSetupWizard = runSetupWizard;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const http = __importStar(require("http"));
const os = __importStar(require("os"));
const chalk_1 = __importDefault(require("chalk"));
const settings_1 = require("../config/settings");
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const inquirer = require('inquirer');
const CONFIG_DIR = process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? os.homedir(), 'coderaw')
    : path.join(os.homedir(), '.coderaw');
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
    const ollama = await detectOllama();
    const ollamaModel = ollama.models.find(m => m.includes('qwen') || m.includes('llama') || m.includes('coder')) ?? ollama.models[0];
    results.push({
        id: 'ollama', label: 'Ollama (local, free)', available: ollama.available, free: true,
        model: ollamaModel,
        reason: ollama.available
            ? (ollamaModel ? `${ollamaModel} ready` : 'running but no models installed')
            : 'not running on localhost:11434',
    });
    const groqKey = process.env.GROQ_API_KEY;
    results.push({ id: 'groq', label: 'Groq (free cloud, fast)', available: !!groqKey, free: true,
        model: 'llama-3.3-70b-versatile', reason: groqKey ? 'GROQ_API_KEY found' : 'no GROQ_API_KEY' });
    const googleKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    results.push({ id: 'google', label: 'Google Gemini (free tier)', available: !!googleKey, free: true,
        model: 'gemini-2.5-flash', reason: googleKey ? 'GOOGLE_API_KEY found' : 'no GOOGLE_API_KEY' });
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    results.push({ id: 'anthropic', label: 'Anthropic Claude (BYOK)', available: !!anthropicKey, free: false,
        model: 'claude-3-5-haiku-20241022', reason: anthropicKey ? 'ANTHROPIC_API_KEY found' : 'no ANTHROPIC_API_KEY' });
    const openaiKey = process.env.OPENAI_API_KEY;
    results.push({ id: 'openai', label: 'OpenAI GPT (BYOK)', available: !!openaiKey, free: false,
        model: 'gpt-4o-mini', reason: openaiKey ? 'OPENAI_API_KEY found' : 'no OPENAI_API_KEY' });
    const mistralKey = process.env.MISTRAL_API_KEY;
    results.push({ id: 'mistral', label: 'Mistral AI (free tier)', available: !!mistralKey, free: true,
        model: 'devstral-small-latest', reason: mistralKey ? 'MISTRAL_API_KEY found' : 'no MISTRAL_API_KEY' });
    return results;
}
/**
 * Pure mapping: wizard answers → a valid Settings object.
 *
 * Starts from the built-in defaults (so every untouched provider, the ui block,
 * permissions, etc. are preserved) and overlays only what the user chose:
 *   - selects the provider as the default
 *   - places the model on both `defaultModel` and the provider config
 *   - places the api key (cloud/custom) and base URL (custom) on the provider
 *
 * No file or environment reads — fully unit-testable.
 */
function buildSettingsFromAnswers(answers) {
    const settings = (0, settings_1.getDefaultSettings)();
    const { provider } = answers;
    // Ensure the provider config object exists (covers any unknown provider id).
    const current = settings.providers[provider] ?? {};
    const model = answers.model?.trim() || current.model;
    const providerConfig = { ...current };
    if (model)
        providerConfig.model = model;
    if (answers.apiKey && answers.apiKey.trim())
        providerConfig.apiKey = answers.apiKey.trim();
    if (answers.baseUrl && answers.baseUrl.trim())
        providerConfig.baseUrl = answers.baseUrl.trim();
    settings.providers[provider] = providerConfig;
    settings.defaultProvider = provider;
    if (model)
        settings.defaultModel = model;
    return settings;
}
/**
 * True only on a genuine first run — when NO config file exists yet AND the
 * setup-complete marker is absent. Conservative by design: if either artifact
 * is present, an existing user has already configured coderaw and the wizard
 * must NOT fire (it would otherwise overwrite a working %APPDATA%\coderaw setup).
 */
function isFirstRun() {
    const configFile = path.join((0, settings_1.getConfigDir)(), 'config.yaml');
    if (fs.existsSync(configFile))
        return false;
    if (fs.existsSync(SETUP_DONE_FILE))
        return false;
    return true;
}
function isSetupComplete() {
    if (!fs.existsSync(SETUP_DONE_FILE))
        return false;
    const settings = (0, settings_1.loadSettings)();
    const prov = settings.defaultProvider;
    if (prov === 'ollama')
        return true;
    const apiKey = settings.providers[prov]?.apiKey;
    return !!apiKey;
}
async function autoDetectProvider() {
    const detected = await detectProviders();
    const working = detected.filter(d => d.available && d.model);
    if (working.length === 0)
        return null;
    const priority = ['ollama', 'groq', 'google', 'anthropic', 'openai'];
    for (const id of priority) {
        const match = working.find(d => d.id === id);
        if (match?.model)
            return { provider: match.id, model: match.model };
    }
    return null;
}
async function silentAutoDetect() {
    const settings = (0, settings_1.loadSettings)();
    const prov = settings.defaultProvider;
    if (prov !== 'ollama' && settings.providers[prov]?.apiKey) {
        return { provider: prov, model: settings.providers[prov].model ?? '' };
    }
    const ollama = await detectOllama(settings.providers.ollama?.baseUrl ?? 'http://localhost:11434');
    if (ollama.available && ollama.models.length > 0) {
        const preferredModel = settings.providers.ollama?.model ?? '';
        const model = ollama.models.find(m => m === preferredModel) ?? ollama.models[0];
        return { provider: 'ollama', model };
    }
    return null;
}
// ─── First-Run Onboarding Wizard ──────────────────────────────────────────────
//
// A short, friendly, skippable guided flow (Claude-Code style). Local Ollama is
// the default (free/offline). Cloud + custom providers prompt for an API key
// (and base URL for custom). Everything accepts Enter to take the default.
//
// The interactive inquirer prompts are intentionally thin — all the answer→config
// logic lives in the pure `buildSettingsFromAnswers` above.
/** Provider menu metadata: label + default model + whether a key is required. */
const ONBOARD_PROVIDERS = {
    ollama: { label: 'Local — Ollama (free, offline) — recommended', model: 'qwen2.5-coder:7b' },
    anthropic: { label: 'Anthropic Claude (cloud)', model: 'claude-3-5-haiku-20241022', keyUrl: 'https://console.anthropic.com' },
    openai: { label: 'OpenAI GPT (cloud)', model: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com' },
    google: { label: 'Google Gemini (cloud)', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com' },
    groq: { label: 'Groq (cloud, fast)', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com' },
    openrouter: { label: 'OpenRouter (cloud)', model: 'openrouter/free', keyUrl: 'https://openrouter.ai/keys' },
    custom: { label: 'Custom — OpenAI-compatible endpoint', model: 'gpt-4o-mini', keyUrl: '' },
};
/**
 * Friendly first-run onboarding. Collects answers via inquirer, maps them with
 * the pure `buildSettingsFromAnswers`, persists via `saveSettings`, writes the
 * setup-complete marker, prints a confirmation, then returns so the caller can
 * fall through into the normal session.
 */
async function runOnboardingWizard() {
    console.log(`
${chalk_1.default.cyan('┌─────────────────────────────────────────────┐')}
${chalk_1.default.cyan('│')}  ${chalk_1.default.bold.cyan('⚡ Welcome to coderaw!')}                      ${chalk_1.default.cyan('│')}
${chalk_1.default.cyan('│')}  ${chalk_1.default.dim('Let\'s get you set up — takes 30 seconds.')}   ${chalk_1.default.cyan('│')}
${chalk_1.default.cyan('└─────────────────────────────────────────────┘')}
`);
    console.log(chalk_1.default.dim('  Tip: press Enter to accept the [default] at any step.\n'));
    // ── Step 1: provider ────────────────────────────────────────────────────────
    const providerChoices = Object.entries(ONBOARD_PROVIDERS).map(([id, meta]) => ({
        name: meta.label,
        value: id,
    }));
    const { provider } = await inquirer.prompt([{
            type: 'list',
            name: 'provider',
            message: 'Which AI provider would you like to use?',
            choices: providerChoices,
            default: 'ollama',
        }]);
    const meta = ONBOARD_PROVIDERS[provider] ?? ONBOARD_PROVIDERS.ollama;
    const answers = { provider };
    // ── Step 2: base URL (custom only) ──────────────────────────────────────────
    if (provider === 'custom') {
        const { baseUrl } = await inquirer.prompt([{
                type: 'input',
                name: 'baseUrl',
                message: 'Base URL of your OpenAI-compatible endpoint:',
                default: 'http://localhost:8000/v1',
            }]);
        answers.baseUrl = baseUrl.trim();
    }
    // ── Step 3: API key (cloud + custom) ────────────────────────────────────────
    if (provider !== 'ollama') {
        if (meta.keyUrl) {
            console.log(chalk_1.default.dim(`\n  Get an API key at: ${chalk_1.default.cyan(meta.keyUrl)}`));
        }
        const { apiKey } = await inquirer.prompt([{
                type: 'password',
                name: 'apiKey',
                message: `Enter your ${provider.toUpperCase()} API key:`,
                mask: '•',
            }]);
        answers.apiKey = apiKey.trim();
    }
    // ── Step 4: model (confirm/override default) ────────────────────────────────
    const { model } = await inquirer.prompt([{
            type: 'input',
            name: 'model',
            message: 'Which model? (Enter to accept default)',
            default: meta.model,
        }]);
    answers.model = model.trim() || meta.model;
    // ── Persist + mark complete ─────────────────────────────────────────────────
    const settings = buildSettingsFromAnswers(answers);
    (0, settings_1.saveSettings)(settings);
    markSetupComplete();
    console.log(chalk_1.default.green(`\n✅ You're all set! Using ${chalk_1.default.bold(provider)} / ${chalk_1.default.bold(answers.model)}.`));
    if (provider === 'ollama') {
        console.log(chalk_1.default.dim(`  Make sure Ollama is running:  ollama pull ${answers.model} && ollama serve`));
    }
    console.log(chalk_1.default.dim('  Re-run anytime with:  coderaw setup   ·   Type /help for commands.\n'));
}
// ─── Setup Wizard ─────────────────────────────────────────────────────────────
async function runSetupWizard(force = false) {
    if (!force && isSetupComplete())
        return;
    console.log(`
${chalk_1.default.cyan('┌─────────────────────────────────────────────┐')}
${chalk_1.default.cyan('│')}  ${chalk_1.default.bold.cyan('⚡ Welcome to coderaw!')}                 ${chalk_1.default.cyan('│')}
${chalk_1.default.cyan('│')}  ${chalk_1.default.dim('Free AI Coding Assistant — Claude Code alt')}  ${chalk_1.default.cyan('│')}
${chalk_1.default.cyan('└─────────────────────────────────────────────┘')}
`);
    console.log(chalk_1.default.bold('🔍 Detecting AI providers...\n'));
    const detected = await detectProviders();
    for (const p of detected) {
        const icon = p.available ? chalk_1.default.green('  ✅') : chalk_1.default.dim('  ○ ');
        const label = p.available ? chalk_1.default.green(p.label) : chalk_1.default.dim(p.label);
        const reason = chalk_1.default.dim(` — ${p.reason}`);
        console.log(`${icon} ${label}${reason}`);
    }
    console.log();
    const working = detected.filter(d => d.available && d.model);
    // ── Something works → offer to use it or pick another ────────────────────
    if (working.length > 0) {
        const best = pickBest(working);
        const choices = [
            {
                name: `${chalk_1.default.green('✅')} Use ${chalk_1.default.bold(best.label)} ${chalk_1.default.dim(`(${best.model})`)} — ready now`,
                value: 'use-best',
            },
            ...working.filter(p => p.id !== best.id).map(p => ({
                name: `   Use ${p.label} ${chalk_1.default.dim(`(${p.model})`)}`,
                value: `use-${p.id}`,
            })),
            { name: chalk_1.default.dim('   Choose a different provider (requires API key)'), value: 'choose' },
        ];
        const { startChoice } = await inquirer.prompt([{
                type: 'list',
                name: 'startChoice',
                message: 'How would you like to start?',
                choices,
            }]);
        if (startChoice === 'use-best' || startChoice.startsWith('use-')) {
            const chosenId = startChoice === 'use-best' ? best.id : startChoice.replace('use-', '');
            const chosen = working.find(p => p.id === chosenId) ?? best;
            const settings = (0, settings_1.loadSettings)();
            settings.defaultProvider = chosen.id;
            if (chosen.model)
                settings.providers[chosen.id] = { ...settings.providers[chosen.id], model: chosen.model };
            (0, settings_1.saveSettings)(settings);
            markSetupComplete();
            console.log(chalk_1.default.green(`\n✅ Ready! Using ${chalk_1.default.bold(chosen.label)}\n`));
            return;
        }
        // Fall through to "choose" flow
    }
    // ── Interactive provider picker ───────────────────────────────────────────
    const providerChoices = [
        {
            name: `🆓 ${chalk_1.default.bold('OpenRouter')} — free cloud models (no API key needed for some)`,
            value: 'openrouter',
        },
        {
            name: `🆓 ${chalk_1.default.bold('Groq')} — ultra-fast free tier · llama-3.3-70b`,
            value: 'groq',
        },
        {
            name: `🆓 ${chalk_1.default.bold('Google Gemini')} — free tier · gemini-2.5-flash`,
            value: 'google',
        },
        {
            name: `🖥️  ${chalk_1.default.bold('Ollama')} — local models, zero cost, zero API key`,
            value: 'ollama',
        },
        {
            name: `💰 ${chalk_1.default.bold('Anthropic Claude')} — BYOK (claude-3-5-haiku)`,
            value: 'anthropic',
        },
        {
            name: `💰 ${chalk_1.default.bold('OpenAI GPT')} — BYOK (gpt-4o-mini)`,
            value: 'openai',
        },
        new inquirer.Separator(),
        { name: chalk_1.default.dim('Skip — I\'ll configure later'), value: 'skip' },
    ];
    const { selectedProvider } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedProvider',
            message: 'Select your AI provider:',
            choices: providerChoices,
        }]);
    if (selectedProvider === 'skip') {
        markSetupComplete();
        console.log(chalk_1.default.dim('\n  Run "kcc setup" to configure anytime.\n'));
        return;
    }
    if (selectedProvider === 'ollama') {
        const settings = (0, settings_1.loadSettings)();
        settings.defaultProvider = 'ollama';
        settings.providers.ollama = { ...settings.providers.ollama, model: 'qwen2.5-coder:7b' };
        (0, settings_1.saveSettings)(settings);
        markSetupComplete();
        console.log(chalk_1.default.green('\n✅ Ollama selected.'));
        console.log(chalk_1.default.dim('  Make sure Ollama is running: ollama pull qwen2.5-coder:7b && ollama serve\n'));
        return;
    }
    // API key required
    const keyLabels = {
        openrouter: { var: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/keys', model: 'openrouter/free', hint: 'sk-or-v1-...' },
        groq: { var: 'GROQ_API_KEY', url: 'https://console.groq.com', model: 'llama-3.3-70b-versatile', hint: 'gsk_...' },
        google: { var: 'GOOGLE_API_KEY', url: 'https://aistudio.google.com', model: 'gemini-2.5-flash', hint: 'AIza...' },
        anthropic: { var: 'ANTHROPIC_API_KEY', url: 'https://console.anthropic.com', model: 'claude-3-5-haiku-20241022', hint: 'sk-ant-...' },
        openai: { var: 'OPENAI_API_KEY', url: 'https://platform.openai.com', model: 'gpt-4o-mini', hint: 'sk-...' },
        mistral: { var: 'MISTRAL_API_KEY', url: 'https://console.mistral.ai/api-keys', model: 'devstral-small-latest', hint: 'sk-...' },
    };
    const info = keyLabels[selectedProvider];
    if (!info) {
        markSetupComplete();
        return;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Primary provider API key
    // ═══════════════════════════════════════════════════════════════════════════
    console.log(chalk_1.default.bold.cyan(`\n📌 Step 1/3: ${info.var}`));
    console.log(chalk_1.default.dim(`  Get your API key at: ${chalk_1.default.cyan(info.url)}\n`));
    const { apiKey } = await inquirer.prompt([{
            type: 'password',
            name: 'apiKey',
            message: `Enter your ${info.var}:`,
            mask: '•',
            validate: (v) => v.trim().length > 10 ? true : 'Key seems too short — please check it.',
        }]);
    const settings = (0, settings_1.loadSettings)();
    settings.defaultProvider = selectedProvider;
    settings.providers[selectedProvider] = {
        ...settings.providers[selectedProvider],
        apiKey: apiKey.trim(),
        model: info.model,
    };
    console.log(chalk_1.default.green(`\n✅ Primary: ${selectedProvider}/${info.model}\n`));
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Groq key for transcription (if not already set)
    // ═══════════════════════════════════════════════════════════════════════════
    const existingGroq = process.env.GROQ_API_KEY || settings.providers.groq?.apiKey;
    if (!existingGroq && selectedProvider !== 'groq') {
        console.log(chalk_1.default.bold.cyan('🎙️  Step 2/3: Transcription (optional)'));
        console.log(chalk_1.default.dim('  Groq offers FREE speech-to-text (whisper-large-v3).'));
        console.log(chalk_1.default.dim(`  Get a free key at: ${chalk_1.default.cyan('https://console.groq.com')}\n`));
        const { groqKey } = await inquirer.prompt([{
                type: 'password',
                name: 'groqKey',
                message: 'Enter GROQ_API_KEY (Enter to skip):',
                mask: '•',
            }]);
        if (groqKey && groqKey.trim().length > 10) {
            settings.providers.groq = { ...settings.providers.groq, apiKey: groqKey.trim(), model: 'llama-3.3-70b-versatile' };
            process.env.GROQ_API_KEY = groqKey.trim();
            console.log(chalk_1.default.green('  ✅ Groq set! /transcribe + fallback AI ready.\n'));
        }
        else {
            console.log(chalk_1.default.dim('  ⏭  Skipped. You can add later with: /key groq <key>\n'));
        }
    }
    else if (selectedProvider === 'groq') {
        // Groq is already the primary — also set for transcription
        settings.providers.groq = { ...settings.providers.groq, apiKey: apiKey.trim(), model: 'llama-3.3-70b-versatile' };
        console.log(chalk_1.default.bold.cyan('🎙️  Step 2/3: Transcription'));
        console.log(chalk_1.default.green('  ✅ Groq is your primary — transcription auto-enabled!\n'));
    }
    else {
        console.log(chalk_1.default.bold.cyan('🎙️  Step 2/3: Transcription'));
        console.log(chalk_1.default.green('  ✅ Groq key already set — transcription ready!\n'));
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: Fallback provider (if no other providers set)
    // ═══════════════════════════════════════════════════════════════════════════
    const hasMultipleProviders = [
        settings.providers.openrouter?.apiKey,
        settings.providers.groq?.apiKey,
        settings.providers.google?.apiKey,
        settings.providers.mistral?.apiKey,
        process.env.GOOGLE_API_KEY,
        process.env.GEMINI_API_KEY,
    ].filter(Boolean).length >= 2;
    if (!hasMultipleProviders) {
        // Suggest a different free provider as fallback
        const fallbackOptions = [
            { name: 'OpenRouter', id: 'openrouter', envVar: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/keys', hint: 'sk-or-v1-...' },
            { name: 'Groq', id: 'groq', envVar: 'GROQ_API_KEY', url: 'https://console.groq.com', hint: 'gsk_...' },
            { name: 'Google Gemini', id: 'google', envVar: 'GOOGLE_API_KEY', url: 'https://aistudio.google.com', hint: 'AIza...' },
            { name: 'Mistral', id: 'mistral', envVar: 'MISTRAL_API_KEY', url: 'https://console.mistral.ai', hint: 'sk-...' },
        ].filter(o => o.id !== selectedProvider && !settings.providers[o.id]?.apiKey);
        if (fallbackOptions.length > 0) {
            const suggestedFallback = fallbackOptions[0];
            console.log(chalk_1.default.bold.cyan('🔄 Step 3/3: Fallback provider (optional)'));
            console.log(chalk_1.default.dim('  If your primary hits rate limits, coderaw auto-switches to a fallback.'));
            console.log(chalk_1.default.dim(`  Recommended: ${chalk_1.default.cyan(suggestedFallback.name)} — free at ${suggestedFallback.url}\n`));
            const { fallbackKey } = await inquirer.prompt([{
                    type: 'password',
                    name: 'fallbackKey',
                    message: `Enter ${suggestedFallback.envVar} (Enter to skip):`,
                    mask: '•',
                }]);
            if (fallbackKey && fallbackKey.trim().length > 10) {
                const fbModel = keyLabels[suggestedFallback.id]?.model || suggestedFallback.id;
                settings.providers[suggestedFallback.id] = {
                    ...settings.providers[suggestedFallback.id],
                    apiKey: fallbackKey.trim(),
                    model: fbModel,
                };
                process.env[suggestedFallback.envVar] = fallbackKey.trim();
                console.log(chalk_1.default.green(`  ✅ Fallback: ${suggestedFallback.name} ready!\n`));
            }
            else {
                console.log(chalk_1.default.dim('  ⏭  Skipped. Add anytime with: /key <provider> <key>\n'));
            }
        }
        else {
            console.log(chalk_1.default.bold.cyan('🔄 Step 3/3: Fallback'));
            console.log(chalk_1.default.green('  ✅ Multiple providers already set — auto-fallback ready!\n'));
        }
    }
    else {
        console.log(chalk_1.default.bold.cyan('🔄 Step 3/3: Fallback'));
        console.log(chalk_1.default.green('  ✅ Multiple providers set — auto-fallback ready!\n'));
    }
    (0, settings_1.saveSettings)(settings);
    markSetupComplete();
    // Summary
    console.log(chalk_1.default.bold('━'.repeat(50)));
    console.log(chalk_1.default.bold.green('  🚀 Setup complete!\n'));
    const configuredProviders = Object.entries(settings.providers)
        .filter(([, cfg]) => cfg.apiKey)
        .map(([name]) => name);
    console.log(chalk_1.default.dim(`  Primary:  ${chalk_1.default.white(selectedProvider)}`));
    console.log(chalk_1.default.dim(`  Fallback: ${chalk_1.default.white(configuredProviders.filter(p => p !== selectedProvider).join(', ') || 'none (add with /key)')}`));
    console.log(chalk_1.default.dim(`  Transcription: ${chalk_1.default.white(settings.providers.groq?.apiKey ? 'Groq Whisper ✅' : 'not set (add with /key groq)')}`));
    console.log(chalk_1.default.bold('━'.repeat(50)));
    console.log();
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
//# sourceMappingURL=wizard.js.map