/**
 * REST API Server — `kcc serve --port 3333`
 *
 * Endpoints:
 *   POST /api/chat       — send message, get AI response
 *   POST /api/transcribe — transcribe audio/video file
 *   GET  /api/tools      — list available tools
 *   GET  /api/status     — health + usage stats
 *   GET  /api/models     — list available providers/models
 */
export interface ServerOptions {
    port: number;
    host?: string;
    cwd?: string;
}
export declare function startApiServer(opts: ServerOptions): Promise<void>;
//# sourceMappingURL=api.d.ts.map