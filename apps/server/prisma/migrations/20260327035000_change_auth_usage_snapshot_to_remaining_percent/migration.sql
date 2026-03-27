ALTER TABLE "auth_usage_snapshot"
RENAME COLUMN "used_percent" TO "remaining_percent";

UPDATE "auth_usage_snapshot"
SET "remaining_percent" = GREATEST(0, LEAST(100, 100 - "remaining_percent"));
