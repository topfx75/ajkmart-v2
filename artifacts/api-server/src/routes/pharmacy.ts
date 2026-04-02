import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable, pharmacyOrdersTable, productsTable, usersTable, walletTransactionsTable, liveLocationsTable } from "@workspace/db/schema";
import { eq, sql, and, gte, count, inArray } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";
import { customerAuth, riderAuth, addSecurityEvent, idorGuard } from "../middleware/security.js";
import { getUserLanguage } from "../lib/getUserLanguage.js";
import { t, type TranslationKey } from "@workspace/i18n";
import { calcDeliveryFee, calcGst, calcCodFee } from "../lib/fees.js";
import { prescriptionRefMap } from "./uploads.js";

const router: IRouter = Router();

async function resolveAndPersistRxPhoto(orderId: string, refId: string): Promise<string | null> {
  const resolvedUrl = prescriptionRefMap.get(refId);
  if (!resolvedUrl) return null;
  const currentNote = await db
    .select({ prescriptionNote: pharmacyOrdersTable.prescriptionNote })
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.id, orderId))
    .limit(1);
  if (currentNote[0]?.prescriptionNote?.includes(refId)) {
    const updatedNote = currentNote[0].prescriptionNote.replace(refId, resolvedUrl);
    await db.update(pharmacyOrdersTable)
      .set({ prescriptionNote: updatedNote, updatedAt: new Date() })
      .where(eq(pharmacyOrdersTable.id, orderId));
  }
  return resolvedUrl;
}

function mapOrder(o: typeof pharmacyOrdersTable.$inferSelect, resolvedPhotoOverride?: string | null) {
  let noteText = o.prescriptionNote ?? null;
  let prescriptionPhotoUrl: string | null = null;
  if (noteText) {
    const photoMatch = noteText.match(/\[photo:\s*([^\]]+)\]/);
    if (photoMatch) {
      const raw = photoMatch[1]!.trim();
      if (resolvedPhotoOverride) {
        prescriptionPhotoUrl = resolvedPhotoOverride;
      } else if (raw.startsWith("rx-")) {
        prescriptionPhotoUrl = prescriptionRefMap.get(raw) ?? null;
      } else {
        prescriptionPhotoUrl = raw;
      }
      noteText = noteText.replace(/\n?\[photo:\s*[^\]]+\]/, "").trim() || null;
    }
  }
  return {
    id: o.id,
    userId: o.userId,
    riderId: o.riderId,
    items: o.items as object[],
    prescriptionNote: noteText,
    prescriptionPhotoUrl,
    deliveryAddress: o.deliveryAddress,
    contactPhone: o.contactPhone,
    total: parseFloat(o.total),
    paymentMethod: o.paymentMethod,
    status: o.status,
    estimatedTime: o.estimatedTime,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

router.get("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const orders = await db
    .select()
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.userId, userId))
    .orderBy(sql`${pharmacyOrdersTable.createdAt} DESC`);
  res.json({ orders: orders.map(mapOrder), total: orders.length });
});

router.get("/:id", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const [order] = await db
    .select()
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.id, String(req.params["id"])))
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "Pharmacy order not found" });
    return;
  }
  if (idorGuard(res, order.userId, userId)) return;

  let resolvedPhoto: string | null = null;
  if (order.prescriptionNote) {
    const refMatch = order.prescriptionNote.match(/\[photo:\s*(rx-[^\]]+)\]/);
    if (refMatch) {
      resolvedPhoto = await resolveAndPersistRxPhoto(order.id, refMatch[1]!.trim());
    }
  }

  res.json(mapOrder(order, resolvedPhoto));
});

