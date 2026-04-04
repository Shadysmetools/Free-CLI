/**
 * Auto-Fallback Provider Chain
 *
 * When a provider fails with a retriable error, automatically tries the next
 * free provider. Only emits ONE quiet notification if a fallback succeeds.
 */

import { Provider, CompletionOptions, CompletionResult } from './index';
import { OllamaProvider } from './ollama';
import { GroqProvider } from './groq';
import { GoogleProvider } from './google';
import { OpenRouterProvider } from './openrouter';

// ─── Fallback Chain ───────────────────────────────────────────────────────────

export interface FallbackEntry {
  provider: string;
  model: string;
  label: string;
  createProvider: () => Provider;
}

export const FREE_FALLBACK_CHAIN: FallbackEntry[] = [
  // OpenRouter free models (different models may have independent rate limits)
  {
    provider: 'openrouter',
    model: 'openrouter/free',
    label: 'OpenRouter (Auto-pick best free)',
    createProvider: () => new OpenRouterProvider('openrouter/free'),
  },
  {
    provider: 'openrouter',
    model: 'qwen/qwen3-30b-a3b:free',
    label: 'OpenRouter (Qwen 3 30B free)',
    createProvider: () => new OpenRouterProvider('qwen/qwen3-30b-a3b:free'),
  },
  {
    provider: 'openrouter',
    model: 'mistralai/devstral-small:free',
    label: 'OpenRouter (Devstral Small free)',
    createProvider: () => new OpenRouterProvider('mistralai/devstral-small:free'),
  },
  {
    provider: 'openrouter',
    model: 'google/gemma-3-27b-it:free',
    label: 'OpenRouter (Gemma 3 27B free)',
    createProvider: () => new OpenRouterProvider('google/gemma-3-27b-it:free'),
  },
  {
    provider: 'openrouter',
    model: 'nvidia/llama-3.1-nemotron-70b-instruct:free',
    label: 'OpenRouter (Nemotron 70B free)',
    createProvider: () => new OpenRouterProvider('nvidia/llama-3.1-nemotron-70b-instruct:free'),
  },
  // Groq — very generous free tier, different provider = different rate limit
  {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    label: 'Groq (Llama 70B)',
    createProvider: () => new GroqProvider('llama-3.3-70b-versatile'),
  },
  {
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    label: 'Groq (Llama 8B instant)',
    createProvider: () => new GroqProvider('llama-3.1-8b-instant'),
  },
  // Google Gemini — free tier with generous limits
  {
    provider: 'google',
    model: 'gemini-2.5-flash',
    label: 'Google Gemini 2.5 Flash',
    createProvider: () => new GoogleProvider('gemini-2.5-flash'),
  },
  // Ollama — local, no rate limits
  {
    provider: 'ollama',
    model: 'qwen2.5-coder:7b',
    label: 'Ollama (local)',
    createProvider: () => new OllamaProvider('qwen2.5-coder:7b'),
  },
];

// ─── Error Classification ─────────────────────────────────────────────────────

export function isRetriableError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('413') ||
    msg.includes('404') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests') ||
    msg.includes('context length') ||
    msg.includes('maximum context') ||
    msg.includes('tokens per') ||
    msg.includes('exceeded') ||
    msg.includes('overloaded') ||
    msg.includes('capacity') ||
    msg.includes('service unavailable') ||
    msg.includes('gateway timeout') ||
    msg.includes('bad gateway')
  );
}

// ─── Fallback Completion ──────────────────────────────────────────────────────

/** Called with the short model name when a fallback succeeds */
export type FallbackNotifier = (modelName: string) => void;

/**
 * Try provider.complete(); on retriable failure, walk FREE_FALLBACK_CHAIN
 * and return the first successful result.
 *
 * Emits ONE quiet notification (via `notify`) when a fallback succeeds.
 */
