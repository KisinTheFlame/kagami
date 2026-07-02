import { formatBeijingDateTime } from "@kagami/shared/utils";
import type { HnFeed } from "./client/firebase.js";
import type { HnGlanceResult, HnThreadResult, HnSearchResult, HnUserResult } from "./hn-reader.js";

// === Hacker News App 屏幕渲染 ===
// 领域模型已在 HnReader 里清洗过（htmlToPlainText 去标签 + 软化尖括号），
// 所以这里直接拼进 <hn_*> XML 段落是安全的——HN 文本无法伪造闭合标签越狱。

const HN_FEED_LABEL: Record<HnFeed, string> = {
  top: "热榜",
  new: "最新",
  best: "最佳",
  ask: "Ask HN",
  show: "Show HN",
  job: "招聘",
};

export function renderHnFrontPageContent(result: HnGlanceResult): string {
  const lines = [`<hn_front_page feed="${HN_FEED_LABEL[result.feed]}">`];
  if (result.stories.length === 0) {
    lines.push("（这个榜单暂时没拉到内容）");
  }
  result.stories.forEach((story, index) => {
    const meta = [
      story.score !== null ? `${story.score} 分` : null,
      story.descendants !== null ? `${story.descendants} 评论` : null,
      story.by ? `by ${story.by}` : null,
      story.domain,
      story.postedAt ? formatBeijingDateTime(story.postedAt) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(`${index + 1}. [id=${story.id}] ${story.title}`);
    if (meta) {
      lines.push(`   ${meta}`);
    }
  });
  lines.push("</hn_front_page>");
  return lines.join("\n");
}

export function renderHnThreadContent(result: HnThreadResult): string {
  const lines = [`<hn_thread id="${result.id}">`];
  lines.push(result.title ?? "(无标题)");
  const head = [
    result.by ? `by ${result.by}` : null,
    result.domain,
    result.postedAt ? formatBeijingDateTime(result.postedAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (head) {
    lines.push(head);
  }
  if (result.url) {
    lines.push(`链接：${result.url}`);
  }
  if (result.selfText) {
    lines.push("", result.selfText);
  }
  lines.push("", `--- 讨论（${result.shownRootComments}/${result.totalRootComments} 条主楼）---`);
  if (result.comments.length === 0) {
    lines.push("（还没有评论）");
  }
  for (const comment of result.comments) {
    const indent = comment.depth > 1 ? "    " : "";
    const replyHint = comment.replyCount > 0 ? `（${comment.replyCount} 回复）` : "";
    const author = comment.author ?? "(匿名)";
    lines.push(`${indent}- ${author}${replyHint}：${comment.text || "（空）"}`);
  }
  if (result.truncated) {
    lines.push("", "（讨论已截断，还有更多评论没展开）");
  }
  lines.push("</hn_thread>");
  return lines.join("\n");
}

export function renderHnSearchContent(result: HnSearchResult): string {
  const sortLabel = result.sort === "date" ? "按时间" : "按热度";
  const lines = [`<hn_search query="${result.query}" sort="${sortLabel}">`];
  if (result.hits.length === 0) {
    lines.push("（没搜到相关内容）");
  }
  result.hits.forEach((hit, index) => {
    const meta = [
      hit.kind === "comment" ? "评论" : "帖子",
      hit.points !== null ? `${hit.points} 分` : null,
      hit.numComments !== null ? `${hit.numComments} 评论` : null,
      hit.author ? `by ${hit.author}` : null,
      hit.domain,
      hit.postedAt ? formatBeijingDateTime(hit.postedAt) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const head = hit.title ?? hit.snippet ?? "(无标题)";
    lines.push(`${index + 1}. [id=${hit.id}] ${head}`);
    lines.push(`   ${meta}`);
    if (hit.title && hit.snippet) {
      lines.push(`   ${hit.snippet}`);
    }
  });
  lines.push("</hn_search>");
  return lines.join("\n");
}

export function renderHnUserContent(result: HnUserResult): string {
  const lines = [`<hn_user name="${result.username}">`];
  if (!result.found) {
    lines.push(`没找到用户 ${result.username}。`);
    lines.push("</hn_user>");
    return lines.join("\n");
  }
  const meta = [
    result.karma !== null ? `karma ${result.karma}` : null,
    result.createdAt ? `注册于 ${formatBeijingDateTime(result.createdAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (meta) {
    lines.push(meta);
  }
  if (result.about) {
    lines.push("", result.about);
  }
  lines.push("", "--- 近期发言 ---");
  if (result.recent.length === 0) {
    lines.push("（最近没有发言）");
  }
  for (const item of result.recent) {
    const kind = item.kind === "comment" ? "评论" : "帖子";
    const when = item.postedAt ? formatBeijingDateTime(item.postedAt) : "";
    const body = item.title ?? item.snippet ?? "(无内容)";
    lines.push(`- [${kind}${when ? ` ${when}` : ""}] ${body}`);
  }
  lines.push("</hn_user>");
  return lines.join("\n");
}
