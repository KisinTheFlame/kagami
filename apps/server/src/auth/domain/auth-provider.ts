import { type AuthProvider } from "@kagami/shared/schemas/auth";
import type { LlmProviderId } from "../../common/contracts/llm.js";

export type InternalAuthProvider = Extract<LlmProviderId, "openai-codex" | "claude-code">;

export const AUTH_PROVIDER_PAIRS = [
  {
    publicProvider: "codex",
    internalProvider: "openai-codex",
    displayName: "Codex",
    managementPath: "/auth/codex",
  },
  {
    publicProvider: "claude-code",
    internalProvider: "claude-code",
    displayName: "Claude Code",
    managementPath: "/auth/claude-code",
  },
] as const satisfies readonly {
  publicProvider: AuthProvider;
  internalProvider: InternalAuthProvider;
  displayName: string;
  managementPath: string;
}[];

export function toInternalAuthProvider(provider: AuthProvider): InternalAuthProvider {
  const internalProvider = AUTH_PROVIDER_PAIRS.find(
    item => item.publicProvider === provider,
  )?.internalProvider;
  if (!internalProvider) {
    throw new Error(`Unsupported auth provider: ${provider}`);
  }

  return internalProvider;
}

export function toPublicAuthProvider(provider: InternalAuthProvider): AuthProvider {
  return (
    AUTH_PROVIDER_PAIRS.find(item => item.internalProvider === provider)?.publicProvider ??
    "claude-code"
  );
}
