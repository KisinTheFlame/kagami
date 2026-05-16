export function createQqGroupStateId(groupId: string): `qq_group:${string}` {
  return `qq_group:${groupId}`;
}

export function createQqPrivateStateId(userId: string): `qq_private:${string}` {
  return `qq_private:${userId}`;
}

export function parseGroupIdFromStateId(stateId: string): string | undefined {
  return stateId.startsWith("qq_group:") ? stateId.slice("qq_group:".length) : undefined;
}

export function parsePrivateUserIdFromStateId(stateId: string): string | undefined {
  return stateId.startsWith("qq_private:") ? stateId.slice("qq_private:".length) : undefined;
}

export function normalizeEnterInputToStateId(
  input:
    | { id: string }
    | {
        kind: "qq_group" | "qq_private" | "ithome" | "zone_out" | "terminal";
        id?: string;
      },
): string | null {
  if ("kind" in input) {
    if (input.kind === "qq_group") {
      return input.id?.trim() ? createQqGroupStateId(input.id.trim()) : null;
    }

    if (input.kind === "qq_private") {
      return input.id?.trim() ? createQqPrivateStateId(input.id.trim()) : null;
    }

    return input.kind;
  }

  return input.id.trim();
}
