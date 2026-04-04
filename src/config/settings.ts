import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface OpenClawConfig {
  url: string;
  token?: string;
}

export interface Settings {
  defaultProvider: string;
  defaultModel: string;
  providers: Record<string, ProviderConfig>;
  mcp?: {
    servers: Record<string, MCPServerConfig>;
  };
  ui: {
    color: boolean;
    markdown: boolean;
    streamingOutput: boolean;
  };
  whisper?: {
    model: string;
    language?: string;
  };
  openclaw?: OpenClawConfig;
  budget?: number;  // Session budget limit in USD
}

// Windows: use %APPDATA%\knowcap-code, Unix: ~/.knowcap-code
const CONFIG_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA ?? os.homedir(), 'knowcap-code')
  : path.join(os.homedir(), '.knowcap-code');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

const DEFAULT_SETTINGS: Settings = {
  defaultProvider: 'ollama',
  defaultModel: 'qwen2.5-coder:7b',
  providers: {
    ollama: {
      baseUrl: 'http://localhost:11434',
      model: 'qwen2.5-coder:7b',
    },
    groq: {
      model: 'llama-3.3-70b-versatile',
    },
    anthropic: {
      model: 'claude-3-5-haiku-20241022',
    },
    openai: {
      model: 'gpt-4o-mini',
    },
    google: {
      model: 'gemini-2.0-flash',
    },
    openrouter: {
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'meta-llama/llama-3.3-70b-instruct:free',
    },
  },
  ui: {
    color: true,
    markdown: true,
    streamingOutput: true,
  },
  whisper: {
    model: 'base',
  },
};

export function loadSettings(): Settings {
  // Start with defaults
  let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;

  // Load from config file
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const loaded = yaml.parse(raw) as Partial<Settings>;
      settings = deepMerge(settings, loaded);
    } catch {
      // ignore parse errors, use defaults
    }
  }

  // Override with env vars
  if (process.env.ANTHROPIC_API_KEY) {
    settings.providers.anthropic = settings.providers.anthropic || {};
    settings.providers.anthropic.apiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.OPENAI_API_KEY) {
    settings.providers.openai = settings.providers.openai || {};
    settings.providers.openai.apiKey = process.env.OPENAI_API_KEY;
  }
  if (process.env.GROQ_API_KEY) {
    settings.providers.groq = settings.providers.groq || {};
    settings.providers.groq.apiKey = process.env.GROQ_API_KEY;
  }
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
    settings.providers.google = settings.providers.google || {};
    settings.providers.google.apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  }
  if (process.env.OPENROUTER_API_KEY) {
    settings.providers.openrouter = settings.providers.openrouter || {};
    settings.providers.openrouter.apiKey = process.env.OPENROUTER_API_KEY;
  }
  if (process.env.OLLAMA_BASE_URL) {
    settings.providers.ollama = settings.providers.ollama || {};
    settings.providers.ollama.baseUrl = process.env.OLLAMA_BASE_URL;
  }

  return settings;
}

export function saveSettings(settings: Settings): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, yaml.stringify(settings), 'utf-8');
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    const val = source[key];
    if (val !== null && val !== undefined) {
      if (typeof val === 'object' && !Array.isArray(val) && typeof result[key] === 'object') {
        result[key] = deepMerge(result[key] as object, val as object) as T[typeof key];
      } else {
        result[key] = val as T[typeof key];
      }
    }
  }
  return result;
}
