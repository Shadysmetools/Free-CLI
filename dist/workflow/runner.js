"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScopedRegistry = buildScopedRegistry;
exports.runSubAgent = runSubAgent;
const index_1 = require("../registry/index");
const tools_1 = require("../agent/tools");
const conversation_1 = require("../agent/conversation");
const core_1 = require("../agent/core");
const roles_1 = require("../agents/roles");
const index_2 = require("../providers/index");
/** Build a registry containing only `allowed` tools (pulled from the parent's full list).
 *
 * Falls back to the built-in TOOLS constant for any name not found in the parent — this
 * handles environments (e.g. vitest ESM) where createDefaultRegistry()'s lazy require()
 * silently fails to populate the parent with file tools.
 */
function buildScopedRegistry(parent, allowed) {
    const scoped = new index_1.ToolRegistry();
    const all = parent.list();
    /** Look up a tool by name: parent first, then the builtin TOOLS array. */
    function resolve(name) {
        const found = all.find(t => t.name === name);
        if (found)
            return { tool: asTool(found), category: found.category, source: found.source };
        const builtin = tools_1.TOOLS.find(t => t.name === name);
        if (builtin)
            return { tool: builtin, category: 'custom', source: 'builtin' };
        return undefined;
    }
    if (!allowed) {
        const enabledNames = new Set(parent.getEnabled().map(t => t.name));
        for (const t of all) {
            if (enabledNames.has(t.name)) {
                scoped.register(asTool(t), t.category, t.source);
            }
        }
        return scoped;
    }
    for (const name of allowed) {
        const r = resolve(name);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (r)
            scoped.register(r.tool, r.category, r.source);
    }
    return scoped;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asTool(t) { return { name: t.name, description: t.description, parameters: t.parameters }; }
/** Resolve provider, applying a per-spec model override without mutating shared settings. */
function resolveProvider(spec, ctx) {
    const name = spec.provider ?? ctx.defaultProviderName;
    const factory = ctx.providerFactory ?? index_2.createProvider;
    if (!spec.model)
        return factory(name, ctx.settings);
    const cloned = JSON.parse(JSON.stringify(ctx.settings));
    cloned.providers[name] = { ...(cloned.providers[name] ?? {}), model: spec.model };
    return factory(name, cloned);
}
async function runSubAgent(spec, ctx) {
    const role = spec.role ? (0, roles_1.getRole)(spec.role) : undefined;
    const systemPrompt = spec.systemPrompt ?? role?.systemPrompt ?? 'You are a focused coding sub-agent. Complete the task and report the result concisely.';
    const allowedTools = spec.tools ?? role?.allowedTools;
    const scoped = buildScopedRegistry(ctx.parentRegistry, allowedTools);
    const maxRetries = Math.max(0, spec.maxRetries ?? 2);
    try {
        const provider = resolveProvider(spec, ctx);
        let lastContent = '';
        let lastUsage;
        let feedback = '';
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const conv = (0, conversation_1.createConversation)(systemPrompt);
            const task = feedback
                ? `${spec.task}\n\n[Revise — previous attempt failed validation: ${feedback}]`
                : spec.task;
            const result = await (0, core_1.runAgent)(provider, conv, task, {
                cwd: ctx.cwd,
                stream: false,
                maxIterations: spec.maxIterations ?? 6,
                registry: scoped,
                mcpClient: ctx.mcpClient,
                memory: ctx.memory,
                skills: ctx.skills,
                tokenTracker: ctx.tokenTracker,
                permissions: ctx.permissions,
                unattended: ctx.unattended,
                sessionAllow: ctx.sessionAllow,
            });
            lastContent = result.content;
            lastUsage = result.usage;
            // runAgent catches provider errors internally and returns { content: 'Error: <msg>' }
            // with no `usage` field, rather than throwing. Require BOTH conditions to avoid
            // mis-classifying a legitimate answer that begins with "Error: " as a failure.
            if (!result.usage && result.content.startsWith('Error: ')) {
                const msg = result.content.slice('Error: '.length);
                return { ok: false, content: result.content, role: spec.role, task: spec.task, error: msg };
            }
            if (!spec.validate) {
                return { ok: true, content: lastContent, role: spec.role, task: spec.task, usage: lastUsage };
            }
            const verdict = spec.validate(lastContent);
            if (verdict.ok) {
                return { ok: true, content: lastContent, role: spec.role, task: spec.task, usage: lastUsage };
            }
            feedback = verdict.feedback ?? 'output rejected by guardrail';
        }
        return { ok: false, content: lastContent, role: spec.role, task: spec.task, usage: lastUsage, error: `guardrail failed after ${maxRetries + 1} attempts` };
    }
    catch (err) {
        const msg = err.message;
        return { ok: false, content: msg, role: spec.role, task: spec.task, error: msg };
    }
}
//# sourceMappingURL=runner.js.map