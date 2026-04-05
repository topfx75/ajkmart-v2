import { logger } from "../lib/logger.js";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, notificationsTable } from "@workspace/db/schema";
import { eq, and, gte, sum, desc, sql } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings, adminAuth } from "./admin.js";
import { customerAuth, checkAvailableRateLimit, getClientIp } from "../middleware/security.js";
import { t } from "@workspace/i18n";
import { getUserLanguage } from "../lib/getUserLanguage.js";
import { getIO } from "../lib/socketio.js";
import { z } from "zod";
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendValidationError, sendErrorWithData } from "../lib/response.js";

type IdempotencyEntry =
  | { state: "in_flight"; ts: number }
  | { state: "success"; ts: number; statusCode: number; body: unknown }
  | { state: "failed"; ts: number };

/* In-memory idempotency store for deposit requests.
   - "in_flight": concurrent duplicate → 409
   - "success": replays the original response body and status code
   - "failed": key is removed so the client can retry with the same key
   TTL = 10 min; swept every 5 min. */
const depositIdempotencyCache = new Map<string, IdempotencyEntry>();
const sendIdempotencyCache = new Map<string, IdempotencyEntry>();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of depositIdempotencyCache) {
    if (now - entry.ts > IDEMPOTENCY_TTL_MS) depositIdempotencyCache.delete(key);
  }
  for (const [key, entry] of sendIdempotencyCache) {
    if (now - entry.ts > IDEMPOTENCY_TTL_MS) sendIdempotencyCache.delete(key);
  }
}, 5 * 60 * 1000);

const amountSchema = z.union([z.number().positive(), z.string().min(1)])
  .transform(v => parseFloat(String(v)))
  .refine(v => !isNaN(v) && v > 0, "Invalid amount")
  .refine(v => Math.round(v * 100) === v * 100, "Amount cannot have more than 2 decimal places");

const depositSchema = z.object({
  amount: amountSchema,
  paymentMethod: z.string().min(1, "paymentMethod required"),
  transactionId: z.string().min(1, "transactionId required"),
  idempotencyKey: z.string().uuid("idempotencyKey must be a UUID"),
  accountNumber: z.string().optional(),
  note: z.string().max(500).optional(),
});

