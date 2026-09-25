/**
 * A few workers taking turns at one queue: each takes the next item as soon
 * as it is free, so a slow item holds up one worker rather than the batch.
 *
 * `next` is asked every time a worker is free, not once at the start, so
 * items queued while the pool runs are picked up by it. It answers
 * undefined when there is nothing left, and the pool ends when every worker
 * has found that. `stop` is asked before each take: once it says yes, no
 * worker starts another item, and the ones already running finish theirs.
 */
export async function runPool<T>(
  next: () => T | undefined,
  work: (item: T) => Promise<void>,
  size: number,
  stop: () => boolean = () => false
): Promise<void> {
  const worker = async (): Promise<void> => {
    for (;;) {
      if (stop()) return;
      const item = next();
      if (item === undefined) return;
      await work(item);
    }
  };
  const count = Math.max(1, Math.floor(size));
  await Promise.all(Array.from({ length: count }, worker));
}