/* ── GET /pharmacy-orders/:id/track — Live rider location for active pharmacy orders ── */
router.get("/:id/track", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const [order] = await db
    .select({ id: pharmacyOrdersTable.id, userId: pharmacyOrdersTable.userId, riderId: pharmacyOrdersTable.riderId, status: pharmacyOrdersTable.status })
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.id, String(req.params["id"])))
    .limit(1);

  if (!order) { res.status(404).json({ error: "Pharmacy order not found" }); return; }
  if (idorGuard(res, order.userId, userId)) return;

  const TRACKABLE = ["picked_up", "out_for_delivery", "in_transit"];
  let riderLat: number | null = null;
  let riderLng: number | null = null;
  let riderLocAge: number | null = null;
  let riderName: string | null = null;
  let riderPhone: string | null = null;

  if (order.riderId && TRACKABLE.includes(order.status)) {
    const [loc, riderUser] = await Promise.all([
      db.select().from(liveLocationsTable).where(eq(liveLocationsTable.userId, order.riderId)).limit(1),
      db.select({ name: usersTable.name, phone: usersTable.phone }).from(usersTable).where(eq(usersTable.id, order.riderId)).limit(1),
    ]);
    if (loc[0]) {
      riderLat     = parseFloat(String(loc[0].latitude));
      riderLng     = parseFloat(String(loc[0].longitude));
      riderLocAge  = Math.floor((Date.now() - new Date(loc[0].updatedAt).getTime()) / 1000);
    }
    riderName  = riderUser[0]?.name  ?? null;
    riderPhone = riderUser[0]?.phone ?? null;
  }

  res.json({
    id: order.id,
    status: order.status,
    riderId: order.riderId,
    riderName,
    riderPhone,
    riderLat,
    riderLng,
    riderLocAge,
    trackable: TRACKABLE.includes(order.status),
  });
});

