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

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as http from 'http';
import * as os from 'os';
import chalk from 'chalk';
import { loadSettings, saveSettings } from '../config/settings';

const CONFIG_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA ?? os.homedir(), 'knowcap-code')
  : path.join(os.homedir(), '.knowcap-code');
const SETUP_DONE_FILE = path.join(CONFIG_DIR, '.setup-complete');

// ─── Auto-Detect ─────────────────────────────────────────────────────────────

interface DetectedProvider {
  id: string;
  label: string;
  model?: string;
  available: boolean;
  free: boolean;
  reason?: string;
}

async function detectOllama(baseUrl = 'http://localhost:11434'): Promise<{ available: boolean; models: string[] }> {
  return new Promise(resolve => {
    const req = http.get(`${baseUrl}/api/tags`, { timeout: 2000 }, res => {
      let data = '';
      res.on('data', (c: Buffer) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data) as { models?: Array<{ name: string }> };
          const models = (json.models ?? []).map(m => m.name);
          resolve({ available: true, models });
        } catch {
          resolve({ available: false, models: [] });
        }
      });
    });
    req.on('error', () => resolve({ available: false, models: [] }));
    req.on('timeout', () => { req.destroy(); resolve({ available: false, models: [] }); });
  });
}

async function detectProviders(): Promise<DetectedProvider[]> {
  const results: DetectedProvider[] = [];

  // Ollama
  const ollama = await detectOllama();
  const ollamaModel = ollama.models.find(m =>
    m.includes('qwen') || m.includes('llama') || m.includes('coder')
  ) ?? ollama.models[0];
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
    model: 'gemini-2.0-flash',
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
export function isSetupComplete(): boolean {
  if (!fs.existsSync(SETUP_DONE_FILE)) return false;
  const settings = loadSettings();
  // Check if at least one provider can work
  const prov = settings.defaultProvider;
  if (prov === 'ollama') return true; // Always attempt ollama
  const apiKey = settings.providers[prov]?.apiKey;
  return !!apiKey;
}

/**
 * Auto-detect: pick the best available provider without asking anything.
 * Returns the provider id to use, or null if nothing works.
 */
export async function autoDetectProvider(): Promise<{ provider: string; model: string } | null> {
  const detected = await detectProviders();
  const working = detected.filter(d => d.available && d.model);
  if (working.length === 0) return null;

  // Priority: ollama (local free) > groq (fast free) > google > anthropic > openai
  const priority = ['ollama', 'groq', 'google', 'anthropic', 'openai'];
  for (const id of priority) {
    const match = working.find(d => d.id === id);
    if (match?.model) return { provider: match.id, model: match.model };
  }
  return null;
}

/**
 * Silent startup: auto-detect, print one info line, return chosen provider.
 * Called at every startup when setup is already complete.
 */
export async function silentAutoDetect(): Promise<{ provider: string; model: string } | null> {
  const settings = loadSettings();
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
export async function runSetupWizard(force = false): Promise<void> {
  if (!force && isSetupComplete()) return;

  console.log(`
${chalk.cyan('┌─────────────────────────────────────────────┐')}
${chalk.cyan('│')}  ${chalk.bold.cyan('⚡ Welcome to knowcap-code!')}                 ${chalk.cyan('│')}
${chalk.cyan('│')}  ${chalk.dim('Free AI Coding Assistant — Claude Code alt')}  ${chalk.cyan('│')}
${chalk.cyan('└─────────────────────────────────────────────┘')}
`);

  console.log(chalk.bold('🔍 Detecting AI providers...\n'));

  const detected = await detectProviders();

  for (const p of detected) {
    const icon = p.available ? chalk.green('  ✅') : chalk.red('  ❌');
    const label = p.available ? chalk.green(p.label) : chalk.dim(p.label);
    const reason = chalk.dim(` — ${p.reason}`);
    console.log(`${icon} ${label}${reason}`);
  }
  console.log();

  const working = detected.filter(d => d.available && d.model);

  // ── Something works → use it immediately ─────────────────────────────────
  if (working.length > 0) {
    const best = pickBest(working);
    console.log(chalk.green(`✅ Ready to go! Using ${chalk.bold(best.label)} (${best.model})`));
    console.log(chalk.dim('   Type your first message or /help for commands.\n'));

    const settings = loadSettings();
    settings.defaultProvider = best.id;
    if (best.model) settings.providers[best.id] = { ...settings.providers[best.id], model: best.model };
    saveSettings(settings);
    markSetupComplete();
    return;
  }

  // ── Nothing works → guided setup ─────────────────────────────────────────
  console.log(chalk.yellow('⚠  No AI providers detected. Let\'s set one up!\n'));

  const choice = await showProviderMenu();
  if (choice) {
    const settings = loadSettings();
    settings.defaultProvider = choice.id;
    if (choice.apiKey) {
      settings.providers[choice.id] = settings.providers[choice.id] ?? {};
      settings.providers[choice.id].apiKey = choice.apiKey;
    }
    if (choice.model) {
      settings.providers[choice.id] = settings.providers[choice.id] ?? {};
      settings.providers[choice.id].model = choice.model;
    }
    saveSettings(settings);
    markSetupComplete();
    console.log(chalk.green(`\n✅ Saved! Using ${choice.id}. Run 'kcc' to start.\n`));
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickBest(providers: DetectedProvider[]): DetectedProvider {
  const priority = ['ollama', 'groq', 'google', 'anthropic', 'openai'];
  for (const id of priority) {
    const match = providers.find(p => p.id === id);
    if (match) return match;
  }
  return providers[0];
}

function markSetupComplete(): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SETUP_DONE_FILE, new Date().toISOString(), 'utf-8');
}

interface ProviderChoice {
  id: string;
  model?: string;
  apiKey?: string;
}

async function showProviderMenu(): Promise<ProviderChoice | null> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve));

  try {
    console.log(chalk.bold('📋 Quick Setup — choose a provider:\n'));
    console.log(`  ${chalk.cyan('1.')} 🆓 ${chalk.bold('Ollama')} — local, free, private`);
    console.log(`     ${chalk.dim('→ Install: curl -fsSL https://ollama.com/install.sh | sh')}`);
    console.log(`     ${chalk.dim('→ Then: ollama pull qwen2.5-coder:7b')}\n`);
    console.log(`  ${chalk.cyan('2.')} 🆓 ${chalk.bold('Groq')} — free cloud, ultra-fast`);
    console.log(`     ${chalk.dim('→ Get free key: https://console.groq.com')}\n`);
    console.log(`  ${chalk.cyan('3.')} 🆓 ${chalk.bold('Google Gemini')} — free tier`);
    console.log(`     ${chalk.dim('→ Get free key: https://aistudio.google.com')}\n`);
    console.log(`  ${chalk.cyan('4.')} 💰 ${chalk.bold('Anthropic Claude')} — BYOK`);
    console.log(`     ${chalk.dim('→ https://console.anthropic.com')}\n`);
    console.log(`  ${chalk.cyan('5.')} 💰 ${chalk.bold('OpenAI GPT')} — BYOK`);
    console.log(`     ${chalk.dim('→ https://platform.openai.com')}\n`);
    console.log(`  ${chalk.cyan('6.')} ⏭  ${chalk.bold('Skip')} — I\'ll configure later\n`);

    const answer = (await ask(chalk.cyan('  Choice [1]: '))).trim() || '1';

    switch (answer) {
      case '1':
        console.log(chalk.dim('\n  Install Ollama first, then re-run kcc.'));
        console.log(chalk.dim('  Quick start: ollama pull qwen2.5-coder:7b && kcc'));
        return { id: 'ollama', model: 'qwen2.5-coder:7b' };

      case '2': {
        const key = (await ask(chalk.cyan('  Groq API key: '))).trim();
        if (!key) { console.log(chalk.red('  No key entered.')); return null; }
        return { id: 'groq', model: 'llama-3.3-70b-versatile', apiKey: key };
      }

      case '3': {
        const key = (await ask(chalk.cyan('  Google API key: '))).trim();
        if (!key) { console.log(chalk.red('  No key entered.')); return null; }
        return { id: 'google', model: 'gemini-2.0-flash', apiKey: key };
      }

      case '4': {
        const key = (await ask(chalk.cyan('  Anthropic API key (sk-ant-...): '))).trim();
        if (!key) { console.log(chalk.red('  No key entered.')); return null; }
        return { id: 'anthropic', model: 'claude-3-5-haiku-20241022', apiKey: key };
      }

      case '5': {
        const key = (await ask(chalk.cyan('  OpenAI API key (sk-...): '))).trim();
        if (!key) { console.log(chalk.red('  No key entered.')); return null; }
        return { id: 'openai', model: 'gpt-4o-mini', apiKey: key };
      }

      default:
        console.log(chalk.dim('\n  Skipped. Run "kcc setup" to configure later.'));
        markSetupComplete();
        return null;
    }
  } finally {
    rl.close();
  }
}
