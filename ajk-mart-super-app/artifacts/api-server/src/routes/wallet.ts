import { logger } from "../lib/logger.js";
import { canonicalizePhone } from "@workspace/phone-utils";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, notificationsTable, supportedPaymentMethodsTable } from "@workspace/db/schema";
import { eq, and, gte, sum, desc, sql, lt } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { generateId } from "../lib/id.js";
import { getPlatformSettings, adminAuth } from "./admin.js";
import { customerAuth, checkAvailableRateLimit, getClientIp, JWT_SECRET } from "../middleware/security.js";
import { t } from "@workspace/i18n";
import { getUserLanguage } from "../lib/getUserLanguage.js";
import { getIO } from "../lib/socketio.js";
import { z } from "zod";
import { sendSuccess, sendCreated, sendAccepted, sendError, sendNotFound, sendForbidden, sendValidationError, sendErrorWithData } from "../lib/response.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendOtpSMS } from "../services/sms.js";

/* ── DB-backed idempotency store (shared table with orders) ─────────────────
   Namespaced by route prefix to avoid key collisions:
     deposit:<userId>:<key>
     send:<userId>:<key>
     withdraw:<userId>:<key>
   - pending sentinel: concurrent duplicate → 409
   - stored JSON { statusCode, body }: replays the original response
   - deleted key: allows client retry with same key after failure
   TTL = 10 min; swept every 60 s. */
const walletIdempotencyTable = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  responseJson: text("response_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const WALLET_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const WALLET_IDEMPOTENCY_PENDING = "__pending__";

setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - WALLET_IDEMPOTENCY_TTL_MS);
    await db.delete(walletIdempotencyTable).where(lt(walletIdempotencyTable.createdAt, cutoff));
  } catch { /* non-fatal */ }
}, 60_000);

async function walletClaimIdempotencyKey(cacheKey: string): Promise<
  { claimed: true } | { claimed: false; cached: { statusCode: number; body: unknown } | null }
> {
  try {
    const result = await db
      .insert(walletIdempotencyTable)
      .values({ key: cacheKey, responseJson: WALLET_IDEMPOTENCY_PENDING })
      .onConflictDoNothing()
      .returning({ key: walletIdempotencyTable.key });

    if (result.length > 0) return { claimed: true };

    const [row] = await db
      .select()
      .from(walletIdempotencyTable)
      .where(eq(walletIdempotencyTable.key, cacheKey))
      .limit(1);

    if (!row) return { claimed: true };

    if (Date.now() - row.createdAt.getTime() > WALLET_IDEMPOTENCY_TTL_MS) {
      await db.delete(walletIdempotencyTable).where(eq(walletIdempotencyTable.key, cacheKey)).catch(() => {});
      const retry = await db
        .insert(walletIdempotencyTable)
        .values({ key: cacheKey, responseJson: WALLET_IDEMPOTENCY_PENDING })
        .onConflictDoNothing()
        .returning({ key: walletIdempotencyTable.key });
      return retry.length > 0 ? { claimed: true } : { claimed: false, cached: null };
    }

    if (row.responseJson === WALLET_IDEMPOTENCY_PENDING) return { claimed: false, cached: null };

    return { claimed: false, cached: JSON.parse(row.responseJson) as { statusCode: number; body: unknown } };
  } catch {
    return { claimed: true };
  }
}

async function walletSetIdempotencyRecord(cacheKey: string, statusCode: number, body: unknown): Promise<void> {
  try {
    await db
      .insert(walletIdempotencyTable)
      .values({ key: cacheKey, responseJson: JSON.stringify({ statusCode, body }) })
      .onConflictDoUpdate({
        target: walletIdempotencyTable.key,
        set: { responseJson: JSON.stringify({ statusCode, body }), createdAt: new Date() },
      });
  } catch { /* non-fatal */ }
}

async function walletReleaseIdempotencyKey(cacheKey: string): Promise<void> {
  try {
    await db
      .delete(walletIdempotencyTable)
      .where(and(eq(walletIdempotencyTable.key, cacheKey), eq(walletIdempotencyTable.responseJson, WALLET_IDEMPOTENCY_PENDING)));
  } catch { /* non-fatal */ }
}

/* ── Amount decimal precision validator ─────────────────────────────────────
   Rejects amounts with more than 2 decimal places (e.g. 100.001 → 400).
   Uses string representation to avoid floating-point artefacts. */
function hasValidDecimalPrecision(value: number): boolean {
  const str = value.toString();
  const dotIndex = str.indexOf(".");
  if (dotIndex === -1) return true;
  return str.length - dotIndex - 1 <= 2;
}

const amountField = z.union([z.number().positive(), z.string().min(1)])
  .transform(v => parseFloat(String(v)))
  .refine(v => !isNaN(v) && isFinite(v) && v > 0, "Invalid amount")
  .refine(hasValidDecimalPrecision, "Amount must have at most 2 decimal places");

const paymentMethodField = z.string().min(1, "paymentMethod is required")
  .regex(/^[a-z_]+$/, "paymentMethod must be a lowercase identifier");

const depositSchema = z.object({
  amount: amountField,
  paymentMethod: paymentMethodField,
  transactionId: z.string().min(1, "transactionId required"),
  idempotencyKey: z.string().uuid("idempotencyKey must be a UUID"),
  accountNumber: z.string().optional(),
  note: z.string().max(200).optional(),
});

const sendSchema = z.object({
  receiverPhone: z.string().min(1, "receiverPhone is required"),
  amount: amountField,
  note: z.string().max(200).optional(),
});

const withdrawSchema = z.object({
  amount: amountField,
  paymentMethod: paymentMethodField,
  accountNumber: z.string().min(1, "accountNumber required"),
  note: z.string().max(200).optional(),
});

/* External transfer rails only — these are valid methods for wallet top-up/deposit.
   'cash' and 'wallet' are order payment methods and must never appear here. */
const WALLET_TRANSFER_RAILS = new Set(["jazzcash", "easypaisa", "bank"]);

async function getEnabledPaymentMethods(): Promise<string[]> {
  /* Fetch active methods from DB (source of truth), filter to transfer rails only,
     then apply platform-setting availability toggles */
  const [s, dbMethods] = await Promise.all([
    getPlatformSettings(),
    db.select({ id: supportedPaymentMethodsTable.id })
      .from(supportedPaymentMethodsTable)
      .where(eq(supportedPaymentMethodsTable.isActive, true))
      .catch(() => [] as Array<{ id: string }>),
  ]);

  /* Platform-settings availability overlay (transfer rails only) */
  const availabilityMap: Record<string, boolean> = {
    jazzcash:  (s["jazzcash_enabled"]  ?? "off") === "on",
    easypaisa: (s["easypaisa_enabled"] ?? "off") === "on",
    bank:      (s["bank_enabled"]      ?? "off") === "on",
  };

  if (dbMethods.length > 0) {
    return dbMethods
      .map(m => m.id)
      .filter(id => WALLET_TRANSFER_RAILS.has(id) && (availabilityMap[id] ?? true));
  }

  /* Fallback if DB table not yet populated */
  const fallback: string[] = [];
  if ((s["jazzcash_enabled"]  ?? "off") === "on") fallback.push("jazzcash");
  if ((s["easypaisa_enabled"] ?? "off") === "on") fallback.push("easypaisa");
  if ((s["bank_enabled"]      ?? "off") === "on") fallback.push("bank");
  return fallback;
}

