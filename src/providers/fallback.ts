/**
 * Auto-Fallback Provider Chain
 *
 * When a provider fails with a retriable error (429, 413, 404, quota, rate limit),
 * automatically tries the next free provider without user intervention.
 *
 * Chain order: OpenRouter free → Groq → Google → (exhausted)
 */

import { Provider, CompletionOptions, CompletionResult } from './index';
import { OllamaProvider } from './ollama';
import { GroqProvider } from './groq';
import { GoogleProvider } from './google';
import { OpenRouterProvider } from './openrouter';

// ─── Fallback Chain Definition ────────────────────────────────────────────────

export interface FallbackEntry {
  provider: string;
  model: string;
  label: string;
  createProvider: () => Provider;
}

export const FREE_FALLBACK_CHAIN: FallbackEntry[] = [
  {
    provider: 'openrouter',
    model: 'openrouter/free',
    label: 'OpenRouter (Auto-pick best free)',
    createProvider: () => new OpenRouterProvider('openrouter/free'),
  },
  {
    provider: 'openrouter',
    model: 'qwen/qwen3.6-plus:free',
    label: 'OpenRouter (Qwen 3.6 Plus free)',
    createProvider: () => new OpenRouterProvider('qwen/qwen3.6-plus:free'),
  },
  {
    provider: 'openrouter',
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    label: 'OpenRouter (NVIDIA Nemotron free)',
    createProvider: () => new OpenRouterProvider('nvidia/nemotron-3-super-120b-a12b:free'),
  },
  {
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    label: 'Groq (Llama 8B)',
    createProvider: () => new GroqProvider('llama-3.1-8b-instant'),
  },
  {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    label: 'Groq (Llama 70B)',
    createProvider: () => new GroqProvider('llama-3.3-70b-versatile'),
  },
  {
    provider: 'google',
    model: 'gemini-2.5-flash',
    label: 'Google Gemini 2.5 Flash',
    createProvider: () => new GoogleProvider('gemini-2.5-flash'),
  },
  {
    provider: 'ollama',
    model: 'qwen2.5-coder:7b',
    label: 'Ollama (local)',
    createProvider: () => new OllamaProvider('qwen2.5-coder:7b'),
  },
];

// ─── Error Classification ─────────────────────────────────────────────────────

/**
 * Returns true if the error is retriable (rate limit, quota, context too large, etc.)
 */
export function isRetriableError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('413') ||
    msg.includes('404') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests') ||
    msg.includes('context length') ||
    msg.includes('maximum context') ||
    msg.includes('tokens per') ||
    msg.includes('exceeded') ||
    msg.includes('overloaded') ||
    msg.includes('capacity')
  );
}

// ─── Fallback Completion ──────────────────────────────────────────────────────

export type FallbackNotifier = (message: string) => void;

/**
 * Try provider.complete(); on retriable failure, walk FREE_FALLBACK_CHAIN
 * and return the first successful result.
 *
 * @param provider      The primary provider to try first
 * @param options       CompletionOptions (messages, tools, etc.)
 * @param notify        Optional callback to print status lines to the user
 * @returns             CompletionResult from whichever provider succeeded
 */
export async function completeWithFallback(
  provider: Provider,
  options: CompletionOptions,
  notify?: FallbackNotifier,
): Promise<{ result: CompletionResult; activeProvider: Provider }> {

  // ── Try primary provider ──────────────────────────────────────────────────
  try {
    const result = await provider.complete(options);
    return { result, activeProvider: provider };
  } catch (primaryError) {
    if (!isRetriableError(primaryError)) {
      // Non-retriable (auth error, bad request, etc.) — don't fallback
      throw primaryError;
    }

    const errMsg = (primaryError instanceof Error ? primaryError.message : String(primaryError));
    const shortErr = extractShortError(errMsg);
    if (notify) notify(`\n⚠️  ${provider.name}/${provider.model} failed (${shortErr}). Trying next provider...`);

    // ── Try each fallback ───────────────────────────────────────────────────
    for (const fb of FREE_FALLBACK_CHAIN) {
      // Skip if it's the same provider+model that just failed
      if (fb.provider === provider.name && fb.model === provider.model) continue;

      const fbProvider = fb.createProvider();

      // Check if credentials are available
      const available = await fbProvider.isAvailable();
      if (!available) continue;

      try {
        if (notify) notify(`🔄 Switching to ${fb.label}...`);

        // Strip streaming from fallback calls (simpler, more compatible)
        const fallbackOptions: CompletionOptions = {
          ...options,
          stream: false,
          onToken: undefined,
        };

        const result = await fbProvider.complete(fallbackOptions);
        if (notify) notify(`✅ Using ${fb.label}\n`);
        return { result, activeProvider: fbProvider };
      } catch {
        // This fallback failed too — continue to next
        continue;
      }
    }

    // All fallbacks exhausted
    throw new Error(
      `All providers failed. Primary error: ${errMsg}\n` +
      `Tip: Set OPENROUTER_API_KEY, GROQ_API_KEY, or GOOGLE_API_KEY for free fallback providers.`
    );
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

/**
 * Check availability of all known providers and return their status.
 */
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
      // Lazy import to avoid circular deps
      provider: (() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
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
        // eslint-disable-next-line @typescript-eslint/no-var-requires
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
    results.push({
      id: check.id,
      label: check.label,
      model: check.model,
      available,
      reason,
    });
  }

  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractShortError(msg: string): string {
  if (msg.includes('429')) return 'rate limited';
  if (msg.includes('413')) return 'context too large';
  if (msg.includes('quota')) return 'quota exceeded';
  if (msg.includes('rate limit') || msg.includes('rate_limit')) return 'rate limited';
  if (msg.includes('overloaded') || msg.includes('capacity')) return 'overloaded';
  if (msg.includes('exceeded')) return 'limit exceeded';
  if (msg.includes('404')) return 'not found';
  return msg.slice(0, 60);
}
