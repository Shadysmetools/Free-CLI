"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKFLOW_TOOLS = void 0;
exports.registerWorkflowTools = registerWorkflowTools;
exports.executeWorkflowTool = executeWorkflowTool;
const primitives_1 = require("./primitives");
const runner_1 = require("./runner");
const runtime_1 = require("./runtime");
exports.WORKFLOW_TOOLS = [
    {
        name: 'spawn_agent',
        description: 'Delegate a self-contained sub-task to a fresh sub-agent (its own context + minimal tools). The task string MUST include all context the sub-agent needs. Returns the sub-agent\'s final answer.',
        parameters: {
            type: 'object',
            properties: {
                role: { type: 'string', description: 'Sub-agent role id (e.g. coder, reviewer, architect, tester, documenter)' },
                task: { type: 'string', description: 'Self-contained instruction with ALL needed context' },
                tools: { type: 'array', description: 'Optional minimal tool-name allow-list for the sub-agent', items: { type: 'string' } },
            },
            required: ['task'],
        },
    },
    {
        name: 'run_parallel',
        description: 'Run several INDEPENDENT sub-tasks concurrently (bounded; local backend serializes). Each task must be self-contained. Returns the joined results.',
        parameters: {
            type: 'object',
            properties: {
                tasks: {
                    type: 'array',
                    description: 'List of { role?, task } objects — must be mutually independent',
                    items: { type: 'object' },
                },
            },
            required: ['tasks'],
        },
    },
];
function registerWorkflowTools(registry) {
    for (const t of exports.WORKFLOW_TOOLS)
        registry.register(t, 'custom', 'custom');
}
async function executeWorkflowTool(name, args, _cwd) {
    const ctx = (0, runtime_1.getWorkflowRuntime)();
    if (!ctx)
        return { content: 'Orchestration unavailable: no active workflow runtime.', isError: true };
    if (name === 'spawn_agent') {
        const res = await (0, runner_1.runSubAgent)({ role: args.role, task: String(args.task ?? ''), tools: args.tools }, ctx);
        return { content: res.content, isError: !res.ok };
    }
    if (name === 'run_parallel') {
        const tasks = Array.isArray(args.tasks) ? args.tasks : [];
        if (tasks.length === 0)
            return { content: 'run_parallel: tasks[] is required and must be non-empty.', isError: true };
        const conc = ctx.defaultProviderName === 'ollama' ? 1 : 4;
        const results = await (0, primitives_1.parallel)(tasks.map(t => () => (0, runner_1.runSubAgent)({ role: t.role, task: t.task }, ctx)), { concurrency: conc });
        const joined = results.map((r, i) => `### Sub-agent ${i + 1}${tasks[i]?.role ? ` (${tasks[i].role})` : ''}\n${r?.content ?? '[failed]'}`).join('\n\n');
        return { content: joined, isError: results.some(r => !r || !r.ok) };
    }
    return { content: `Unknown workflow tool: ${name}`, isError: true };
}
//# sourceMappingURL=tools.js.map