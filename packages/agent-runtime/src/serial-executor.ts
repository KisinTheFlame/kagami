import { InMemoryQueue, type Queue } from "./queue.js";

/**
 * SerialExecutor: runs submitted async tasks one at a time, in submission
 * order. Replaces the "promise chain as mutex" idiom with an explicit
 * queue + on-demand worker.
 *
 * Semantics:
 * - submit(task) enqueues the task and returns a promise that resolves with
 *   the task's result (or rejects with its error).
 * - Tasks run strictly serially. The next task does not start until the
 *   previous one settles.
 * - One task throwing does NOT affect subsequent tasks. Each task's error
 *   is delivered to its own caller via the returned promise.
 * - The worker is started lazily on the first submit and exits when the
 *   queue drains. No long-running background promise; nothing to dispose.
 *
 * Use this when multiple async entry points need to mutate shared state
 * without interleaving and without holding a real lock.
 */
type SerialTask = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

export class SerialExecutor {
  private readonly queue: Queue<SerialTask> = new InMemoryQueue<SerialTask>();
  private running = false;

  public submit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.enqueue({
        run: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      if (!this.running) {
        this.running = true;
        void this.runWorker();
      }
    });
  }

  public size(): number {
    return this.queue.size();
  }

  private async runWorker(): Promise<void> {
    try {
      while (this.queue.size() > 0) {
        const task = await this.queue.take();
        try {
          const result = await task.run();
          task.resolve(result);
        } catch (error) {
          task.reject(error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
