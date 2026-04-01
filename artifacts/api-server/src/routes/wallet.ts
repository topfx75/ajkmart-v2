import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable, notificationsTable } from "@workspace/db/schema";
import { eq, and, gte, sum, desc, sql } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings, adminAuth } from "./admin.js";
import { customerAuth } from "../middleware/security.js";
import { t } from "@workspace/i18n";
import { getUserLanguage } from "../lib/getUserLanguage.js";
import { getIO } from "../lib/socketio.js";

function broadcastWalletUpdate(userId: string, newBalance: number) {
  const io = getIO();
  if (!io) return;
  io.to(`user:${userId}`).emit("wallet:update", { balance: newBalance });
}

const router: IRouter = Router();

function deriveStatus(reference: string | null): "pending" | "approved" | "rejected" {
  const ref = reference ?? "";
  if (ref.startsWith("approved:") || ref.startsWith("approved")) return "approved";
  if (ref.startsWith("rejected:") || ref.startsWith("rejected")) return "rejected";
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

const WALLET_FROZEN_RESPONSE = { error: "wallet_frozen", message: "Your wallet has been temporarily frozen. Contact support." } as const;

/* ── GET /wallet ─────────────────────────────────────────────────────────── */
router.get("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (isWalletFrozen(user)) { res.status(403).json(WALLET_FROZEN_RESPONSE); return; }

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

    broadcastWalletUpdate(userId, result);
    const transactions = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, userId));
    res.json({ balance: result, transactions: transactions.map(mapTx) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ── POST /wallet/deposit — Submit a manual deposit request (customer) ───── */
router.post("/deposit", customerAuth, async (req, res) => {
  const userId = req.customerId!;

  const [depositUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (depositUser && isWalletFrozen(depositUser)) { res.status(403).json(WALLET_FROZEN_RESPONSE); return; }

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
    res.status(409).json({ error: "This Transaction ID has already been used. Please check your transaction history or use a different TxID." });
    return;
  }

  const s = await getPlatformSettings();
  const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
  const minTopup      = parseFloat(s["wallet_min_topup"]   ?? "100");
  const maxTopup      = parseFloat(s["wallet_max_topup"]   ?? "25000");
  const autoApproveThreshold = Math.max(0, parseFloat(s["wallet_deposit_auto_approve"] ?? "0"));

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

  const shouldAutoApprove = autoApproveThreshold > 0 && amt <= autoApproveThreshold;

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
    } catch (e: any) {
      res.status(400).json({ error: e.message }); return;
    }

    const depositLang = await getUserLanguage(userId);
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: t("notifWalletCredited", depositLang) + " ✅",
      body: t("notifWalletCreditedBody", depositLang).replace("{amount}", amt.toFixed(0)),
      type: "wallet", icon: "wallet-outline",
    }).catch(e => console.error("customer deposit notif insert failed:", e));

    const [freshUser] = await db.select({ walletBalance: usersTable.walletBalance }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (freshUser) broadcastWalletUpdate(userId, parseFloat(freshUser.walletBalance ?? "0"));

    res.json({ success: true, txId, status: "approved:auto", amount: amt });
  } else {
    await db.insert(walletTransactionsTable).values({
      id: txId, userId, type: "deposit",
      amount: amt.toFixed(2),
      description: desc,
      reference: `pending:txid:${normalizedTxId}`,
      paymentMethod,
    });

    const pendingLang = await getUserLanguage(userId);
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: t("notifWalletPending", pendingLang) + " ✅",
      body: t("notifWalletPendingBody", pendingLang).replace("{amount}", amt.toFixed(0)),
      type: "wallet", icon: "wallet-outline",
    }).catch(e => console.error("customer deposit notif insert failed:", e));

    res.json({ success: true, txId, status: "pending", amount: amt });
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

  res.json({ deposits: mapped });
});

/* ── POST /wallet/resolve-phone ─────────────────────────────────────────── */
router.post("/resolve-phone", customerAuth, async (req, res) => {
  const { phone } = req.body;
  if (!phone) { res.status(400).json({ error: "phone is required" }); return; }
  try {
    const [user] = await db.select({ name: usersTable.name, phone: usersTable.phone })
      .from(usersTable).where(eq(usersTable.phone, phone.trim())).limit(1);
    if (!user) { res.json({ found: false, name: null }); return; }
    res.json({ found: true, name: user.name || null });
  } catch {
    res.json({ found: false, name: null });
  }
});