function broadcastWalletUpdate(userId: string, newBalance: number) {
  const io = getIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("wallet:update", { balance: newBalance });
}

const router: IRouter = Router();

/* ── deriveStatus — reads structured status prefix stored at the start of reference ──
   Format: "<status>:<rest>" where status is one of: approved | rejected | pending
   This is robust against admin note text that might contain the word "approved" etc. */
function deriveStatus(reference: string | null): "pending" | "approved" | "rejected" {
  const ref = (reference ?? "").split(":")[0] ?? "";
  if (ref === "approved") return "approved";
  if (ref === "rejected") return "rejected";
  return "pending";
}

function mapTx(t: typeof walletTransactionsTable.$inferSelect) {
  return {
    id: t.id,
    type: t.type,
    amount: parseFloat(t.amount),
    description: t.description,
    reference: t.reference,
    status: deriveStatus(t.reference),
    createdAt: t.createdAt.toISOString(),
  };
}

function isWalletFrozen(user: { blockedServices: string }): boolean {
  return (user.blockedServices || "").split(",").map(s => s.trim()).filter(Boolean).includes("wallet");
}

/* ── GET /wallet ─────────────────────────────────────────────────────────── */
router.get("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { sendNotFound(res, "User not found"); return; }

    if (isWalletFrozen(user)) { sendForbidden(res, "wallet_frozen", "Your wallet has been temporarily frozen. Contact support."); return; }

    const transactions = await db
      .select()
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.userId, userId))
      .orderBy(desc(walletTransactionsTable.createdAt));

    sendSuccess(res, {
      balance: parseFloat(user.walletBalance ?? "0"),
      transactions: transactions.map(mapTx),
      pinSetup: !!user.walletPinHash,
      walletHidden: !!user.walletHidden,
    });
  } catch (e: unknown) {
    logger.error("[wallet GET /] DB error:", e);
    sendError(res, "Something went wrong, please try again.", 500);
  }
});

