-- CreateTable
CREATE TABLE "identity_account" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "roles" TEXT[],
    "auth_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_challenge" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "account_id" UUID,
    "purpose" VARCHAR(16) NOT NULL,
    "password_hash" TEXT,
    "digest" CHAR(64) NOT NULL,
    "generation" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "resend_at" TIMESTAMPTZ(3) NOT NULL,
    "state" VARCHAR(16) NOT NULL,

    CONSTRAINT "identity_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_session" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "identity_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_refresh" (
    "digest" CHAR(64) NOT NULL,
    "session_id" UUID NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "identity_refresh_pkey" PRIMARY KEY ("digest")
);

-- CreateTable
CREATE TABLE "identity_audit" (
    "id" UUID NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "actor_id" UUID,
    "subject_id" UUID,
    "request_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "identity_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_account_email_key" ON "identity_account"("email");

-- CreateIndex
CREATE INDEX "identity_challenge_expires_at_idx" ON "identity_challenge"("expires_at");

-- CreateIndex
CREATE INDEX "identity_session_account_id_revoked_at_idx" ON "identity_session"("account_id", "revoked_at");

-- CreateIndex
CREATE INDEX "identity_refresh_session_id_idx" ON "identity_refresh"("session_id");

-- CreateIndex
CREATE INDEX "identity_audit_occurred_at_idx" ON "identity_audit"("occurred_at");

-- AddForeignKey
ALTER TABLE "identity_session" ADD CONSTRAINT "identity_session_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "identity_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_refresh" ADD CONSTRAINT "identity_refresh_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "identity_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