/* ── POST /wallet/send ───────────────────────────────────────────────────── */
router.post("/send", customerAuth, async (req, res) => {
  const senderUserId = req.customerId!;

  const [sendUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, senderUserId)).limit(1);
  if (sendUser && isWalletFrozen(sendUser)) { res.status(403).json(WALLET_FROZEN_RESPONSE); return; }

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
  const p2pFeePct      = Math.max(0, Math.min(50, parseFloat(s["wallet_p2p_fee_pct"] ?? "0")));

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

  const [receiverPre] = await db.select({ id: usersTable.id, name: usersTable.name, blockedServices: usersTable.blockedServices })
    .from(usersTable).where(eq(usersTable.phone, receiverPhone.trim())).limit(1);
  if (!receiverPre) { res.status(404).json({ error: "Receiver not found. Phone number check karein." }); return; }
  if (receiverPre.id === senderUserId) { res.status(400).json({ error: "Apne aap ko transfer nahi kar sakte" }); return; }
  if (isWalletFrozen(receiverPre)) { res.status(403).json({ error: "Receiver's wallet is currently frozen. Transfer cannot be completed.", walletFrozen: true }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      const [sender] = await tx.select().from(usersTable).where(eq(usersTable.id, senderUserId)).limit(1);
      if (!sender) throw new Error("Sender not found");

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
      if (todayTotal + totalDebit > dailyLimit) {
        throw new Error(`Daily wallet limit is Rs. ${dailyLimit}. Aaj aap ne Rs. ${todayTotal.toFixed(0)} kharch kiye hain.`);
      }
      if (todayTotal + totalDebit > p2pDailyLimit) {
        throw new Error(`Daily P2P transfer limit is Rs. ${p2pDailyLimit}. Aaj Rs. ${todayTotal.toFixed(0)} transfer ho chuke hain.`);
      }

      const [receiver] = await tx.select().from(usersTable).where(eq(usersTable.id, receiverPre.id)).limit(1);
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
    }).catch(e => console.error("receiver send notif insert failed:", e));

    const { receiverId: _rid, senderName: _sn, ...responseData } = result;
    res.json({ success: true, ...responseData });
  } catch (e: any) {
    if ((e as any).walletFrozen) {
      res.status(403).json({ error: "wallet_frozen", message: e.message }); return;
    }
    res.status(400).json({ error: e.message });
  }
});

/* ── POST /wallet/p2p-topup — Customer requests P2P topup (pending admin approval) ── */
router.post("/p2p-topup", customerAuth, async (req, res) => {
  const userId = req.customerId!;

  const [p2pUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (p2pUser && isWalletFrozen(p2pUser)) { res.status(403).json(WALLET_FROZEN_RESPONSE); return; }

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

  const p2pLang = await getUserLanguage(userId);
  await db.insert(notificationsTable).values({
    id: generateId(), userId,
    title: t("notifWalletPending", p2pLang),
    body: t("notifWalletPendingBody", p2pLang).replace("{amount}", amt.toFixed(0)),
    type: "wallet", icon: "wallet-outline",
  }).catch(e => console.error("p2p topup notif insert failed:", e));

  res.json({ success: true, txId, status: "pending", amount: amt });
});

/* ── POST /wallet/withdraw — Customer requests a withdrawal ─────────────── */
router.post("/withdraw", customerAuth, async (req, res) => {
  const userId = req.customerId!;

  const [withdrawUser] = await db.select({ blockedServices: usersTable.blockedServices, walletBalance: usersTable.walletBalance })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!withdrawUser) { res.status(404).json({ error: "User not found" }); return; }
  if (isWalletFrozen(withdrawUser)) { res.status(403).json(WALLET_FROZEN_RESPONSE); return; }

  const { amount, paymentMethod, accountNumber, note } = req.body;

  const ALLOWED_WITHDRAWAL_METHODS = ["jazzcash", "easypaisa", "bank"] as const;
  if (!amount)        { res.status(400).json({ error: "amount required" }); return; }
  if (!paymentMethod) { res.status(400).json({ error: "paymentMethod required" }); return; }
  if (!(ALLOWED_WITHDRAWAL_METHODS as readonly string[]).includes(paymentMethod)) {
    res.status(400).json({ error: `Invalid paymentMethod. Must be one of: ${ALLOWED_WITHDRAWAL_METHODS.join(", ")}` }); return;
  }
  if (!accountNumber) { res.status(400).json({ error: "accountNumber required" }); return; }

  const amt = parseFloat(String(amount));
  if (isNaN(amt) || amt <= 0) { res.status(400).json({ error: "Invalid amount" }); return; }

  const s = await getPlatformSettings();
  const walletEnabled  = (s["feature_wallet"]        ?? "on") === "on";
  const minWithdrawal  = parseFloat(s["wallet_min_withdrawal"] ?? "200");
  const maxWithdrawal  = parseFloat(s["wallet_max_withdrawal"] ?? "10000");

  if (!walletEnabled) { res.status(503).json({ error: "Wallet service is currently disabled" }); return; }
  if (amt < minWithdrawal) { res.status(400).json({ error: `Minimum withdrawal is Rs. ${minWithdrawal}` }); return; }
  if (amt > maxWithdrawal) { res.status(400).json({ error: `Maximum single withdrawal is Rs. ${maxWithdrawal}` }); return; }

  const balance = parseFloat(String(withdrawUser.walletBalance ?? "0"));
  if (balance < amt) {
    res.status(400).json({ error: `Insufficient wallet balance. Available: Rs. ${balance.toFixed(0)}` }); return;
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
  } catch (e: any) {
    res.status(400).json({ error: e.message }); return;
  }

  const withdrawLang = await getUserLanguage(userId);
  await db.insert(notificationsTable).values({
    id: generateId(), userId,
    title: t("notifWithdrawalPending", withdrawLang),
    body: t("notifWithdrawalPendingBody", withdrawLang).replace("{amount}", amt.toFixed(0)),
    type: "wallet", icon: "wallet-outline",
  }).catch(e => console.error("withdrawal notif insert failed:", e));

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
