export interface TranscribeOptions {
    model?: string;
    language?: string;
    outputFormat?: string;
}
export interface TranscribeResult {
    text: string;
    language?: string;
    duration?: number;
}
export declare function transcribeFile(filePath: string, options?: TranscribeOptions): Promise<TranscribeResult>;
export declare function transcribeViaGroq(filePath: string, apiKey: string, options?: TranscribeOptions): Promise<TranscribeResult>;
export declare function getWhisperInstallInstructions(): string;
//# sourceMappingURL=transcribe.d.ts.map