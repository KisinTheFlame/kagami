import type { GroupChatState } from "./group-chat-state.js";
import type { PrivateChatState } from "./private-chat-state.js";
import {
  createQqGroupStateId,
  createQqPrivateStateId,
  parseGroupIdFromStateId,
  parsePrivateUserIdFromStateId,
} from "./state-id.js";
import type { RootAgentStateId } from "./state.types.js";
import type {
  CurrentPersistedRootAgentSessionSnapshot,
  PersistedRootAgentSessionSnapshot,
} from "../persistence/root-agent-runtime-snapshot.js";

export type NormalizedPersistedSnapshot = {
  stateStack: RootAgentStateId[];
  groups: CurrentPersistedRootAgentSessionSnapshot["groups"];
  privateChats: CurrentPersistedRootAgentSessionSnapshot["privateChats"];
  groupInfoLoaded: boolean;
};

export function cloneGroupStates(
  groups: CurrentPersistedRootAgentSessionSnapshot["groups"],
): CurrentPersistedRootAgentSessionSnapshot["groups"] {
  return groups.map(group => ({
    groupId: group.groupId,
    groupInfo: group.groupInfo ? structuredClone(group.groupInfo) : null,
    unreadMessages: structuredClone(group.unreadMessages),
    hasEntered: group.hasEntered,
  }));
}

export function clonePrivateChatStates(
  privateChats: CurrentPersistedRootAgentSessionSnapshot["privateChats"],
): CurrentPersistedRootAgentSessionSnapshot["privateChats"] {
  return privateChats.map(privateChat => ({
    userId: privateChat.userId,
    friendInfo: privateChat.friendInfo ? structuredClone(privateChat.friendInfo) : null,
    unreadMessages: structuredClone(privateChat.unreadMessages),
    hasEntered: privateChat.hasEntered,
  }));
}

export function normalizePersistedSnapshot(
  snapshot: PersistedRootAgentSessionSnapshot,
  groupStateById: ReadonlyMap<string, GroupChatState>,
  privateChatStateByUserId: ReadonlyMap<string, PrivateChatState>,
): NormalizedPersistedSnapshot {
  const knownPrivateUserIds = new Set([
    ...privateChatStateByUserId.keys(),
    ...snapshot.privateChats.map(privateChat => privateChat.userId),
  ]);
  const normalizedStack = snapshot.stateStack
    .map(stateId => normalizeStateId(stateId, groupStateById, knownPrivateUserIds))
    .filter((stateId): stateId is RootAgentStateId => stateId !== null);

  return {
    stateStack: normalizedStack.length > 0 ? normalizedStack : ["portal"],
    groups: cloneGroupStates(snapshot.groups),
    privateChats: clonePrivateChatStates(snapshot.privateChats),
    groupInfoLoaded: snapshot.groups.some(group => group.groupInfo !== null),
  };
}

function normalizeStateId(
  stateId: string,
  groupStateById: ReadonlyMap<string, GroupChatState>,
  knownPrivateUserIds: ReadonlySet<string>,
): RootAgentStateId | null {
  if (stateId === "portal") {
    return stateId;
  }
  // 旧 snapshot 里 stateStack 可能有 "ithome"——state tree 时代的焦点状态。
  // ithome 现在归 IthomeApp 管，状态树没有这个节点了。归一化时丢弃这种值，
  // 让外层兜底回 ["portal"]。
  if (stateId === "ithome") {
    return null;
  }

  const groupId = parseGroupIdFromStateId(stateId);
  if (groupId && groupStateById.has(groupId)) {
    return createQqGroupStateId(groupId);
  }

  const userId = parsePrivateUserIdFromStateId(stateId);
  if (userId && knownPrivateUserIds.has(userId)) {
    return createQqPrivateStateId(userId);
  }

  return null;
}