const sendSchema = z.object({
  receiverPhone: z.string().min(1, "receiverPhone is required"),
  amount: amountSchema,
  note: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

const withdrawSchema = z.object({
  amount: amountSchema,
  paymentMethod: z.enum(["jazzcash", "easypaisa", "bank"], { errorMap: () => ({ message: "paymentMethod must be jazzcash, easypaisa, or bank" }) }),
  accountNumber: z.string().min(1, "accountNumber required"),
  note: z.string().max(500).optional(),
});

function broadcastWalletUpdate(userId: string, newBalance: number) {
  const io = getIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("wallet:update", { balance: newBalance });
}

const router: IRouter = Router();

function deriveStatus(reference: string | null): "pending" | "approved" | "rejected" {
  const ref = reference ?? "";
  if (ref.startsWith("approved")) return "approved";
  if (ref.startsWith("rejected")) return "rejected";
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
  });
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
  if (isNaN(topupAmt) || topupAmt <= 0) {
    sendValidationError(res, "Invalid amount"); return;
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
    sendValidationError(res, (e as Error).message);
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

  const [depositUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (depositUser && isWalletFrozen(depositUser)) { sendForbidden(res, "wallet_frozen", "Your wallet has been temporarily frozen. Contact support."); return; }

  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
    sendValidationError(res, firstError); return;
  }

  const { amount: amt, paymentMethod, transactionId, idempotencyKey, accountNumber, note } = parsed.data;

  const cacheKey = `deposit:${userId}:${idempotencyKey}`;
  const existing = depositIdempotencyCache.get(cacheKey);
  if (existing) {
    if (existing.state === "in_flight") {
      sendError(res, "Duplicate request — this deposit is already being processed.", 409);
      return;
    }
    if (existing.state === "success") {
      res.status(existing.statusCode).json(existing.body);
      return;
    }
    /* state === "failed": key already removed below, allow retry with same key */
  }
  depositIdempotencyCache.set(cacheKey, { state: "in_flight", ts: Date.now() });

  /* ── Duplicate Transaction ID check ──
     Normalize TxID (trim + uppercase) both on check and on storage
     to prevent bypass via whitespace/casing variations. */
  const normalizedTxId = transactionId.trim().toUpperCase().replace(/\s+/g, "");
  if (!normalizedTxId) {
    depositIdempotencyCache.delete(cacheKey);
    sendValidationError(res, "transactionId cannot be empty"); return;
  }

  const txidSuffix = `:txid:${normalizedTxId}`;
  const existingDeposit = await db.select({ id: walletTransactionsTable.id })
    .from(walletTransactionsTable)
    .where(and(
      eq(walletTransactionsTable.type, "deposit"),
      sql`${walletTransactionsTable.reference} LIKE ${'%' + txidSuffix}`,
      sql`RIGHT(${walletTransactionsTable.reference}, ${txidSuffix.length}) = ${txidSuffix}`,
    ))
    .limit(1);

  if (existingDeposit.length > 0) {
    depositIdempotencyCache.delete(cacheKey);
    sendError(res, "This Transaction ID has already been used. Please check your transaction history or use a different TxID.", 409);
    return;
  }

  const s = await getPlatformSettings();
  const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
  const minTopup      = parseFloat(s["wallet_min_topup"]   ?? "100");
  const maxTopup      = parseFloat(s["wallet_max_topup"]   ?? "25000");
  const autoApproveThreshold = Math.max(0, parseFloat(s["wallet_deposit_auto_approve"] ?? "0"));

  if (!walletEnabled) { depositIdempotencyCache.delete(cacheKey); sendError(res, "Wallet service is currently disabled", 503); return; }
  if (amt < minTopup) { depositIdempotencyCache.delete(cacheKey); sendValidationError(res, `Minimum deposit is Rs. ${minTopup}`); return; }
  if (amt > maxTopup) { depositIdempotencyCache.delete(cacheKey); sendValidationError(res, `Maximum single deposit is Rs. ${maxTopup}`); return; }

  const txId = generateId();
  const desc = [
    `Manual deposit — ${paymentMethod}`,
    transactionId ? `TxID: ${transactionId}` : null,
    accountNumber ? `Sender: ${accountNumber}` : null,
    note ? `Note: ${note}` : null,
  ].filter(Boolean).join(" · ");

  const shouldAutoApprove = autoApproveThreshold > 0 && amt <= autoApproveThreshold;

  const setIdempotencyResult = (statusCode: number, body: unknown) => {
    depositIdempotencyCache.set(cacheKey, { state: "success", ts: Date.now(), statusCode, body });
  };
  const setIdempotencyFailed = () => {
    depositIdempotencyCache.delete(cacheKey);
  };

  if (shouldAutoApprove) {
    const maxBalance = parseFloat(s["wallet_max_balance"] ?? "50000");

    try {
      await db.transaction(async (tx) => {
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
          paymentMethod,
        });
      });
    } catch (e: unknown) {
      setIdempotencyFailed();
      sendValidationError(res, (e as Error).message); return;
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
      await db.insert(walletTransactionsTable).values({
        id: txId, userId, type: "deposit",
        amount: amt.toFixed(2),
        description: desc,
        reference: `pending:txid:${normalizedTxId}`,
        paymentMethod,
      });
    } catch (e: unknown) {
      setIdempotencyFailed();
      sendValidationError(res, (e as Error).message); return;
    }

    const pendingLang = await getUserLanguage(userId);
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: t("notifWalletPending", pendingLang) + " ✅",
      body: t("notifWalletPendingBody", pendingLang).replace("{amount}", amt.toFixed(0)),
      type: "wallet", icon: "wallet-outline",
    }).catch(e => logger.error("customer deposit notif insert failed:", e));

    const pendingBody = { txId, status: "pending", amount: amt };
    setIdempotencyResult(200, pendingBody);
    sendSuccess(res, pendingBody);
  }
});

