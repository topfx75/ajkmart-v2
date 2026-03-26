import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";

const router: IRouter = Router();

function mapTx(t: typeof walletTransactionsTable.$inferSelect) {
  return {
    id: t.id,
    type: t.type,
    amount: parseFloat(t.amount),
    description: t.description,
    createdAt: t.createdAt.toISOString(),
  };
}

/* ── GET /wallet?userId=xxx ──────────────────────────────────────────────── */
router.get("/", async (req, res) => {
  const userId = req.query["userId"] as string;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }

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

/* ── POST /wallet/topup ──────────────────────────────────────────────────── */
router.post("/topup", async (req, res) => {
  const { userId, amount, method } = req.body;
  if (!userId || !amount) { res.status(400).json({ error: "userId and amount required" }); return; }

  const topupAmt = parseFloat(amount);
  if (isNaN(topupAmt) || topupAmt <= 0) {
    res.status(400).json({ error: "Invalid amount" }); return;
  }

  // Fetch platform settings for validation
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

  // Atomic transaction: read balance → check limit → credit (prevents race condition)
  try {
    const result = await db.transaction(async (tx) => {
      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) throw new Error("User not found");

      const currentBalance = parseFloat(user.walletBalance ?? "0");
      if (currentBalance + topupAmt > maxBalance) {
        throw new Error(`Wallet balance limit is Rs. ${maxBalance}. Current: Rs. ${currentBalance}`);
      }

      const newBalance = (currentBalance + topupAmt).toFixed(2);
      await tx.update(usersTable).set({ walletBalance: newBalance }).where(eq(usersTable.id, userId));
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId, type: "credit",
        amount: topupAmt.toFixed(2),
        description: method ? `Wallet top-up via ${method}` : "Wallet top-up",
      });
      return parseFloat(newBalance);
    });

    const transactions = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, userId));
    res.json({ balance: result, transactions: transactions.map(mapTx) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ── POST /wallet/send ───────────────────────────────────────────────────── */
router.post("/send", async (req, res) => {
  const { senderUserId, receiverPhone, amount, note } = req.body;
  if (!senderUserId || !receiverPhone || !amount) {
    res.status(400).json({ error: "senderUserId, receiverPhone, and amount are required" }); return;
  }

  const sendAmt = parseFloat(amount);
  if (isNaN(sendAmt) || sendAmt <= 0) {
    res.status(400).json({ error: "Invalid amount" }); return;
  }

  // Platform settings validation
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

  // Use DB transaction to prevent race condition / double-spend
  try {
    const result = await db.transaction(async (tx) => {
      const [sender] = await tx.select().from(usersTable).where(eq(usersTable.id, senderUserId)).limit(1);
      if (!sender) throw new Error("Sender not found");

      const senderBalance = parseFloat(sender.walletBalance ?? "0");
      if (senderBalance < sendAmt) throw new Error("Insufficient wallet balance");
      if (sendAmt > dailyLimit) throw new Error(`Daily wallet limit is Rs. ${dailyLimit}`);
      if (sendAmt > p2pDailyLimit) throw new Error(`Daily P2P transfer limit is Rs. ${p2pDailyLimit}`);

      const [receiver] = await tx.select().from(usersTable).where(eq(usersTable.phone, receiverPhone)).limit(1);
      if (!receiver) throw new Error("Receiver not found. Phone number check karein.");
      if (receiver.id === senderUserId) throw new Error("Apne aap ko transfer nahi kar sakte");

      const senderNewBal   = (senderBalance - sendAmt).toFixed(2);
      const receiverNewBal = (parseFloat(receiver.walletBalance ?? "0") + sendAmt).toFixed(2);

      await tx.update(usersTable).set({ walletBalance: senderNewBal }).where(eq(usersTable.id, senderUserId));
      await tx.update(usersTable).set({ walletBalance: receiverNewBal }).where(eq(usersTable.id, receiver.id));

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

      return { newBalance: parseFloat(senderNewBal), receiverName: receiver.name || receiverPhone, amount: sendAmt };
    });

    res.json({ success: true, ...result });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
