"use strict";
/**
 * Auto-Fallback Provider Chain
 *
 * When a provider fails with a retriable error, automatically tries the next
 * free provider. Only emits ONE quiet notification if a fallback succeeds.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_FALLBACK_CHAIN = void 0;
exports.isRetriableError = isRetriableError;
exports.completeWithFallback = completeWithFallback;
exports.checkAllProviders = checkAllProviders;
exports.extractShortError = extractShortError;
const ollama_1 = require("./ollama");
const groq_1 = require("./groq");
const google_1 = require("./google");
const openrouter_1 = require("./openrouter");
exports.FREE_FALLBACK_CHAIN = [
    {
        provider: 'openrouter',
        model: 'openrouter/free',
        label: 'OpenRouter (Auto-pick best free)',
        createProvider: () => new openrouter_1.OpenRouterProvider('openrouter/free'),
    },
    {
        provider: 'openrouter',
        model: 'qwen/qwen3.6-plus:free',
        label: 'OpenRouter (Qwen 3.6 Plus free)',
        createProvider: () => new openrouter_1.OpenRouterProvider('qwen/qwen3.6-plus:free'),
    },
    {
        provider: 'openrouter',
        model: 'nvidia/nemotron-3-super-120b-a12b:free',
        label: 'OpenRouter (NVIDIA Nemotron free)',
        createProvider: () => new openrouter_1.OpenRouterProvider('nvidia/nemotron-3-super-120b-a12b:free'),
    },
    {
        provider: 'groq',
        model: 'llama-3.1-8b-instant',
        label: 'Groq (Llama 8B)',
        createProvider: () => new groq_1.GroqProvider('llama-3.1-8b-instant'),
    },
    {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        label: 'Groq (Llama 70B)',
        createProvider: () => new groq_1.GroqProvider('llama-3.3-70b-versatile'),
    },
    {
        provider: 'google',
        model: 'gemini-2.5-flash',
        label: 'Google Gemini 2.5 Flash',
        createProvider: () => new google_1.GoogleProvider('gemini-2.5-flash'),
    },
    {
        provider: 'ollama',
        model: 'qwen2.5-coder:7b',
        label: 'Ollama (local)',
        createProvider: () => new ollama_1.OllamaProvider('qwen2.5-coder:7b'),
    },
];
// ─── Error Classification ─────────────────────────────────────────────────────
function isRetriableError(error) {
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return (msg.includes('429') ||
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
        msg.includes('bad gateway'));
}
/**
 * Try provider.complete(); on retriable failure, walk FREE_FALLBACK_CHAIN
 * and return the first successful result.
 *
 * Emits ONE quiet notification (via `notify`) when a fallback succeeds.
 */
async function completeWithFallback(provider, options, notify) {
    // ── Try primary ───────────────────────────────────────────────────────────
    try {
        const result = await provider.complete(options);
        return { result, activeProvider: provider };
    }
    catch (primaryError) {
        if (!isRetriableError(primaryError)) {
            throw primaryError;
        }
        // ── Try each fallback silently ────────────────────────────────────────
        for (const fb of exports.FREE_FALLBACK_CHAIN) {
            if (fb.provider === provider.name && fb.model === provider.model)
                continue;
            const fbProvider = fb.createProvider();
            const available = await fbProvider.isAvailable();
            if (!available)
                continue;
            try {
                // Fallback always runs non-streaming for simplicity/compatibility
                const fallbackOptions = {
                    ...options,
                    stream: false,
                    onToken: undefined,
                };
                const result = await fbProvider.complete(fallbackOptions);
                // Success — emit one quiet notification with just the model name
                if (notify)
                    notify(fb.model);
                return { result, activeProvider: fbProvider };
            }
            catch {
                continue;
            }
        }
        // All fallbacks exhausted
        const errMsg = (primaryError instanceof Error ? primaryError.message : String(primaryError));
        throw new Error(`All providers failed. Primary error: ${errMsg}\n` +
            `Tip: Set OPENROUTER_API_KEY, GROQ_API_KEY, or GOOGLE_API_KEY for free fallback providers.`);
    }
}
async function checkAllProviders() {
    const results = [];
    const checks = [
        {
            id: 'openrouter',
            label: 'OpenRouter',
            model: 'openrouter/free',
            provider: new openrouter_1.OpenRouterProvider('openrouter/free'),
            envVar: 'OPENROUTER_API_KEY',
        },
        {
            id: 'groq',
            label: 'Groq',
            model: 'llama-3.3-70b-versatile',
            provider: new groq_1.GroqProvider('llama-3.3-70b-versatile'),
            envVar: 'GROQ_API_KEY',
        },
        {
            id: 'google',
            label: 'Google Gemini',
            model: 'gemini-2.5-flash',
            provider: new google_1.GoogleProvider('gemini-2.5-flash'),
            envVar: 'GOOGLE_API_KEY or GEMINI_API_KEY',
        },
        {
            id: 'ollama',
            label: 'Ollama',
            model: 'local',
            provider: new ollama_1.OllamaProvider('qwen2.5-coder:7b'),
            envVar: undefined,
        },
        {
            id: 'anthropic',
            label: 'Anthropic',
            model: 'claude-3-5-haiku-20241022',
            provider: (() => {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { AnthropicProvider } = require('./anthropic');
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
                const { OpenAIProvider } = require('./openai');
                return new OpenAIProvider('gpt-4o-mini');
            })(),
            envVar: 'OPENAI_API_KEY',
        },
    ];
    for (const check of checks) {
        const available = await check.provider.isAvailable();
        let reason;
        if (available) {
            reason = check.envVar ? `${check.envVar.split(' ')[0]} set` : 'running';
        }
        else {
            reason = check.envVar ? `no ${check.envVar}` : 'not running';
        }
        results.push({ id: check.id, label: check.label, model: check.model, available, reason });
    }
    return results;
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
// (kept for potential external use)
function extractShortError(msg) {
    if (msg.includes('429'))
        return 'rate limited';
    if (msg.includes('413'))
        return 'context too large';
    if (msg.includes('quota'))
        return 'quota exceeded';
    if (msg.includes('rate limit') || msg.includes('rate_limit'))
        return 'rate limited';
    if (msg.includes('overloaded') || msg.includes('capacity'))
        return 'overloaded';
    if (msg.includes('exceeded'))
        return 'limit exceeded';
    if (msg.includes('404'))
        return 'not found';
    return msg.slice(0, 60);
}
//# sourceMappingURL=fallback.js.map