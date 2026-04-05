import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const conditionTypeEnum = pgEnum("condition_type", [
  "warning_l1", "warning_l2", "warning_l3",
  "restriction_service_block", "restriction_wallet_freeze", "restriction_promo_block",
  "restriction_order_cap", "restriction_review_block", "restriction_cash_only",
  "restriction_new_order_block", "restriction_rate_limit", "restriction_pending_review_gate",
  "restriction_device_restriction",
  "suspension_temporary", "suspension_extended", "suspension_pending_review",
  "ban_soft", "ban_hard", "ban_fraud",
]);

export const conditionSeverityEnum = pgEnum("condition_severity", [
  "warning", "restriction_normal", "restriction_strict", "suspension", "ban",
]);

export const conditionModeEnum = pgEnum("condition_mode", [
  "default", "ai_recommended", "custom",
]);

export const accountConditionsTable = pgTable("account_conditions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  userRole: text("user_role").notNull(),
  conditionType: conditionTypeEnum("condition_type").notNull(),
  severity: conditionSeverityEnum("severity").notNull(),
  category: text("category").notNull(),
  reason: text("reason").notNull(),
  notes: text("notes"),
  appliedBy: text("applied_by"),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  liftedAt: timestamp("lifted_at"),
  liftedBy: text("lifted_by"),
  liftReason: text("lift_reason"),
  isActive: boolean("is_active").notNull().default(true),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("account_conditions_user_id_idx").on(t.userId),
  index("account_conditions_user_role_idx").on(t.userRole),
  index("account_conditions_type_idx").on(t.conditionType),
  index("account_conditions_severity_idx").on(t.severity),
  index("account_conditions_is_active_idx").on(t.isActive),
  index("account_conditions_applied_at_idx").on(t.appliedAt),
]);

export const insertAccountConditionSchema = createInsertSchema(accountConditionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertAccountCondition = z.infer<typeof insertAccountConditionSchema>;
export type AccountCondition = typeof accountConditionsTable.$inferSelect;

export const conditionRulesTable = pgTable("condition_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  targetRole: text("target_role").notNull(),
  metric: text("metric").notNull(),
  operator: text("operator").notNull(),
  threshold: text("threshold").notNull(),
  conditionType: conditionTypeEnum("condition_type").notNull(),
  severity: conditionSeverityEnum("severity").notNull(),
  cooldownHours: integer("cooldown_hours").notNull().default(24),
  isActive: boolean("is_active").notNull().default(true),
  modeApplicability: text("mode_applicability").notNull().default("default,ai_recommended,custom"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("condition_rules_target_role_idx").on(t.targetRole),
  index("condition_rules_is_active_idx").on(t.isActive),
]);

export const insertConditionRuleSchema = createInsertSchema(conditionRulesTable).omit({ createdAt: true, updatedAt: true });
export type InsertConditionRule = z.infer<typeof insertConditionRuleSchema>;
export type ConditionRule = typeof conditionRulesTable.$inferSelect;

export const conditionSettingsTable = pgTable("condition_settings", {
  id: text("id").primaryKey(),
  mode: conditionModeEnum("mode").notNull().default("default"),
  customThresholds: jsonb("custom_thresholds"),
  aiParameters: jsonb("ai_parameters"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertConditionSettingSchema = createInsertSchema(conditionSettingsTable);
export type InsertConditionSetting = z.infer<typeof insertConditionSettingSchema>;
export type ConditionSetting = typeof conditionSettingsTable.$inferSelect;
