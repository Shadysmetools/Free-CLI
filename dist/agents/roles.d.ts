/**
 * Built-in Agent Roles
 *
 * Each role has a system prompt, icon, and specialization.
 * Inspired by Claude Code's agent patterns (architect, coder, reviewer, etc.)
 */
export interface AgentRole {
    id: string;
    name: string;
    icon: string;
    description: string;
    systemPrompt: string;
    /** Tools this role is allowed to use (undefined = all) */
    allowedTools?: string[];
}
export declare const BUILTIN_ROLES: Record<string, AgentRole>;
export declare function getRole(id: string): AgentRole | undefined;
export declare function listRoles(): AgentRole[];
//# sourceMappingURL=roles.d.ts.map