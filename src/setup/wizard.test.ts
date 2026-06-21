import { describe, it, expect } from 'vitest';
import { buildSettingsFromAnswers, WizardAnswers } from './wizard';

// ─── buildSettingsFromAnswers (pure mapping) ──────────────────────────────────
//
// This is the testable seam of the onboarding wizard. The interactive inquirer
// prompts are thin I/O wrappers around this pure function, which maps the
// collected answers onto a valid Settings object (built on top of the defaults).

describe('buildSettingsFromAnswers', () => {
  it('defaults to Ollama (local, free) with no api key required', () => {
    const answers: WizardAnswers = { provider: 'ollama' };
    const s = buildSettingsFromAnswers(answers);

    expect(s.defaultProvider).toBe('ollama');
    // Default ollama model carried over from settings defaults
    expect(s.defaultModel).toBe('qwen2.5-coder:7b');
    expect(s.providers.ollama.model).toBe('qwen2.5-coder:7b');
    expect(s.providers.ollama.baseUrl).toBe('http://localhost:11434');
    // No api key on the local provider
    expect(s.providers.ollama.apiKey).toBeUndefined();
  });

  it('respects a custom ollama model when supplied', () => {
    const s = buildSettingsFromAnswers({ provider: 'ollama', model: 'llama3.1:8b' });
    expect(s.defaultProvider).toBe('ollama');
    expect(s.defaultModel).toBe('llama3.1:8b');
    expect(s.providers.ollama.model).toBe('llama3.1:8b');
  });

  it('places the api key on a cloud provider and selects it as default', () => {
    const answers: WizardAnswers = {
      provider: 'anthropic',
      model: 'claude-3-5-haiku-20241022',
      apiKey: 'sk-ant-secret-key-1234567890',
    };
    const s = buildSettingsFromAnswers(answers);

    expect(s.defaultProvider).toBe('anthropic');
    expect(s.defaultModel).toBe('claude-3-5-haiku-20241022');
    expect(s.providers.anthropic.apiKey).toBe('sk-ant-secret-key-1234567890');
    expect(s.providers.anthropic.model).toBe('claude-3-5-haiku-20241022');
    // Other providers keep their defaults and stay key-less
    expect(s.providers.openai.apiKey).toBeUndefined();
  });

  it('falls back to the provider default model when none is supplied', () => {
    const s = buildSettingsFromAnswers({ provider: 'groq', apiKey: 'gsk_abcdef 1234567890'.replace(' ', '') });
    expect(s.defaultProvider).toBe('groq');
    // groq default model from DEFAULT_SETTINGS
    expect(s.defaultModel).toBe('llama-3.3-70b-versatile');
    expect(s.providers.groq.model).toBe('llama-3.3-70b-versatile');
  });

  it('configures the custom OpenAI-compatible provider with baseUrl + key', () => {
    const answers: WizardAnswers = {
      provider: 'custom',
      model: 'my-local-model',
      apiKey: 'sk-custom-key-0987654321',
      baseUrl: 'https://my-gateway.example.com/v1',
    };
    const s = buildSettingsFromAnswers(answers);

    expect(s.defaultProvider).toBe('custom');
    expect(s.defaultModel).toBe('my-local-model');
    expect(s.providers.custom.apiKey).toBe('sk-custom-key-0987654321');
    expect(s.providers.custom.baseUrl).toBe('https://my-gateway.example.com/v1');
    expect(s.providers.custom.model).toBe('my-local-model');
  });

  it('preserves the rest of the default Settings (ui, permissions)', () => {
    const s = buildSettingsFromAnswers({ provider: 'ollama' });
    expect(s.ui.color).toBe(true);
    expect(s.ui.markdown).toBe(true);
    expect(s.permissions?.enabled).toBe(true);
    // Untouched providers still present with their defaults
    expect(s.providers.openrouter.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('does not mutate the shared defaults across calls', () => {
    const a = buildSettingsFromAnswers({ provider: 'anthropic', apiKey: 'sk-ant-key-111111111' });
    const b = buildSettingsFromAnswers({ provider: 'ollama' });
    // b must not see a's anthropic key
    expect(b.providers.anthropic.apiKey).toBeUndefined();
    expect(a.providers.anthropic.apiKey).toBe('sk-ant-key-111111111');
  });
});
