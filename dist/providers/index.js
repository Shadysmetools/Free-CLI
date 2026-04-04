"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVIDER_INFO = exports.FREE_PROVIDERS = exports.PROVIDER_LIST = void 0;
exports.createProvider = createProvider;
const ollama_1 = require("./ollama");
const groq_1 = require("./groq");
const anthropic_1 = require("./anthropic");
const openai_1 = require("./openai");
const google_1 = require("./google");
const openrouter_1 = require("./openrouter");
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
            return new google_1.GoogleProvider(cfg.model || 'gemini-2.0-flash', cfg.apiKey);
        case 'openrouter':
            return new openrouter_1.OpenRouterProvider(cfg.model || 'meta-llama/llama-3.3-70b-instruct:free', cfg.apiKey, cfg.baseUrl);
        default:
            throw new Error(`Unknown provider: ${providerName}`);
    }
}
exports.PROVIDER_LIST = ['ollama', 'groq', 'anthropic', 'openai', 'google', 'openrouter'];
exports.FREE_PROVIDERS = ['ollama', 'groq', 'google', 'openrouter'];
exports.PROVIDER_INFO = {
    ollama: { description: 'Local models — completely free, no API key', requiresKey: false, free: true },
    groq: { description: 'Ultra-fast inference — free tier available', requiresKey: true, free: true },
    google: { description: 'Gemini models — free tier via AI Studio', requiresKey: true, free: true },
    openrouter: { description: 'Many models including free ones', requiresKey: true, free: true },
    anthropic: { description: 'Claude models (BYOK)', requiresKey: true, free: false },
    openai: { description: 'GPT models (BYOK)', requiresKey: true, free: false },
};
//# sourceMappingURL=index.js.map