/**
 * config.ts — Bot YAML config loader
 *
 * Config file: ~/.knowcap-code/bot.yaml
 * Creates default config on first run.
 */
export interface BotTelegramConfig {
    token: string;
    /** Allowlisted Telegram user IDs (numeric). Empty = deny all. */
    allowed_users: number[];
    /** Group IDs the bot works in. '*' = all groups. */
    allowed_groups: Array<number | string>;
    /** Admin user IDs who can run /admin commands */
    admin_users: number[];
    /** Require @mention in groups */
    require_mention: boolean;
    /** Enable webhook mode instead of long polling */
    webhook_url?: string;
    webhook_port?: number;
    webhook_secret?: string;
}
export interface BotProviderConfig {
    provider: string;
    model: string;
}
export interface BotFeaturesConfig {
    shell: boolean;
    files: boolean;
    web_search: boolean;
    code_exec: boolean;
    memory: boolean;
    voice: boolean;
    images: boolean;
    diagrams: boolean;
    scheduler: boolean;
    streaming: boolean;
}
export interface BotSecurityConfig {
    sandbox: boolean;
    sandbox_dir: string;
    max_output: number;
    blocked_commands: string[];
    rate_limit_per_minute: number;
    rate_limit_burst: number;
}
export interface BotSchedulerConfig {
    enabled: boolean;
    store: string;
    timezone: string;
}
export interface BotUIConfig {
    ack_reaction: string;
    typing_indicator: boolean;
    chunk_size: number;
    stream_edits: boolean;
    link_previews: boolean;
}
export interface BotConfig {
    telegram: BotTelegramConfig;
    provider: string;
    model: string;
    features: BotFeaturesConfig;
    security: BotSecurityConfig;
    scheduler: BotSchedulerConfig;
    ui: BotUIConfig;
}
export declare function getBotConfigPath(): string;
export declare function loadBotConfig(): BotConfig;
export declare function saveBotConfig(config: BotConfig): void;
export declare function validateBotConfig(config: BotConfig): string[];
//# sourceMappingURL=config.d.ts.map