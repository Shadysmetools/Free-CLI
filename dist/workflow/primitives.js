"use strict";
/**
 * Orchestration primitives — pure, dependency-free async combinators.
 *
 * parallel() runs thunks through a bounded queue (pLimit); a throwing thunk
 * resolves to null in its slot so a batch never rejects. Concurrency defaults
 * to 1 because the local Ollama backend serializes on a single GPU.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pLimit = pLimit;
exports.parallel = parallel;
exports.pipeline = pipeline;
/** A simple promise-concurrency limiter (no external dep). */
function pLimit(concurrency) {
    const max = Math.max(1, Math.floor(concurrency));
    let active = 0;
    const queue = [];
    const next = () => { active--; if (queue.length > 0)
        queue.shift()(); };
    return (fn) => new Promise((resolve, reject) => {
        const run = () => {
            active++;
            fn().then(resolve, reject).finally(next);
        };
        if (active < max)
            run();
        else
            queue.push(run);
    });
}
/** Run thunks concurrently (bounded). Throwing thunk → null. Order preserved. */
async function parallel(thunks, opts = {}) {
    const limit = pLimit(opts.concurrency ?? 1);
    return Promise.all(thunks.map(thunk => limit(async () => {
        try {
            return await thunk();
        }
        catch {
            return null;
        }
    })));
}
/**
 * Run each item through every stage independently (no barrier between stages):
 * item A may reach stage 3 while item B is still in stage 1. A stage that throws
 * drops that item to null and skips its remaining stages.
 */
async function pipeline(items, ...stages // eslint-disable-line @typescript-eslint/no-explicit-any
) {
    return Promise.all(items.map(async (item, index) => {
        let acc = undefined;
        try {
            for (const stage of stages)
                acc = await stage(acc, item, index);
            return acc;
        }
        catch {
            return null;
        }
    }));
}
//# sourceMappingURL=primitives.js.map