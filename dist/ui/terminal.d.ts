/**
 * Terminal UI — ChatGPT-clean output
 *
 * Design principles:
 *   • Show WHAT happened, not HOW (no raw JSON, no boxes for tool calls)
 *   • Response appears inline with "AI  › " prefix (no blank line)
 *   • Token stats as dim footer AFTER response
 *   • Tool calls as compact one-liners
 *   • Code blocks with line numbers + syntax highlighting
 *   • Inquirer-powered interactive choices everywhere
 */
export declare let verboseMode: boolean;
export declare function setVerboseMode(v: boolean): void;
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
/**
 * Writes "  emoji tool_name → arg" WITHOUT trailing newline.
 * printToolResult() will append the result info on the same line.
 */
export declare function printToolCall(toolName: string, input: Record<string, unknown>): void;
/**
 * Appends " (N lines)" to the tool call line, or shows full output in verbose mode.
 */
export declare function printToolResult(_toolName: string, result: string): void;
/**
 * Format: "  model · 1,234 tokens · free"  (dim, shown after AI response)
 */
export declare function printResponseFooter(provider: string, model: string, tokenLine: string): void;
/**
 * Renders a file/code block with line numbers and (optional) syntax highlighting.
 * Used for verbose file reads and explicit code display.
 */
export declare function printCodeBlock(code: string, lang?: string, filename?: string): void;
export interface PlanStep {
    num: number;
    icon: string;
    role: string;
    description: string;
    target?: string;
    estMin?: number;
}
export declare function printPlanBox(title: string, steps: PlanStep[], summary?: string): void;
export declare function printFileOp(action: 'created' | 'updated' | 'deleted', filePath: string, extra?: string): void;
export declare function printStatus(provider: string, model: string, tokens: number, cost: number): void;
export declare function printDivider(): void;
export declare function printSectionHeader(title: string): void;
export declare function printBox(title: string, content: string, color?: 'cyan' | 'green' | 'yellow' | 'red' | 'magenta'): void;
export declare function createSpinner(text: string): {
    start: () => void;
    stop: (final?: string) => void;
};
//# sourceMappingURL=terminal.d.ts.map