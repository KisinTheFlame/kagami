import { XMLParser } from "fast-xml-parser";
import { parse } from "node-html-parser";
import { BizError } from "../../common/errors/biz-error.js";

const ITHOME_RSS_URL = "https://www.ithome.com/rss/";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Kagami/1.0";

export type IthomeFeedItem = {
  upstreamId: string;
  title: string;
  url: string;
  publishedAt: Date;
  rssSummary: string;
  payload: Record<string, unknown>;
};

export interface IthomeClient {
  fetchFeedItems(): Promise<IthomeFeedItem[]>;
  fetchArticleContent(input: { url: string }): Promise<string>;
}

export class DefaultIthomeClient implements IthomeClient {
  private readonly feedUrl: string;
  private readonly userAgent: string;

  public constructor({ feedUrl, userAgent }: { feedUrl?: string; userAgent?: string } = {}) {
    this.feedUrl = feedUrl ?? ITHOME_RSS_URL;
    this.userAgent = userAgent ?? DEFAULT_USER_AGENT;
  }

  public async fetchFeedItems(): Promise<IthomeFeedItem[]> {
    const response = await fetch(this.feedUrl, {
      headers: {
        "User-Agent": this.userAgent,
      },
    });
    if (!response.ok) {
      throw new BizError({
        message: "拉取 IT 之家 RSS 失败",
        meta: {
          reason: "ITHOME_RSS_FETCH_FAILED",
          status: response.status,
        },
      });
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      processEntities: false,
    });
    const parsed = parser.parse(await response.text()) as Record<string, unknown>;
    const channel = getRecord(getRecord(parsed.rss)?.channel);
    const itemValue = channel?.item;
    const items = Array.isArray(itemValue) ? itemValue : itemValue ? [itemValue] : [];

    return items.flatMap(item => {
      const normalized = normalizeFeedItem(item);
      return normalized ? [normalized] : [];
    });
  }

  public async fetchArticleContent(input: { url: string }): Promise<string> {
    const response = await fetch(input.url, {
      headers: {
        "User-Agent": this.userAgent,
      },
    });
    if (!response.ok) {
      throw new BizError({
        message: "拉取 IT 之家文章页失败",
        meta: {
          reason: "ITHOME_ARTICLE_FETCH_FAILED",
          status: response.status,
          url: input.url,
        },
      });
    }

    const root = parse(await response.text());
    const articleRoot = root.querySelector("#paragraph");
    if (!articleRoot) {
      throw new BizError({
        message: "IT 之家文章页缺少正文容器",
        meta: {
          reason: "ITHOME_ARTICLE_CONTENT_NOT_FOUND",
          url: input.url,
        },
      });
    }

    for (const selector of ["img", "script", "style", "iframe", ".ad-tips"]) {
      for (const node of articleRoot.querySelectorAll(selector)) {
        node.remove();
      }
    }

    const content = collectStructuredText(articleRoot);
    if (content.length === 0) {
      throw new BizError({
        message: "IT 之家文章正文为空",
        meta: {
          reason: "ITHOME_ARTICLE_CONTENT_EMPTY",
          url: input.url,
        },
      });
    }

    return content;
  }
}

function normalizeFeedItem(value: unknown): IthomeFeedItem | null {
  const record = getRecord(value);
  if (!record) {
    return null;
  }

  const title = normalizeText(getString(record.title));
  const url = normalizeText(getString(record.link));
  const upstreamId = normalizeText(getString(record.guid) ?? url);
  const pubDate = normalizeText(getString(record.pubDate));
  const publishedAt = pubDate ? new Date(pubDate) : null;
  if (!title || !url || !upstreamId || !publishedAt || Number.isNaN(publishedAt.getTime())) {
    return null;
  }

  return {
    upstreamId,
    title,
    url,
    publishedAt,
    rssSummary: cleanHtmlFragmentToText(getString(record.description) ?? ""),
    payload: normalizeRecord(record),
  };
}

function cleanHtmlFragmentToText(html: string): string {
  if (html.trim().length === 0) {
    return "";
  }

  const root = parse(html);
  for (const node of root.querySelectorAll("img,script,style,iframe")) {
    node.remove();
  }

  return collectStructuredText(root);
}

function collectStructuredText(root: ReturnType<typeof parse>): string {
  const blockNodes = root.querySelectorAll("h1, h2, h3, p, li");
  const lines =
    blockNodes.length > 0
      ? blockNodes.map(node => normalizeText(node.textContent)).filter(Boolean)
      : normalizeText(root.textContent)
          .split("\n")
          .map(line => normalizeText(line))
          .filter(Boolean);

  return lines
    .filter(line => !line.startsWith("广告声明"))
    .join("\n\n")
    .trim();
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .trim();
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}
