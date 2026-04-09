CREATE TABLE IF NOT EXISTS "bulk_upload_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "vendor_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "file_name" text,
  "total_rows" integer NOT NULL DEFAULT 0,
  "success_count" integer NOT NULL DEFAULT 0,
  "fail_count" integer NOT NULL DEFAULT 0,
  "errors" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "bulk_upload_logs_vendor_id_idx" ON "bulk_upload_logs" ("vendor_id");
