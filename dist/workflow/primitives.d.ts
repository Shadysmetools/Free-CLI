/**
 * Orchestration primitives — pure, dependency-free async combinators.
 *
 * parallel() runs thunks through a bounded queue (pLimit); a throwing thunk
 * resolves to null in its slot so a batch never rejects. Concurrency defaults
 * to 1 because the local Ollama backend serializes on a single GPU.
 */
/** A simple promise-concurrency limiter (no external dep). */
export declare function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T>;
/** Run thunks concurrently (bounded). Throwing thunk → null. Order preserved. */
export declare function parallel<T>(thunks: Array<() => Promise<T>>, opts?: {
    concurrency?: number;
}): Promise<Array<T | null>>;
/**
 * Run each item through every stage independently (no barrier between stages):
 * item A may reach stage 3 while item B is still in stage 1. A stage that throws
 * drops that item to null and skips its remaining stages.
 */
export declare function pipeline<T>(items: T[], ...stages: Array<(prev: any, item: T, index: number) => Promise<any>>): Promise<Array<any | null>>;
//# sourceMappingURL=primitives.d.ts.map