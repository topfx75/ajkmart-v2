import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, notificationsTable } from "@workspace/db/schema";
import { eq, and, gte, sum, desc, sql } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings, adminAuth } from "./admin.js";
import { customerAuth } from "../middleware/security.js";

const router: IRouter = Router();

function mapTx(t: typeof walletTransactionsTable.$inferSelect) {
  return {
    id: t.id,
    type: t.type,
    amount: parseFloat(t.amount),
    description: t.description,
    reference: t.reference,
    createdAt: t.createdAt.toISOString(),
  };
}

/* ── GET /wallet ─────────────────────────────────────────────────────────── */
router.get("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const transactions = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.userId, userId))
    .orderBy(walletTransactionsTable.createdAt);

  res.json({
    balance: parseFloat(user.walletBalance ?? "0"),
    transactions: transactions.map(mapTx),
  });
});

/* ── POST /wallet/topup — ADMIN ONLY ────────────────────────────────────────
   Restricted to admin panel. Requires admin JWT or x-admin-secret header.
   Body: { userId, amount, method? }
   Customers cannot self-credit — all credits must go through payment verification.
─────────────────────────────────────────────────────────────────────────── */
router.post("/topup", adminAuth, async (req, res) => {

  const { userId, amount, method } = req.body;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  if (!amount) { res.status(400).json({ error: "amount required" }); return; }

  const topupAmt = parseFloat(amount);
  if (isNaN(topupAmt) || topupAmt <= 0) {
    res.status(400).json({ error: "Invalid amount" }); return;
  }

  const s = await getPlatformSettings();
  const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
  const minTopup      = parseFloat(s["wallet_min_topup"]   ?? "100");
  const maxTopup      = parseFloat(s["wallet_max_topup"]   ?? "25000");
  const maxBalance    = parseFloat(s["wallet_max_balance"] ?? "50000");

  if (!walletEnabled) {
    res.status(503).json({ error: "Wallet service is currently disabled" }); return;
  }
  if (topupAmt < minTopup) {
    res.status(400).json({ error: `Minimum top-up is Rs. ${minTopup}` }); return;
  }
  if (topupAmt > maxTopup) {
    res.status(400).json({ error: `Maximum single top-up is Rs. ${maxTopup}` }); return;
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

    const transactions = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, userId));
    res.json({ balance: result, transactions: transactions.map(mapTx) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ── POST /wallet/deposit — Submit a manual deposit request (customer) ───── */
router.post("/deposit", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const { amount, paymentMethod, transactionId, accountNumber, note } = req.body;

  if (!amount)          { res.status(400).json({ error: "amount required" }); return; }
  if (!paymentMethod)   { res.status(400).json({ error: "paymentMethod required" }); return; }
  if (!transactionId)   { res.status(400).json({ error: "transactionId required" }); return; }

  const amt = parseFloat(String(amount));
  if (isNaN(amt) || amt <= 0) { res.status(400).json({ error: "Invalid amount" }); return; }

  /* ── Duplicate Transaction ID check ──
     Normalize TxID (trim + uppercase) both on check and on storage
     to prevent bypass via whitespace/casing variations. */
  const normalizedTxId = transactionId.trim().toUpperCase().replace(/\s+/g, "");
  if (!normalizedTxId) { res.status(400).json({ error: "transactionId cannot be empty" }); return; }

  const txidTag = `txid:${normalizedTxId}`;
  const existingDeposit = await db.select({ id: walletTransactionsTable.id })
    .from(walletTransactionsTable)
    .where(and(
      eq(walletTransactionsTable.type, "deposit"),
      sql`${walletTransactionsTable.reference} LIKE ${'%' + txidTag}`,
    ))
    .limit(1);

  if (existingDeposit.length > 0) {
    res.status(409).json({ error: "This Transaction ID has already been used. Please check your transaction history or use a different TxID." });
    return;
  }

  const s = await getPlatformSettings();
  const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
  const minTopup      = parseFloat(s["wallet_min_topup"]   ?? "100");
  const maxTopup      = parseFloat(s["wallet_max_topup"]   ?? "25000");

  if (!walletEnabled) { res.status(503).json({ error: "Wallet service is currently disabled" }); return; }
  if (amt < minTopup) { res.status(400).json({ error: `Minimum deposit is Rs. ${minTopup}` }); return; }
  if (amt > maxTopup) { res.status(400).json({ error: `Maximum single deposit is Rs. ${maxTopup}` }); return; }

  const txId = generateId();
  const desc = [
    `Manual deposit — ${paymentMethod}`,
    transactionId ? `TxID: ${transactionId}` : null,
    accountNumber ? `Sender: ${accountNumber}` : null,
    note ? `Note: ${note}` : null,
  ].filter(Boolean).join(" · ");

  await db.insert(walletTransactionsTable).values({
    id: txId, userId, type: "deposit",
    amount: amt.toFixed(2),
    description: desc,
    reference: `pending:txid:${normalizedTxId}`,
    paymentMethod,
  });

  await db.insert(notificationsTable).values({
    id: generateId(), userId,
    title: "Deposit Request Submitted ✅",
    body: `Rs. ${amt.toFixed(0)} deposit request mein hai. Admin 1-2 hours mein verify karke wallet credit karega.`,
    type: "wallet", icon: "wallet-outline",
  }).catch(e => console.error("customer deposit notif insert failed:", e));

  res.json({ success: true, txId, status: "pending", amount: amt });
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

  res.json({ deposits: mapped });
});

/* ── POST /wallet/send ───────────────────────────────────────────────────── */
router.post("/send", customerAuth, async (req, res) => {
  const senderUserId = req.customerId!;
  const { receiverPhone, amount, note } = req.body;
  if (!receiverPhone || !amount) {
    res.status(400).json({ error: "receiverPhone and amount are required" }); return;
  }

  const sendAmt = parseFloat(amount);
  if (isNaN(sendAmt) || sendAmt <= 0) {
    res.status(400).json({ error: "Invalid amount" }); return;
  }

  const s = await getPlatformSettings();
  const walletEnabled  = (s["feature_wallet"]      ?? "on") === "on";
  const p2pEnabled     = (s["wallet_p2p_enabled"]   ?? "on") === "on";
  const minWithdrawal  = parseFloat(s["wallet_min_withdrawal"]   ?? "200");
  const maxWithdrawal  = parseFloat(s["wallet_max_withdrawal"]   ?? "10000");
  const dailyLimit     = parseFloat(s["wallet_daily_limit"]      ?? "20000");
  const p2pDailyLimit  = parseFloat(s["wallet_p2p_daily_limit"]  ?? "10000");

  if (!p2pEnabled) {
    res.status(403).json({ error: "P2P money transfers are currently disabled by admin." }); return;
  }
  if (!walletEnabled) {
    res.status(503).json({ error: "Wallet service is currently disabled" }); return;
  }
  if (sendAmt < minWithdrawal) {
    res.status(400).json({ error: `Minimum transfer is Rs. ${minWithdrawal}` }); return;
  }
  if (sendAmt > maxWithdrawal) {
    res.status(400).json({ error: `Maximum single transfer is Rs. ${maxWithdrawal}` }); return;
  }

  const maxBalance = parseFloat(s["wallet_max_balance"] ?? "50000");

  try {
    const result = await db.transaction(async (tx) => {
      const [sender] = await tx.select().from(usersTable).where(eq(usersTable.id, senderUserId)).limit(1);
      if (!sender) throw new Error("Sender not found");

      const senderBalance = parseFloat(sender.walletBalance ?? "0");
      if (senderBalance < sendAmt) throw new Error("Insufficient wallet balance");

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
      if (todayTotal + sendAmt > dailyLimit) {
        throw new Error(`Daily wallet limit is Rs. ${dailyLimit}. Aaj aap ne Rs. ${todayTotal.toFixed(0)} kharch kiye hain.`);
      }
      if (todayTotal + sendAmt > p2pDailyLimit) {
        throw new Error(`Daily P2P transfer limit is Rs. ${p2pDailyLimit}. Aaj Rs. ${todayTotal.toFixed(0)} transfer ho chuke hain.`);
      }

      const [receiver] = await tx.select().from(usersTable).where(eq(usersTable.phone, receiverPhone)).limit(1);
      if (!receiver) throw new Error("Receiver not found. Phone number check karein.");
      if (receiver.id === senderUserId) throw new Error("Apne aap ko transfer nahi kar sakte");

      const [deducted] = await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance - ${sendAmt.toFixed(2)}` })
        .where(and(eq(usersTable.id, senderUserId), gte(usersTable.walletBalance, sendAmt.toFixed(2))))
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

      return { newBalance: parseFloat(deducted.walletBalance ?? "0"), receiverName: receiver.name || receiverPhone, amount: sendAmt };
    });

    res.json({ success: true, ...result });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ── POST /wallet/p2p-topup — Customer requests P2P topup (pending admin approval) ── */
router.post("/p2p-topup", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const { senderPhone, amount, note } = req.body;

  if (!senderPhone) { res.status(400).json({ error: "senderPhone required" }); return; }
  if (!amount) { res.status(400).json({ error: "amount required" }); return; }

  const amt = parseFloat(String(amount));
  if (isNaN(amt) || amt <= 0) { res.status(400).json({ error: "Invalid amount" }); return; }

  const s = await getPlatformSettings();
  const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
  const minTopup = parseFloat(s["wallet_min_topup"] ?? "100");
  const maxTopup = parseFloat(s["wallet_max_topup"] ?? "25000");

  if (!walletEnabled) { res.status(503).json({ error: "Wallet service is currently disabled" }); return; }
  if (amt < minTopup) { res.status(400).json({ error: `Minimum topup is Rs. ${minTopup}` }); return; }
  if (amt > maxTopup) { res.status(400).json({ error: `Maximum single topup is Rs. ${maxTopup}` }); return; }

  const txId = generateId();
  const desc = [
    `P2P Topup from ${senderPhone}`,
    note ? `Note: ${note}` : null,
  ].filter(Boolean).join(" — ");

  await db.insert(walletTransactionsTable).values({
    id: txId, userId, type: "deposit",
    amount: amt.toFixed(2),
    description: desc,
    reference: "pending",
    paymentMethod: "p2p",
  });

  await db.insert(notificationsTable).values({
    id: generateId(), userId,
    title: "P2P Topup Request Submitted",
    body: `Rs. ${amt.toFixed(0)} P2P topup request pending hai. Admin approval ke baad wallet credit hoga.`,
    type: "wallet", icon: "wallet-outline",
  }).catch(e => console.error("p2p topup notif insert failed:", e));

  res.json({ success: true, txId, status: "pending", amount: amt });
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
  res.json({ count: pending.length, total: pending.reduce((s, t) => s + parseFloat(t.amount), 0) });
});

export default router;
