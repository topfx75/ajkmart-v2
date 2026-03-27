import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq, and, gte, sum } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { customerAuth } from "../middleware/security.js";

/* Only the admin panel may credit wallets — prevents self-top-up exploits */
const ADMIN_SECRET = process.env["ADMIN_SECRET"] || "ajkmart-admin-2025";

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
   Restricted to admin panel. Requires x-admin-secret header.
   Body: { userId, amount, method? }
   Customers cannot self-credit — all credits must go through payment verification.
─────────────────────────────────────────────────────────────────────────── */
router.post("/topup", async (req, res) => {
  const incomingSecret = req.headers["x-admin-secret"] as string | undefined;
  if (!incomingSecret || incomingSecret !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized. Admin secret required for wallet top-up." });
    return;
  }

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