/* ── POST /wallet/topup — ADMIN ONLY ────────────────────────────────────────
   Restricted to admin panel. Uses centralized adminAuth middleware.
   Body: { userId, amount, method? }
   Customers cannot self-credit — all credits must go through payment verification.
─────────────────────────────────────────────────────────────────────────── */
router.post("/topup", adminAuth, async (req, res) => {

  const { userId, amount, method } = req.body;
  if (!userId) { sendValidationError(res, "userId required"); return; }
  if (!amount) { sendValidationError(res, "amount required"); return; }

  const topupAmt = parseFloat(amount);
  if (isNaN(topupAmt) || !isFinite(topupAmt) || topupAmt <= 0) {
    sendValidationError(res, "Invalid amount"); return;
  }
  if (!hasValidDecimalPrecision(topupAmt)) {
    sendValidationError(res, "Amount must have at most 2 decimal places"); return;
  }

  const s = await getPlatformSettings();
  const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
  const minTopup      = parseFloat(s["wallet_min_topup"]   ?? "100");
  const maxTopup      = parseFloat(s["wallet_max_topup"]   ?? "25000");
  const maxBalance    = parseFloat(s["wallet_max_balance"] ?? "50000");

  if (!walletEnabled) {
    sendError(res, "Wallet service is currently disabled", 503); return;
  }
  if (topupAmt < minTopup) {
    sendValidationError(res, `Minimum top-up is Rs. ${minTopup}`); return;
  }
  if (topupAmt > maxTopup) {
    sendValidationError(res, `Maximum single top-up is Rs. ${maxTopup}`); return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) throw new Error("User not found");

      const currentBalance = parseFloat(user.walletBalance ?? "0");
      if (currentBalance + topupAmt > maxBalance) {
        throw new Error(`Wallet balance limit is Rs. ${maxBalance}. Current: Rs. ${currentBalance}`);
      }

      const [updated] = await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${topupAmt.toFixed(2)}` })
        .where(and(eq(usersTable.id, userId), sql`CAST(wallet_balance AS numeric) + ${topupAmt} <= ${maxBalance}`))
        .returning({ walletBalance: usersTable.walletBalance });
      if (!updated) throw new Error(`Wallet balance limit is Rs. ${maxBalance}. Top-up would exceed the limit.`);

      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId, type: "credit",
        amount: topupAmt.toFixed(2),
        description: method ? `Wallet top-up via ${method}` : "Wallet top-up",
      });
      return parseFloat(updated.walletBalance ?? "0");
    });

    broadcastWalletUpdate(userId, result);
    const transactions = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, userId));
    sendSuccess(res, { balance: result, transactions: transactions.map(mapTx) });
  } catch (e: unknown) {
    const msg = (e as Error).message ?? "";
    /* Known business rule errors bubble up as-is; unexpected errors are sanitized */
    if (msg.startsWith("Wallet balance limit") || msg === "User not found") {
      sendValidationError(res, msg);
    } else {
      logger.error("[wallet /topup] Unexpected error:", e);
      sendError(res, "Something went wrong, please try again.", 500);
    }
  }
});

/* ── POST /wallet/deposit — Submit a manual deposit request (customer) ───── */
router.post("/deposit", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const ip = getClientIp(req);

  const depositLimit = await checkAvailableRateLimit(`deposit:${ip}:${userId}`, 10, 15);
  if (depositLimit.limited) {
    sendError(res, `Too many deposit requests. Try again in ${depositLimit.minutesLeft} minute(s).`, 429); return;
  }

  try {
    const [depositUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (depositUser && isWalletFrozen(depositUser)) { sendForbidden(res, "wallet_frozen", "Your wallet has been temporarily frozen. Contact support."); return; }
  } catch (e: unknown) {
    logger.error("[wallet /deposit] DB error checking frozen:", e);
    sendError(res, "Something went wrong, please try again.", 500); return;
  }

  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
    sendValidationError(res, firstError); return;
  }

  const { amount: amt, paymentMethod, transactionId, idempotencyKey, accountNumber, note } = parsed.data;

  const enabledMethods = await getEnabledPaymentMethods();
  if (!enabledMethods.includes(paymentMethod)) {
    sendValidationError(res, `Payment method '${paymentMethod}' is not currently enabled`); return;
  }

  /* ── Normalize TxID early (needed for secondary cache guard below) ── */
  const normalizedTxId = transactionId.trim().toUpperCase().replace(/\s+/g, "");
  if (!normalizedTxId) {
    sendValidationError(res, "transactionId cannot be empty"); return;
  }

  const cacheKey = `deposit:${userId}:${idempotencyKey}`;

  const claimResult = await walletClaimIdempotencyKey(cacheKey);
  if (!claimResult.claimed) {
    if (claimResult.cached === null) {
      sendError(res, "Duplicate request — this deposit is already being processed.", 409); return;
    }
    res.status(claimResult.cached.statusCode).json(claimResult.cached.body); return;
  }

  const s = await getPlatformSettings();
  const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
  const minTopup      = parseFloat(s["wallet_min_topup"]   ?? "100");
  const maxTopup      = parseFloat(s["wallet_max_topup"]   ?? "25000");
  const autoApproveThreshold = Math.max(0, parseFloat(s["wallet_deposit_auto_approve"] ?? "0"));

  const releaseCacheKey = () => walletReleaseIdempotencyKey(cacheKey).catch(() => {});

  if (!walletEnabled) { void releaseCacheKey(); sendError(res, "Wallet service is currently disabled", 503); return; }
  if (amt < minTopup) { void releaseCacheKey(); sendValidationError(res, `Minimum deposit is Rs. ${minTopup}`); return; }
  if (amt > maxTopup) { void releaseCacheKey(); sendValidationError(res, `Maximum single deposit is Rs. ${maxTopup}`); return; }

  const txId = generateId();
  const desc = [
    `Manual deposit — ${paymentMethod}`,
    transactionId ? `TxID: ${transactionId}` : null,
    accountNumber ? `Sender: ${accountNumber}` : null,
    note ? `Note: ${note}` : null,
  ].filter(Boolean).join(" · ");

  const shouldAutoApprove = autoApproveThreshold > 0 && amt <= autoApproveThreshold;

  const setIdempotencyResult = (statusCode: number, body: unknown) => {
    void walletSetIdempotencyRecord(cacheKey, statusCode, body);
  };
  const setIdempotencyFailed = () => {
    void releaseCacheKey();
  };

  if (shouldAutoApprove) {
    const maxBalance = parseFloat(s["wallet_max_balance"] ?? "50000");

    try {
      await db.transaction(async (tx) => {
        /* SERIALIZABLE isolation ensures the duplicate check + balance update + insert
           are atomic even under concurrent snapshot reads. */
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);

        /* Lock the user row to prevent concurrent balance mutations for the same user. */
        await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);

        /* Duplicate TxID check inside the transaction — DB-level enforcement. */
        const [dupTx] = await tx.select({ id: walletTransactionsTable.id })
          .from(walletTransactionsTable)
          .where(and(
            eq(walletTransactionsTable.type, "deposit"),
            eq(walletTransactionsTable.normalizedTxId, normalizedTxId),
          ))
          .limit(1);
        if (dupTx) {
          throw Object.assign(new Error("duplicate_txid"), { isDuplicateTxId: true });
        }

        const [credited] = await tx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance + ${amt.toFixed(2)}` })
          .where(and(eq(usersTable.id, userId), sql`CAST(wallet_balance AS numeric) + ${amt} <= ${maxBalance}`))
          .returning({ walletBalance: usersTable.walletBalance });
        if (!credited) {
          throw new Error(`Wallet limit (Rs. ${maxBalance}) exceed ho jayega. Deposit nahi ho sakta.`);
        }

        await tx.insert(walletTransactionsTable).values({
          id: txId, userId, type: "deposit",
          amount: amt.toFixed(2),
          description: desc,
          reference: `approved:auto:txid:${normalizedTxId}`,
          normalizedTxId,
          paymentMethod,
        });
      });
    } catch (e: unknown) {
      const err = e as Error & { isDuplicateTxId?: boolean; code?: string; constraint?: string };
      const isDupTxId = err.isDuplicateTxId ||
        /* Postgres unique_violation (23505) on our partial unique index */
        (err.code === "23505" && (
          err.constraint === "wallet_txn_deposit_normalized_tx_id_uidx" ||
          /wallet_txn_deposit_normalized_tx_id_uidx/i.test(err.message ?? "")
        ));
      if (isDupTxId) {
        setIdempotencyFailed();
        sendError(res, "This Transaction ID has already been used. Please check your transaction history or use a different TxID.", 409);
        return;
      }
      setIdempotencyFailed();
      const msg = err.message ?? "";
      if (msg.startsWith("Wallet limit")) {
        sendValidationError(res, msg);
      } else {
        logger.error("[wallet /deposit auto-approve] DB error:", e);
        sendError(res, "Something went wrong, please try again.", 500);
      }
      return;
    }

    const depositLang = await getUserLanguage(userId);
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: t("notifWalletCredited", depositLang) + " ✅",
      body: t("notifWalletCreditedBody", depositLang).replace("{amount}", amt.toFixed(0)),
      type: "wallet", icon: "wallet-outline",
    }).catch(e => logger.error("customer deposit notif insert failed:", e));

    const [freshUser] = await db.select({ walletBalance: usersTable.walletBalance }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (freshUser) broadcastWalletUpdate(userId, parseFloat(freshUser.walletBalance ?? "0"));

    const autoBody = { txId, status: "approved:auto", amount: amt };
    setIdempotencyResult(200, autoBody);
    sendSuccess(res, autoBody);
  } else {
    try {
      await db.transaction(async (tx) => {
        /* SERIALIZABLE isolation ensures duplicate check + insert are atomic. */
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);

        /* Lock the user row to serialize concurrent deposits for the same user. */
        await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);

        /* Duplicate TxID check inside the transaction — DB-level enforcement. */
        const [dupTx] = await tx.select({ id: walletTransactionsTable.id })
          .from(walletTransactionsTable)
          .where(and(
            eq(walletTransactionsTable.type, "deposit"),
            eq(walletTransactionsTable.normalizedTxId, normalizedTxId),
          ))
          .limit(1);
        if (dupTx) {
          throw Object.assign(new Error("duplicate_txid"), { isDuplicateTxId: true });
        }

        await tx.insert(walletTransactionsTable).values({
          id: txId, userId, type: "deposit",
          amount: amt.toFixed(2),
          description: desc,
          reference: `pending:txid:${normalizedTxId}`,
          normalizedTxId,
          paymentMethod,
        });
      });
    } catch (e: unknown) {
      const err = e as Error & { isDuplicateTxId?: boolean; code?: string; constraint?: string };
      const isDupTxId = err.isDuplicateTxId ||
        (err.code === "23505" && (
          err.constraint === "wallet_txn_deposit_normalized_tx_id_uidx" ||
          /wallet_txn_deposit_normalized_tx_id_uidx/i.test(err.message ?? "")
        ));
      if (isDupTxId) {
        setIdempotencyFailed();
        sendError(res, "This Transaction ID has already been used. Please check your transaction history or use a different TxID.", 409);
        return;
      }
      setIdempotencyFailed();
      logger.error("[wallet /deposit pending] DB error:", e);
      sendError(res, "Something went wrong, please try again.", 500); return;
    }

    const pendingLang = await getUserLanguage(userId);
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: t("notifWalletPending", pendingLang) + " ✅",
      body: t("notifWalletPendingBody", pendingLang).replace("{amount}", amt.toFixed(0)),
      type: "wallet", icon: "wallet-outline",
    }).catch(e => logger.error("customer deposit notif insert failed:", e));

    const pendingBody = { txId, status: "pending", amount: amt };
    setIdempotencyResult(202, pendingBody);
    sendAccepted(res, pendingBody);
  }
});

