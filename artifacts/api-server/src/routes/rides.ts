import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { liveLocationsTable, notificationsTable, rideBidsTable, rideServiceTypesTable, ridesTable, rideRatingsTable, riderPenaltiesTable, usersTable, walletTransactionsTable, popularLocationsTable, rideEventLogsTable } from "@workspace/db/schema";
import { and, asc, desc, eq, ne, sql, or, isNull, gte, count } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { ensureDefaultRideServices, ensureDefaultLocations, getPlatformSettings } from "./admin.js";
import { customerAuth, riderAuth, verifyUserJwt } from "../middleware/security.js";

const router: IRouter = Router();

const activeDispatchers = new Map<string, ReturnType<typeof setInterval>>();

async function dispatchRide(rideId: string) {
  if (activeDispatchers.has(rideId)) return;

  const tick = async () => {
    try {
      const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
      if (!ride || !["searching"].includes(ride.status)) {
        stopDispatcher(rideId);
        return;
      }

      const s = await getPlatformSettings();
      const timeoutSec = parseInt(s["dispatch_request_timeout"] ?? "30", 10);
      const maxLoops = parseInt(s["dispatch_max_loops"] ?? "3", 10);
      const radiusKm = parseFloat(s["dispatch_min_radius_km"] ?? "5");
      const avgSpeed = parseFloat(s["dispatch_avg_speed_kmh"] ?? "30");

      if (ride.dispatchedRiderId && ride.expiresAt) {
        if (new Date() < new Date(ride.expiresAt)) return;

        const expiredRiderId = ride.dispatchedRiderId;
        const currentAttempts = ride.dispatchAttempts ? JSON.parse(ride.dispatchAttempts) : [];
        if (!currentAttempts.includes(expiredRiderId)) currentAttempts.push(expiredRiderId);

        await db.update(usersTable)
          .set({ ignoreCount: sql`ignore_count + 1`, updatedAt: new Date() })
          .where(eq(usersTable.id, expiredRiderId));

        const s = await getPlatformSettings();
        const ignoreThreshold = parseInt(s["dispatch_ignore_threshold"] ?? "10", 10);
        const ignorePenaltyAmt = parseFloat(s["dispatch_ignore_penalty"] ?? "25");

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const [countRow] = await db.select({ c: count() })
          .from(riderPenaltiesTable)
          .where(and(
            eq(riderPenaltiesTable.riderId, expiredRiderId),
            eq(riderPenaltiesTable.type, "ignore"),
            gte(riderPenaltiesTable.createdAt, today),
          ));
        const dailyIgnores = (countRow?.c ?? 0) + 1;

        let penaltyApplied = 0;
        if (dailyIgnores > ignoreThreshold) {
          penaltyApplied = ignorePenaltyAmt;
          await db.transaction(async (tx) => {
            await tx.update(usersTable)
              .set({ walletBalance: sql`wallet_balance - ${ignorePenaltyAmt}`, updatedAt: new Date() })
              .where(eq(usersTable.id, expiredRiderId));
            await tx.insert(walletTransactionsTable).values({
              id: generateId(), userId: expiredRiderId, type: "ignore_penalty",
              amount: ignorePenaltyAmt.toFixed(2),
              description: `Auto-expire penalty (${dailyIgnores}/${ignoreThreshold} today) — Rs. ${ignorePenaltyAmt}`,
              reference: `ignore_penalty:${Date.now()}`,
            });
          });
          await db.insert(notificationsTable).values({
            id: generateId(), userId: expiredRiderId,
            title: "Ignore Penalty ⚠️",
            body: `Ride request expired ${dailyIgnores} times today (limit: ${ignoreThreshold}). Rs. ${ignorePenaltyAmt} penalty applied.`,
            type: "system", icon: "alert-circle-outline",
          }).catch(() => {});
        }

        await db.insert(riderPenaltiesTable).values({
          id: generateId(), riderId: expiredRiderId, type: "ignore",
          amount: penaltyApplied > 0 ? ignorePenaltyAmt.toFixed(2) : "0",
          reason: `Auto-expired: ride ${rideId.slice(-6).toUpperCase()} (${dailyIgnores} today)`,
        });

        await db.update(ridesTable).set({
          dispatchedRiderId: null,
          dispatchAttempts: JSON.stringify(currentAttempts),
          expiresAt: null,
          updatedAt: new Date(),
        }).where(eq(ridesTable.id, rideId));
      }

      const freshRide = (await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1))[0];
      if (!freshRide || freshRide.status !== "searching") { stopDispatcher(rideId); return; }

      const loopCount = freshRide.dispatchLoopCount ?? 0;
      if (loopCount >= maxLoops) {
        await db.update(ridesTable).set({ status: "no_riders", updatedAt: new Date() }).where(eq(ridesTable.id, rideId));
        await db.insert(notificationsTable).values({
          id: generateId(), userId: freshRide.userId,
          title: "No Riders Available",
          body: "Koi rider available nahi hai. Thodi der baad try karein ya fare adjust karein.",
          type: "ride", icon: "alert-circle-outline",
        }).catch(() => {});
        stopDispatcher(rideId);
        return;
      }

      const excludedIds: string[] = freshRide.dispatchAttempts ? JSON.parse(freshRide.dispatchAttempts) : [];
      const pickupLat = parseFloat(freshRide.pickupLat ?? "0");
      const pickupLng = parseFloat(freshRide.pickupLng ?? "0");

      const onlineRiders = await db.select({
        userId: liveLocationsTable.userId,
        latitude: liveLocationsTable.latitude,
        longitude: liveLocationsTable.longitude,
      }).from(liveLocationsTable)
        .where(and(
          eq(liveLocationsTable.role, "rider"),
          gte(liveLocationsTable.updatedAt, new Date(Date.now() - 5 * 60 * 1000)),
        ));

      let nearestRider: { userId: string; dist: number } | null = null;
      for (const r of onlineRiders) {
        if (excludedIds.includes(r.userId)) continue;
        const dist = calcDistance(pickupLat, pickupLng, parseFloat(r.latitude), parseFloat(r.longitude));
        if (dist > radiusKm) continue;
        const [user] = await db.select({ isActive: usersTable.isActive, isBanned: usersTable.isBanned, isRestricted: usersTable.isRestricted })
          .from(usersTable).where(eq(usersTable.id, r.userId)).limit(1);
        if (!user || !user.isActive || user.isBanned || user.isRestricted) continue;
        if (!nearestRider || dist < nearestRider.dist) {
          nearestRider = { userId: r.userId, dist };
        }
      }

      if (nearestRider) {
        const etaMin = Math.max(1, Math.round((nearestRider.dist / avgSpeed) * 60));
        const expiresAt = new Date(Date.now() + timeoutSec * 1000);

        await db.update(ridesTable).set({
          dispatchedRiderId: nearestRider.userId,
          expiresAt,
          updatedAt: new Date(),
        }).where(eq(ridesTable.id, rideId));

        await db.insert(notificationsTable).values({
          id: generateId(), userId: nearestRider.userId,
          title: "New Ride Request! 🚗",
          body: `${freshRide.pickupAddress} → ${freshRide.dropAddress} · Rs. ${parseFloat(freshRide.fare ?? "0").toFixed(0)} · ${nearestRider.dist.toFixed(1)} km away · ETA ${etaMin} min`,
          type: "ride", icon: "car-outline", link: `/ride/${rideId}`,
        }).catch(() => {});
      } else {
        await db.update(ridesTable).set({
          dispatchLoopCount: loopCount + 1,
          dispatchAttempts: "[]",
          updatedAt: new Date(),
        }).where(eq(ridesTable.id, rideId));
      }
    } catch (err) {
      console.error(`[dispatch] Error for ride ${rideId}:`, err);
    }
  };

  const interval = setInterval(tick, 5000);
  activeDispatchers.set(rideId, interval);
  tick();
}

