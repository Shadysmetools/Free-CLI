/**
 * Terminal UI — improved display matching Claude Code quality
 *
 * Color scheme:
 *   Blue/Cyan  = AI responses, prompts
 *   Green      = success, tool results
 *   Red        = errors
 *   Yellow     = warnings, tool calls
 *   Magenta    = file paths, memory
 *   Dim/Gray   = metadata, status lines
 */
export declare const colors: {
    primary: (s: string) => string;
    secondary: (s: string) => string;
    success: (s: string) => string;
    error: (s: string) => string;
    warning: (s: string) => string;
    info: (s: string) => string;
    bold: (s: string) => string;
    dim: (s: string) => string;
    code: (s: string) => string;
    filePath: (s: string) => string;
    user: (s: string) => string;
    assistant: (s: string) => string;
    system: (s: string) => string;
    tool: (s: string) => string;
    memory: (s: string) => string;
    skill: (s: string) => string;
};
export declare function printBanner(): void;
export declare function printHelp(): void;
export declare function printMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string): void;
export declare function printError(msg: string): void;
export declare function printSuccess(msg: string): void;
export declare function printInfo(msg: string): void;
export declare function printWarning(msg: string): void;
export declare function printToolCall(toolName: string, input: Record<string, unknown>): void;
export declare function printToolResult(toolName: string, result: string): void;
/**
 * Shown after every AI response.
 * Format: [provider/model · 1,234 in / 567 out · $0.00]
 */
export declare function printResponseFooter(provider: string, model: string, tokenLine: string): void;
/**
 * Legacy status for one-shot mode
 */
export declare function printStatus(provider: string, model: string, tokens: number, cost: number): void;
export declare function printDivider(): void;
export declare function printSectionHeader(title: string): void;
export declare function printBox(title: string, content: string, color?: 'cyan' | 'green' | 'yellow' | 'red' | 'magenta'): void;
export declare function createSpinner(text: string): {
    start: () => void;
    stop: (final?: string) => void;
};
//# sourceMappingURL=terminal.d.ts.map