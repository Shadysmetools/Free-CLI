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
    user: (s: string) => string;
    assistant: (s: string) => string;
    system: (s: string) => string;
    tool: (s: string) => string;
};
export declare function printBanner(): void;
export declare function printHelp(): void;
export declare function printMessage(role: 'user' | 'assistant' | 'system' | 'tool', content: string): void;
export declare function printError(msg: string): void;
export declare function printSuccess(msg: string): void;
export declare function printInfo(msg: string): void;
export declare function printToolCall(toolName: string, input: Record<string, unknown>): void;
export declare function printToolResult(toolName: string, result: string): void;
export declare function printStatus(provider: string, model: string, tokens: number, cost: number): void;
export declare function printDivider(): void;
export declare function createSpinner(text: string): {
    start: () => void;
    stop: (final?: string) => void;
};
//# sourceMappingURL=terminal.d.ts.map