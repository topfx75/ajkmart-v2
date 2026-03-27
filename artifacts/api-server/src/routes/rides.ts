import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { liveLocationsTable, notificationsTable, rideBidsTable, rideServiceTypesTable, ridesTable, usersTable, walletTransactionsTable, popularLocationsTable, rideEventLogsTable } from "@workspace/db/schema";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { ensureDefaultRideServices, ensureDefaultLocations, getPlatformSettings } from "./admin.js";
import { customerAuth, riderAuth, verifyUserJwt } from "../middleware/security.js";

const router: IRouter = Router();

/* ── Haversine distance (km) ── */
function calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function calcFare(distance: number, type: string): Promise<{ baseFare: number; gstAmount: number; total: number }> {
  const s = await getPlatformSettings();

  /* ── Platform settings take priority: ride_{type}_base_fare / _per_km / _min_fare ── */
  let baseRate: number, perKm: number, minFare: number;
  const psBase = s[`ride_${type}_base_fare`];
  const psKm   = s[`ride_${type}_per_km`];
  const psMin  = s[`ride_${type}_min_fare`];

  if (psBase !== undefined && psKm !== undefined && psMin !== undefined) {
    baseRate = parseFloat(psBase);
    perKm    = parseFloat(psKm);
    minFare  = parseFloat(psMin);
  } else {
    /* Fallback: DB-driven service type table */
    const [svc] = await db.select().from(rideServiceTypesTable).where(eq(rideServiceTypesTable.key, type)).limit(1);
    if (svc) {
      baseRate = parseFloat(svc.baseFare  ?? "15");
      perKm    = parseFloat(svc.perKm     ?? "8");
      minFare  = parseFloat(svc.minFare   ?? "50");
    } else {
      baseRate = 25; perKm = 12; minFare = 80;
    }
  }

  const surgeEnabled    = (s["ride_surge_enabled"] ?? "off") === "on";
  const surgeMultiplier = surgeEnabled ? parseFloat(s["ride_surge_multiplier"] ?? "1.5") : 1;
  const raw      = Math.round(baseRate + distance * perKm);
  const baseFare = Math.round(Math.max(minFare, raw) * surgeMultiplier);
  const gstEnabled = (s["finance_gst_enabled"] ?? "off") === "on";
  const gstPct     = parseFloat(s["finance_gst_pct"] ?? "17");
  const gstAmount  = gstEnabled ? parseFloat(((baseFare * gstPct) / 100).toFixed(2)) : 0;
  return { baseFare, gstAmount, total: baseFare + gstAmount };
}

function formatRide(r: any) {
  return {
    ...r,
    fare:        parseFloat(r.fare         ?? "0"),
    distance:    parseFloat(r.distance     ?? "0"),
    offeredFare: r.offeredFare  ? parseFloat(r.offeredFare)  : null,
    counterFare: r.counterFare  ? parseFloat(r.counterFare)  : null,
    bargainRounds: r.bargainRounds ?? 0,
    createdAt:   r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt:   r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
    acceptedAt:  r.acceptedAt   ? (r.acceptedAt instanceof Date ? r.acceptedAt.toISOString() : r.acceptedAt) : null,
  };
}

/* ══════════════════════════════════════════════════════
   GET /rides/services — Publicly visible enabled service types
══════════════════════════════════════════════════════ */
router.get("/services", async (_req, res) => {
  await ensureDefaultRideServices();
  const services = await db.select().from(rideServiceTypesTable)
    .where(eq(rideServiceTypesTable.isEnabled, true))
    .orderBy(asc(rideServiceTypesTable.sortOrder));
  res.json({
    services: services.map(s => ({
      id:              s.id,
      key:             s.key,
      name:            s.name,
      nameUrdu:        s.nameUrdu,
      icon:            s.icon,
      description:     s.description,
      color:           s.color,
      baseFare:        parseFloat(s.baseFare   ?? "0"),
      perKm:           parseFloat(s.perKm      ?? "0"),
      minFare:         parseFloat(s.minFare    ?? "0"),
      maxPassengers:   s.maxPassengers,
      allowBargaining: s.allowBargaining,
      sortOrder:       s.sortOrder,
    })),
  });
});

