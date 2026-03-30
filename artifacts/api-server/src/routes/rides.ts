import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  liveLocationsTable, notificationsTable, rideBidsTable,
  rideServiceTypesTable, ridesTable, rideRatingsTable,
  usersTable, walletTransactionsTable,
  popularLocationsTable, rideEventLogsTable, rideNotifiedRidersTable,
} from "@workspace/db/schema";
import { and, asc, eq, ne, sql, or, isNull, gte, count } from "drizzle-orm";
import { z } from "zod";
import { generateId } from "../lib/id.js";
import { ensureDefaultRideServices, ensureDefaultLocations, getPlatformSettings } from "./admin.js";
import { customerAuth, riderAuth, verifyUserJwt } from "../middleware/security.js";
import { loadRide, requireRideState, requireRideOwner } from "../middleware/ride-guards.js";

const router: IRouter = Router();

const coordinateSchema = z.number().min(-180).max(180);
const latitudeSchema = z.number().min(-90).max(90);

function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

const bookRideSchema = z.object({
  type: z.string().min(1),
  pickupAddress: z.string().min(1),
  dropAddress: z.string().min(1),
  pickupLat: z.preprocess(toNumber, latitudeSchema),
  pickupLng: z.preprocess(toNumber, coordinateSchema),
  dropLat: z.preprocess(toNumber, latitudeSchema),
  dropLng: z.preprocess(toNumber, coordinateSchema),
  paymentMethod: z.string().min(1),
  offeredFare: z.preprocess((v) => (v != null && v !== "" ? Number(v) : undefined), z.number().positive().optional()),
  bargainNote: z.string().max(500).optional(),
});

const cancelRideSchema = z.object({
  reason: z.string().max(200).optional(),
});

const acceptBidSchema = z.object({
  bidId: z.string().min(1),
});

const customerCounterSchema = z.object({
  offeredFare: z.preprocess(toNumber, z.number().positive()),
  note: z.string().max(500).optional(),
});

const rateRideSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

const estimateSchema = z.object({
  pickupLat: z.preprocess(toNumber, latitudeSchema),
  pickupLng: z.preprocess(toNumber, coordinateSchema),
  dropLat: z.preprocess(toNumber, latitudeSchema),
  dropLng: z.preprocess(toNumber, coordinateSchema),
  type: z.string().min(1).optional(),
});

const eventLogSchema = z.object({
  event: z.string().min(1),
  lat: z.number().optional(),
  lng: z.number().optional(),
  notes: z.string().max(1000).optional(),
});

async function broadcastRide(rideId: string) {
  try {
    const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);
    if (!ride || ride.riderId) return;
    if (!["searching", "bargaining"].includes(ride.status)) return;

    const s = await getPlatformSettings();
    const radiusKm = parseFloat(s["dispatch_min_radius_km"] ?? "5");
    const avgSpeed = parseFloat(s["dispatch_avg_speed_kmh"] ?? "25");

    const pickupLat = parseFloat(ride.pickupLat ?? "0");
    const pickupLng = parseFloat(ride.pickupLng ?? "0");

    const onlineRiders = await db.select({
      userId: liveLocationsTable.userId,
      latitude: liveLocationsTable.latitude,
      longitude: liveLocationsTable.longitude,
    }).from(liveLocationsTable)
      .where(and(
        eq(liveLocationsTable.role, "rider"),
        gte(liveLocationsTable.updatedAt, new Date(Date.now() - 5 * 60 * 1000)),
      ));

    const alreadyNotified = await db.select({ riderId: rideNotifiedRidersTable.riderId })
      .from(rideNotifiedRidersTable)
      .where(eq(rideNotifiedRidersTable.rideId, rideId));
    const alreadySet = new Set(alreadyNotified.map(r => r.riderId));

    for (const r of onlineRiders) {
      if (alreadySet.has(r.userId)) continue;
      const dist = calcDistance(pickupLat, pickupLng, parseFloat(r.latitude), parseFloat(r.longitude));
      if (dist > radiusKm) continue;

      const [user] = await db.select({ isActive: usersTable.isActive, isBanned: usersTable.isBanned, isRestricted: usersTable.isRestricted, vehicleType: usersTable.vehicleType })
        .from(usersTable).where(eq(usersTable.id, r.userId)).limit(1);
      if (!user || !user.isActive || user.isBanned || user.isRestricted) continue;
      // Strict vehicle-type matching: when a ride specifies a type, only notify riders
      // who have that exact vehicleType registered. Riders without a vehicleType set
      // are excluded to avoid dispatching to unqualified vehicles.
      if (ride.type) {
        const vt = (user.vehicleType ?? "").trim();
        if (!vt || vt !== ride.type) continue;
      }

      const etaMin = Math.max(1, Math.round((dist / avgSpeed) * 60));
      const fareStr = parseFloat(ride.fare ?? "0").toFixed(0);
      const typeLabel = ride.status === "bargaining" ? "Bargaining Ride" : "New Ride";

      await db.insert(notificationsTable).values({
        id: generateId(), userId: r.userId,
        title: `${typeLabel} Request! 🚗`,
        body: `${ride.pickupAddress} → ${ride.dropAddress} · Rs. ${fareStr} · ${dist.toFixed(1)} km away · ETA ${etaMin} min`,
        type: "ride", icon: "car-outline", link: `/ride/${rideId}`,
      }).catch(() => {});

      await db.insert(rideNotifiedRidersTable).values({
        id: generateId(),
        rideId,
        riderId: r.userId,
      }).catch(() => {});
    }

    await db.update(ridesTable).set({
      dispatchedAt: ride.dispatchedAt ?? new Date(),
      updatedAt: new Date(),
    }).where(and(eq(ridesTable.id, rideId), isNull(ridesTable.riderId)));

  } catch (err) {
    console.error(`[broadcast] Error for ride ${rideId}:`, err);
  }
}