/* ── GET /wallet/deposits — Customer deposit history ────────────────────── */
router.get("/deposits", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  try {
    const deposits = await db.select()
      .from(walletTransactionsTable)
      .where(and(eq(walletTransactionsTable.userId, userId), eq(walletTransactionsTable.type, "deposit")))
      .orderBy(desc(walletTransactionsTable.createdAt));

    const mapped = deposits.map(d => {
      const ref = d.reference ?? "pending";
      const isPending = ref === "pending" || ref.startsWith("pending:");
      const status = isPending ? "pending" : ref.startsWith("approved:") ? "approved" : ref.startsWith("rejected:") ? "rejected" : ref;
      const refNo = ref.startsWith("approved:") || ref.startsWith("rejected:") ? ref.split(":").slice(1).join(":") : "";
      return { ...d, amount: parseFloat(String(d.amount)), status, refNo };
    });

    sendSuccess(res, { deposits: mapped });
  } catch (e: unknown) {
    logger.error("[wallet /deposits] DB error:", e);
    sendError(res, "Something went wrong, please try again.", 500);
  }
});

/* ── POST /wallet/resolve-phone ─────────────────────────────────────────── */
const resolvePhoneSchema = z.object({
  phone: z.string()
    .min(1, "phone is required")
    .transform(v => canonicalizePhone(v.trim()) ?? "")
    .pipe(z.string().regex(/^92\d{10}$/, "Invalid Pakistani phone number (must be a valid Pakistani mobile number e.g. 03001234567 or +923001234567)")),
});

router.post("/resolve-phone", customerAuth, async (req, res) => {
  const parsed = resolvePhoneSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
    sendValidationError(res, firstError); return;
  }

  const userId = req.customerId!;
  const resolveLimit = await checkAvailableRateLimit(`resolve-phone:${userId}`, 10, 1);
  if (resolveLimit.limited) {
    sendError(res, `Too many lookup requests. Try again in ${resolveLimit.minutesLeft} minute(s).`, 429); return;
  }

  const phone = parsed.data.phone;
  try {
    const [user] = await db.select({ name: usersTable.name, phone: usersTable.phone })
      .from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
    if (!user) { sendSuccess(res, { found: false, name: null }); return; }
    sendSuccess(res, { found: true, name: user.name || null });
  } catch (e: unknown) {
    logger.error("[wallet /resolve-phone] DB error:", e);
    sendError(res, "Something went wrong, please try again.", 500);
  }
});

