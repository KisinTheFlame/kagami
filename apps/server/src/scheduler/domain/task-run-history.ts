import type { TaskRun } from "./scheduled-task.js";

export class TaskRunHistory {
  private readonly capacity: number;
  private readonly buffer: TaskRun[] = [];

  public constructor({ capacity }: { capacity: number }) {
    if (capacity <= 0) {
      throw new Error(`TaskRunHistory capacity must be positive, got ${capacity}`);
    }
    this.capacity = capacity;
  }

  public push(run: TaskRun): void {
    this.buffer.push(run);
    while (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  public toArray(): TaskRun[] {
    return [...this.buffer];
  }
}
