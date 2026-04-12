-- Migration: Normalize phone numbers to 923xxxxxxxxx (12-digit) canonical form
-- Handles all legacy storage variants: 3xxxxxxxxx, 03xxxxxxxxx, +923xxxxxxxxx, 923xxxxxxxxx
-- Deduplication runs AFTER full normalization so real-number collisions are resolved.

-- ─── Step 1: Temporarily drop unique constraint on users.phone ───────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_unique;

-- ─── Step 2: Normalize ALL legacy variants in users.phone → 923xxxxxxxxx ─────
-- 2a) Bare 10-digit:  3xxxxxxxxx  →  923xxxxxxxxx
UPDATE users
SET phone = '92' || phone
WHERE phone ~ '^3[0-9]{9}$';

-- 2b) Local 11-digit: 03xxxxxxxxx  →  923xxxxxxxxx
UPDATE users
SET phone = '92' || substring(phone FROM 2)
WHERE phone ~ '^03[0-9]{9}$';

-- 2c) E.164 with +: +923xxxxxxxxx  →  923xxxxxxxxx
UPDATE users
SET phone = substring(phone FROM 2)
WHERE phone ~ '^\+923[0-9]{9}$';

-- 2d) Already 92xxx but with any leading +: catch-all safety strip
UPDATE users
SET phone = replace(phone, '+', '')
WHERE phone ~ '^\+92[0-9]{10}$';

-- ─── Step 3: Deduplicate users sharing the same canonical number ──────────────
-- After full normalization, keep the oldest account (lowest created_at / id).
DELETE FROM users
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY phone ORDER BY created_at ASC, id ASC) AS rn
    FROM users
    WHERE phone IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- ─── Step 4: Re-add unique constraint on users.phone ─────────────────────────
ALTER TABLE users ADD CONSTRAINT users_phone_unique UNIQUE (phone);

-- ─── Step 5: Normalize pending_otps.phone ────────────────────────────────────
ALTER TABLE pending_otps DROP CONSTRAINT IF EXISTS pending_otps_phone_unique;

-- 5a) Bare 10-digit: 3xxxxxxxxx  →  923xxxxxxxxx
UPDATE pending_otps
SET phone = '92' || phone
WHERE phone ~ '^3[0-9]{9}$';

-- 5b) Local 11-digit: 03xxxxxxxxx  →  923xxxxxxxxx
UPDATE pending_otps
SET phone = '92' || substring(phone FROM 2)
WHERE phone ~ '^03[0-9]{9}$';

-- 5c) E.164 with +: +923xxxxxxxxx  →  923xxxxxxxxx
UPDATE pending_otps
SET phone = substring(phone FROM 2)
WHERE phone ~ '^\+923[0-9]{9}$';

-- 5d) Safety strip any remaining + prefix
UPDATE pending_otps
SET phone = replace(phone, '+', '')
WHERE phone ~ '^\+92[0-9]{10}$';

-- Remove any duplicates — keep most recently created OTP per canonical number
DELETE FROM pending_otps
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY phone ORDER BY created_at DESC, id ASC) AS rn
    FROM pending_otps
  ) ranked
  WHERE rn > 1
);

-- Re-add unique constraint
ALTER TABLE pending_otps ADD CONSTRAINT pending_otps_phone_unique UNIQUE (phone);
