import { pLimit } from '../src/shared/plimit';

describe('pLimit', () => {
  it('runs tasks up to the concurrency limit', async () => {
    const order: number[] = [];
    const limit = pLimit(2);

    const tasks = [1, 2, 3, 4].map((n) =>
      limit(async () => {
        order.push(n);
        await new Promise((r) => setTimeout(r, 10));
        return n * 10;
      }),
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([10, 20, 30, 40]);
    expect(order).toHaveLength(4);
  });

  it('limits concurrent execution', async () => {
    let running = 0;
    let maxRunning = 0;
    const limit = pLimit(2);

    const tasks = Array.from({ length: 6 }, () =>
      limit(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
      }),
    );

    await Promise.all(tasks);
    expect(maxRunning).toBe(2);
  });

  it('propagates errors without blocking other tasks', async () => {
    const limit = pLimit(2);
    const results: string[] = [];

    const tasks = [
      limit(() => {
        results.push('a');
        return Promise.resolve('a');
      }),
      limit(() => {
        return Promise.reject(new Error('fail'));
      }),
      limit(() => {
        results.push('c');
        return Promise.resolve('c');
      }),
    ];

    const settled = await Promise.allSettled(tasks);
    expect(settled[0]).toEqual({ status: 'fulfilled', value: 'a' });
    expect(settled[1]).toEqual(expect.objectContaining({ status: 'rejected' }));
    expect(settled[2]).toEqual({ status: 'fulfilled', value: 'c' });
  });
});
