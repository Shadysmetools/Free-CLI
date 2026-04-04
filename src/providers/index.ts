import { Settings } from '../config/settings';
import { OllamaProvider } from './ollama';
import { GroqProvider } from './groq';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { GoogleProvider } from './google';
import { OpenRouterProvider } from './openrouter';

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required?: string[];
  };
}

export interface CompletionOptions {
  messages: Message[];
  tools?: Tool[];
  stream?: boolean;
  onToken?: (token: string) => void;
}

export interface CompletionResult {
  content: string;
  tool_calls?: ToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface Provider {
  name: string;
  model: string;
  complete(options: CompletionOptions): Promise<CompletionResult>;
  isAvailable(): Promise<boolean>;
}

export function createProvider(providerName: string, settings: Settings): Provider {
  const cfg = settings.providers[providerName] || {};

  switch (providerName) {
    case 'ollama':
      return new OllamaProvider(
        cfg.model || settings.defaultModel || 'qwen2.5-coder:7b',
        cfg.baseUrl || 'http://localhost:11434'
      );
    case 'groq':
      return new GroqProvider(
        cfg.model || 'llama-3.3-70b-versatile',
        cfg.apiKey
      );
    case 'anthropic':
      return new AnthropicProvider(
        cfg.model || 'claude-3-5-haiku-20241022',
        cfg.apiKey
      );
    case 'openai':
      return new OpenAIProvider(
        cfg.model || 'gpt-4o-mini',
        cfg.apiKey,
        cfg.baseUrl
      );
    case 'google':
      return new GoogleProvider(
        cfg.model || 'gemini-2.0-flash',
        cfg.apiKey
      );
    case 'openrouter':
      return new OpenRouterProvider(
        cfg.model || 'meta-llama/llama-3.3-70b-instruct:free',
        cfg.apiKey,
        cfg.baseUrl
      );
    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

export const PROVIDER_LIST = ['ollama', 'groq', 'anthropic', 'openai', 'google', 'openrouter'] as const;
export type ProviderName = typeof PROVIDER_LIST[number];

export const FREE_PROVIDERS = ['ollama', 'groq', 'google', 'openrouter'] as const;

export const PROVIDER_INFO: Record<string, { description: string; requiresKey: boolean; free: boolean }> = {
  ollama: { description: 'Local models — completely free, no API key', requiresKey: false, free: true },
  groq: { description: 'Ultra-fast inference — free tier available', requiresKey: true, free: true },
  google: { description: 'Gemini models — free tier via AI Studio', requiresKey: true, free: true },
  openrouter: { description: 'Many models including free ones', requiresKey: true, free: true },
  anthropic: { description: 'Claude models (BYOK)', requiresKey: true, free: false },
  openai: { description: 'GPT models (BYOK)', requiresKey: true, free: false },
};
