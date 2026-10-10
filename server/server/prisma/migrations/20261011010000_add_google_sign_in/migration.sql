-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_id" VARCHAR(255);
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_google_id_key" ON "users"("google_id");