export async function completeWithFallback(
  provider: Provider,
  options: CompletionOptions,
  notify?: FallbackNotifier,
): Promise<{ result: CompletionResult; activeProvider: Provider }> {

  // ── Try primary ───────────────────────────────────────────────────────────
  try {
    const result = await provider.complete(options);
    return { result, activeProvider: provider };
  } catch (primaryError) {
    if (!isRetriableError(primaryError)) {
      throw primaryError;
    }

    // ── Try each fallback silently ────────────────────────────────────────
    for (const fb of FREE_FALLBACK_CHAIN) {
      if (fb.provider === provider.name && fb.model === provider.model) continue;

      const fbProvider = fb.createProvider();
      const available = await fbProvider.isAvailable();
      if (!available) continue;

      try {
        // Fallback always runs non-streaming for simplicity/compatibility
        const fallbackOptions: CompletionOptions = {
          ...options,
          stream: false,
          onToken: undefined,
        };

        const result = await fbProvider.complete(fallbackOptions);
        // Success — emit one quiet notification with just the model name
        if (notify) notify(fb.model);
        return { result, activeProvider: fbProvider };
      } catch {
        continue;
      }
    }

    // All fallbacks exhausted
    const errMsg = (primaryError instanceof Error ? primaryError.message : String(primaryError));
    const tips = [];
    if (!process.env.GROQ_API_KEY) tips.push('GROQ_API_KEY (free at console.groq.com)');
    if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) tips.push('GOOGLE_API_KEY (free at aistudio.google.com)');
    const tipText = tips.length > 0
      ? `\nTip: Add more free providers with /key:\n  ${tips.join('\n  ')}`
      : '\nAll configured providers are rate-limited. Wait a moment and try again.';
    throw new Error(`All providers failed. ${errMsg}${tipText}`);
  }
}

// ─── Provider Status ──────────────────────────────────────────────────────────

export interface ProviderStatus {
  id: string;
  label: string;
  model: string;
  available: boolean;
  reason: string;
}

export async function checkAllProviders(): Promise<ProviderStatus[]> {
  const results: ProviderStatus[] = [];

  const checks: Array<{ id: string; label: string; model: string; provider: Provider; envVar?: string }> = [
    {
      id: 'openrouter',
      label: 'OpenRouter',
      model: 'openrouter/free',
      provider: new OpenRouterProvider('openrouter/free'),
      envVar: 'OPENROUTER_API_KEY',
    },
    {
      id: 'groq',
      label: 'Groq',
      model: 'llama-3.3-70b-versatile',
      provider: new GroqProvider('llama-3.3-70b-versatile'),
      envVar: 'GROQ_API_KEY',
    },
    {
      id: 'google',
      label: 'Google Gemini',
      model: 'gemini-2.5-flash',
      provider: new GoogleProvider('gemini-2.5-flash'),
      envVar: 'GOOGLE_API_KEY or GEMINI_API_KEY',
    },
    {
      id: 'ollama',
      label: 'Ollama',
      model: 'local',
      provider: new OllamaProvider('qwen2.5-coder:7b'),
      envVar: undefined,
    },
    {
      id: 'anthropic',
      label: 'Anthropic',
      model: 'claude-3-5-haiku-20241022',
      provider: (() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { AnthropicProvider } = require('./anthropic') as { AnthropicProvider: new (model: string) => Provider };
        return new AnthropicProvider('claude-3-5-haiku-20241022');
      })(),
      envVar: 'ANTHROPIC_API_KEY',
    },
    {
      id: 'openai',
      label: 'OpenAI',
      model: 'gpt-4o-mini',
      provider: (() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { OpenAIProvider } = require('./openai') as { OpenAIProvider: new (model: string) => Provider };
        return new OpenAIProvider('gpt-4o-mini');
      })(),
      envVar: 'OPENAI_API_KEY',
    },
  ];

  for (const check of checks) {
    const available = await check.provider.isAvailable();
    let reason: string;
    if (available) {
      reason = check.envVar ? `${check.envVar.split(' ')[0]} set` : 'running';
    } else {
      reason = check.envVar ? `no ${check.envVar}` : 'not running';
    }
    results.push({ id: check.id, label: check.label, model: check.model, available, reason });
  }

  return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// (kept for potential external use)
export function extractShortError(msg: string): string {
  if (msg.includes('429')) return 'rate limited';
  if (msg.includes('413')) return 'context too large';
  if (msg.includes('quota')) return 'quota exceeded';
  if (msg.includes('rate limit') || msg.includes('rate_limit')) return 'rate limited';
  if (msg.includes('overloaded') || msg.includes('capacity')) return 'overloaded';
  if (msg.includes('exceeded')) return 'limit exceeded';
  if (msg.includes('404')) return 'not found';
  return msg.slice(0, 60);
}