/* ══════════════════════════════════════════════════════
   GET /rides/stops — Public popular locations (admin-managed)
══════════════════════════════════════════════════════ */
router.get("/stops", async (_req, res) => {
  try { await ensureDefaultLocations(); } catch {}
  const locs = await db.select().from(popularLocationsTable)
    .where(eq(popularLocationsTable.isActive, true))
    .orderBy(asc(popularLocationsTable.sortOrder));
  res.json({
    locations: locs.map(l => ({
      id: l.id, name: l.name, nameUrdu: l.nameUrdu,
      lat: parseFloat(String(l.lat)), lng: parseFloat(String(l.lng)),
      category: l.category, icon: l.icon,
    })),
  });
});

/* ══════════════════════════════════════════════════════
   POST /rides/estimate — Fare estimate (server-side, incl. GST)
══════════════════════════════════════════════════════ */
router.post("/estimate", async (req, res) => {
  const { pickupLat, pickupLng, dropLat, dropLng, type } = req.body;
  if (!pickupLat || !pickupLng || !dropLat || !dropLng) {
    res.status(400).json({ error: "pickupLat, pickupLng, dropLat, dropLng required" }); return;
  }
  const distance = calcDistance(Number(pickupLat), Number(pickupLng), Number(dropLat), Number(dropLng));
  const { baseFare, gstAmount, total } = await calcFare(distance, type || "bike");
  const s = await getPlatformSettings();
  const duration = `${Math.round(distance * 3 + 5)} min`;
  const bargainEnabled = (s["ride_bargaining_enabled"] ?? "on") === "on";
  const bargainMinPct  = parseFloat(s["ride_bargaining_min_pct"] ?? "70");
  const minOffer       = Math.ceil(total * (bargainMinPct / 100));
  res.json({
    distance:    Math.round(distance * 10) / 10,
    baseFare,
    gstAmount,
    fare:        total,
    duration,
    type:        type || "bike",
    bargainEnabled,
    minOffer,
  });
});