router.post("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const { items, prescriptionNote, prescriptionPhotoUri, deliveryAddress, contactPhone, paymentMethod } = req.body;

  // If prescriptionPhotoUri is a refId (async upload in-flight), resolve to real URL
  // If no URL found yet, store the refId as placeholder — mapOrder will handle rendering
  let resolvedPhotoUrl: string | null = null;
  if (prescriptionPhotoUri?.trim()) {
    const rawUri = prescriptionPhotoUri.trim();
    if (rawUri.startsWith("rx-")) {
      let resolved = prescriptionRefMap.get(rawUri);
      if (!resolved) {
        await new Promise((r) => setTimeout(r, 1500));
        resolved = prescriptionRefMap.get(rawUri);
      }
      resolvedPhotoUrl = resolved ?? rawUri;
    } else {
      resolvedPhotoUrl = rawUri;
    }
  }

  // Merge text note + photo URL into a single prescriptionNote for storage
  // Format: "text note\n[photo: /api/uploads/filename.jpg]"
  const mergedPrescriptionNote = [
    prescriptionNote?.trim() || null,
    resolvedPhotoUrl ? `[photo: ${resolvedPhotoUrl}]` : null,
  ].filter(Boolean).join("\n") || null;
  if (!items || !deliveryAddress || !contactPhone || !paymentMethod) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const s = await getPlatformSettings();

  // Maintenance mode gate
  if ((s["app_status"] ?? "active") === "maintenance") {
    const mainKey = (s["security_maintenance_key"] ?? "").trim();
    const bypass  = ((req.headers["x-maintenance-key"] as string) ?? "").trim();
    if (!mainKey || bypass !== mainKey) {
      res.status(503).json({ error: s["content_maintenance_msg"] ?? "We're performing scheduled maintenance. Back soon!" }); return;
    }
  }

  // Feature flag check
  const pharmacyEnabled = (s["feature_pharmacy"] ?? "on") === "on";
  if (!pharmacyEnabled) {
    res.status(503).json({ error: "Pharmacy service is currently disabled" }); return;
  }

  /* ── Fraud detection (mirrors orders.ts pattern) ── */
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  {
    const [userRecord] = await db.select({ isBanned: usersTable.isBanned, isActive: usersTable.isActive }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (userRecord?.isBanned) {
      res.status(403).json({ error: "Your account has been suspended." }); return;
    }
    if (userRecord && !userRecord.isActive) {
      res.status(403).json({ error: "Your account is inactive. Please contact support." }); return;
    }

    if ((s["security_fake_order_detect"] ?? "off") === "on") {
      const maxDailyOrders = parseInt(s["security_max_daily_orders"] ?? "20", 10);
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const [dailyResult] = await db.select({ c: count() }).from(pharmacyOrdersTable).where(and(eq(pharmacyOrdersTable.userId, userId), gte(pharmacyOrdersTable.createdAt, todayStart)));
      const dailyCount = Number(dailyResult?.c ?? 0);
      if (dailyCount >= maxDailyOrders) {
        addSecurityEvent({ type: "daily_order_limit", ip, userId, details: `User ${userId} hit daily pharmacy limit: ${dailyCount}/${maxDailyOrders}`, severity: "medium" });
        res.status(429).json({ error: `Daily pharmacy order limit (${maxDailyOrders}) reached. Please try again tomorrow.` }); return;
      }

      if (deliveryAddress) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const sameAddrLimit = parseInt(s["security_same_addr_limit"] ?? "5", 10);
        const sameAddrOrders = await db.select({ c: count() }).from(pharmacyOrdersTable).where(and(eq(pharmacyOrdersTable.deliveryAddress, deliveryAddress), gte(pharmacyOrdersTable.createdAt, oneHourAgo)));
        const sameAddrCount = Number(sameAddrOrders[0]?.c ?? 0);
        if (sameAddrCount >= sameAddrLimit) {
          addSecurityEvent({ type: "same_address_limit", ip, userId, details: `Pharmacy same-address limit: ${deliveryAddress} (${sameAddrCount}/hr)`, severity: "high" });
          res.status(429).json({ error: "Too many pharmacy orders to this address. Please try again later." }); return;
        }
      }
    }
  }

  /* Per-item validation — prevents negative-price injection */
  const badItem = (items as any[]).find(
    (it) => !Number.isFinite(Number(it.price)) || Number(it.price) <= 0 ||
            !Number.isFinite(Number(it.quantity)) || Number(it.quantity) <= 0,
  );
  if (badItem) {
    res.status(400).json({ error: "Each item must have a valid positive price and quantity" }); return;
  }

  /* ── Prescription (Rx) enforcement ──
     Server-authoritative check: look up product IDs in the DB to determine Rx requirement.
     If a product is not found in DB, fall back to platform setting:
     - If pharmacy_always_require_rx = "on": require Rx for ALL pharmacy orders
     - Otherwise: treat unknown items as not requiring Rx (safe default for items without IDs) ── */
  const alwaysRx = (s["pharmacy_always_require_rx"] ?? "off") === "on";
  let hasRxItem = alwaysRx;

  if (!hasRxItem) {
    const itemIds = (items as any[]).map((it: any) => it.id).filter(Boolean);
    if (itemIds.length > 0) {
      try {
        const dbProducts = await db
          .select({ id: productsTable.id, name: productsTable.name, category: productsTable.category })
          .from(productsTable)
          .where(inArray(productsTable.id, itemIds));
        const RX_KEYWORDS = /\b(antibiotic|amoxicillin|azithromycin|ciprofloxacin|metformin|insulin|steroid|cortisone|opioid|codeine|tramadol|diazepam|alprazolam|morphine|fentanyl|prescription|rx only)\b/i;
        hasRxItem = dbProducts.some(p => RX_KEYWORDS.test(p.name ?? "") || p.category === "prescription");
        if (!hasRxItem) {
          const unlistedRx = (items as any[]).some((it: any) => it.requires_prescription || it.requiresPrescription);
          hasRxItem = unlistedRx;
        }
      } catch { /* non-fatal: fall back to client flag on DB error */ }
    }
    if (!hasRxItem) {
      hasRxItem = (items as any[]).some((it: any) => it.requires_prescription || it.requiresPrescription);
    }
  }

  if (hasRxItem && !mergedPrescriptionNote) {
    res.status(400).json({
      error: "One or more items in your order require a doctor's prescription. Please add a prescription note or upload a photo.",
      requiresPrescription: true,
    });
    return;
  }

  const itemsTotal = (items as { price: number; quantity: number }[]).reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  if (itemsTotal <= 0) {
    res.status(400).json({ error: "Order total must be greater than 0" }); return;
  }

  /* ── Min order check ── */
  const minOrder = parseFloat(s["min_order_amount"] ?? "100");
  if (itemsTotal < minOrder) {
    res.status(400).json({ error: `Minimum order amount is Rs. ${minOrder}` }); return;
  }

  /* ── Delivery fee, GST, COD fee — via shared utility (see lib/fees.ts) ── */
  const deliveryFee = calcDeliveryFee(s, "pharmacy", itemsTotal);
  const gstAmount   = calcGst(s, itemsTotal);
  const codFee      = calcCodFee(s, paymentMethod, itemsTotal + deliveryFee + gstAmount);

  const total = itemsTotal + deliveryFee + gstAmount + codFee;

  /* ── Estimated time from admin Order settings ── */
  const preptimeMin   = parseInt(s["order_preptime_min"] ?? "15", 10);
  const estimatedTime = `${preptimeMin}–${preptimeMin + 25} min`;

  /* ── COD validation (mirrors orders.ts pattern) ── */
  if (paymentMethod === "cash") {
    const codEnabled = (s["cod_enabled"] ?? "on") === "on";
    if (!codEnabled) {
      res.status(400).json({ error: "Cash on Delivery is currently not available" }); return;
    }
    const codAllowedForPharmacy = (s["cod_allowed_pharmacy"] ?? "on") !== "off";
    if (!codAllowedForPharmacy) {
      res.status(400).json({ error: "Cash on Delivery is not available for Pharmacy orders. Please choose another payment method." }); return;
    }
    const codMax = parseFloat(s["cod_max_amount"] ?? "5000");
    if (total > codMax) {
      res.status(400).json({ error: `Maximum Cash on Delivery order is Rs. ${codMax}. Please pay online for larger orders.` }); return;
    }
    /* ── COD verification threshold — flag high-value cash orders ── */
    const verifyThreshold = parseFloat(s["cod_verification_threshold"] ?? "0");
    if (verifyThreshold > 0 && total > verifyThreshold) {
      /* Order is allowed but flagged for rider photo verification */
    }
  }

  // Wallet payment → atomic DB transaction (prevents race condition / double-spend)
  if (paymentMethod === "wallet") {
    const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
    if (!walletEnabled) {
      res.status(400).json({ error: "Wallet payments are currently disabled" }); return;
    }

    const [wUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (wUser && (wUser.blockedServices || "").split(",").map(sv => sv.trim()).includes("wallet")) {
      res.status(403).json({ error: "wallet_frozen", message: "Your wallet has been temporarily frozen. Contact support." }); return;
    }

    try {
      const order = await db.transaction(async (tx) => {
        const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (!user) throw new Error("User not found");

        const balance = parseFloat(user.walletBalance ?? "0");
        if (balance < total) throw new Error(`Insufficient wallet balance. Balance: Rs. ${balance.toFixed(0)}, Required: Rs. ${total.toFixed(0)}`);

        /* DB floor guard — deducts only if balance ≥ amount at UPDATE time */
        const [deducted] = await tx.update(usersTable)
          .set({ walletBalance: sql`wallet_balance - ${total.toFixed(2)}` })
          .where(and(eq(usersTable.id, userId), gte(usersTable.walletBalance, total.toFixed(2))))
          .returning({ id: usersTable.id });
        if (!deducted) throw new Error(`Insufficient wallet balance. Required: Rs. ${total.toFixed(0)}`);
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit",
          amount: total.toFixed(2),
          description: "Pharmacy order payment (items + delivery + GST)",
        });

        const [newOrder] = await tx.insert(pharmacyOrdersTable).values({
          id: generateId(), userId, items,
          prescriptionNote: mergedPrescriptionNote,
          deliveryAddress, contactPhone,
          total: total.toFixed(2), paymentMethod,
          status: "pending", estimatedTime,
        }).returning();
        return newOrder!;
      });

      const phLang1 = await getUserLanguage(userId);
      await db.insert(notificationsTable).values({
        id: generateId(), userId,
        title: t("notifPharmacyOrderPlaced" as TranslationKey, phLang1),
        body: t("notifPharmacyOrderPlacedBody" as TranslationKey, phLang1).replace("{amount}", `${total.toFixed(0)} (items + Rs. ${deliveryFee} delivery)`).replace("{eta}", estimatedTime),
        type: "pharmacy", icon: "medical-outline", link: `/(tabs)/orders`,
      }).catch(() => {});

      res.status(201).json({ ...mapOrder(order), deliveryFee, gstAmount });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
    return;
  }

  // Cash / other payments
  const [order] = await db.insert(pharmacyOrdersTable).values({
    id: generateId(), userId, items,
    prescriptionNote: mergedPrescriptionNote,
    deliveryAddress, contactPhone,
    total: total.toFixed(2), paymentMethod,
    status: "pending", estimatedTime,
  }).returning();

  const phLang2 = await getUserLanguage(userId);
  await db.insert(notificationsTable).values({
    id: generateId(), userId,
    title: t("notifPharmacyOrderPlaced" as TranslationKey, phLang2),
    body: t("notifPharmacyOrderPlacedBody" as TranslationKey, phLang2).replace("{amount}", `${total.toFixed(0)} (items + Rs. ${deliveryFee} delivery)`).replace("{eta}", estimatedTime),
    type: "pharmacy", icon: "medical-outline", link: `/(tabs)/orders`,
  }).catch(() => {});

  res.status(201).json({ ...mapOrder(order!), deliveryFee, gstAmount });
});

