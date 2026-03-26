import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable, platformSettingsTable, ridesTable, usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id.js";
import { getPlatformSettings } from "./admin.js";

const router: IRouter = Router();

function calcDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function calcFare(distance: number, type: string): Promise<number> {
  const settings = await getPlatformSettings();
  const baseRate = type === "bike"
    ? parseFloat(settings["ride_bike_base_fare"] ?? "15")
    : parseFloat(settings["ride_car_base_fare"] ?? "25");
  const perKm = type === "bike"
    ? parseFloat(settings["ride_bike_per_km"] ?? "8")
    : parseFloat(settings["ride_car_per_km"] ?? "12");
  return Math.round(baseRate + distance * perKm);
}

router.post("/estimate", async (req, res) => {
  const { pickupLat, pickupLng, dropLat, dropLng, type } = req.body;
  const distance = calcDistance(pickupLat, pickupLng, dropLat, dropLng);
  const fare = await calcFare(distance, type);
  const duration = `${Math.round(distance * 3 + 5)} min`;
  res.json({ distance: Math.round(distance * 10) / 10, fare, duration, type });
});

router.post("/", async (req, res) => {
  const { userId, type, pickupAddress, dropAddress, pickupLat, pickupLng, dropLat, dropLng, paymentMethod } = req.body;

  if (!userId || !type || !paymentMethod) {
    res.status(400).json({ error: "userId, type, and paymentMethod are required" }); return;
  }

  const s = await getPlatformSettings();

  // Feature flag check
  const ridesEnabled = (s["feature_rides"] ?? "on") === "on";
  if (!ridesEnabled) {
    res.status(503).json({ error: "Ride booking is currently disabled" }); return;
  }

  const distance = pickupLat && dropLat ? calcDistance(pickupLat, pickupLng, dropLat, dropLng) : 5;
  const fare = await calcFare(distance, type);

  // Wallet payment → deduct atomically inside DB transaction (prevents race condition)
  if (paymentMethod === "wallet") {
    const walletEnabled = (s["feature_wallet"] ?? "on") === "on";
    if (!walletEnabled) {
      res.status(400).json({ error: "Wallet payments are currently disabled" }); return;
    }

    try {
      const rideResult = await db.transaction(async (tx) => {
        const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (!user) throw new Error("User not found");

        const balance = parseFloat(user.walletBalance ?? "0");
        if (balance < fare) throw new Error(`Insufficient wallet balance. Balance: Rs. ${balance.toFixed(0)}, Required: Rs. ${fare}`);

        const newBalance = (balance - fare).toFixed(2);
        await tx.update(usersTable).set({ walletBalance: newBalance }).where(eq(usersTable.id, userId));
        await tx.insert(walletTransactionsTable).values({
          id: generateId(),
          userId,
          type: "debit",
          amount: fare.toFixed(2),
          description: `${type === "bike" ? "Bike" : "Car"} ride payment`,
        });

        const [ride] = await tx.insert(ridesTable).values({
          id: generateId(),
          userId,
          type,
          status: "searching",
          pickupAddress,
          dropAddress,
          pickupLat: pickupLat?.toString(),
          pickupLng: pickupLng?.toString(),
          dropLat: dropLat?.toString(),
          dropLng: dropLng?.toString(),
          fare: fare.toString(),
          distance: Math.round(distance * 10 / 10).toString(),
          paymentMethod,
        }).returning();
        return ride!;
      });

      await db.insert(notificationsTable).values({
        id: generateId(),
        userId,
        title: `${type === "bike" ? "Bike" : "Car"} Ride Booked`,
        body: `Aapki ride book ho gayi. Rider dhundha ja raha hai. Fare: Rs. ${fare}`,
        type: "ride",
        icon: type === "bike" ? "bicycle-outline" : "car-outline",
        link: `/ride`,
      }).catch(() => {});

      res.status(201).json({
        ...rideResult,
        fare: parseFloat(rideResult.fare),
        distance: parseFloat(rideResult.distance),
        createdAt: rideResult.createdAt.toISOString(),
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
    return;
  }

  // Cash payment — no wallet deduction
  const [ride] = await db.insert(ridesTable).values({
    id: generateId(),
    userId,
    type,
    status: "searching",
    pickupAddress,
    dropAddress,
    pickupLat: pickupLat?.toString(),
    pickupLng: pickupLng?.toString(),
    dropLat: dropLat?.toString(),
    dropLng: dropLng?.toString(),
    fare: fare.toString(),
    distance: Math.round(distance * 10 / 10).toString(),
    paymentMethod,
  }).returning();

  await db.insert(notificationsTable).values({
    id: generateId(),
    userId,
    title: `${type === "bike" ? "Bike" : "Car"} Ride Booked`,
    body: `Aapki ride book ho gayi. Rider dhundha ja raha hai. Fare: Rs. ${fare}`,
    type: "ride",
    icon: type === "bike" ? "bicycle-outline" : "car-outline",
    link: `/ride`,
  }).catch(() => {});

  res.status(201).json({
    ...ride!,
    fare: parseFloat(ride!.fare),
    distance: parseFloat(ride!.distance),
    createdAt: ride!.createdAt.toISOString(),
  });
});

router.get("/", async (req, res) => {
  const userId = req.query["userId"] as string;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  const rides = await db.select().from(ridesTable).where(eq(ridesTable.userId, userId)).orderBy(ridesTable.createdAt);
  res.json({
    rides: rides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
    })).reverse(),
    total: rides.length,
  });
});

router.get("/:id", async (req, res) => {
  const [ride] = await db.select().from(ridesTable).where(eq(ridesTable.id, req.params["id"]!)).limit(1);
  if (!ride) {
    res.status(404).json({ error: "Ride not found" });
    return;
  }
  res.json({
    ...ride,
    fare: parseFloat(ride.fare),
    distance: parseFloat(ride.distance),
    createdAt: ride.createdAt.toISOString(),
  });
});

export default router;
