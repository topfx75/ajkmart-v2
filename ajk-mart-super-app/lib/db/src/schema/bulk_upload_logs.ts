import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const bulkUploadLogsTable = pgTable("bulk_upload_logs", {
  id: text("id").primaryKey(),
  vendorId: text("vendor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  fileName: text("file_name"),
  totalRows: integer("total_rows").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
  errors: text("errors"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("bulk_upload_logs_vendor_id_idx").on(t.vendorId),
]);

export type BulkUploadLog = typeof bulkUploadLogsTable.$inferSelect;
