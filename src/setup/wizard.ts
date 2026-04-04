/**
 * First-run setup wizard — Gemini CLI-style interactive selection
 * Uses inquirer arrow-key prompts instead of numbered text menus.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as os from 'os';
import chalk from 'chalk';
import { loadSettings, saveSettings } from '../config/settings';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const inquirer = require('inquirer') as any;

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

  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isSetupComplete(): boolean {
  if (!fs.existsSync(SETUP_DONE_FILE)) return false;
  const settings = loadSettings();
  const prov = settings.defaultProvider;
  if (prov === 'ollama') return true;
  const apiKey = settings.providers[prov]?.apiKey;
  return !!apiKey;
}

export async function autoDetectProvider(): Promise<{ provider: string; model: string } | null> {
  const detected = await detectProviders();
  const working = detected.filter(d => d.available && d.model);
  if (working.length === 0) return null;
  const priority = ['ollama', 'groq', 'google', 'anthropic', 'openai'];
  for (const id of priority) {
    const match = working.find(d => d.id === id);
    if (match?.model) return { provider: match.id, model: match.model };
  }
  return null;
}

export async function silentAutoDetect(): Promise<{ provider: string; model: string } | null> {
  const settings = loadSettings();
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

// ─── Setup Wizard ─────────────────────────────────────────────────────────────

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
    const icon = p.available ? chalk.green('  ✅') : chalk.dim('  ○ ');
    const label = p.available ? chalk.green(p.label) : chalk.dim(p.label);
    const reason = chalk.dim(` — ${p.reason}`);
    console.log(`${icon} ${label}${reason}`);
  }
  console.log();

  const working = detected.filter(d => d.available && d.model);

  // ── Something works → offer to use it or pick another ────────────────────
  if (working.length > 0) {
    const best = pickBest(working);
    const choices = [
      {
        name: `${chalk.green('✅')} Use ${chalk.bold(best.label)} ${chalk.dim(`(${best.model})`)} — ready now`,
        value: 'use-best',
      },
      ...working.filter(p => p.id !== best.id).map(p => ({
        name: `   Use ${p.label} ${chalk.dim(`(${p.model})`)}`,
        value: `use-${p.id}`,
      })),
      { name: chalk.dim('   Choose a different provider (requires API key)'), value: 'choose' },
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
      const settings = loadSettings();
      settings.defaultProvider = chosen.id;
      if (chosen.model) settings.providers[chosen.id] = { ...settings.providers[chosen.id], model: chosen.model };
      saveSettings(settings);
      markSetupComplete();
      console.log(chalk.green(`\n✅ Ready! Using ${chalk.bold(chosen.label)}\n`));
      return;
    }
    // Fall through to "choose" flow
  }

  // ── Interactive provider picker ───────────────────────────────────────────
  const providerChoices = [
    {
      name: `🆓 ${chalk.bold('OpenRouter')} — free cloud models (no API key needed for some)`,
      value: 'openrouter',
    },
    {
      name: `🆓 ${chalk.bold('Groq')} — ultra-fast free tier · llama-3.3-70b`,
      value: 'groq',
    },
    {
      name: `🆓 ${chalk.bold('Google Gemini')} — free tier · gemini-2.5-flash`,
      value: 'google',
    },
    {
      name: `🖥️  ${chalk.bold('Ollama')} — local models, zero cost, zero API key`,
      value: 'ollama',
    },
    {
      name: `💰 ${chalk.bold('Anthropic Claude')} — BYOK (claude-3-5-haiku)`,
      value: 'anthropic',
    },
    {
      name: `💰 ${chalk.bold('OpenAI GPT')} — BYOK (gpt-4o-mini)`,
      value: 'openai',
    },
    new inquirer.Separator(),
    { name: chalk.dim('Skip — I\'ll configure later'), value: 'skip' },
  ];

  const { selectedProvider } = await inquirer.prompt([{
    type: 'list',
    name: 'selectedProvider',
    message: 'Select your AI provider:',
    choices: providerChoices,
  }]);

  if (selectedProvider === 'skip') {
    markSetupComplete();
    console.log(chalk.dim('\n  Run "kcc setup" to configure anytime.\n'));
    return;
  }

  if (selectedProvider === 'ollama') {
    const settings = loadSettings();
    settings.defaultProvider = 'ollama';
    settings.providers.ollama = { ...settings.providers.ollama, model: 'qwen2.5-coder:7b' };
    saveSettings(settings);
    markSetupComplete();
    console.log(chalk.green('\n✅ Ollama selected.'));
    console.log(chalk.dim('  Make sure Ollama is running: ollama pull qwen2.5-coder:7b && ollama serve\n'));
    return;
  }

  // API key required
  const keyLabels: Record<string, { var: string; url: string; model: string; hint: string }> = {
    openrouter: { var: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/keys', model: 'openrouter/free', hint: 'sk-or-v1-...' },
    groq:       { var: 'GROQ_API_KEY',       url: 'https://console.groq.com',     model: 'llama-3.3-70b-versatile', hint: 'gsk_...' },
    google:     { var: 'GOOGLE_API_KEY',      url: 'https://aistudio.google.com',  model: 'gemini-2.5-flash', hint: 'AIza...' },
    anthropic:  { var: 'ANTHROPIC_API_KEY',   url: 'https://console.anthropic.com', model: 'claude-3-5-haiku-20241022', hint: 'sk-ant-...' },
    openai:     { var: 'OPENAI_API_KEY',      url: 'https://platform.openai.com',  model: 'gpt-4o-mini', hint: 'sk-...' },
  };

  const info = keyLabels[selectedProvider];
  if (!info) {
    markSetupComplete();
    return;
  }

  console.log(chalk.dim(`\n  Get your API key at: ${chalk.cyan(info.url)}\n`));

  const { apiKey } = await inquirer.prompt([{
    type: 'password',
    name: 'apiKey',
    message: `Enter your ${info.var}:`,
    mask: '•',
    validate: (v: string) => v.trim().length > 10 ? true : 'Key seems too short — please check it.',
  }]);

  const settings = loadSettings();
  settings.defaultProvider = selectedProvider;
  settings.providers[selectedProvider] = {
    ...settings.providers[selectedProvider],
    apiKey: apiKey.trim(),
    model: info.model,
  };
  saveSettings(settings);
  markSetupComplete();

  console.log(chalk.green(`\n✅ Saved! Using ${selectedProvider}/${info.model}\n`));
  console.log(chalk.dim(`  Tip: Also set ${info.var} in your shell profile for permanent use.\n`));
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
