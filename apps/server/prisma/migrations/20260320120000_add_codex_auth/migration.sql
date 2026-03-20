CREATE TABLE "codex_auth_session" (
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

    CONSTRAINT "codex_auth_session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "codex_oauth_state" (
    "id" SERIAL NOT NULL,
    "state" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codex_oauth_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "codex_auth_session_provider_uq" ON "codex_auth_session"("provider");
CREATE INDEX "codex_auth_session_status_updated_at_idx" ON "codex_auth_session"("status", "updated_at");
CREATE UNIQUE INDEX "codex_oauth_state_state_uq" ON "codex_oauth_state"("state");
CREATE INDEX "codex_oauth_state_expires_at_idx" ON "codex_oauth_state"("expires_at");
