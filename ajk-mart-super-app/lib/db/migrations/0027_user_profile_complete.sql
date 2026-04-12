-- Add is_profile_complete to track whether a user has completed registration setup
-- Default false for new users; backfill true for existing legitimate users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_profile_complete" boolean NOT NULL DEFAULT false;

-- Backfill: mark as complete any user who has a name, verified phone,
-- and an active/pending approval status (i.e. they were created before this column existed)
UPDATE "users"
SET "is_profile_complete" = true
WHERE "is_profile_complete" = false
  AND "phone_verified" = true
  AND "name" IS NOT NULL
  AND "name" != ''
  AND ("approval_status" = 'approved' OR "approval_status" = 'pending');

-- Add payload column to pending_otps to store registration intent data
-- so the user record is only created after OTP is verified
ALTER TABLE "pending_otps"
  ADD COLUMN IF NOT EXISTS "payload" text;