async function cleanupNotifiedRiders(rideId: string) {
  await db.delete(rideNotifiedRidersTable)
    .where(eq(rideNotifiedRidersTable.rideId, rideId))
    .catch(() => {});
}

function calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!isFinite(lat1) || !isFinite(lng1) || !isFinite(lat2) || !isFinite(lng2)) {
    throw new Error("Invalid coordinates: all values must be finite numbers");
  }
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function calcFare(distance: number, type: string): Promise<{ baseFare: number; gstAmount: number; total: number }> {
  if (!isFinite(distance) || distance < 0) {
    throw new Error("Invalid distance: must be a non-negative number");
  }
  if (!type || typeof type !== "string") {
    throw new Error("Invalid service type: must be a non-empty string");
  }

  const s = await getPlatformSettings();

  let baseRate: number, perKm: number, minFare: number;
  const psBase = s[`ride_${type}_base_fare`];
  const psKm   = s[`ride_${type}_per_km`];
  const psMin  = s[`ride_${type}_min_fare`];

  if (psBase !== undefined && psKm !== undefined && psMin !== undefined) {
    baseRate = parseFloat(psBase);
    perKm    = parseFloat(psKm);
    minFare  = parseFloat(psMin);
  } else {
    const [svc] = await db.select().from(rideServiceTypesTable).where(eq(rideServiceTypesTable.key, type)).limit(1);
    if (!svc) {
      throw new Error(`Unknown ride service type: '${type}'`);
    }
    baseRate = parseFloat(svc.baseFare  ?? "15");
    perKm    = parseFloat(svc.perKm     ?? "8");
    minFare  = parseFloat(svc.minFare   ?? "50");
  }

  if (!isFinite(baseRate) || !isFinite(perKm) || !isFinite(minFare)) {
    throw new Error("Fare configuration is invalid for this service type");
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

router.post("/estimate", async (req, res) => {
  const parsed = estimateSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    res.status(422).json({ error: msg }); return;
  }
  const { pickupLat, pickupLng, dropLat, dropLng, type } = parsed.data;
  try {
    const serviceType = type || "bike";
    const distance = calcDistance(pickupLat, pickupLng, dropLat, dropLng);
    const { baseFare, gstAmount, total } = await calcFare(distance, serviceType);
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
      type:        serviceType,
      bargainEnabled,
      minOffer,
    });
  } catch (e: any) {
    res.status(422).json({ error: e.message });
  }
});

