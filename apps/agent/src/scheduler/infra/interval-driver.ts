export class IntervalDriver {
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;
  private readonly handler: () => void;
  private initialTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private nextFireAt: Date | null = null;

  public constructor({
    intervalMs,
    initialDelayMs,
    handler,
  }: {
    intervalMs: number;
    initialDelayMs: number;
    handler: () => void;
  }) {
    if (intervalMs <= 0) {
      throw new Error(`IntervalDriver intervalMs must be positive, got ${intervalMs}`);
    }
    if (initialDelayMs < 0) {
      throw new Error(`IntervalDriver initialDelayMs must be non-negative, got ${initialDelayMs}`);
    }
    this.intervalMs = intervalMs;
    this.initialDelayMs = initialDelayMs;
    this.handler = handler;
  }

  public start(): void {
    if (this.initialTimer || this.intervalTimer) {
      return;
    }

    const firstFireAt = Date.now() + this.initialDelayMs;
    this.nextFireAt = new Date(firstFireAt);

    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      this.fireAndSchedule();
    }, this.initialDelayMs);
    this.initialTimer.unref?.();
  }

  public stop(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.nextFireAt = null;
  }

  public peekNextRun(): Date | null {
    return this.nextFireAt;
  }

  private fireAndSchedule(): void {
    this.handler();
    this.nextFireAt = new Date(Date.now() + this.intervalMs);
    this.intervalTimer = setInterval(() => {
      this.handler();
      this.nextFireAt = new Date(Date.now() + this.intervalMs);
    }, this.intervalMs);
    this.intervalTimer.unref?.();
  }
}