function stopDispatcher(rideId: string) {
  const interval = activeDispatchers.get(rideId);
  if (interval) { clearInterval(interval); activeDispatchers.delete(rideId); }
}

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

  /* ── Prevent duplicate active rides ── */
  const existingActive = await db.select({ id: ridesTable.id, status: ridesTable.status })
    .from(ridesTable)
    .where(and(eq(ridesTable.userId, userId), sql`status IN ('searching', 'bargaining', 'accepted', 'arrived', 'in_transit')`))
    .limit(1);
  if (existingActive.length > 0) {
    res.status(409).json({
      error: "Aapki ek ride pehle se active hai. Naye ride ke liye pehle wali complete ya cancel karein.",
      activeRideId: existingActive[0]!.id,
      activeRideStatus: existingActive[0]!.status,
    });
    return;
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

    if (!isBargaining && rideRecord) {
      dispatchRide(rideRecord.id);
    }

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
  const cancelReason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : null;

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, String(req.params["id"]))).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (ride.userId !== userId) { res.status(403).json({ error: "Not your ride" }); return; }
  if (!["searching", "bargaining", "accepted", "arrived", "in_transit"].includes(ride.status)) {
    res.status(400).json({ error: "Ride cannot be cancelled at this stage" }); return;
  }

  stopDispatcher(String(req.params["id"]));
  const s = await getPlatformSettings();
  const cancelFee = parseFloat(s["ride_cancellation_fee"] ?? "30");
  const riderAssigned = ["accepted", "arrived", "in_transit"].includes(ride.status);

  /* All-or-nothing transaction: cancel ride + bid rejection + cancellation fee + refund */
  let actualCancelFee = 0;
  let cancelFeeAsDebt = false;

  const cancelResult = await db.transaction(async (tx) => {
    const [upd] = await tx.update(ridesTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(ridesTable.id, String(req.params["id"])), eq(ridesTable.userId, userId)))
      .returning();

    await tx.update(rideBidsTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(and(eq(rideBidsTable.rideId, String(req.params["id"])), eq(rideBidsTable.status, "pending")));

    if (riderAssigned && cancelFee > 0) {
      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (user) {
        const balance = parseFloat(user.walletBalance ?? "0");
        if (balance >= cancelFee) {
          actualCancelFee = cancelFee;
          await tx.update(usersTable)
            .set({ walletBalance: (balance - cancelFee).toFixed(2) })
            .where(eq(usersTable.id, userId));
          await tx.insert(walletTransactionsTable).values({
            id: generateId(), userId, type: "debit",
            amount: cancelFee.toFixed(2),
            description: `Ride cancellation fee — #${ride.id.slice(-6).toUpperCase()}`,
          });
        } else if (balance > 0) {
          actualCancelFee = balance;
          cancelFeeAsDebt = true;
          await tx.update(usersTable)
            .set({ walletBalance: "0" })
            .where(eq(usersTable.id, userId));
          await tx.insert(walletTransactionsTable).values({
            id: generateId(), userId, type: "debit",
            amount: balance.toFixed(2),
            description: `Ride cancellation fee (partial, Rs.${(cancelFee - balance).toFixed(0)} as debt) — #${ride.id.slice(-6).toUpperCase()}`,
          });
        } else {
          cancelFeeAsDebt = true;
        }
      }
    }

    if (cancelFeeAsDebt && upd) {
      await tx.update(ridesTable)
        .set({ bargainNote: `Cancellation debt: Rs.${cancelFee}` })
        .where(eq(ridesTable.id, upd.id));
    }

    if (ride.paymentMethod === "wallet" && ride.status !== "bargaining" && ride.bargainStatus !== "customer_offered") {
      const refundAmt = parseFloat(ride.fare);
      await tx.update(usersTable)
        .set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
      await tx.insert(walletTransactionsTable).values({
        id: generateId(), userId, type: "credit", amount: refundAmt.toFixed(2),
        description: `Ride refund — #${ride.id.slice(-6).toUpperCase()} cancelled`,
      });
    }

    return upd;
  });

  if (ride.paymentMethod === "wallet" && ride.status !== "bargaining" && ride.bargainStatus !== "customer_offered") {
    const refundAmt = parseFloat(ride.fare);
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
      body: riderAssigned && cancelFee > 0
        ? `A cancellation fee of Rs. ${cancelFee} has been applied.${cancelFeeAsDebt ? " Remaining balance will be deducted from future wallet top-ups." : ""}`
        : "Aapki ride cancel ho gayi.",
      type: "ride", icon: "close-circle-outline",
    }).catch(() => {});
  }

  if (cancelReason) {
    req.log?.info({ rideId: ride.id, cancelReason }, "Ride cancelled with reason");
  }

  res.json({
    ...formatRide(cancelResult!),
    cancellationFee: actualCancelFee,
    cancelFeeAsDebt,
    cancelReason,
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

  /* ── Single transaction: wallet deduction + ride update + bid acceptance ── */
  let updated: any;
  try {
    updated = await db.transaction(async (tx) => {
      if (ride.paymentMethod === "wallet") {
        const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (!user) throw new Error("User not found");
        const balance = parseFloat(user.walletBalance ?? "0");
        if (balance < agreedFare) throw new Error(`Insufficient wallet balance. Need Rs. ${agreedFare.toFixed(0)}`);
        await tx.update(usersTable).set({ walletBalance: (balance - agreedFare).toFixed(2) }).where(eq(usersTable.id, userId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit", amount: agreedFare.toFixed(2),
          description: `Ride payment (bargained) — #${rideId.slice(-6).toUpperCase()}`,
        });
      }

      const [rideUpdate] = await tx.update(ridesTable)
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
        .where(and(eq(ridesTable.id, rideId), eq(ridesTable.userId, userId), eq(ridesTable.status, "bargaining")))
        .returning();

      if (!rideUpdate) throw new Error("Ride is no longer available for acceptance");

      const bidUpdateResult = await tx.update(rideBidsTable)
        .set({ status: "accepted", updatedAt: new Date() })
        .where(and(eq(rideBidsTable.id, bidId), eq(rideBidsTable.status, "pending")))
        .returning();

      if (bidUpdateResult.length === 0) throw new Error("Bid is no longer available");

      await tx.update(rideBidsTable)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending"), ne(rideBidsTable.id, bidId)));

      return rideUpdate;
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }

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

/* ══════════════════════════════════════════════════════
   GET /rides/payment-methods — Active ride payment methods
══════════════════════════════════════════════════════ */
router.get("/payment-methods", async (_req, res) => {
  const s = await getPlatformSettings();
  const rideAllowed = (newKey: string, legacyKey: string, legacyDefault: string): boolean => {
    if (s[newKey] !== undefined) return s[newKey] === "on";
    return (s[legacyKey] ?? legacyDefault) === "on";
  };
  const methods: { key: string; label: string; enabled: boolean }[] = [
    { key: "cash",      label: "Cash",      enabled: rideAllowed("cod_allowed_rides", "ride_payment_cash", "on") && (s["cod_enabled"] ?? "on") === "on" && (s["rider_cash_allowed"] ?? "on") === "on" },
    { key: "wallet",    label: "Wallet",     enabled: rideAllowed("wallet_allowed_rides", "ride_payment_wallet", "on") && (s["feature_wallet"] ?? "on") === "on" },
    { key: "jazzcash",  label: "JazzCash",   enabled: rideAllowed("jazzcash_allowed_rides", "ride_payment_jazzcash", "off") && (s["jazzcash_enabled"] ?? "off") === "on" },
    { key: "easypaisa", label: "EasyPaisa",  enabled: rideAllowed("easypaisa_allowed_rides", "ride_payment_easypaisa", "off") && (s["easypaisa_enabled"] ?? "off") === "on" },
  ];
  res.json({ methods: methods.filter(m => m.enabled) });
});

/* ══════════════════════════════════════════════════════
   POST /rides/:id/rate — Customer rates rider after ride
══════════════════════════════════════════════════════ */
router.post("/:id/rate", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const rideId = String(req.params["id"]);
  const { stars, comment } = req.body;

  if (!stars || stars < 1 || stars > 5) {
    res.status(400).json({ error: "stars must be between 1 and 5" }); return;
  }

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (ride.userId !== userId) { res.status(403).json({ error: "Not your ride" }); return; }
  if (ride.status !== "completed") { res.status(400).json({ error: "Can only rate completed rides" }); return; }
  if (!ride.riderId) { res.status(400).json({ error: "No rider assigned" }); return; }

  const existing = await db.select({ id: rideRatingsTable.id }).from(rideRatingsTable).where(eq(rideRatingsTable.rideId, rideId)).limit(1);
  if (existing.length > 0) { res.status(409).json({ error: "Already rated" }); return; }

  const [rating] = await db.insert(rideRatingsTable).values({
    id: generateId(),
    rideId,
    customerId: userId,
    riderId: ride.riderId,
    stars: parseInt(String(stars), 10),
    comment: comment || null,
  }).returning();

  await db.insert(notificationsTable).values({
    id: generateId(), userId: ride.riderId,
    title: `${stars} Star Rating ⭐`,
    body: comment ? `Customer ne ${stars} stars diye: "${comment}"` : `Customer ne aapko ${stars} stars diye!`,
    type: "ride", icon: "star-outline",
  }).catch(() => {});

  res.json({ success: true, rating });
});

/* ══════════════════════════════════════════════════════
   GET /rides/:id/status — Customer polls dispatch status
══════════════════════════════════════════════════════ */
router.get("/:id/status", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const rideId = String(req.params["id"]);

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (ride.userId !== userId) { res.status(403).json({ error: "Not your ride" }); return; }

  const attempts = (ride.dispatchAttempts as string[] | null) || [];
  const hasRating = await db.select({ id: rideRatingsTable.id }).from(rideRatingsTable).where(eq(rideRatingsTable.rideId, rideId)).limit(1);

  res.json({
    id: ride.id,
    status: ride.status,
    riderId: ride.riderId,
    riderName: ride.riderName,
    riderPhone: ride.riderPhone,
    dispatchedRiderId: ride.dispatchedRiderId,
    dispatchLoopCount: ride.dispatchLoopCount ?? 0,
    dispatchAttempts: attempts.length,
    expiresAt: ride.expiresAt ? (ride.expiresAt instanceof Date ? ride.expiresAt.toISOString() : ride.expiresAt) : null,
    fare: parseFloat(ride.fare),
    distance: parseFloat(ride.distance),
    hasRating: hasRating.length > 0,
  });
});

/* ══════════════════════════════════════════════════════
   GET /rides/:id/dispatch-status — Alias for dispatch progress
══════════════════════════════════════════════════════ */
router.get("/:id/dispatch-status", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const rideId = String(req.params["id"]);
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (ride.userId !== userId) { res.status(403).json({ error: "Not your ride" }); return; }

  const s = await getPlatformSettings();
  const maxLoops = parseInt(s["dispatch_max_loops"] ?? "2", 10);
  const timeoutSec = parseInt(s["dispatch_request_timeout_sec"] ?? "30", 10);
  const avgSpeed = parseFloat(s["dispatch_avg_speed_kmh"] ?? "25");
  const attempts = (ride.dispatchAttempts as string[] | null) || [];

  let riderDistance: number | null = null;
  let riderEta: number | null = null;
  if (ride.dispatchedRiderId) {
    const [loc] = await db.select().from(liveLocationsTable)
      .where(eq(liveLocationsTable.userId, ride.dispatchedRiderId)).limit(1);
    if (loc) {
      riderDistance = Math.round(calcDistance(
        parseFloat(ride.pickupLat ?? "0"), parseFloat(ride.pickupLng ?? "0"),
        parseFloat(loc.latitude), parseFloat(loc.longitude)
      ) * 10) / 10;
      riderEta = Math.max(1, Math.round((riderDistance / avgSpeed) * 60));
    }
  }

  res.json({
    status: ride.status,
    dispatchedRiderId: ride.dispatchedRiderId,
    dispatchLoopCount: ride.dispatchLoopCount ?? 0,
    maxLoops,
    attemptCount: attempts.length,
    expiresAt: ride.expiresAt ? ride.expiresAt.toISOString() : null,
    timeoutSec,
    riderDistance,
    riderEta,
  });
});

/* ══════════════════════════════════════════════════════
   POST /rides/:id/retry — Customer retries dispatch after no_riders/expired
══════════════════════════════════════════════════════ */
router.post("/:id/retry", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const rideId = String(req.params["id"]);

  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (ride.userId !== userId) { res.status(403).json({ error: "Not your ride" }); return; }
  if (ride.status !== "no_riders" && ride.status !== "expired") { res.status(400).json({ error: "Ride is not in no_riders/expired state" }); return; }

  await db.update(ridesTable).set({
    status: "searching",
    dispatchedRiderId: null,
    dispatchAttempts: [],
    dispatchLoopCount: 0,
    dispatchedAt: null,
    expiresAt: null,
    updatedAt: new Date(),
  }).where(eq(ridesTable.id, rideId));

  res.json({ success: true, message: "Dispatch restarted" });
});

