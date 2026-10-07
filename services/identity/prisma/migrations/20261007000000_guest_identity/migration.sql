-- P01-E3: guest principals in identity_account (expand-only, no data rewrite).
-- Every existing row becomes kind 'account' with email and password_hash present,
-- so it satisfies the new CHECK. Application rollback to the previous release is
-- safe: that code never looks guests up by email, and a guest has no roles, so
-- it would grant a guest no permission. This migration is not reversed; any
-- later contraction needs its own reviewed data plan.

-- AlterTable
ALTER TABLE "identity_account" ADD COLUMN "kind" VARCHAR(16) NOT NULL DEFAULT 'account';
ALTER TABLE "identity_account" ADD COLUMN "recovery_digest" CHAR(64);
ALTER TABLE "identity_account" ADD COLUMN "guest_expires_at" TIMESTAMPTZ(3);
ALTER TABLE "identity_account" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "identity_account" ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "identity_account_recovery_digest_key" ON "identity_account"("recovery_digest");

-- Shape invariant per kind. A guest can never hold an email, a password or a role.
ALTER TABLE "identity_account" ADD CONSTRAINT "identity_account_kind_shape" CHECK (
  (
    "kind" = 'account'
    AND "email" IS NOT NULL
    AND "password_hash" IS NOT NULL
    AND "recovery_digest" IS NULL
    AND "guest_expires_at" IS NULL
  )
  OR (
    "kind" = 'guest'
    AND "email" IS NULL
    AND "password_hash" IS NULL
    AND "recovery_digest" IS NOT NULL
    AND "guest_expires_at" IS NOT NULL
    AND COALESCE(cardinality("roles"), 0) = 0
  )
);
