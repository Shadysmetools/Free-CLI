/** Natural-language intent router — layered local heuristic + hybrid matcher. Never throws. */
import { hybridSearch as realHybrid } from '../match/hybrid';
export type Intent = 'research' | 'goal' | 'workflow' | 'skill' | 'chat';
export interface RouteDecision {
    kind: Intent;
    target?: string;
    confidence: number;
    reason: string;
}
export interface RouterContext {
    skills: Array<{
        name: string;
        description: string;
    }>;
    workflows: Array<{
        name: string;
        description?: string;
    }>;
    threshold: number;
    /** Optional semantic embed for the hybrid named-item match; absent → BM25-only. */
    embed?: (texts: string[]) => Promise<number[][] | null>;
}
export interface RouterDeps {
    hybrid?: typeof realHybrid;
}
export declare function classifyIntent(text: string, ctx: RouterContext, deps?: RouterDeps): Promise<RouteDecision>;
/** Pure helper for the `/router on|off|status` slash command. Mutates settings.router in place. */
export declare function applyRouterCommand(settings: {
    router?: {
        enabled?: boolean;
        confidenceThreshold?: number;
    };
}, arg?: string): {
    message: string;
    changed: boolean;
};
//# sourceMappingURL=router.d.ts.map