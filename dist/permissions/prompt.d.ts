import { ConfirmRequest, ConfirmChoice, Verdict } from './types';
export declare function buildPreview(toolName: string, args: Record<string, unknown>, verdict: Verdict): string;
export declare function defaultConfirm(req: ConfirmRequest): Promise<ConfirmChoice>;
//# sourceMappingURL=prompt.d.ts.map