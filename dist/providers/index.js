"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVIDER_MODELS = exports.PROVIDER_INFO = exports.FREE_PROVIDERS = exports.PROVIDER_LIST = void 0;
exports.createProvider = createProvider;
const ollama_1 = require("./ollama");
const groq_1 = require("./groq");
const anthropic_1 = require("./anthropic");
const openai_1 = require("./openai");
const google_1 = require("./google");
const openrouter_1 = require("./openrouter");
const mistral_1 = require("./mistral");
const custom_1 = require("./custom");
function createProvider(providerName, settings) {
    const cfg = settings.providers[providerName] || {};
    switch (providerName) {
        case 'ollama':
            return new ollama_1.OllamaProvider(cfg.model || settings.defaultModel || 'qwen2.5-coder:7b', cfg.baseUrl || 'http://localhost:11434');
        case 'groq':
            return new groq_1.GroqProvider(cfg.model || 'llama-3.3-70b-versatile', cfg.apiKey);
        case 'anthropic':
            return new anthropic_1.AnthropicProvider(cfg.model || 'claude-3-5-haiku-20241022', cfg.apiKey);
        case 'openai':
            return new openai_1.OpenAIProvider(cfg.model || 'gpt-4o-mini', cfg.apiKey, cfg.baseUrl);
        case 'google':
            return new google_1.GoogleProvider(cfg.model || 'gemini-2.5-flash', cfg.apiKey);
        case 'openrouter':
            return new openrouter_1.OpenRouterProvider(cfg.model || 'openrouter/free', cfg.apiKey, cfg.baseUrl);
        case 'mistral':
            return new mistral_1.MistralProvider(cfg.model || 'devstral-small-latest', cfg.apiKey);
        case 'custom':
            return new custom_1.CustomProvider(cfg.model || process.env.CUSTOM_MODEL || 'gpt-4o-mini', cfg.apiKey, cfg.baseUrl, cfg.headers);
        default:
            throw new Error(`Unknown provider: ${providerName}`);
    }
}
exports.PROVIDER_LIST = ['ollama', 'groq', 'anthropic', 'openai', 'google', 'openrouter', 'mistral', 'custom'];
exports.FREE_PROVIDERS = ['ollama', 'groq', 'google', 'openrouter', 'mistral'];
exports.PROVIDER_INFO = {
    ollama: { description: 'Local models — completely free, no API key', requiresKey: false, free: true },
    groq: { description: 'Ultra-fast inference — free tier available', requiresKey: true, free: true },
    google: { description: 'Gemini models — free tier via AI Studio', requiresKey: true, free: true },
    openrouter: { description: 'Many models including free ones', requiresKey: true, free: true },
    anthropic: { description: 'Claude models (BYOK)', requiresKey: true, free: false },
    openai: { description: 'GPT models (BYOK)', requiresKey: true, free: false },
    mistral: { description: 'Mistral/Devstral/Codestral — free tier', requiresKey: true, free: true },
    custom: { description: 'Any OpenAI-compatible endpoint (base URL + key + model)', requiresKey: true, free: false },
};
/**
 * Curated model lists per provider (for /models command and tab-completion).
 * Keep these up-to-date as providers release new models.
 * Last updated: 2026-04
 */
exports.PROVIDER_MODELS = {
    openrouter: [
        { id: 'openrouter/free', label: 'Auto (best free model)', free: true, recommended: true },
        { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1 (reasoning)', free: true },
        { id: 'deepseek/deepseek-r1-0528:free', label: 'DeepSeek R1 0528', free: true },
        { id: 'google/gemma-3-27b-it:free', label: 'Google Gemma 3 27B', free: true },
        { id: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral Small 3.1 24B', free: true },
        { id: 'qwen/qwen3-6b:free', label: 'Qwen 3 6B', free: true },
        { id: 'nvidia/llama-3.1-nemotron-70b-instruct:free', label: 'NVIDIA Nemotron 70B', free: true },
    ],
    groq: [
        { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile', free: true, recommended: true },
        { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', free: true },
        { id: 'gemma2-9b-it', label: 'Gemma 2 9B', free: true },
        { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill 70B', free: true },
        { id: 'llama-3.2-90b-vision-preview', label: 'Llama 3.2 90B Vision', free: true },
    ],
    google: [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (free tier)', free: true, recommended: true },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (free tier)', free: true },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (free, 5 RPM)', free: true },
        // gemini-2.0-flash was deprecated Feb 2026, shut down Jun 2026
    ],
    ollama: [
        { id: 'qwen2.5-coder:7b', label: 'Qwen 2.5 Coder 7B', free: true, recommended: true },
        { id: 'qwen2.5-coder:14b', label: 'Qwen 2.5 Coder 14B', free: true },
        { id: 'llama3.2:3b', label: 'Llama 3.2 3B', free: true },
        { id: 'llama3.3:70b', label: 'Llama 3.3 70B', free: true },
        { id: 'deepseek-coder-v2', label: 'DeepSeek Coder V2', free: true },
        { id: 'gemma3:12b', label: 'Gemma 3 12B', free: true },
        { id: 'phi4', label: 'Phi-4 14B', free: true },
    ],
    mistral: [
        { id: 'devstral-small-latest', label: 'Devstral Small (coding, free)', free: true, recommended: true },
        { id: 'mistral-small-latest', label: 'Mistral Small (fast)', free: true },
        { id: 'codestral-latest', label: 'Codestral (code-optimized)', free: false },
        { id: 'mistral-large-latest', label: 'Mistral Large (best)', free: false },
        { id: 'open-mistral-nemo', label: 'Mistral Nemo 12B (free)', free: true },
        { id: 'pixtral-large-latest', label: 'Pixtral Large (vision)', free: false },
    ],
    anthropic: [
        { id: 'claude-opus-4-5', label: 'Claude Opus 4.5 (best)', free: false, recommended: true },
        { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (fast)', free: false },
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (cheapest)', free: false },
        { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', free: false },
    ],
    openai: [
        { id: 'gpt-4o', label: 'GPT-4o', free: false, recommended: true },
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini', free: false },
        { id: 'o1-mini', label: 'o1 Mini (reason)', free: false },
        { id: 'o3-mini', label: 'o3 Mini (reason)', free: false },
    ],
    custom: [
        // The model id for a custom endpoint is user-defined (CUSTOM_MODEL /
        // providers.custom.model). This entry is a placeholder for /models UX.
        { id: 'gpt-4o-mini', label: 'Custom endpoint model (set CUSTOM_MODEL)', free: false, recommended: true },
    ],
};
//# sourceMappingURL=index.js.map