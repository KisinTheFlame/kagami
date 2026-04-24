import { AppLogger } from "../../logger/logger.js";
import type { IthomeNewsService } from "./ithome-news.service.js";

const logger = new AppLogger({ source: "news.ithome-poller" });

export class IthomePoller {
  private readonly ithomeNewsService: IthomeNewsService;
  public readonly pollIntervalMs: number;
  private readonly onArticleIngested: (input: { articleId: number; title: string }) => void;

  public constructor({
    ithomeNewsService,
    pollIntervalMs,
    onArticleIngested,
  }: {
    ithomeNewsService: IthomeNewsService;
    pollIntervalMs: number;
    onArticleIngested: (input: { articleId: number; title: string }) => void;
  }) {
    this.ithomeNewsService = ithomeNewsService;
    this.pollIntervalMs = pollIntervalMs;
    this.onArticleIngested = onArticleIngested;
  }

  public async runOnce(): Promise<void> {
    try {
      const result = await this.ithomeNewsService.syncFeed();
      for (const article of result.newArticles) {
        this.onArticleIngested(article);
      }
    } catch (error) {
      logger.warn("Failed to poll ithome rss feed", {
        event: "news.ithome_poll_failed",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