router.patch("/:id/cancel", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const orderId = String(req.params["id"]);

  const [order] = await db
    .select()
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.id, orderId))
    .limit(1);

  if (!order) { res.status(404).json({ error: "Pharmacy order not found" }); return; }
  if (idorGuard(res, order.userId, userId)) return;
  if (order.status !== "pending") {
    res.status(409).json({ error: "Only pending pharmacy orders can be cancelled" });
    return;
  }

  const s = await getPlatformSettings();
  const cancelWindowMin = parseFloat(String(s["order_cancel_window_min"] ?? "5"));
  const minutesSincePlaced = (Date.now() - order.createdAt.getTime()) / 60000;
  if (minutesSincePlaced > cancelWindowMin) {
    res.status(409).json({ error: `Cancellation window of ${cancelWindowMin} minutes has passed` });
    return;
  }

  let refundAmount = 0;
  let cancelledOrder: typeof pharmacyOrdersTable.$inferSelect | undefined;

  if (order.paymentMethod === "wallet") {
    const refund = parseFloat(order.total);
    cancelledOrder = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(pharmacyOrdersTable)
        .where(eq(pharmacyOrdersTable.id, orderId))
        .for("update")
        .limit(1);
      if (!locked || locked.status !== "pending") {
        throw Object.assign(new Error("Order already processed or cancelled"), { httpStatus: 409 });
      }
      const [updated] = await tx.update(pharmacyOrdersTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(pharmacyOrdersTable.id, orderId), eq(pharmacyOrdersTable.status, "pending")))
        .returning();
      if (!updated) throw Object.assign(new Error("Concurrent cancel — order state changed"), { httpStatus: 409 });
      await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${refund.toFixed(2)}`, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId, type: "credit",
        amount: refund.toFixed(2),
        description: `Pharmacy order refund — #${orderId.slice(-6).toUpperCase()} cancelled`,
        reference: `refund:${orderId}`,
      });
      return updated;
    }).catch((err: any) => {
      if (err?.httpStatus) { res.status(err.httpStatus).json({ error: err.message }); }
      else { res.status(500).json({ error: "Cancel failed" }); }
      return undefined;
    });
    if (!cancelledOrder) return;
    const phRefLang = await getUserLanguage(userId);
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: t("notifPharmacyRefund" as TranslationKey, phRefLang),
      body: t("notifPharmacyRefundBody" as TranslationKey, phRefLang).replace("{amount}", refund.toFixed(0)),
      type: "pharmacy", icon: "wallet-outline",
    }).catch(() => {});
    refundAmount = refund;
    res.json({ ...mapOrder(cancelledOrder), refundAmount });
    return;
  }

  const [cancelled] = await db
    .update(pharmacyOrdersTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(pharmacyOrdersTable.id, orderId), eq(pharmacyOrdersTable.status, "pending")))
    .returning();

  if (!cancelled) { res.status(409).json({ error: "Order already processed or cancelled" }); return; }
  res.json({ ...mapOrder(cancelled), refundAmount });
});