/* ══════════════════════════════════════════════════════
   POST /rides — Book a ride (standard or bargaining)
══════════════════════════════════════════════════════ */
router.post("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const {
    type, pickupAddress, dropAddress,
    pickupLat, pickupLng, dropLat, dropLng,
    paymentMethod,
    offeredFare,   /* bargaining: customer's custom price offer */
    bargainNote,   /* bargaining: optional note */
  } = req.body;

  if (!type || !paymentMethod) {
    res.status(400).json({ error: "type and paymentMethod are required" }); return;
  }
  if (!pickupAddress || !dropAddress) {
    res.status(400).json({ error: "pickupAddress and dropAddress are required" }); return;
  }
  if (!pickupLat || !pickupLng || !dropLat || !dropLng) {
    res.status(400).json({ error: "Exact coordinates required. Please select pickup/drop from the location list." }); return;
  }

  const s = await getPlatformSettings();

  if ((s["app_status"] ?? "active") === "maintenance") {
    const mainKey = (s["security_maintenance_key"] ?? "").trim();
    const bypass  = ((req.headers["x-maintenance-key"] as string) ?? "").trim();
    if (!mainKey || bypass !== mainKey) {
      res.status(503).json({ error: s["content_maintenance_msg"] ?? "We're performing scheduled maintenance. Back soon!" }); return;
    }
  }

  const ridesEnabled = (s["feature_rides"] ?? "on") === "on";
  if (!ridesEnabled) { res.status(503).json({ error: "Ride booking is currently disabled" }); return; }

  const distance = calcDistance(Number(pickupLat), Number(pickupLng), Number(dropLat), Number(dropLng));
  const { baseFare, gstAmount, total: platformFare } = await calcFare(distance, type);

  /* ── Bargaining logic ── */
  const bargainEnabled  = (s["ride_bargaining_enabled"] ?? "on") === "on";
  const bargainMinPct   = parseFloat(s["ride_bargaining_min_pct"] ?? "70");
  const bargainMaxRound = parseInt(s["ride_bargaining_max_rounds"] ?? "3", 10);

  let isBargaining = false;
  let validatedOffer = 0;

  if (offeredFare !== undefined && offeredFare !== null && bargainEnabled) {
    validatedOffer = parseFloat(String(offeredFare));
    if (isNaN(validatedOffer) || validatedOffer <= 0) {
      res.status(400).json({ error: "Invalid offered fare" }); return;
    }
    const minOffer = Math.ceil(platformFare * (bargainMinPct / 100));
    if (validatedOffer < minOffer) {
      res.status(400).json({ error: `Minimum offer allowed is Rs. ${minOffer} (${bargainMinPct}% of platform fare)` }); return;
    }
    if (validatedOffer >= platformFare) {
      isBargaining = false;  /* offered >= platform price → just use platform price */
    } else {
      isBargaining = true;
    }
  }

  /* ── Online payment limits ── */
  const minOnline = parseFloat(s["payment_min_online"] ?? "50");
  const maxOnline = parseFloat(s["payment_max_online"] ?? "100000");
  const effectiveFare = isBargaining ? validatedOffer : platformFare;
  if (paymentMethod === "wallet" && (effectiveFare < minOnline || effectiveFare > maxOnline)) {
    res.status(400).json({ error: `Wallet payment must be between Rs. ${minOnline} and Rs. ${maxOnline}` }); return;
  }

  if (paymentMethod === "cash") {
    const riderCashAllowed = (s["rider_cash_allowed"] ?? "on") === "on";
    if (!riderCashAllowed) {
      res.status(400).json({ error: "Cash payment is currently not available for rides. Please use wallet." }); return;
    }
  }

  const rideStatus = isBargaining ? "bargaining" : "searching";
  const fareToCharge = isBargaining ? validatedOffer : platformFare;
  const fareToStore  = platformFare.toFixed(2);  /* always store platform fare; bargaining tracks offered separately */

  /* ── Wallet: deduct immediately only for non-bargaining (platform price accepted) ── */
  try {
    let rideRecord: any;

    if (paymentMethod === "wallet" && !isBargaining) {
      const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
      if (!walletEnabled) { res.status(400).json({ error: "Wallet payments are currently disabled" }); return; }

      rideRecord = await db.transaction(async (tx) => {
        const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (!user) throw new Error("User not found");
        const balance = parseFloat(user.walletBalance ?? "0");
        if (balance < fareToCharge) throw new Error(`Insufficient wallet balance. Balance: Rs. ${balance.toFixed(0)}, Required: Rs. ${fareToCharge.toFixed(0)}`);
        await tx.update(usersTable).set({ walletBalance: (balance - fareToCharge).toFixed(2) }).where(eq(usersTable.id, userId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit",
          amount: fareToCharge.toFixed(2),
          description: `${type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ")} ride payment`,
        });
        const [ride] = await tx.insert(ridesTable).values({
          id: generateId(), userId, type, status: rideStatus,
          pickupAddress, dropAddress,
          pickupLat: String(pickupLat), pickupLng: String(pickupLng),
          dropLat: String(dropLat), dropLng: String(dropLng),
          fare: fareToStore, distance: (Math.round(distance * 10) / 10).toString(), paymentMethod,
          offeredFare: null, counterFare: null, bargainStatus: null, bargainRounds: 0,
        }).returning();
        return ride!;
      });
    } else {
      /* Cash payment OR bargaining ride (wallet deducted on agreement) */
      const [ride] = await db.insert(ridesTable).values({
        id: generateId(), userId, type, status: rideStatus,
        pickupAddress, dropAddress,
        pickupLat: String(pickupLat), pickupLng: String(pickupLng),
        dropLat: String(dropLat), dropLng: String(dropLng),
        fare: fareToStore, distance: (Math.round(distance * 10) / 10).toString(), paymentMethod,
        offeredFare:   isBargaining ? validatedOffer.toFixed(2) : null,
        counterFare:   null,
        bargainStatus: isBargaining ? "customer_offered" : null,
        bargainRounds: isBargaining ? 1 : 0,
        bargainNote:   bargainNote || null,
      }).returning();
      rideRecord = ride!;
    }

    /* Notification */
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: isBargaining ? `Ride Offer Sent 💬` : `${type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ")} Ride Booked`,
      body: isBargaining
        ? `Aapka Rs. ${validatedOffer} ka offer send ho gaya. Rider respond karega.`
        : `Aapki ride book ho gayi. Rider dhundha ja raha hai. Fare: Rs. ${fareToCharge.toFixed(0)}`,
      type: "ride", icon: ({ bike: "bicycle-outline", car: "car-outline", rickshaw: "car-outline", daba: "bus-outline", school_shift: "bus-outline" } as Record<string, string>)[type] ?? "car-outline", link: `/ride`,
    }).catch(() => {});

    res.status(201).json({
      ...formatRide(rideRecord),
      baseFare, gstAmount,
      platformFare, effectiveFare: fareToCharge,
      isBargaining,
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/* ══════════════════════════════════════════════════════
   PATCH /rides/:id/cancel — Customer cancels a ride
══════════════════════════════════════════════════════ */
router.patch("/:id/cancel", customerAuth, async (req, res) => {
  const userId = req.customerId!;

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, String(req.params["id"]))).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (ride.userId !== userId) { res.status(403).json({ error: "Not your ride" }); return; }
  if (!["searching", "bargaining", "accepted", "arrived", "in_transit"].includes(ride.status)) {
    res.status(400).json({ error: "Ride cannot be cancelled at this stage" }); return;
  }

  const s = await getPlatformSettings();
  const cancelFee = parseFloat(s["ride_cancellation_fee"] ?? "30");
  const riderAssigned = ["accepted", "arrived", "in_transit"].includes(ride.status);

  /* Cancellation fee only if rider was assigned */
  let actualCancelFee = 0;
  if (riderAssigned && cancelFee > 0 && ride.paymentMethod === "wallet") {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (user) {
      const balance = parseFloat(user.walletBalance ?? "0");
      actualCancelFee = Math.min(cancelFee, balance);
      if (actualCancelFee > 0) {
        await db.update(usersTable)
          .set({ walletBalance: (balance - actualCancelFee).toFixed(2) })
          .where(eq(usersTable.id, userId));
        await db.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit",
          amount: actualCancelFee.toFixed(2),
          description: `Ride cancellation fee — #${ride.id.slice(-6).toUpperCase()}`,
        }).catch(() => {});
      }
    }
  }

  /* Include userId in WHERE to close the TOCTOU window between ownership check and update */
  const [updated] = await db.update(ridesTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(ridesTable.id, String(req.params["id"])), eq(ridesTable.userId, userId)))
    .returning();

  /* Reject all pending bids (InDrive multi-bid) */
  await db.update(rideBidsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(rideBidsTable.rideId, String(req.params["id"])), eq(rideBidsTable.status, "pending")));

  /* Refund wallet fare if wallet payment + not bargaining (bargaining rides haven't charged yet) */
  if (ride.paymentMethod === "wallet" && ride.status !== "bargaining" && ride.bargainStatus !== "customer_offered") {
    const refundAmt = parseFloat(ride.fare);
    await db.update(usersTable)
      .set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
    await db.insert(walletTransactionsTable).values({
      id: generateId(), userId, type: "credit", amount: refundAmt.toFixed(2),
      description: `Ride refund — #${ride.id.slice(-6).toUpperCase()} cancelled`,
    }).catch(() => {});
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: "Ride Refund 💰",
      body: `Rs. ${refundAmt.toFixed(0)} refunded to your wallet.${actualCancelFee > 0 ? ` Rs. ${actualCancelFee} cancellation fee applied.` : ""}`,
      type: "ride", icon: "wallet-outline",
    }).catch(() => {});
  } else if (ride.status === "bargaining" || ride.bargainStatus === "customer_offered") {
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: "Ride Offer Cancelled",
      body: "Aapka ride offer cancel ho gaya.",
      type: "ride", icon: "close-circle-outline",
    }).catch(() => {});
  } else {
    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: "Ride Cancelled",
      body: riderAssigned && cancelFee > 0 ? `A cancellation fee of Rs. ${cancelFee} has been applied.` : "Aapki ride cancel ho gayi.",
      type: "ride", icon: "close-circle-outline",
    }).catch(() => {});
  }

  res.json({
    ...formatRide(updated!),
    cancellationFee: actualCancelFee,
  });
});

