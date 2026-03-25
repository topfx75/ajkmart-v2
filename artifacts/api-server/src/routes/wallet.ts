import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id.js";

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

router.get("/", async (req, res) => {
  const userId = req.query["userId"] as string;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const transactions = await db
    .select().from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.userId, userId))
    .orderBy(walletTransactionsTable.createdAt);
  res.json({
    balance: parseFloat(user.walletBalance ?? "0"),
    transactions: transactions.map(mapTx),
  });
});

router.post("/topup", async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) { res.status(400).json({ error: "userId and amount required" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const newBalance = (parseFloat(user.walletBalance ?? "0") + parseFloat(amount)).toString();
  await db.update(usersTable).set({ walletBalance: newBalance }).where(eq(usersTable.id, userId));
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId, type: "credit",
    amount: amount.toString(), description: "Wallet top-up",
  });
  const transactions = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, userId));
  res.json({ balance: parseFloat(newBalance), transactions: transactions.map(mapTx) });
});

router.post("/send", async (req, res) => {
  const { senderUserId, receiverPhone, amount, note } = req.body;
  if (!senderUserId || !receiverPhone || !amount) {
    res.status(400).json({ error: "senderUserId, receiverPhone, and amount are required" }); return;
  }
  const sendAmt = parseFloat(amount);
  if (sendAmt < 50) { res.status(400).json({ error: "Minimum transfer is Rs. 50" }); return; }

  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, senderUserId)).limit(1);
  if (!sender) { res.status(404).json({ error: "Sender not found" }); return; }
  if (parseFloat(sender.walletBalance ?? "0") < sendAmt) {
    res.status(400).json({ error: "Insufficient wallet balance" }); return;
  }

  const [receiver] = await db.select().from(usersTable).where(eq(usersTable.phone, receiverPhone)).limit(1);
  if (!receiver) { res.status(404).json({ error: "Receiver not found. Check phone number." }); return; }
  if (receiver.id === senderUserId) { res.status(400).json({ error: "Cannot send money to yourself" }); return; }

  const senderNewBal = (parseFloat(sender.walletBalance ?? "0") - sendAmt).toString();
  const receiverNewBal = (parseFloat(receiver.walletBalance ?? "0") + sendAmt).toString();

  await db.update(usersTable).set({ walletBalance: senderNewBal }).where(eq(usersTable.id, senderUserId));
  await db.update(usersTable).set({ walletBalance: receiverNewBal }).where(eq(usersTable.id, receiver.id));

  const desc = note ? `Transfer to ${receiverPhone} — ${note}` : `Transfer to ${receiverPhone}`;
  const recvDesc = note ? `Received from ${sender.phone} — ${note}` : `Received from ${sender.phone}`;

  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: senderUserId, type: "debit",
    amount: sendAmt.toString(), description: desc,
  });
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: receiver.id, type: "credit",
    amount: sendAmt.toString(), description: recvDesc,
  });

  res.json({
    success: true,
    newBalance: parseFloat(senderNewBal),
    receiverName: receiver.name || receiverPhone,
    amount: sendAmt,
  });
});

export default router;
