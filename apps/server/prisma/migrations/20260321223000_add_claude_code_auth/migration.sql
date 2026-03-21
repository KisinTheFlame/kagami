CREATE TABLE "claude_code_auth_session" (
  "id" SERIAL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "account_id" TEXT,
  "email" TEXT,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "id_token" TEXT,
  "expires_at" TIMESTAMPTZ(6),
  "last_refresh_at" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "claude_code_auth_session_provider_uq"
  ON "claude_code_auth_session" ("provider");

CREATE INDEX "claude_code_auth_session_status_updated_at_idx"
  ON "claude_code_auth_session" ("status", "updated_at");

CREATE TABLE "claude_code_oauth_state" (
  "id" SERIAL PRIMARY KEY,
  "state" TEXT NOT NULL,
  "code_verifier" TEXT NOT NULL,
  "redirect_uri" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "claude_code_oauth_state_state_uq"
  ON "claude_code_oauth_state" ("state");

CREATE INDEX "claude_code_oauth_state_expires_at_idx"
  ON "claude_code_oauth_state" ("expires_at");
