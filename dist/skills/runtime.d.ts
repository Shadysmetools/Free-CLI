/**
 * Module-level holder for the SkillsManager so the `skill` tool can reach it at
 * call time without threading it through executeTool's signature. Same singleton
 * pattern as workflow/runtime.ts. The CLI sets it once after skills.loadAll().
 */
import { SkillsManager } from './index';
export declare function setSkillsRuntime(m: SkillsManager): void;
export declare function getSkillsRuntime(): SkillsManager | null;
export declare function clearSkillsRuntime(): void;
//# sourceMappingURL=runtime.d.ts.map