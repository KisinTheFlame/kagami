import { type HealthResponse } from "./schemas.js";

export function createHealthResponse(): HealthResponse {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
}

export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${String(value)}`);
}
