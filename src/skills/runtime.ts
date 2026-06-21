/**
 * Module-level holder for the SkillsManager so the `skill` tool can reach it at
 * call time without threading it through executeTool's signature. Same singleton
 * pattern as workflow/runtime.ts. The CLI sets it once after skills.loadAll().
 */
import { SkillsManager } from './index';

let current: SkillsManager | null = null;

export function setSkillsRuntime(m: SkillsManager): void {
  current = m;
}

export function getSkillsRuntime(): SkillsManager | null {
  return current;
}

export function clearSkillsRuntime(): void {
  current = null;
}
