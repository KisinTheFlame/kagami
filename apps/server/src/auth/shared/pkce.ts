import { createHash, randomBytes } from "node:crypto";

export type PkcePair = {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
};

export function createPkcePair(): PkcePair {
  const state = randomBytes(24).toString("hex");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  return {
    state,
    codeVerifier,
    codeChallenge,
  };
}
