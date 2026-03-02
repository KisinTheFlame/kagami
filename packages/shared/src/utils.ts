import { GreetingInputSchema, type HealthResponse } from "./schemas.js";

export function createHealthResponse(): HealthResponse {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
}

export function formatGreeting(appName: string): string {
  const { appName: normalizedName } = GreetingInputSchema.parse({ appName });
  return `Hello from ${normalizedName}`;
}