/* ── POST /wallet/send ───────────────────────────────────────────────────── */
router.post("/send", customerAuth, requireWalletPin, async (req, res) => {
  const senderUserId = req.customerId!;

  const sendRateLimit = await checkAvailableRateLimit(`send:${senderUserId}`, 5, 1);
  if (sendRateLimit.limited) {
    sendError(res, `Too many transfer requests. Try again in ${sendRateLimit.minutesLeft} minute(s).`, 429); return;
  }

  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
    sendValidationError(res, firstError); return;
  }

  const { receiverPhone, amount: sendAmt, note } = parsed.data;

  /* Idempotency for /send — accept key from Idempotency-Key header (preferred) or body field */
  const idempotencyKey =
    (req.headers["idempotency-key"] as string | undefined) ??
    (typeof req.body["idempotencyKey"] === "string" ? req.body["idempotencyKey"] : undefined);

  let sendCacheKey: string | null = null;
  if (idempotencyKey) {
    sendCacheKey = `send:${senderUserId}:${idempotencyKey}`;
    const claimResult = await walletClaimIdempotencyKey(sendCacheKey);
    if (!claimResult.claimed) {
      if (claimResult.cached === null) {
        sendError(res, "Duplicate request — this transfer is already being processed.", 409); return;
      }
      res.status(claimResult.cached.statusCode).json(claimResult.cached.body); return;
    }
  }

  const s = await getPlatformSettings();
  const walletEnabled  = (s["feature_wallet"]      ?? "on") === "on";
  const p2pEnabled     = (s["wallet_p2p_enabled"]   ?? "on") === "on";
  const minWithdrawal  = parseFloat(s["wallet_min_withdrawal"]   ?? "200");
  const maxWithdrawal  = parseFloat(s["wallet_max_withdrawal"]   ?? "10000");
  const dailyLimit     = parseFloat(s["wallet_daily_limit"]      ?? "20000");
  const p2pDailyLimit  = parseFloat(s["wallet_p2p_daily_limit"]  ?? "10000");
  const p2pFeePct      = Math.max(0, Math.min(50, parseFloat(s["wallet_p2p_fee_pct"] ?? "0")));

  const clearKey = () => { if (sendCacheKey) void walletReleaseIdempotencyKey(sendCacheKey!).catch(() => {}); };

  if (!p2pEnabled) {
    clearKey();
    sendForbidden(res, "P2P money transfers are currently disabled by admin."); return;
  }
  if (!walletEnabled) {
    clearKey();
    sendError(res, "Wallet service is currently disabled", 503); return;
  }
  if (sendAmt < minWithdrawal) {
    clearKey();
    sendValidationError(res, `Minimum transfer is Rs. ${minWithdrawal}`); return;
  }
  if (sendAmt > maxWithdrawal) {
    clearKey();
    sendValidationError(res, `Maximum single transfer is Rs. ${maxWithdrawal}`); return;
  }

  const maxBalance = parseFloat(s["wallet_max_balance"] ?? "50000");

  try {
    const [receiverPre] = await db.select({ id: usersTable.id, name: usersTable.name, blockedServices: usersTable.blockedServices })
      .from(usersTable).where(eq(usersTable.phone, receiverPhone.trim())).limit(1);
    if (!receiverPre) { clearKey(); sendNotFound(res, "Receiver not found. Phone number check karein."); return; }
    if (receiverPre.id === senderUserId) { clearKey(); sendValidationError(res, "Apne aap ko transfer nahi kar sakte"); return; }
    if (isWalletFrozen(receiverPre)) { clearKey(); sendErrorWithData(res, "Receiver's wallet is currently frozen. Transfer cannot be completed.", { walletFrozen: true }, 403); return; }

    const result = await db.transaction(async (tx) => {
      /* Lock sender row first */
      const [sender] = await tx.select().from(usersTable).where(eq(usersTable.id, senderUserId)).limit(1).for("update");
      if (!sender) throw new Error("Sender not found");
      if (isWalletFrozen(sender)) throw Object.assign(new Error("Your wallet has been temporarily frozen. Contact support."), { walletFrozen: true });

      /* Re-validate frozen check inside transaction so mid-flight admin freeze is caught */
      if (isWalletFrozen(sender)) {
        throw Object.assign(new Error("Your wallet has been temporarily frozen. Contact support."), { walletFrozen: "sender" });
      }

      const feeAmt = p2pFeePct > 0 ? Math.round(sendAmt * p2pFeePct) / 100 : 0;
      const totalDebit = sendAmt + feeAmt;

      const senderBalance = parseFloat(sender.walletBalance ?? "0");
      if (senderBalance < totalDebit) throw new Error(feeAmt > 0 ? `Insufficient balance. Amount Rs. ${sendAmt} + Fee Rs. ${feeAmt.toFixed(2)} = Rs. ${totalDebit.toFixed(2)}` : "Insufficient wallet balance");

      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const [todayDebits] = await tx
        .select({ total: sum(walletTransactionsTable.amount) })
        .from(walletTransactionsTable)
        .where(and(
          eq(walletTransactionsTable.userId, senderUserId),
          eq(walletTransactionsTable.type, "debit"),
          gte(walletTransactionsTable.createdAt, todayStart),
        ));
      const todayTotal = parseFloat(String(todayDebits?.total ?? "0")) || 0;
      if (todayTotal + totalDebit > p2pDailyLimit) {
        throw new Error(`Daily P2P transfer limit is Rs. ${p2pDailyLimit}. Aaj Rs. ${todayTotal.toFixed(0)} transfer ho chuke hain.`);
      }
      if (todayTotal + totalDebit > dailyLimit) {
        throw new Error(`Daily wallet limit is Rs. ${dailyLimit}. Aaj aap ne Rs. ${todayTotal.toFixed(0)} kharch kiye hain.`);
      }

      /* Lock receiver row before any read/write */
      const [receiver] = await tx.select().from(usersTable).where(eq(usersTable.id, receiverPre.id)).limit(1).for("update");
      if (!receiver) throw new Error("Receiver not found");
      if (isWalletFrozen(receiver)) throw Object.assign(new Error("Receiver's wallet is currently frozen. Transfer cannot be completed."), { walletFrozen: "receiver" });

      const [deducted] = await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance - ${totalDebit.toFixed(2)}` })
        .where(and(eq(usersTable.id, senderUserId), gte(usersTable.walletBalance, totalDebit.toFixed(2))))
        .returning({ walletBalance: usersTable.walletBalance });
      if (!deducted) throw new Error("Insufficient wallet balance");

      const [credited] = await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${sendAmt.toFixed(2)}` })
        .where(and(eq(usersTable.id, receiver.id), sql`CAST(wallet_balance AS numeric) + ${sendAmt} <= ${maxBalance}`))
        .returning({ walletBalance: usersTable.walletBalance });
      if (!credited) {
        throw new Error(`Receiver wallet limit (Rs. ${maxBalance}) exceed ho jayega. Transfer nahi ho sakta.`);
      }

      const desc    = note ? `Transfer to ${receiverPhone} — ${note}` : `Transfer to ${receiverPhone}`;
      const recvDesc = note ? `Received from ${sender.phone} — ${note}` : `Received from ${sender.phone}`;

      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId: senderUserId, type: "debit",
        amount: sendAmt.toFixed(2), description: desc,
      });
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId: receiver.id, type: "credit",
        amount: sendAmt.toFixed(2), description: recvDesc,
      });

      if (feeAmt > 0) {
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId: senderUserId, type: "debit",
          amount: feeAmt.toFixed(2), description: `P2P Transfer Fee (${p2pFeePct}%)`,
        });
      }

      return { newBalance: parseFloat(deducted.walletBalance ?? "0"), receiverName: receiver.name || receiverPhone, receiverId: receiver.id, senderName: sender.name || sender.phone, amount: sendAmt, fee: feeAmt };
    });

    broadcastWalletUpdate(senderUserId, result.newBalance);
    const [rcvBal] = await db.select({ walletBalance: usersTable.walletBalance }).from(usersTable).where(eq(usersTable.id, result.receiverId)).limit(1);
    if (rcvBal) broadcastWalletUpdate(result.receiverId, parseFloat(rcvBal.walletBalance ?? "0"));

    const sendLang = await getUserLanguage(result.receiverId);
    db.insert(notificationsTable).values({
      id: generateId(), userId: result.receiverId,
      title: t("notifWalletCredited", sendLang) + " 💰",
      body: t("notifWalletReceivedBody", sendLang).replace("{amount}", result.amount.toFixed(0)).replace("{sender}", result.senderName),
      type: "wallet", icon: "wallet-outline",
    }).catch(e => logger.error("receiver send notif insert failed:", e));

    const { receiverId: _rid, senderName: _sn, ...responseData } = result;
    if (sendCacheKey) void walletSetIdempotencyRecord(sendCacheKey, 200, responseData);
    sendSuccess(res, responseData);
  } catch (e: unknown) {
    if (sendCacheKey) void walletReleaseIdempotencyKey(sendCacheKey).catch(() => {});
    const err = e as { walletFrozen?: string; message?: string };
    if (err.walletFrozen === "sender") {
      sendForbidden(res, "wallet_frozen", err.message); return;
    }
    if (err.walletFrozen === "receiver") {
      sendErrorWithData(res, err.message ?? "Wallet is frozen", { walletFrozen: true }, 403); return;
    }
    const knownErrors = [
      "Insufficient", "Daily", "Sender not found", "Receiver not found",
      "limit", "Apne aap", "transfer nahi"
    ];
    const isKnown = knownErrors.some(k => (err.message ?? "").includes(k));
    if (isKnown) {
      sendValidationError(res, err.message ?? "Transaction failed");
    } else {
      logger.error("[wallet /send] Unexpected error:", e);
      sendError(res, "Something went wrong, please try again.", 500);
    }
  }
});