/* ══════════════════════════════════════════════════════
   Dispatch Engine — runs every 10 seconds
   Finds rides in "searching" status and dispatches to
   nearest available online rider within configured radius.
   Handles timeouts and re-dispatch loops.
══════════════════════════════════════════════════════ */
let dispatchCycleRunning = false;
async function runDispatchCycle() {
  if (dispatchCycleRunning) return;
  dispatchCycleRunning = true;
  try {
    const s = await getPlatformSettings();
    const timeoutSec = parseInt(s["dispatch_request_timeout_sec"] ?? "30", 10);
    const maxLoops = parseInt(s["dispatch_max_loops"] ?? "2", 10);
    const minRadius = parseFloat(s["dispatch_min_radius_km"] ?? "5");
    const avgSpeed = parseFloat(s["dispatch_avg_speed_kmh"] ?? "25");

    const pendingRides = await db.select().from(ridesTable)
      .where(and(
        or(eq(ridesTable.status, "searching"), eq(ridesTable.status, "bargaining")),
        isNull(ridesTable.riderId),
      ))
      .orderBy(asc(ridesTable.createdAt))
      .limit(50);

    if (pendingRides.length === 0) return;

    const onlineRiders = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      phone: usersTable.phone,
    }).from(usersTable)
      .where(and(
        sql`(${usersTable.roles} LIKE '%rider%' OR ${usersTable.role} LIKE '%rider%')`,
        eq(usersTable.isOnline, true),
        eq(usersTable.isActive, true),
      ));

    if (onlineRiders.length === 0) return;

    const riderLocations = await db.select().from(liveLocationsTable);
    const riderLocMap = new Map(riderLocations.map(l => [l.userId, { lat: parseFloat(String(l.latitude)), lng: parseFloat(String(l.longitude)) }]));

    for (const ride of pendingRides) {
      const attempts = (ride.dispatchAttempts as string[] | null) || [];
      const loopCount = ride.dispatchLoopCount ?? 0;
      const pickupLat = parseFloat(ride.pickupLat ?? "0");
      const pickupLng = parseFloat(ride.pickupLng ?? "0");

      if (ride.dispatchedRiderId && ride.dispatchedAt) {
        const dispatchedAtMs = new Date(ride.dispatchedAt).getTime();
        const elapsed = (Date.now() - dispatchedAtMs) / 1000;
        if (elapsed < timeoutSec) continue;
      }

      if (loopCount >= maxLoops && ride.dispatchedRiderId) {
        await db.update(ridesTable)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(ridesTable.id, ride.id));

        await db.insert(notificationsTable).values({
          id: generateId(),
          userId: ride.userId,
          title: "No Rider Found",
          body: "Koi rider available nahi mila. Please dubara try karein.",
          type: "ride",
          icon: "close-circle-outline",
        }).catch(() => {});
        continue;
      }

      const riderDistances: { id: string; name: string; phone: string; dist: number; eta: number }[] = [];
      for (const rider of onlineRiders) {
        if (attempts.includes(rider.id)) continue;
        const loc = riderLocMap.get(rider.id);
        if (!loc) continue;
        const dist = calcDistance(loc.lat, loc.lng, pickupLat, pickupLng);
        if (dist > minRadius) continue;
        const etaMin = Math.round((dist / avgSpeed) * 60);
        riderDistances.push({ id: rider.id, name: rider.name || "Rider", phone: rider.phone || "", dist, eta: etaMin });
      }

      riderDistances.sort((a, b) => a.dist - b.dist);

      if (riderDistances.length === 0) {
        const newLoopCount = loopCount + 1;
        if (newLoopCount >= maxLoops) {
          await db.update(ridesTable)
            .set({ status: "expired", dispatchLoopCount: newLoopCount, updatedAt: new Date() })
            .where(eq(ridesTable.id, ride.id));
          await db.insert(notificationsTable).values({
            id: generateId(),
            userId: ride.userId,
            title: "No Rider Found",
            body: "Koi rider available nahi mila. Please dubara try karein.",
            type: "ride",
            icon: "close-circle-outline",
          }).catch(() => {});
        } else {
          await db.update(ridesTable)
            .set({ dispatchLoopCount: newLoopCount, dispatchAttempts: [], dispatchedRiderId: null, dispatchedAt: null, updatedAt: new Date() })
            .where(eq(ridesTable.id, ride.id));
        }
        continue;
      }

      const nearest = riderDistances[0]!;
      const newAttempts = [...attempts, nearest.id];

      await db.update(ridesTable)
        .set({
          dispatchedRiderId: nearest.id,
          dispatchAttempts: newAttempts,
          dispatchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(ridesTable.id, ride.id));
    }
  } catch (err) {
    console.error("[dispatch-engine] cycle error:", err);
  } finally {
    dispatchCycleRunning = false;
  }
}

let dispatchInterval: ReturnType<typeof setInterval> | null = null;
export function startDispatchEngine() {
  if (dispatchInterval) return;
  dispatchInterval = setInterval(runDispatchCycle, 10_000);
  console.log("[dispatch-engine] started (every 10s)");
  runDispatchCycle();
}

export default router;
