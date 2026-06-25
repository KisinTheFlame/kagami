/**
 * QQ 会话标识。沿用历史的 `qq_group:<id>` / `qq_private:<id>` 字面格式（与旧状态树
 * 一致，便于持久化平滑），同时充当 NotificationCenter 的 sourceId 与 QQ App 的
 * `open_conversation(id)` 参数。
 */
export type ConversationId = `qq_group:${string}` | `qq_private:${string}`;

const GROUP_PREFIX = "qq_group:";
const PRIVATE_PREFIX = "qq_private:";

export function createGroupConversationId(groupId: string): ConversationId {
  return `${GROUP_PREFIX}${groupId}`;
}

export function createPrivateConversationId(userId: string): ConversationId {
  return `${PRIVATE_PREFIX}${userId}`;
}

export function parseGroupIdFromConversationId(id: string): string | null {
  return id.startsWith(GROUP_PREFIX) ? id.slice(GROUP_PREFIX.length) : null;
}

export function parsePrivateUserIdFromConversationId(id: string): string | null {
  return id.startsWith(PRIVATE_PREFIX) ? id.slice(PRIVATE_PREFIX.length) : null;
}