/* ── GET /wallet/deposit-methods — Dynamic deposit methods from admin settings ── */
router.get("/deposit-methods", customerAuth, async (_req, res) => {
  try {
    const s = await getPlatformSettings();
    const methods: Array<Record<string, unknown>> = [];

    if ((s["jazzcash_enabled"] ?? "off") === "on") {
      const jcType = s["jazzcash_type"] ?? "manual";
      const entry: Record<string, unknown> = {
        id: "jazzcash",
        label: "JazzCash",
        logo: "jazzcash",
        available: true,
        mode: jcType === "api" ? (s["jazzcash_mode"] ?? "sandbox") : "manual",
        type: jcType,
        description: "JazzCash mobile wallet",
        proofRequired: (s["jazzcash_proof_required"] ?? "off") === "on",
        minAmount: parseFloat(s["jazzcash_min_amount"] ?? "10"),
        maxAmount: parseFloat(s["jazzcash_max_amount"] ?? "100000"),
      };
      if (jcType === "manual") {
        entry["manualName"] = s["jazzcash_manual_name"] ?? "";
        entry["manualNumber"] = s["jazzcash_manual_number"] ?? "";
        entry["manualInstructions"] = s["jazzcash_manual_instructions"] ?? "Number par payment bhejein aur transaction ID hum se share karein.";
      }
      methods.push(entry);
    }

    if ((s["easypaisa_enabled"] ?? "off") === "on") {
      const epType = s["easypaisa_type"] ?? "manual";
      const entry: Record<string, unknown> = {
        id: "easypaisa",
        label: "EasyPaisa",
        logo: "easypaisa",
        available: true,
        mode: epType === "api" ? (s["easypaisa_mode"] ?? "sandbox") : "manual",
        type: epType,
        description: "EasyPaisa mobile wallet",
        proofRequired: (s["easypaisa_proof_required"] ?? "off") === "on",
        minAmount: parseFloat(s["easypaisa_min_amount"] ?? "10"),
        maxAmount: parseFloat(s["easypaisa_max_amount"] ?? "100000"),
      };
      if (epType === "manual") {
        entry["manualName"] = s["easypaisa_manual_name"] ?? "";
        entry["manualNumber"] = s["easypaisa_manual_number"] ?? "";
        entry["manualInstructions"] = s["easypaisa_manual_instructions"] ?? "Number par payment bhejein aur transaction ID share karein.";
      }
      methods.push(entry);
    }

    if ((s["bank_enabled"] ?? "off") === "on") {
      methods.push({
        id: "bank",
        label: "Bank Transfer",
        logo: "bank",
        available: true,
        mode: "manual",
        type: "manual",
        description: "Direct bank account transfer",
        bankName: s["bank_name"] ?? "",
        accountTitle: s["bank_account_title"] ?? "",
        accountNumber: s["bank_account_number"] ?? "",
        iban: s["bank_iban"] ?? "",
        branchCode: s["bank_branch_code"] ?? "",
        swiftCode: s["bank_swift_code"] ?? "",
        instructions: s["bank_instructions"] ?? "Bank account mein transfer karein aur receipt hum se share karein.",
        proofRequired: (s["bank_proof_required"] ?? "on") === "on",
        minAmount: parseFloat(s["bank_min_amount"] ?? "0"),
        processingHours: parseInt(s["bank_processing_hours"] ?? "24"),
      });
    }

    sendSuccess(res, { methods });
  } catch (e: unknown) {
    logger.error("[wallet /deposit-methods] error:", e);
    sendError(res, "Something went wrong, please try again.", 500);
  }
});

router.get("/withdrawal-methods", customerAuth, async (_req, res) => {
  try {
    const s = await getPlatformSettings();
    const methods: Array<{ id: string; label: string; placeholder: string }> = [];
    if ((s["jazzcash_enabled"] ?? "off") === "on") {
      methods.push({ id: "jazzcash", label: "JazzCash", placeholder: "03XX-XXXXXXX" });
    }
    if ((s["easypaisa_enabled"] ?? "off") === "on") {
      methods.push({ id: "easypaisa", label: "EasyPaisa", placeholder: "03XX-XXXXXXX" });
    }
    if ((s["bank_enabled"] ?? "off") === "on") {
      methods.push({ id: "bank", label: "Bank Transfer", placeholder: "PKXX XXXX XXXX XXXX XXXX (IBAN)" });
    }
    sendSuccess(res, { methods });
  } catch (e: unknown) {
    logger.error("[wallet /withdrawal-methods] error:", e);
    sendError(res, "Something went wrong, please try again.", 500);
  }
});