/* ══════════════════════════════════════════════════════
   PATCH /rides/:id/accept-bid — Customer accepts a specific rider's bid
   Body: { userId, bidId }
══════════════════════════════════════════════════════ */
router.patch("/:id/accept-bid", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const { bidId } = req.body;
  if (!bidId) { res.status(400).json({ error: "bidId required" }); return; }

  const rideId = String(req.params["id"]);
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (ride.userId !== userId) { res.status(403).json({ error: "Not your ride" }); return; }
  if (ride.status !== "bargaining") { res.status(400).json({ error: "Ride is not in bargaining state" }); return; }

  /* Fetch the bid being accepted */
  const [bid] = await db.select().from(rideBidsTable)
    .where(and(eq(rideBidsTable.id, bidId), eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending")))
    .limit(1);
  if (!bid) { res.status(404).json({ error: "Bid not found or no longer pending" }); return; }

  const agreedFare = parseFloat(bid.fare);

  /* Wallet deduction if wallet payment */
  if (ride.paymentMethod === "wallet") {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const balance = parseFloat(user.walletBalance ?? "0");
    if (balance < agreedFare) {
      res.status(400).json({ error: `Insufficient wallet balance. Need Rs. ${agreedFare.toFixed(0)}` }); return;
    }
    await db.update(usersTable).set({ walletBalance: (balance - agreedFare).toFixed(2) }).where(eq(usersTable.id, userId));
    await db.insert(walletTransactionsTable).values({
      id: generateId(), userId, type: "debit", amount: agreedFare.toFixed(2),
      description: `Ride payment (bargained) — #${rideId.slice(-6).toUpperCase()}`,
    }).catch(() => {});
  }

  /* Update the ride — assign rider, set fare, mark accepted.
     Include userId in WHERE to close TOCTOU between ownership check and update. */
  const [updated] = await db.update(ridesTable)
    .set({
      status:        "accepted",
      riderId:       bid.riderId,
      riderName:     bid.riderName,
      riderPhone:    bid.riderPhone,
      fare:          agreedFare.toFixed(2),
      counterFare:   agreedFare.toFixed(2),
      bargainStatus: "agreed",
      acceptedAt:    new Date(),
      updatedAt:     new Date(),
    })
    .where(and(eq(ridesTable.id, rideId), eq(ridesTable.userId, userId)))
    .returning();

  /* Atomically accept this bid + reject all other pending bids for this ride in a single transaction */
  await db.transaction(async (tx) => {
    await tx.update(rideBidsTable)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(eq(rideBidsTable.id, bidId));
    await tx.update(rideBidsTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending"), ne(rideBidsTable.id, bidId)));
  });

  /* Notify winning rider */
  await db.insert(notificationsTable).values({
    id: generateId(), userId: bid.riderId,
    title: "Aapka Bid Accept Ho Gaya! 🎉",
    body: `Customer ne aapka Rs. ${agreedFare.toFixed(0)} ka offer accept kar liya. Pickup ke liye jaayein!`,
    type: "ride", icon: "checkmark-circle-outline",
  }).catch(() => {});

  res.json({ ...formatRide(updated!), agreedFare });
});

/* ══════════════════════════════════════════════════════
   PATCH /rides/:id/customer-counter — Customer updates their offered fare
   Body: { userId, offeredFare, note? }
   Works anytime during bargaining; rejects all pending bids → riders re-bid
══════════════════════════════════════════════════════ */
router.patch("/:id/customer-counter", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const { offeredFare: newOffer, note } = req.body;
  if (!newOffer) { res.status(400).json({ error: "offeredFare required" }); return; }

  const rideId = String(req.params["id"]);
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (ride.userId !== userId) { res.status(403).json({ error: "Not your ride" }); return; }
  if (ride.status !== "bargaining") { res.status(400).json({ error: "Ride is not in bargaining state" }); return; }

  const s = await getPlatformSettings();
  const bargainMinPct = parseFloat(s["ride_bargaining_min_pct"] ?? "70");
  const platformFare  = parseFloat(ride.fare);
  const parsedOffer   = parseFloat(String(newOffer));
  const minOffer      = Math.ceil(platformFare * (bargainMinPct / 100));
  if (parsedOffer < minOffer) {
    res.status(400).json({ error: `Minimum offer is Rs. ${minOffer}` }); return;
  }

  /* Reject all pending bids so riders see fresh offer */
  await db.update(rideBidsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending")));

  const currentRounds = ride.bargainRounds ?? 0;
  /* Include userId in WHERE — closes TOCTOU between ownership check and update */
  const [updated] = await db.update(ridesTable)
    .set({
      offeredFare:   parsedOffer.toFixed(2),
      counterFare:   null,
      bargainStatus: "customer_offered",
      bargainRounds: currentRounds + 1,
      bargainNote:   note || ride.bargainNote,
      status:        "bargaining",
      riderId:       null,
      riderName:     null,
      riderPhone:    null,
      updatedAt:     new Date(),
    })
    .where(and(eq(ridesTable.id, rideId), eq(ridesTable.userId, userId)))
    .returning();

  res.json(formatRide(updated!));
});

/* ══════════════════════════════════════════════════════
   GET /rides — List rides for user
══════════════════════════════════════════════════════ */
router.get("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const rides = await db.select().from(ridesTable).where(eq(ridesTable.userId, userId)).orderBy(ridesTable.createdAt);
  res.json({
    rides: rides.map(formatRide).reverse(),
    total: rides.length,
  });
});

/* ══════════════════════════════════════════════════════
   GET /rides/:id — Single ride details + pending bids (InDrive)
   Requires valid JWT. Caller must be the customer OR the assigned rider.
══════════════════════════════════════════════════════ */
router.get("/:id", async (req, res) => {
  /* Flexible auth — accepts customer or rider JWT */
  const authHeader  = req.headers["authorization"] as string | undefined;
  const tokenHeader = req.headers["x-auth-token"]  as string | undefined;
  const raw = tokenHeader || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  if (!raw) { res.status(401).json({ error: "Authentication required" }); return; }
  const payload = verifyUserJwt(raw);
  if (!payload) { res.status(401).json({ error: "Invalid or expired session. Please log in again." }); return; }
  const callerId = payload.userId;

  const rideId = String(req.params["id"]);
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }

  /* Ownership check: requester must be the customer or the assigned rider */
  const isCustomer = ride.userId  === callerId;
  const isRider    = ride.riderId === callerId;
  if (!isCustomer && !isRider) {
    res.status(403).json({ error: "Access denied — not your ride" }); return;
  }

  /* Enrich with rider info if riderId set but riderName not stored */
  let riderName = ride.riderName;
  let riderPhone = ride.riderPhone;
  if (ride.riderId && !riderName) {
    const [riderUser] = await db.select({ name: usersTable.name, phone: usersTable.phone })
      .from(usersTable).where(eq(usersTable.id, ride.riderId)).limit(1);
    riderName  = riderUser?.name  || null;
    riderPhone = riderUser?.phone || null;
  }

  /* Include pending bids for bargaining rides */
  const bids = ride.status === "bargaining"
    ? await db.select().from(rideBidsTable)
        .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending")))
        .orderBy(rideBidsTable.createdAt)
    : [];

  const formattedBids = bids.map(b => ({
    ...b,
    fare: parseFloat(b.fare),
    createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
    updatedAt: b.updatedAt instanceof Date ? b.updatedAt.toISOString() : b.updatedAt,
  }));

  /* ── Rider live location (only when ride is active) ── */
  let riderLat: number | null = null;
  let riderLng: number | null = null;
  let riderLocAge: number | null = null;
  const ACTIVE_STATUSES = ["accepted", "arrived", "in_transit"];
  if (ride.riderId && ACTIVE_STATUSES.includes(ride.status)) {
    const [loc] = await db
      .select()
      .from(liveLocationsTable)
      .where(eq(liveLocationsTable.userId, ride.riderId))
      .limit(1);
    if (loc) {
      riderLat    = parseFloat(String(loc.latitude));
      riderLng    = parseFloat(String(loc.longitude));
      riderLocAge = Math.floor((Date.now() - new Date(loc.updatedAt).getTime()) / 1000);
    }
  }

  res.json({ ...formatRide(ride), riderName, riderPhone, bids: formattedBids, riderLat, riderLng, riderLocAge });
});

