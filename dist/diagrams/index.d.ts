/**
 * Diagram & Image Generation
 *
 * Mermaid diagrams — rendered via @mermaid-js/mermaid-cli (mmdc)
 *   Flowcharts, sequence, class, ER, Gantt, architecture, mindmap
 *
 * Image generation — AI-powered, provider-dependent
 *   OpenAI DALL-E 3 (requires OPENAI_API_KEY)
 *   Stability AI (requires STABILITY_API_KEY)
 *   Graceful skip if no image API available
 */
export type DiagramType = 'flowchart' | 'sequence' | 'class' | 'er' | 'gantt' | 'architecture' | 'mindmap' | 'timeline' | 'mermaid';
export interface DiagramResult {
    outputPath: string;
    format: 'png' | 'svg';
    type: DiagramType;
    mermaidCode: string;
    sizeBytes: number;
}
export interface ImageResult {
    outputPath: string;
    provider: 'dalle' | 'stability' | 'placeholder';
    prompt: string;
    sizeBytes: number;
}
/**
 * Ensure the Mermaid code block starts with the right directive.
 * If the code already has a directive, leave it alone.
 */
export declare function normaliseMermaid(code: string, type: DiagramType): string;
export interface GenerateDiagramOpts {
    type?: DiagramType;
    code: string;
    outputPath: string;
    format?: 'png' | 'svg';
    width?: number;
    backgroundColor?: string;
    /** called with progress messages */
    onProgress?: (msg: string) => void;
}
export declare function generateDiagram(opts: GenerateDiagramOpts): Promise<DiagramResult>;
/** Return a display-friendly excerpt of Mermaid code (max 8 lines) */
export declare function mermaidPreview(code: string): string;
export interface GenerateImageOpts {
    prompt: string;
    outputPath: string;
    size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
    style?: 'vivid' | 'natural';
    openaiKey?: string;
    stabilityKey?: string;
    onProgress?: (msg: string) => void;
}
export declare function generateImage(opts: GenerateImageOpts): Promise<ImageResult>;
/** Guess diagram type from a user description */
export declare function detectDiagramType(description: string): DiagramType;
/** Build a prompt that asks the AI to produce a specific diagram type */
export declare function buildDiagramPrompt(description: string, type: DiagramType): string;
//# sourceMappingURL=index.d.ts.map