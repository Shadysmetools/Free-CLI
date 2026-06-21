"use strict";
/**
 * Workflow definition types + validation. A workflow is a small DAG of steps;
 * validateWorkflow() guarantees shape, unique ids, resolvable dependencies, and
 * the absence of cycles BEFORE any agent runs. topoOrder() returns dependency
 * levels so the engine can run independent steps together.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWorkflow = validateWorkflow;
exports.topoOrder = topoOrder;
const TYPES = new Set(['agent', 'parallel', 'pipeline']);
function validateWorkflow(def) {
    const errors = [];
    const d = def;
    if (!d || typeof d !== 'object')
        return { ok: false, errors: ['workflow must be an object'] };
    if (typeof d.name !== 'string' || !d.name.trim())
        errors.push('workflow.name is required');
    if (!Array.isArray(d.steps) || d.steps.length === 0)
        errors.push('workflow.steps must be a non-empty array');
    const ids = new Set();
    if (Array.isArray(d.steps)) {
        for (const s of d.steps) {
            if (!s || typeof s.id !== 'string' || !s.id.trim()) {
                errors.push('every step needs a non-empty id');
                continue;
            }
            if (ids.has(s.id))
                errors.push(`duplicate step id: ${s.id}`);
            ids.add(s.id);
            if (!TYPES.has(s.type))
                errors.push(`step ${s.id}: type must be agent|parallel|pipeline`);
            if (s.type === 'agent' && typeof s.task !== 'string')
                errors.push(`step ${s.id}: agent step needs a task`);
            if (s.type === 'parallel' && !Array.isArray(s.branches))
                errors.push(`step ${s.id}: parallel step needs branches[]`);
            if (s.type === 'pipeline' && !Array.isArray(s.stages))
                errors.push(`step ${s.id}: pipeline step needs stages[]`);
        }
        for (const s of d.steps) {
            if (!s || typeof s.id !== 'string' || !s.id.trim())
                continue;
            for (const dep of s.depends_on ?? [])
                if (!ids.has(dep))
                    errors.push(`step ${s.id}: depends_on unknown step "${dep}"`);
        }
        if (errors.length === 0) {
            try {
                topoOrder(d.steps);
            }
            catch (e) {
                errors.push(e.message);
            }
        }
    }
    return errors.length ? { ok: false, errors } : { ok: true, def: d };
}
/** Kahn's algorithm → dependency levels. Throws "dependency cycle: …" if not a DAG. */
function topoOrder(steps) {
    const deps = new Map();
    for (const s of steps) {
        deps.set(s.id, s.depends_on ?? []);
    }
    const levels = [];
    const done = new Set();
    while (done.size < steps.length) {
        const ready = steps.filter(s => !done.has(s.id) && (deps.get(s.id) ?? []).every(d => done.has(d))).map(s => s.id);
        if (ready.length === 0) {
            const stuck = steps.filter(s => !done.has(s.id)).map(s => s.id).join(', ');
            throw new Error(`dependency cycle among steps: ${stuck}`);
        }
        levels.push(ready);
        for (const id of ready)
            done.add(id);
    }
    return levels;
}
//# sourceMappingURL=schema.js.map