/* ════════════════════════════════════════════════════════
   POST /rides/:id/event-log
   Rider calls this on every status change (accepted →
   arrived → in_transit → completed / cancelled).
   Saves rider GPS + event type with the ride reference.
   Professional journey audit trail — used by admin.
════════════════════════════════════════════════════════ */
router.post("/:id/event-log", riderAuth, async (req, res) => {
  const rideId  = String(req.params["id"]);
  const riderId = req.riderId!;
  const { event, lat, lng, notes } = req.body;

  if (!event) {
    res.status(400).json({ error: "event is required" });
    return;
  }

  /* Verify ride exists AND this rider is the assigned rider */
  const [ride] = await db.select({ id: ridesTable.id, riderId: ridesTable.riderId })
    .from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (!ride.riderId || ride.riderId !== riderId) {
    res.status(403).json({ error: "You are not the assigned rider for this ride" }); return;
  }

  const id = generateId();
  await db.insert(rideEventLogsTable).values({
    id,
    rideId,
    riderId,
    event,
    lat:  lat  != null ? String(lat)  : null,
    lng:  lng  != null ? String(lng)  : null,
    notes: notes ?? null,
    createdAt: new Date(),
  });

  res.json({ success: true, id });
});

/* ════════════════════════════════════════════════════════
   GET /rides/:id/event-logs   — Admin only (journey audit trail)
════════════════════════════════════════════════════════ */
router.get("/:id/event-logs", async (req, res) => {
  /* Admin-secret guard — prevents public scraping of rider GPS journey history */
  const adminSecret = process.env.ADMIN_SECRET;
  const provided    = req.headers["x-admin-secret"] as string | undefined;
  if (!adminSecret || !provided || provided !== adminSecret) {
    res.status(401).json({ error: "Admin authentication required" }); return;
  }
  const logs = await db.select().from(rideEventLogsTable)
    .where(eq(rideEventLogsTable.rideId, String(req.params["id"])))
    .orderBy(asc(rideEventLogsTable.createdAt));

  const formatted = logs.map(l => ({
    id:        l.id,
    rideId:    l.rideId,
    riderId:   l.riderId,
    event:     l.event,
    lat:       l.lat  != null ? parseFloat(String(l.lat))  : null,
    lng:       l.lng  != null ? parseFloat(String(l.lng))  : null,
    notes:     l.notes,
    createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
  }));

  res.json({ logs: formatted, total: formatted.length });
});

export default router;
