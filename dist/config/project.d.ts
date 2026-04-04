export interface ProjectConfig {
    memoryFile: string | null;
    memoryContent: string | null;
    projectRoot: string;
    gitRoot: string | null;
}
export declare function loadProjectConfig(cwd?: string): ProjectConfig;
export declare function findGitRoot(cwd: string): string | null;
export declare function initProjectMemory(cwd: string): string;
//# sourceMappingURL=project.d.ts.map