router.patch("/:id/status", riderAuth, async (req, res) => {
  const { status } = req.body;

  /* Whitelist: prevent arbitrary string injection into the status column */
  const ALLOWED_STATUSES = ["accepted", "picked_up", "in_transit", "delivered", "cancelled"] as const;
  if (!ALLOWED_STATUSES.includes(status)) {
    res.status(400).json({ error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}` });
    return;
  }

  const [existing] = await db
    .select()
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.id, String(req.params["id"])))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Pharmacy order not found" });
    return;
  }
  if (existing.riderId && existing.riderId !== req.riderId) {
    res.status(403).json({ error: "This order is assigned to another rider" });
    return;
  }

  const riderId = req.riderId!;
  const isUnassigned = !existing.riderId;

  if (isUnassigned) {
    const [order] = await db
      .update(pharmacyOrdersTable)
      .set({ status, riderId, updatedAt: new Date() })
      .where(and(eq(pharmacyOrdersTable.id, String(req.params["id"])), sql`rider_id IS NULL`))
      .returning();
    if (!order) {
      res.status(409).json({ error: "This order has already been accepted by another rider" });
      return;
    }
    res.json(mapOrder(order));
    return;
  }

  const [order] = await db
    .update(pharmacyOrdersTable)
    .set({ status, riderId, updatedAt: new Date() })
    .where(eq(pharmacyOrdersTable.id, String(req.params["id"])))
    .returning();
  if (!order) {
    res.status(404).json({ error: "Pharmacy order not found" });
    return;
  }
  res.json(mapOrder(order));
});

export default router;