/* ── GET /wallet/deposits — Customer deposit history ────────────────────── */
router.get("/deposits", customerAuth, async (req, res) => {
  const userId = req.customerId!;
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
});

/* ── POST /wallet/resolve-phone ─────────────────────────────────────────── */
router.post("/resolve-phone", customerAuth, async (req, res) => {
  const { phone } = req.body;
  if (!phone) { sendValidationError(res, "phone is required"); return; }
  try {
    const [user] = await db.select({ name: usersTable.name, phone: usersTable.phone })
      .from(usersTable).where(eq(usersTable.phone, phone.trim())).limit(1);
    if (!user) { sendSuccess(res, { found: false, name: null }); return; }
    sendSuccess(res, { found: true, name: user.name || null });
  } catch {
    sendSuccess(res, { found: false, name: null });
  }
});

/* ── POST /wallet/send ───────────────────────────────────────────────────── */
router.post("/send", customerAuth, async (req, res) => {
  const senderUserId = req.customerId!;

  const [sendUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, senderUserId)).limit(1);
  if (sendUser && isWalletFrozen(sendUser)) { sendForbidden(res, "wallet_frozen", "Your wallet has been temporarily frozen. Contact support."); return; }

  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
    sendValidationError(res, firstError); return;
  }

  const { receiverPhone, amount: sendAmt, note, idempotencyKey } = parsed.data;

  if (idempotencyKey) {
    const cacheKey = `send:${senderUserId}:${idempotencyKey}`;
    const existing = sendIdempotencyCache.get(cacheKey);
    if (existing) {
      if (existing.state === "in_flight") {
        sendError(res, "Duplicate request — this transfer is already being processed.", 409); return;
      }
      if (existing.state === "success") {
        res.status((existing as any).statusCode ?? 200).json((existing as any).body); return;
      }
    }
    sendIdempotencyCache.set(cacheKey, { state: "in_flight", ts: Date.now() });
  }

  const s = await getPlatformSettings();
  const walletEnabled  = (s["feature_wallet"]      ?? "on") === "on";
  const p2pEnabled     = (s["wallet_p2p_enabled"]   ?? "on") === "on";
  const minWithdrawal  = parseFloat(s["wallet_min_withdrawal"]   ?? "200");
  const maxWithdrawal  = parseFloat(s["wallet_max_withdrawal"]   ?? "10000");
  const dailyLimit     = parseFloat(s["wallet_daily_limit"]      ?? "20000");
  const p2pDailyLimit  = parseFloat(s["wallet_p2p_daily_limit"]  ?? "10000");
  const p2pFeePct      = Math.max(0, Math.min(50, parseFloat(s["wallet_p2p_fee_pct"] ?? "0")));

  if (!p2pEnabled) {
    sendForbidden(res, "P2P money transfers are currently disabled by admin."); return;
  }
  if (!walletEnabled) {
    sendError(res, "Wallet service is currently disabled", 503); return;
  }
  if (sendAmt < minWithdrawal) {
    sendValidationError(res, `Minimum transfer is Rs. ${minWithdrawal}`); return;
  }
  if (sendAmt > maxWithdrawal) {
    sendValidationError(res, `Maximum single transfer is Rs. ${maxWithdrawal}`); return;
  }

  const maxBalance = parseFloat(s["wallet_max_balance"] ?? "50000");

  const [receiverPre] = await db.select({ id: usersTable.id, name: usersTable.name, blockedServices: usersTable.blockedServices })
    .from(usersTable).where(eq(usersTable.phone, receiverPhone.trim())).limit(1);
  if (!receiverPre) { sendNotFound(res, "Receiver not found. Phone number check karein."); return; }
  if (receiverPre.id === senderUserId) { sendValidationError(res, "Apne aap ko transfer nahi kar sakte"); return; }
  if (isWalletFrozen(receiverPre)) { sendErrorWithData(res, "Receiver's wallet is currently frozen. Transfer cannot be completed.", { walletFrozen: true }, 403); return; }

  try {
    const result = await db.transaction(async (tx) => {
      const [sender] = await tx.select().from(usersTable).where(eq(usersTable.id, senderUserId)).limit(1).for("update");
      if (!sender) throw new Error("Sender not found");
      if (isWalletFrozen(sender)) throw Object.assign(new Error("Your wallet has been temporarily frozen. Contact support."), { walletFrozen: true });

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

      const [receiver] = await tx.select().from(usersTable).where(eq(usersTable.id, receiverPre.id)).limit(1).for("update");
      if (!receiver) throw new Error("Receiver not found");
      if (isWalletFrozen(receiver)) throw Object.assign(new Error("Receiver's wallet is currently frozen. Transfer cannot be completed."), { walletFrozen: true });

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

    if (idempotencyKey) {
      const cacheKey = `send:${senderUserId}:${idempotencyKey}`;
      const body = { success: true, data: responseData };
      sendIdempotencyCache.set(cacheKey, { state: "success", ts: Date.now(), statusCode: 200, body });
    }

    sendSuccess(res, responseData);
  } catch (e: unknown) {
    if (idempotencyKey) {
      sendIdempotencyCache.delete(`send:${senderUserId}:${idempotencyKey}`);
    }
    if ((e as any).walletFrozen) {
      sendForbidden(res, "wallet_frozen", (e as Error).message); return;
    }
    const msg = (e instanceof Error) ? e.message : "Unknown error";
    const isDbError = /deadlock|duplicate key|FATAL|ERROR:|ECONNRESET|ETIMEDOUT|connection|timeout/i.test(msg) && !/balance|limit|frozen|found|disabled|transfer|wallet/i.test(msg);
    if (isDbError) {
      logger.error("/wallet/send unexpected DB error:", e);
      sendError(res, "Transaction failed due to a temporary error. Please try again.", 500);
    } else {
      sendValidationError(res, msg);
    }
  }
});

