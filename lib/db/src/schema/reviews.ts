import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reviewsTable = pgTable("reviews", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  userId: text("user_id").notNull(),
  vendorId: text("vendor_id"),
  riderId: text("rider_id"),
  orderType: text("order_type").notNull(),
  /** Primary / vendor rating (always present) */
  rating: integer("rating").notNull(),
  /** Separate rider rating — only set when a delivery rider is also being rated */
  riderRating: integer("rider_rating"),
  comment: text("comment"),
  hidden: boolean("hidden").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  deletedBy: text("deleted_by"),
  status: text("status").notNull().default("visible"),
  moderationNote: text("moderation_note"),
  vendorReply: text("vendor_reply"),
  vendorRepliedAt: timestamp("vendor_replied_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("reviews_order_user_uidx").on(t.orderId, t.userId),
  index("reviews_user_id_idx").on(t.userId),
  index("reviews_vendor_id_idx").on(t.vendorId),
  index("reviews_rider_id_idx").on(t.riderId),
  check("reviews_rating_range",       sql`${t.rating}       BETWEEN 1 AND 5`),
  check("reviews_rider_rating_range", sql`${t.riderRating}  IS NULL OR ${t.riderRating} BETWEEN 1 AND 5`),
]);

export const insertReviewSchema = createInsertSchema(reviewsTable).omit({ createdAt: true });
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviewsTable.$inferSelect;