/* ── POST /wallet/withdraw — Customer requests a withdrawal ─────────────── */
router.post("/withdraw", customerAuth, requireWalletPin, async (req, res) => {
  const userId = req.customerId!;

  const withdrawRateLimit = await checkAvailableRateLimit(`withdraw:${userId}`, 3, 10);
  if (withdrawRateLimit.limited) {
    sendError(res, `Too many withdrawal requests. Try again in ${withdrawRateLimit.minutesLeft} minute(s).`, 429); return;
  }

  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
    sendValidationError(res, firstError); return;
  }

  const { amount: amt, paymentMethod, accountNumber, note } = parsed.data;

  const enabledWithdrawMethods = await getEnabledPaymentMethods();
  if (!enabledWithdrawMethods.includes(paymentMethod)) {
    sendValidationError(res, `Withdrawal method '${paymentMethod}' is not currently enabled`); return;
  }

  /* Idempotency for /withdraw — accept key from Idempotency-Key header (preferred) or body field */
  const idempotencyKey =
    (req.headers["idempotency-key"] as string | undefined) ??
    (typeof req.body["idempotencyKey"] === "string" ? req.body["idempotencyKey"] : undefined);

  let withdrawCacheKey: string | null = null;
  if (idempotencyKey) {
    withdrawCacheKey = `withdraw:${userId}:${idempotencyKey}`;
    const claimResult = await walletClaimIdempotencyKey(withdrawCacheKey);
    if (!claimResult.claimed) {
      if (claimResult.cached === null) {
        sendError(res, "Duplicate request — this withdrawal is already being processed.", 409); return;
      }
      res.status(claimResult.cached.statusCode).json(claimResult.cached.body); return;
    }
  }

  const clearKey = () => { if (withdrawCacheKey) void walletReleaseIdempotencyKey(withdrawCacheKey!).catch(() => {}); };

  let withdrawUser: { blockedServices: string; walletBalance: string } | undefined;
  try {
    const [u] = await db.select({ blockedServices: usersTable.blockedServices, walletBalance: usersTable.walletBalance })
      .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!u) { clearKey(); sendNotFound(res, "User not found"); return; }
    withdrawUser = u;
  } catch (e: unknown) {
    clearKey();
    logger.error("[wallet /withdraw] DB error fetching user:", e);
    sendError(res, "Something went wrong, please try again.", 500); return;
  }

  if (isWalletFrozen(withdrawUser)) { clearKey(); sendForbidden(res, "wallet_frozen", "Your wallet has been temporarily frozen. Contact support."); return; }

  const s = await getPlatformSettings();
  const walletEnabled  = (s["feature_wallet"]        ?? "on") === "on";
  const minWithdrawal  = parseFloat(s["wallet_min_withdrawal"] ?? "200");
  const maxWithdrawal  = parseFloat(s["wallet_max_withdrawal"] ?? "10000");

  if (!walletEnabled) { clearKey(); sendError(res, "Wallet service is currently disabled", 503); return; }
  if (amt < minWithdrawal) { clearKey(); sendValidationError(res, `Minimum withdrawal is Rs. ${minWithdrawal}`); return; }
  if (amt > maxWithdrawal) { clearKey(); sendValidationError(res, `Maximum single withdrawal is Rs. ${maxWithdrawal}`); return; }

  /* Fast-fail UX shortcut — NOT authoritative. This balance may be stale if a concurrent
     request committed between the read above and now. The SELECT FOR UPDATE inside the
     transaction below is the authoritative check. */
  const balance = parseFloat(String(withdrawUser.walletBalance ?? "0"));
  if (balance < amt) {
    clearKey();
    sendValidationError(res, `Insufficient wallet balance. Available: Rs. ${balance.toFixed(0)}`); return;
  }

  const txId = generateId();
  const desc = [
    `Withdrawal request — ${paymentMethod}`,
    `Account: ${accountNumber}`,
    note ? `Note: ${note}` : null,
  ].filter(Boolean).join(" · ");

  try {
    await db.transaction(async (tx) => {
      /* Lock user row first (SELECT FOR UPDATE) — prevents two concurrent withdrawal
         requests from both entering the deduction step simultaneously.
         The pre-transaction balance check above is a fast-fail UX shortcut only;
         this locked row is the authoritative balance check. */
      const [lockedUser] = await tx.select({ walletBalance: usersTable.walletBalance, blockedServices: usersTable.blockedServices })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1).for("update");
      if (!lockedUser) throw new Error("User not found");
      if (isWalletFrozen(lockedUser)) throw Object.assign(new Error("Your wallet has been temporarily frozen. Contact support."), { walletFrozen: true });

      const lockedBalance = parseFloat(String(lockedUser.walletBalance ?? "0"));
      if (lockedBalance < amt) throw new Error(`Insufficient wallet balance. Available: Rs. ${lockedBalance.toFixed(0)}`);

      const [deducted] = await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance - ${amt.toFixed(2)}`, updatedAt: new Date() })
        .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, amt.toFixed(2))))
        .returning({ id: usersTable.id });
      if (!deducted) throw new Error(`Insufficient wallet balance. Available: Rs. ${lockedBalance.toFixed(0)}`);
      await tx.insert(walletTransactionsTable).values({
        id: txId, userId, type: "withdrawal",
        amount: amt.toFixed(2),
        description: desc,
        reference: "pending",
        paymentMethod,
      });
    });
  } catch (e: unknown) {
    clearKey();
    const msg = (e instanceof Error) ? e.message : "";
    if (msg.startsWith("Insufficient") || msg.includes("frozen") || msg.includes("limit")) {
      sendValidationError(res, msg);
    } else {
      logger.error("[wallet /withdraw] Unexpected error:", e);
      sendError(res, "Something went wrong, please try again.", 500);
    }
    return;
  }

  const withdrawLang = await getUserLanguage(userId);
  await db.insert(notificationsTable).values({
    id: generateId(), userId,
    title: t("notifWithdrawalPending", withdrawLang),
    body: t("notifWithdrawalPendingBody", withdrawLang).replace("{amount}", amt.toFixed(0)),
    type: "wallet", icon: "wallet-outline",
  }).catch(e => logger.error("withdrawal notif insert failed:", e));

  const responseBody = { txId, status: "pending", amount: amt };
  if (withdrawCacheKey) void walletSetIdempotencyRecord(withdrawCacheKey, 200, responseBody);
  sendSuccess(res, responseBody);
});

/* ── GET /wallet/pending-topups — Customer pending topup count ────────── */
router.get("/pending-topups", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  try {
    const pending = await db.select()
      .from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.userId, userId),
        eq(walletTransactionsTable.type, "deposit"),
        sql`(${walletTransactionsTable.reference} = 'pending' OR ${walletTransactionsTable.reference} LIKE 'pending:%')`,
      ));
    sendSuccess(res, { count: pending.length, total: pending.reduce((s, t) => s + parseFloat(t.amount), 0) });
  } catch (e: unknown) {
    logger.error("[wallet /pending-topups] DB error:", e);
    sendError(res, "Something went wrong, please try again.", 500);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   MPIN Security System
   ══════════════════════════════════════════════════════════════════════════ */

const MPIN_MAX_ATTEMPTS = 5;
const MPIN_LOCK_DURATION_MS = 30 * 60 * 1000;
const MPIN_BCRYPT_ROUNDS = 10;
const WALLET_ACTION_TOKEN_TTL_SEC = 5 * 60;

const mpinSchema = z.string().regex(/^\d{4}$/, "MPIN must be exactly 4 digits");

const revokedWalletTokens = new Set<string>();
setInterval(() => {
  revokedWalletTokens.clear();
}, 10 * 60 * 1000);

function signWalletActionToken(userId: string): string {
  const jti = generateId();
  return jwt.sign(
    { sub: userId, scope: "wallet-action", jti, iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: WALLET_ACTION_TOKEN_TTL_SEC },
  );
}

function verifyWalletActionToken(
  token: string,
  expectedUserId: string,
  pinChangedAt?: Date | null,
): { valid: true; jti: string } | { valid: false; reason: string } {
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (payload.scope !== "wallet-action") return { valid: false, reason: "Invalid token scope" };
    if (payload.sub !== expectedUserId) return { valid: false, reason: "Token user mismatch" };
    if (!payload.jti) return { valid: false, reason: "Missing token identifier" };
    if (revokedWalletTokens.has(payload.jti)) return { valid: false, reason: "Token already used" };
    if (pinChangedAt && payload.iat && payload.iat < Math.floor(pinChangedAt.getTime() / 1000)) {
      return { valid: false, reason: "Token issued before PIN change" };
    }
    return { valid: true, jti: payload.jti };
  } catch (e: unknown) {
    const err = e as Error;
    if (err.name === "TokenExpiredError") return { valid: false, reason: "Token expired" };
    return { valid: false, reason: "Invalid token" };
  }
}

async function requireWalletPin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.customerId!;

  const s = await getPlatformSettings();
  if ((s["wallet_mpin_enabled"] ?? "on") !== "on") {
    next();
    return;
  }

  const [user] = await db.select({
    walletPinHash: usersTable.walletPinHash,
    updatedAt: usersTable.updatedAt,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user?.walletPinHash) {
    next();
    return;
  }

  const pinToken = req.headers["x-wallet-pin-token"] as string | undefined;
  if (!pinToken) {
    sendForbidden(res, "pin_required", "MPIN verification required for this transaction");
    return;
  }

  const result = verifyWalletActionToken(pinToken, userId, user.updatedAt);
  if (!result.valid) {
    sendForbidden(res, "pin_expired", result.reason === "Token expired"
      ? "MPIN verification expired. Please verify again."
      : `MPIN verification failed: ${result.reason}`);
    return;
  }

  revokedWalletTokens.add(result.jti);
  next();
}

function isWalletPinLocked(user: { walletPinLockedUntil: Date | null }): boolean {
  if (!user.walletPinLockedUntil) return false;
  return user.walletPinLockedUntil.getTime() > Date.now();
}

router.post("/pin/setup", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { sendNotFound(res, "User not found"); return; }
    if (user.walletPinHash) { sendError(res, "MPIN already set. Use change PIN instead.", 409); return; }

    const parsed = mpinSchema.safeParse(req.body.pin);
    if (!parsed.success) { sendValidationError(res, "MPIN must be exactly 4 digits"); return; }

    const hash = await bcrypt.hash(parsed.data, MPIN_BCRYPT_ROUNDS);
    await db.update(usersTable).set({
      walletPinHash: hash,
      walletPinAttempts: 0,
      walletPinLockedUntil: null,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, userId));

    sendCreated(res, { message: "MPIN created successfully", pinSetup: true });
  } catch (e: unknown) {
    logger.error("[wallet /pin/setup] error:", e);
    sendError(res, "Something went wrong, please try again.", 500);
  }
});

router.post("/pin/verify", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { sendNotFound(res, "User not found"); return; }
    if (!user.walletPinHash) { sendError(res, "MPIN not set up yet", 400); return; }

    if (isWalletPinLocked(user)) {
      const remainMin = Math.ceil((user.walletPinLockedUntil!.getTime() - Date.now()) / 60000);
      sendForbidden(res, "pin_locked", `MPIN locked. Try again in ${remainMin} minute(s).`);
      return;
    }

    const parsed = mpinSchema.safeParse(req.body.pin);
    if (!parsed.success) { sendValidationError(res, "MPIN must be exactly 4 digits"); return; }

    const valid = await bcrypt.compare(parsed.data, user.walletPinHash);
    if (!valid) {
      const newAttempts = (user.walletPinAttempts ?? 0) + 1;
      const locked = newAttempts >= MPIN_MAX_ATTEMPTS;
      await db.update(usersTable).set({
        walletPinAttempts: newAttempts,
        walletPinLockedUntil: locked ? new Date(Date.now() + MPIN_LOCK_DURATION_MS) : null,
        updatedAt: new Date(),
      }).where(eq(usersTable.id, userId));

      if (locked) {
        sendForbidden(res, "pin_locked", "Too many wrong attempts. MPIN locked for 30 minutes.");
      } else {
        sendError(res, `Wrong MPIN. ${MPIN_MAX_ATTEMPTS - newAttempts} attempt(s) remaining.`, 401);
      }
      return;
    }

    await db.update(usersTable).set({
      walletPinAttempts: 0,
      walletPinLockedUntil: null,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, userId));

    const pinToken = signWalletActionToken(userId);

    sendSuccess(res, { verified: true, pinToken });
  } catch (e: unknown) {
    logger.error("[wallet /pin/verify] error:", e);
    sendError(res, "Something went wrong, please try again.", 500);
  }
});

router.post("/pin/change", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { sendNotFound(res, "User not found"); return; }
    if (!user.walletPinHash) { sendError(res, "MPIN not set up yet", 400); return; }

    if (isWalletPinLocked(user)) {
      sendForbidden(res, "pin_locked", "MPIN is locked. Try again later.");
      return;
    }

    const oldParsed = mpinSchema.safeParse(req.body.oldPin);
    const newParsed = mpinSchema.safeParse(req.body.newPin);
    if (!oldParsed.success || !newParsed.success) {
      sendValidationError(res, "Both old and new MPIN must be exactly 4 digits");
      return;
    }

    if (oldParsed.data === newParsed.data) {
      sendValidationError(res, "New MPIN must be different from old MPIN");
      return;
    }

    const valid = await bcrypt.compare(oldParsed.data, user.walletPinHash);
    if (!valid) {
      sendError(res, "Current MPIN is incorrect", 401);
      return;
    }

    const hash = await bcrypt.hash(newParsed.data, MPIN_BCRYPT_ROUNDS);
    await db.update(usersTable).set({
      walletPinHash: hash,
      walletPinAttempts: 0,
      walletPinLockedUntil: null,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, userId));

    sendSuccess(res, { message: "MPIN changed successfully" });
  } catch (e: unknown) {
    logger.error("[wallet /pin/change] error:", e);
    sendError(res, "Something went wrong, please try again.", 500);
  }
});

router.post("/pin/forgot", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { sendNotFound(res, "User not found"); return; }
    if (!user.walletPinHash) { sendError(res, "MPIN not set up yet", 400); return; }
    if (!user.phone) { sendError(res, "No phone number linked to this account", 400); return; }

    const rateLimited = await checkAvailableRateLimit(`pin-forgot:${userId}`, 3, 5);
    if (rateLimited.limited) {
      sendError(res, `Too many requests. Try again in ${rateLimited.minutesLeft} minute(s).`, 429);
      return;
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await import("crypto").then(c => c.createHash("sha256").update(otp).digest("hex"));
    await db.update(usersTable).set({
      otpCode: otpHash,
      otpExpiry: new Date(Date.now() + 5 * 60 * 1000),
      otpUsed: false,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, userId));

    /* Send OTP via SMS service (logs to console in dev when provider is "console") */
    const walletSettings = await getPlatformSettings();
    const userLang = await getUserLanguage(userId);
    const smsResult = await sendOtpSMS(user.phone, otp, walletSettings, userLang);

    logger.info(`[wallet /pin/forgot] OTP dispatched via ${smsResult.provider} for ${user.phone}`);

    const isDev_walletPin = process.env.NODE_ENV !== "production";
    const globalDevOtp_wallet = walletSettings["security_global_dev_otp"] === "on";
    const showDevOtp = user.devOtpEnabled || globalDevOtp_wallet;

    const responseData: Record<string, unknown> = {
      message: "OTP sent to your phone number",
      phone: user.phone.replace(/^(\d{2})\d+(\d{2})$/, "$1****$2"),
    };

    if (showDevOtp) {
      responseData["_dev_otp"] = otp;
    }

    sendSuccess(res, responseData);
  } catch (e: unknown) {
    logger.error("[wallet /pin/forgot] error:", e);
    sendError(res, "Something went wrong, please try again.", 500);
  }
});

router.post("/pin/reset-confirm", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { sendNotFound(res, "User not found"); return; }

    const { otp, newPin } = req.body;
    if (!otp || typeof otp !== "string") { sendValidationError(res, "OTP is required"); return; }

    const newParsed = mpinSchema.safeParse(newPin);
    if (!newParsed.success) { sendValidationError(res, "New MPIN must be exactly 4 digits"); return; }

    if (!user.otpCode || !user.otpExpiry || user.otpUsed) {
      sendError(res, "No active OTP found. Request a new one.", 400);
      return;
    }
    if (user.otpExpiry.getTime() < Date.now()) {
      sendError(res, "OTP has expired. Request a new one.", 400);
      return;
    }

    const resetSettings = await getPlatformSettings();
    const isDev_pinReset = process.env.NODE_ENV !== "production";
    const bypassOtp_pinReset = isDev_pinReset && resetSettings["security_otp_bypass"] === "on";

    if (!bypassOtp_pinReset) {
      const otpHash = await import("crypto").then(c => c.createHash("sha256").update(otp).digest("hex"));
      if (otpHash !== user.otpCode) {
        sendError(res, "Invalid OTP", 401);
        return;
      }
    }

    const hash = await bcrypt.hash(newParsed.data, MPIN_BCRYPT_ROUNDS);
    await db.update(usersTable).set({
      walletPinHash: hash,
      walletPinAttempts: 0,
      walletPinLockedUntil: null,
      otpUsed: true,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, userId));

    sendSuccess(res, { message: "MPIN reset successfully", pinSetup: true });
  } catch (e: unknown) {
    logger.error("[wallet /pin/reset-confirm] error:", e);
    sendError(res, "Something went wrong, please try again.", 500);
  }
});

router.patch("/visibility", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  try {
    const hidden = req.body.hidden;
    if (typeof hidden !== "boolean") { sendValidationError(res, "hidden must be a boolean"); return; }

    await db.update(usersTable).set({
      walletHidden: hidden,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, userId));

    sendSuccess(res, { walletHidden: hidden });
  } catch (e: unknown) {
    logger.error("[wallet /visibility] error:", e);
    sendError(res, "Something went wrong, please try again.", 500);
  }
});

export { requireWalletPin };

export default router;
