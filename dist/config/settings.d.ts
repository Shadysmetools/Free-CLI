export interface ProviderConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    headers?: Record<string, string>;
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
    budget?: number;
    permissions?: {
        enabled?: boolean;
        projectRoot?: string;
        allow?: string[];
        ask?: string[];
        deny?: string[];
        unattended?: 'deny' | 'allow';
        confirmDefault?: 'approve' | 'skip';
    };
}
/** Return a fresh deep clone of the built-in default settings (no file/env reads). */
export declare function getDefaultSettings(): Settings;
export declare function loadSettings(): Settings;
export declare function saveSettings(settings: Settings): void;
export declare function getConfigDir(): string;
//# sourceMappingURL=settings.d.ts.map