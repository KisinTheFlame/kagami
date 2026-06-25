import { AppLogger } from "../../../../logger/logger.js";
import type { IthomeService } from "./ithome.service.js";

const logger = new AppLogger({ source: "ithome.poller" });

export class IthomePoller {
  private readonly ithomeService: IthomeService;
  public readonly pollIntervalMs: number;
  private readonly onArticleIngested: (input: { articleId: number; title: string }) => void;

  public constructor({
    ithomeService,
    pollIntervalMs,
    onArticleIngested,
  }: {
    ithomeService: IthomeService;
    pollIntervalMs: number;
    onArticleIngested: (input: { articleId: number; title: string }) => void;
  }) {
    this.ithomeService = ithomeService;
    this.pollIntervalMs = pollIntervalMs;
    this.onArticleIngested = onArticleIngested;
  }

  public async runOnce(): Promise<void> {
    try {
      const result = await this.ithomeService.syncFeed();
      for (const article of result.newArticles) {
        this.onArticleIngested(article);
      }
    } catch (error) {
      logger.warn("Failed to poll ithome rss feed", {
        event: "ithome.poll_failed",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
