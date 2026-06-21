"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
exports.getConfigDir = getConfigDir;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const yaml = __importStar(require("yaml"));
// Windows: use %APPDATA%\coderaw, Unix: ~/.coderaw
const CONFIG_DIR = process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? os.homedir(), 'coderaw')
    : path.join(os.homedir(), '.coderaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');
const DEFAULT_SETTINGS = {
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
            model: 'gemini-2.5-flash',
        },
        openrouter: {
            baseUrl: 'https://openrouter.ai/api/v1',
            model: 'openrouter/free',
        },
        custom: {
            model: 'gpt-4o-mini',
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
    permissions: {
        enabled: true,
        projectRoot: 'auto',
        allow: [],
        ask: [],
        deny: [],
        unattended: 'deny',
        confirmDefault: 'approve',
    },
};
function loadSettings() {
    // Start with defaults
    let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    // Load from config file
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
            const loaded = yaml.parse(raw);
            settings = deepMerge(settings, loaded);
        }
        catch {
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
    if (process.env.CUSTOM_API_KEY || process.env.CUSTOM_BASE_URL || process.env.CUSTOM_MODEL) {
        settings.providers.custom = settings.providers.custom || {};
        if (process.env.CUSTOM_API_KEY)
            settings.providers.custom.apiKey = process.env.CUSTOM_API_KEY;
        if (process.env.CUSTOM_BASE_URL)
            settings.providers.custom.baseUrl = process.env.CUSTOM_BASE_URL;
        if (process.env.CUSTOM_MODEL)
            settings.providers.custom.model = process.env.CUSTOM_MODEL;
    }
    return settings;
}
function saveSettings(settings) {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, yaml.stringify(settings), 'utf-8');
}
function getConfigDir() {
    return CONFIG_DIR;
}
function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        const val = source[key];
        if (val !== null && val !== undefined) {
            if (typeof val === 'object' && !Array.isArray(val) && typeof result[key] === 'object') {
                result[key] = deepMerge(result[key], val);
            }
            else {
                result[key] = val;
            }
        }
    }
    return result;
}
//# sourceMappingURL=settings.js.map