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
    budget?: number;
}
export declare function loadSettings(): Settings;
export declare function saveSettings(settings: Settings): void;
export declare function getConfigDir(): string;
//# sourceMappingURL=settings.d.ts.map