router.post("/", customerAuth, async (req, res) => {
  const parsed = bookRideSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    res.status(422).json({ error: msg }); return;
  }

  const userId = req.customerId!;
  const {
    type, pickupAddress, dropAddress,
    pickupLat, pickupLng, dropLat, dropLng,
    paymentMethod, offeredFare, bargainNote,
  } = parsed.data;

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

  const [debtUser] = await db.select({ cancellationDebt: usersTable.cancellationDebt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const debtAmount = parseFloat(debtUser?.cancellationDebt ?? "0");
  if (debtAmount > 0) {
    res.status(402).json({
      error: `You have an outstanding cancellation fee debt of Rs. ${debtAmount.toFixed(0)}. Please clear your debt before booking a new ride.`,
      debtAmount,
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

  let distance: number;
  let baseFare: number, gstAmount: number, platformFare: number;
  try {
    distance = calcDistance(pickupLat, pickupLng, dropLat, dropLng);
    const fareResult = await calcFare(distance, type);
    baseFare = fareResult.baseFare;
    gstAmount = fareResult.gstAmount;
    platformFare = fareResult.total;
  } catch (e: any) {
    res.status(422).json({ error: e.message }); return;
  }

  const bargainEnabled  = (s["ride_bargaining_enabled"] ?? "on") === "on";
  const bargainMinPct   = parseFloat(s["ride_bargaining_min_pct"] ?? "70");

  let isBargaining = false;
  let validatedOffer = 0;

  if (offeredFare !== undefined && bargainEnabled) {
    validatedOffer = offeredFare;
    const minOffer = Math.ceil(platformFare * (bargainMinPct / 100));
    if (validatedOffer < minOffer) {
      res.status(400).json({ error: `Minimum offer allowed is Rs. ${minOffer} (${bargainMinPct}% of platform fare)` }); return;
    }
    isBargaining = validatedOffer < platformFare;
  }

  const minOnline = parseFloat(s["payment_min_online"] ?? "50");
  const maxOnline = parseFloat(s["payment_max_online"] ?? "100000");
  const effectiveFare = isBargaining ? validatedOffer : platformFare;
  if (paymentMethod === "wallet" && (effectiveFare < minOnline || effectiveFare > maxOnline)) {
    res.status(400).json({ error: `Wallet payment must be between Rs. ${minOnline} and Rs. ${maxOnline}` }); return;
  }

  if (paymentMethod === "wallet") {
    const [wUser] = await db.select({ blockedServices: usersTable.blockedServices }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (wUser && (wUser.blockedServices || "").split(",").map(sv => sv.trim()).includes("wallet")) {
      res.status(403).json({ error: "wallet_frozen", message: "Your wallet has been temporarily frozen. Contact support." }); return;
    }
  }

  if (paymentMethod === "cash") {
    const riderCashAllowed = (s["rider_cash_allowed"] ?? "on") === "on";
    if (!riderCashAllowed) {
      res.status(400).json({ error: "Cash payment is currently not available for rides. Please use wallet." }); return;
    }
  }

  const rideStatus = isBargaining ? "bargaining" : "searching";
  const fareToCharge = isBargaining ? validatedOffer : platformFare;
  const fareToStore  = platformFare.toFixed(2);

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
        // NOTE: ride.id is unknown at this point; we patch the reference after insertion
        const rideId = generateId();
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit",
          amount: fareToCharge.toFixed(2),
          description: `${type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ")} ride payment`,
          reference: `ride:${rideId}`,
        });
        const [ride] = await tx.insert(ridesTable).values({
          id: rideId, userId, type, status: rideStatus,
          pickupAddress, dropAddress,
          pickupLat: String(pickupLat), pickupLng: String(pickupLng),
          dropLat: String(dropLat), dropLng: String(dropLng),
          fare: fareToStore, distance: (Math.round(distance * 10) / 10).toString(), paymentMethod,
          offeredFare: null, counterFare: null, bargainStatus: null, bargainRounds: 0,
        }).returning();
        return ride!;
      });
    } else {
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

    await db.insert(notificationsTable).values({
      id: generateId(), userId,
      title: isBargaining ? `Ride Offer Sent 💬` : `${type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ")} Ride Booked`,
      body: isBargaining
        ? `Aapka Rs. ${validatedOffer} ka offer send ho gaya. Rider respond karega.`
        : `Aapki ride book ho gayi. Rider dhundha ja raha hai. Fare: Rs. ${fareToCharge.toFixed(0)}`,
      type: "ride", icon: ({ bike: "bicycle-outline", car: "car-outline", rickshaw: "car-outline", daba: "bus-outline", school_shift: "bus-outline" } as Record<string, string>)[type] ?? "car-outline", link: `/ride`,
    }).catch(() => {});

    if (rideRecord) {
      broadcastRide(rideRecord.id);
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

router.patch("/:id/cancel", customerAuth, requireRideState(["searching", "bargaining", "accepted", "arrived", "in_transit"]), requireRideOwner("userId"), async (req, res) => {
  const userId = req.customerId!;
  const ride = req.ride!;
  const cancelParsed = cancelRideSchema.safeParse(req.body ?? {});
  if (!cancelParsed.success) {
    const msg = cancelParsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    res.status(422).json({ error: msg }); return;
  }
  const cancelReason = cancelParsed.data.reason ?? null;

  await cleanupNotifiedRiders(String(req.params["id"]));
  const s = await getPlatformSettings();
  const cancelFee = parseFloat(s["ride_cancellation_fee"] ?? "30");
  const riderAssigned = ["accepted", "arrived", "in_transit"].includes(ride.status);

  let actualCancelFee = 0;
  let cancelFeeAsDebt = false;

  // Determine if a wallet debit was actually made for this ride.
  // All wallet-paid rides (direct booking and bargain accept-bid) record
  // a debit with reference "ride:<id>" — check that authoritatively.
  let fareWasCharged = false;
  if (ride.paymentMethod === "wallet") {
    const rideRef = `ride:${ride.id}`;
    const [debitTx] = await db.select({ id: walletTransactionsTable.id })
      .from(walletTransactionsTable)
      .where(and(
        eq(walletTransactionsTable.userId, userId),
        eq(walletTransactionsTable.type, "debit"),
        eq(walletTransactionsTable.reference, rideRef),
      ))
      .limit(1);
    fareWasCharged = !!debitTx;
  }

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

    if (cancelFeeAsDebt) {
      const remainingDebt = cancelFee - actualCancelFee;
      await tx.update(usersTable)
        .set({ cancellationDebt: sql`cancellation_debt + ${remainingDebt}`, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
    }

    if (fareWasCharged) {
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

  if (fareWasCharged) {
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

router.patch("/:id/accept-bid", customerAuth, async (req, res) => {
  const parsed = acceptBidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "bidId required" }); return;
  }

  const userId = req.customerId!;
  const { bidId } = parsed.data;
  const rideId = String(req.params["id"]);

  let updated: any;
  try {
    updated = await db.transaction(async (tx) => {
      const [ride] = await tx.select().from(ridesTable)
        .where(eq(ridesTable.id, rideId))
        .for("update")
        .limit(1);

      if (!ride) throw new Error("Ride not found");
      if (ride.userId !== userId) throw new Error("Not your ride");
      if (ride.status !== "bargaining") throw new Error("Ride is not in bargaining state");

      const [bid] = await tx.select().from(rideBidsTable)
        .where(and(eq(rideBidsTable.id, bidId), eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending")))
        .limit(1);
      if (!bid) throw new Error("Bid not found or no longer pending");

      const agreedFare = parseFloat(bid.fare);

      if (ride.paymentMethod === "wallet") {
        const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (!user) throw new Error("User not found");
        const balance = parseFloat(user.walletBalance ?? "0");
        if (balance < agreedFare) throw new Error(`Insufficient wallet balance. Need Rs. ${agreedFare.toFixed(0)}`);
        await tx.update(usersTable).set({ walletBalance: (balance - agreedFare).toFixed(2) }).where(eq(usersTable.id, userId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(), userId, type: "debit", amount: agreedFare.toFixed(2),
          description: `Ride payment (bargained) — #${rideId.slice(-6).toUpperCase()}`,
          reference: `ride:${rideId}`,
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

      return { rideUpdate, bid };
    });
  } catch (e: any) {
    const status = e.message.includes("not found") ? 404
      : e.message.includes("Not your") ? 403
      : e.message.includes("not in bargaining") ? 400
      : 400;
    res.status(status).json({ error: e.message });
    return;
  }

  const { rideUpdate, bid } = updated;
  const agreedFare = parseFloat(bid.fare);

  await db.insert(notificationsTable).values({
    id: generateId(), userId: bid.riderId,
    title: "Aapka Bid Accept Ho Gaya! 🎉",
    body: `Customer ne aapka Rs. ${agreedFare.toFixed(0)} ka offer accept kar liya. Pickup ke liye jaayein!`,
    type: "ride", icon: "checkmark-circle-outline",
  }).catch(() => {});

  res.json({ ...formatRide(rideUpdate!), agreedFare });
});

router.patch("/:id/customer-counter", customerAuth, requireRideState(["bargaining"]), requireRideOwner("userId"), async (req, res) => {
  const parsed = customerCounterSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    res.status(422).json({ error: msg }); return;
  }

  const ride = req.ride!;
  const rideId = ride.id;
  const { offeredFare: newOffer, note } = parsed.data;

  const s = await getPlatformSettings();
  const bargainMinPct = parseFloat(s["ride_bargaining_min_pct"] ?? "70");
  const platformFare  = parseFloat(ride.fare);
  const minOffer      = Math.ceil(platformFare * (bargainMinPct / 100));
  if (newOffer < minOffer) {
    res.status(400).json({ error: `Minimum offer is Rs. ${minOffer}` }); return;
  }

  await db.update(rideBidsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(rideBidsTable.rideId, rideId), eq(rideBidsTable.status, "pending")));

  const currentRounds = ride.bargainRounds ?? 0;
  const [updated] = await db.update(ridesTable)
    .set({
      offeredFare:   newOffer.toFixed(2),
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

router.get("/", customerAuth, async (req, res) => {
  const userId = req.customerId!;
  const rides = await db.select().from(ridesTable).where(eq(ridesTable.userId, userId)).orderBy(ridesTable.createdAt);
  res.json({
    rides: rides.map(formatRide).reverse(),
    total: rides.length,
  });
});

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

router.get("/:id", async (req, res) => {
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

  const isCustomer = ride.userId  === callerId;
  const isRider    = ride.riderId === callerId;
  if (!isCustomer && !isRider) {
    res.status(403).json({ error: "Access denied — not your ride" }); return;
  }

  let riderName = ride.riderName;
  let riderPhone = ride.riderPhone;
  if (ride.riderId && !riderName) {
    const [riderUser] = await db.select({ name: usersTable.name, phone: usersTable.phone })
      .from(usersTable).where(eq(usersTable.id, ride.riderId)).limit(1);
    riderName  = riderUser?.name  || null;
    riderPhone = riderUser?.phone || null;
  }

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

router.get("/:id/track", async (req, res) => {
  const authHeader  = req.headers["authorization"] as string | undefined;
  const tokenHeader = req.headers["x-auth-token"]  as string | undefined;
  const raw = tokenHeader || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  if (!raw) { res.status(401).json({ error: "Authentication required" }); return; }
  const payload = verifyUserJwt(raw);
  if (!payload) { res.status(401).json({ error: "Invalid or expired session. Please log in again." }); return; }
  const callerId = payload.userId;

  const rideId = String(req.params["id"]);
  const [ride] = await db.select({
    id: ridesTable.id, status: ridesTable.status, riderId: ridesTable.riderId,
    userId: ridesTable.userId, pickupLat: ridesTable.pickupLat, pickupLng: ridesTable.pickupLng,
    dropLat: ridesTable.dropLat, dropLng: ridesTable.dropLng,
    pickupAddress: ridesTable.pickupAddress, dropAddress: ridesTable.dropAddress,
  }).from(ridesTable).where(eq(ridesTable.id, rideId)).limit(1);

  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }
  if (ride.userId !== callerId && ride.riderId !== callerId) {
    res.status(403).json({ error: "Access denied — not your ride" }); return;
  }

  let riderLat: number | null = null;
  let riderLng: number | null = null;
  let riderLocAge: number | null = null;
  let etaMinutes: number | null = null;

  // "Active trip" statuses: accepted (rider on way to pickup), arrived, in_transit (en route to drop)
  const TRACKABLE = ["accepted", "arrived", "in_transit"];
  if (ride.riderId && TRACKABLE.includes(ride.status)) {
    const [loc] = await db.select()
      .from(liveLocationsTable)
      .where(eq(liveLocationsTable.userId, ride.riderId))
      .limit(1);
    if (loc) {
      riderLat    = parseFloat(String(loc.latitude));
      riderLng    = parseFloat(String(loc.longitude));
      riderLocAge = Math.floor((Date.now() - new Date(loc.updatedAt).getTime()) / 1000);

      // Compute ETA: distance from rider to next destination / average speed
      const s = await getPlatformSettings();
      const avgSpeedKmh = parseFloat(s["dispatch_avg_speed_kmh"] ?? "25");
      const destinationLat = ride.status === "in_transit"
        ? (ride.dropLat  ? parseFloat(ride.dropLat)  : null)
        : (ride.pickupLat ? parseFloat(ride.pickupLat) : null);
      const destinationLng = ride.status === "in_transit"
        ? (ride.dropLng  ? parseFloat(ride.dropLng)  : null)
        : (ride.pickupLng ? parseFloat(ride.pickupLng) : null);

      if (destinationLat !== null && destinationLng !== null && avgSpeedKmh > 0) {
        try {
          const distKm = calcDistance(riderLat, riderLng, destinationLat, destinationLng);
          etaMinutes = Math.max(1, Math.round((distKm / avgSpeedKmh) * 60));
        } catch {
          etaMinutes = null;
        }
      }
    }
  }

  const dropLat  = ride.dropLat  ? parseFloat(ride.dropLat)  : null;
  const dropLng  = ride.dropLng  ? parseFloat(ride.dropLng)  : null;
  const pickLat  = ride.pickupLat ? parseFloat(ride.pickupLat) : null;
  const pickLng  = ride.pickupLng ? parseFloat(ride.pickupLng) : null;

  res.json({
    id: ride.id,
    status: ride.status,
    riderId: ride.riderId,
    pickupLat:     pickLat,
    pickupLng:     pickLng,
    dropLat:       dropLat,
    dropLng:       dropLng,
    pickupAddress: ride.pickupAddress,
    dropAddress:   ride.dropAddress,
    riderLat,
    riderLng,
    riderLocAge,
    etaMinutes,
    trackable: TRACKABLE.includes(ride.status),
  });
});

router.post("/:id/event-log", riderAuth, loadRide(), requireRideOwner("riderId"), async (req, res) => {
  const parsed = eventLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "event is required" });
    return;
  }

  const ride = req.ride!;
  const rideId = ride.id;
  const riderId = req.riderId!;
  const { event, lat, lng, notes } = parsed.data;

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

router.get("/:id/event-logs", async (req, res) => {
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

router.post("/:id/rate", customerAuth, requireRideState(["completed"]), requireRideOwner("userId"), async (req, res) => {
  const parsed = rateRideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.issues[0]?.message || "stars must be between 1 and 5" }); return;
  }

  const ride = req.ride!;
  const userId = req.customerId!;
  const rideId = ride.id;
  const { stars, comment } = parsed.data;

  if (!ride.riderId) { res.status(400).json({ error: "No rider assigned" }); return; }

  const existing = await db.select({ id: rideRatingsTable.id }).from(rideRatingsTable).where(eq(rideRatingsTable.rideId, rideId)).limit(1);
  if (existing.length > 0) { res.status(409).json({ error: "Already rated" }); return; }

  const [rating] = await db.insert(rideRatingsTable).values({
    id: generateId(),
    rideId,
    customerId: userId,
    riderId: ride.riderId,
    stars,
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

router.get("/:id/status", customerAuth, loadRide(), requireRideOwner("userId"), async (req, res) => {
  const ride = req.ride!;
  const rideId = ride.id;

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

router.get("/:id/dispatch-status", customerAuth, loadRide(), requireRideOwner("userId"), async (req, res) => {
  const ride = req.ride!;
  const rideId = ride.id;

  const s = await getPlatformSettings();
  const totalTimeoutSec = parseInt(s["dispatch_broadcast_timeout_sec"] ?? s["dispatch_request_timeout_sec"] ?? "120", 10);

  const [notifiedRow] = await db.select({ c: count() })
    .from(rideNotifiedRidersTable)
    .where(eq(rideNotifiedRidersTable.rideId, rideId));
  const notifiedCount = notifiedRow?.c ?? 0;

  const createdMs = new Date(ride.createdAt!).getTime();
  const elapsedSec = Math.round((Date.now() - createdMs) / 1000);
  const remainingSec = Math.max(0, totalTimeoutSec - elapsedSec);

  const maxLoops = parseInt(s["dispatch_max_loops"] ?? "3", 10);

  res.json({
    status: ride.status,
    notifiedRiders: notifiedCount,
    elapsedSec,
    remainingSec,
    totalTimeoutSec,
    attemptCount: notifiedCount,
    dispatchLoopCount: ride.dispatchLoopCount ?? 0,
    maxLoops,
  });
});

router.post("/:id/retry", customerAuth, requireRideState(["no_riders", "expired"]), requireRideOwner("userId"), async (req, res) => {
  const ride = req.ride!;
  const rideId = ride.id;

  await cleanupNotifiedRiders(rideId);

  await db.update(ridesTable).set({
    status: "searching",
    dispatchedRiderId: null,
    dispatchAttempts: [],
    dispatchLoopCount: 0,
    dispatchedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(ridesTable.id, rideId));

  broadcastRide(rideId);

  res.json({ success: true, message: "Dispatch restarted" });
});

let dispatchCycleRunning = false;
async function runDispatchCycle() {
  if (dispatchCycleRunning) return;
  dispatchCycleRunning = true;
  try {
    const s = await getPlatformSettings();
    const totalTimeoutSec = parseInt(s["dispatch_broadcast_timeout_sec"] ?? s["dispatch_request_timeout_sec"] ?? "120", 10);

    const pendingRides = await db.select().from(ridesTable)
      .where(and(
        or(eq(ridesTable.status, "searching"), eq(ridesTable.status, "bargaining")),
        isNull(ridesTable.riderId),
      ))
      .orderBy(asc(ridesTable.createdAt))
      .limit(50);

    if (pendingRides.length === 0) {
      await db.delete(rideNotifiedRidersTable)
        .where(sql`ride_id NOT IN (SELECT id FROM rides WHERE status IN ('searching', 'bargaining') AND rider_id IS NULL)`)
        .catch(() => {});
      return;
    }

    await db.delete(rideNotifiedRidersTable)
      .where(sql`ride_id NOT IN (SELECT id FROM rides WHERE status IN ('searching', 'bargaining') AND rider_id IS NULL)`)
      .catch(() => {});

    const DISPATCH_ROUND_INTERVAL_SEC = 45;
    const MAX_DISPATCH_ROUNDS = 3;

    for (const ride of pendingRides) {
      try {
        const createdMs = new Date(ride.createdAt!).getTime();
        const elapsedSec = (Date.now() - createdMs) / 1000;

        if (elapsedSec > totalTimeoutSec) {
          await db.update(ridesTable)
            .set({ status: "expired", updatedAt: new Date() })
            .where(and(eq(ridesTable.id, ride.id), isNull(ridesTable.riderId)));

          await db.insert(notificationsTable).values({
            id: generateId(),
            userId: ride.userId,
            title: "No Rider Found",
            body: "Koi rider available nahi mila. Please dubara try karein ya fare adjust karein.",
            type: "ride",
            icon: "close-circle-outline",
          }).catch(() => {});

          await cleanupNotifiedRiders(ride.id);
          continue;
        }

        // Dispatch in rounds: each round lasts DISPATCH_ROUND_INTERVAL_SEC seconds.
        // After MAX_DISPATCH_ROUNDS rounds with no acceptance, mark no_riders and stop.
        const currentRound = Math.floor(elapsedSec / DISPATCH_ROUND_INTERVAL_SEC);
        const loopCount = ride.dispatchLoopCount ?? 0;

        if (currentRound >= MAX_DISPATCH_ROUNDS && loopCount >= MAX_DISPATCH_ROUNDS) {
          await db.update(ridesTable)
            .set({ status: "no_riders", updatedAt: new Date() })
            .where(and(eq(ridesTable.id, ride.id), isNull(ridesTable.riderId)));
          await db.insert(notificationsTable).values({
            id: generateId(), userId: ride.userId,
            title: "No Riders Available",
            body: "Koi rider available nahi mila. Dobara try karein ya fare badhayein.",
            type: "ride", icon: "close-circle-outline",
          }).catch(() => {});
          await cleanupNotifiedRiders(ride.id);
          continue;
        }

        if (currentRound > loopCount) {
          // New round started — do NOT clear notified riders.
          // broadcastRide already skips riders in rideNotifiedRidersTable,
          // so new rounds naturally reach only newly-online/unnotified riders.
          await db.update(ridesTable)
            .set({ dispatchLoopCount: currentRound, updatedAt: new Date() })
            .where(and(eq(ridesTable.id, ride.id), isNull(ridesTable.riderId)));
        }

        await broadcastRide(ride.id);
      } catch (rideErr) {
        console.error(`[dispatch-engine] Error processing ride ${ride.id}:`, rideErr);
      }
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
