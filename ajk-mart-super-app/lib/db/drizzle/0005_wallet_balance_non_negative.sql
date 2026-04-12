-- Add CHECK constraint to ensure wallet_balance can never go below zero at the DB level.
-- This is a safety net that enforces the application-level balance guard at the DB layer,
-- preventing any rogue deduction (bypassing app logic) from resulting in a negative balance.
-- The constraint is added with IF NOT EXISTS to be idempotent across environments.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_wallet_non_negative'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_wallet_non_negative" CHECK ("wallet_balance" >= 0);
  END IF;
END $$;