/* ── POST /wallet/withdraw — Customer requests a withdrawal ─────────────── */
router.post("/withdraw", customerAuth, async (req, res) => {
  const userId = req.customerId!;

  const [withdrawUser] = await db.select({ blockedServices: usersTable.blockedServices, walletBalance: usersTable.walletBalance })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!withdrawUser) { sendNotFound(res, "User not found"); return; }
  if (isWalletFrozen(withdrawUser)) { sendForbidden(res, "wallet_frozen", "Your wallet has been temporarily frozen. Contact support."); return; }

  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
    sendValidationError(res, firstError); return;
  }

  const { amount: amt, paymentMethod, accountNumber, note } = parsed.data;

  const s = await getPlatformSettings();
  const walletEnabled  = (s["feature_wallet"]        ?? "on") === "on";
  const minWithdrawal  = parseFloat(s["wallet_min_withdrawal"] ?? "200");
  const maxWithdrawal  = parseFloat(s["wallet_max_withdrawal"] ?? "10000");

  if (!walletEnabled) { sendError(res, "Wallet service is currently disabled", 503); return; }
  if (amt < minWithdrawal) { sendValidationError(res, `Minimum withdrawal is Rs. ${minWithdrawal}`); return; }
  if (amt > maxWithdrawal) { sendValidationError(res, `Maximum single withdrawal is Rs. ${maxWithdrawal}`); return; }

  const balance = parseFloat(String(withdrawUser.walletBalance ?? "0"));
  if (balance < amt) {
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
      const [deducted] = await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance - ${amt.toFixed(2)}`, updatedAt: new Date() })
        .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, amt.toFixed(2))))
        .returning({ id: usersTable.id });
      if (!deducted) throw new Error(`Insufficient wallet balance. Available: Rs. ${balance.toFixed(0)}`);
      await tx.insert(walletTransactionsTable).values({
        id: txId, userId, type: "withdrawal",
        amount: amt.toFixed(2),
        description: desc,
        reference: "pending",
        paymentMethod,
      });
    });
  } catch (e: unknown) {
    const msg = (e instanceof Error) ? e.message : "Unknown error";
    const isDbError = /deadlock|duplicate key|FATAL|ERROR:|ECONNRESET|ETIMEDOUT|connection|timeout/i.test(msg) && !/balance|limit|frozen|found|disabled|withdrawal/i.test(msg);
    if (isDbError) {
      logger.error("/wallet/withdraw unexpected DB error:", e);
      sendError(res, "Withdrawal failed due to a temporary error. Please try again.", 500);
    } else {
      sendValidationError(res, msg);
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

  sendSuccess(res, { txId, status: "pending", amount: amt });
});

/* ── POST /wallet/simulate-topup — Customer self-service simulated top-up
   For demo/testing purposes. Allowed amounts: 500, 1000, 2000, 5000 PKR.
   Daily limit: Rs. 10,000. Labeled clearly as simulated.
──────────────────────────────────────────────────────────────────────── */
const SIMULATE_ALLOWED = [500, 1000, 2000, 5000];
const SIMULATE_DAILY_LIMIT = 10000;

router.post("/simulate-topup", customerAuth, async (req, res) => {
  if (process.env.DISABLE_SIMULATION === "true" || process.env.NODE_ENV === "production") {
    sendForbidden(res, "Not available in production"); return;
  }
  const userId = req.customerId!;
  const amount = parseInt(String(req.body["amount"] ?? ""), 10);

  if (!SIMULATE_ALLOWED.includes(amount)) {
    sendValidationError(res, `Invalid amount. Choose from: ${SIMULATE_ALLOWED.join(", ")}`); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { sendNotFound(res, "User not found"); return; }
  if (isWalletFrozen(user)) { sendForbidden(res, "wallet_frozen", "Your wallet has been temporarily frozen. Contact support."); return; }

  /* Check daily simulated topup total */
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayTxns = await db.select({ s: sum(walletTransactionsTable.amount) })
    .from(walletTransactionsTable)
    .where(and(
      eq(walletTransactionsTable.userId, userId),
      eq(walletTransactionsTable.type, "simulated_topup"),
      gte(walletTransactionsTable.createdAt, todayStart),
    ));
  const todayTotal = parseFloat(todayTxns[0]?.s ?? "0") || 0;
  if (todayTotal + amount > SIMULATE_DAILY_LIMIT) {
    sendError(res, `Daily simulation limit is Rs. ${SIMULATE_DAILY_LIMIT}. You have Rs. ${SIMULATE_DAILY_LIMIT - todayTotal} remaining today.`, 429); return;
  }

  const newBalance = await db.transaction(async (tx) => {
    const [updated] = await tx.update(usersTable)
      .set({ walletBalance: sql`wallet_balance + ${amount}`, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning({ walletBalance: usersTable.walletBalance });
    await tx.insert(walletTransactionsTable).values({
      id: generateId(), userId, type: "simulated_topup",
      amount: amount.toFixed(2),
      description: `Simulated top-up — Rs. ${amount} (Demo Mode)`,
      reference: `sim:${Date.now()}`,
      paymentMethod: "simulation",
    });
    return parseFloat(updated?.walletBalance ?? "0");
  });

  broadcastWalletUpdate(userId, newBalance);
  sendSuccess(res, { amount, newBalance });
});

/* ── GET /wallet/pending-topups — Customer pending topup count ────────── */
router.get("/pending-topups", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const pending = await db.select()
    .from(walletTransactionsTable)
    .where(and(
      eq(walletTransactionsTable.userId, userId),
      eq(walletTransactionsTable.type, "deposit"),
      sql`(${walletTransactionsTable.reference} = 'pending' OR ${walletTransactionsTable.reference} LIKE 'pending:%')`,
    ));
  sendSuccess(res, { count: pending.length, total: pending.reduce((s, t) => s + parseFloat(t.amount), 0) });
});

export default router;
