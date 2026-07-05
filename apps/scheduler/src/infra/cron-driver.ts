import { Cron } from "croner";

/** cron 表达式驱动（croner）。从原 apps/agent 进程内调度器搬迁（issue #428），逻辑不变。 */
export class CronDriver {
  private readonly cron: Cron;

  public constructor({ expression, handler }: { expression: string; handler: () => void }) {
    this.cron = new Cron(expression, { paused: true, unref: true }, () => {
      handler();
    });
  }

  public start(): void {
    this.cron.resume();
  }

  public stop(): void {
    this.cron.stop();
  }

  public peekNextRun(): Date | null {
    return this.cron.nextRun();
  }
}
