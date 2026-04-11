/**
 * Creates a concurrency limiter that runs at most `concurrency` async
 * tasks at a time. Returns a wrapper function that queues tasks.
 *
 * Usage:
 *   const limit = pLimit(3);
 *   const results = await Promise.all(items.map(item => limit(() => fetch(item))));
 */
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      queue.shift()!();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(
          (val) => {
            active--;
            resolve(val);
            next();
          },
          (err: unknown) => {
            active--;
            reject(err instanceof Error ? err : new Error(String(err)));
            next();
          },
        );
      };

      if (active < concurrency) {
        active++;
        run();
      } else {
        queue.push(run);
      }
    });
}
