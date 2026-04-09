-- Create supported_payment_methods table for DB-driven payment method management.
-- Replaces hardcoded payment method lists in wallet.ts and platform-config.ts.
CREATE TABLE IF NOT EXISTS "supported_payment_methods" (
  "id"          text        PRIMARY KEY,
  "label"       text        NOT NULL,
  "description" text        NOT NULL DEFAULT '',
  "is_active"   boolean     NOT NULL DEFAULT true,
  "sort_order"  integer     NOT NULL DEFAULT 0,
  "created_at"  timestamp   NOT NULL DEFAULT now(),
  "updated_at"  timestamp   NOT NULL DEFAULT now()
);

-- Seed default payment methods (idempotent)
INSERT INTO "supported_payment_methods" ("id", "label", "description", "is_active", "sort_order")
VALUES
  ('cash',       'Cash on Delivery', 'Delivery par payment karein',       true, 1),
  ('wallet',     'AJKMart Wallet',   'Apni wallet se instant pay karein', true, 2),
  ('jazzcash',   'JazzCash',         'JazzCash mobile wallet',            true, 3),
  ('easypaisa',  'EasyPaisa',        'EasyPaisa mobile wallet',           true, 4),
  ('bank',       'Bank Transfer',    'Direct bank account transfer',      true, 5)
ON CONFLICT ("id") DO NOTHING;
