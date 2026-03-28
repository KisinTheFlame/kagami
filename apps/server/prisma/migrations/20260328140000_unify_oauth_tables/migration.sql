CREATE TABLE "oauth_session" (
  "id" SERIAL NOT NULL,
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
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oauth_session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_session_provider_uq" ON "oauth_session"("provider");
CREATE INDEX "oauth_session_status_updated_at_idx" ON "oauth_session"("status", "updated_at");

INSERT INTO "oauth_session" (
  "provider",
  "account_id",
  "email",
  "access_token",
  "refresh_token",
  "id_token",
  "expires_at",
  "last_refresh_at",
  "status",
  "last_error",
  "created_at",
  "updated_at"
)
SELECT
  "provider",
  "account_id",
  "email",
  "access_token",
  "refresh_token",
  "id_token",
  "expires_at",
  "last_refresh_at",
  "status",
  "last_error",
  "created_at",
  "updated_at"
FROM "codex_auth_session"
ON CONFLICT ("provider") DO NOTHING;

INSERT INTO "oauth_session" (
  "provider",
  "account_id",
  "email",
  "access_token",
  "refresh_token",
  "id_token",
  "expires_at",
  "last_refresh_at",
  "status",
  "last_error",
  "created_at",
  "updated_at"
)
SELECT
  "provider",
  "account_id",
  "email",
  "access_token",
  "refresh_token",
  "id_token",
  "expires_at",
  "last_refresh_at",
  "status",
  "last_error",
  "created_at",
  "updated_at"
FROM "claude_code_auth_session"
ON CONFLICT ("provider") DO NOTHING;

CREATE TABLE "oauth_state" (
  "id" SERIAL NOT NULL,
  "state" TEXT NOT NULL,
  "code_verifier" TEXT NOT NULL,
  "redirect_uri" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oauth_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_state_state_uq" ON "oauth_state"("state");
CREATE INDEX "oauth_state_expires_at_idx" ON "oauth_state"("expires_at");

INSERT INTO "oauth_state" (
  "state",
  "code_verifier",
  "redirect_uri",
  "expires_at",
  "used_at",
  "created_at"
)
SELECT
  "state",
  "code_verifier",
  "redirect_uri",
  "expires_at",
  "used_at",
  "created_at"
FROM "codex_oauth_state"
ON CONFLICT ("state") DO NOTHING;

INSERT INTO "oauth_state" (
  "state",
  "code_verifier",
  "redirect_uri",
  "expires_at",
  "used_at",
  "created_at"
)
SELECT
  "state",
  "code_verifier",
  "redirect_uri",
  "expires_at",
  "used_at",
  "created_at"
FROM "claude_code_oauth_state"
ON CONFLICT ("state") DO NOTHING;

DROP TABLE "codex_oauth_state";
DROP TABLE "claude_code_oauth_state";
DROP TABLE "codex_auth_session";
DROP TABLE "claude_code_auth_session";
