import { Cron } from "croner";

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
