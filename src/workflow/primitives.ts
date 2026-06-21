/**
 * Orchestration primitives — pure, dependency-free async combinators.
 *
 * parallel() runs thunks through a bounded queue (pLimit); a throwing thunk
 * resolves to null in its slot so a batch never rejects. Concurrency defaults
 * to 1 because the local Ollama backend serializes on a single GPU.
 */

/** A simple promise-concurrency limiter (no external dep). */
export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const max = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => { active--; if (queue.length > 0) queue.shift()!(); };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(next);
      };
      if (active < max) run();
      else queue.push(run);
    });
}

/** Run thunks concurrently (bounded). Throwing thunk → null. Order preserved. */
export async function parallel<T>(
  thunks: Array<() => Promise<T>>,
  opts: { concurrency?: number } = {},
): Promise<Array<T | null>> {
  const limit = pLimit(opts.concurrency ?? 1);
  return Promise.all(
    thunks.map(thunk => limit(async () => {
      try { return await thunk(); } catch { return null; }
    })),
  );
}
