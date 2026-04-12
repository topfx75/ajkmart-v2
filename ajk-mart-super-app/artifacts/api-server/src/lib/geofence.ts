import { db } from "@workspace/db";
import { serviceZonesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

/* ── Haversine distance in km ── */
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── In-process zone cache — refreshed every 2 minutes ── */
type ZoneRow = {
  id: number;
  name: string;
  city: string;
  lat: string;
  lng: string;
  radiusKm: string;
  appliesToRides: boolean;
  appliesToOrders: boolean;
  appliesToParcel: boolean;
};
let _zoneCache: ZoneRow[] = [];
let _zoneCacheAt = 0;
const ZONE_CACHE_TTL_MS = 2 * 60 * 1000;

async function getActiveZones(): Promise<ZoneRow[]> {
  if (Date.now() - _zoneCacheAt < ZONE_CACHE_TTL_MS) return _zoneCache;
  try {
    _zoneCache = await db
      .select({
        id:               serviceZonesTable.id,
        name:             serviceZonesTable.name,
        city:             serviceZonesTable.city,
        lat:              serviceZonesTable.lat,
        lng:              serviceZonesTable.lng,
        radiusKm:         serviceZonesTable.radiusKm,
        appliesToRides:   serviceZonesTable.appliesToRides,
        appliesToOrders:  serviceZonesTable.appliesToOrders,
        appliesToParcel:  serviceZonesTable.appliesToParcel,
      })
      .from(serviceZonesTable)
      .where(eq(serviceZonesTable.isActive, true));
    _zoneCacheAt = Date.now();
  } catch {
    /* On DB error, return stale cache so booking is not blocked */
  }
  return _zoneCache;
}

/** Invalidate the zone cache immediately (call after any admin CRUD on service_zones). */
export function invalidateZoneCache() {
  _zoneCacheAt = 0;
}

export type ServiceType = "rides" | "orders" | "parcel";

/**
 * Returns true when (lat, lng) falls inside at least one active service zone
 * that applies to the requested service type.
 *
 * If no active zones exist for the given service type the function returns
 * true (open-world: coverage is assumed when no zones are configured).
 */
export async function isInServiceZone(
  lat: number,
  lng: number,
  serviceType: ServiceType,
): Promise<{ allowed: boolean; zoneName?: string }> {
  const zones = await getActiveZones();

  const relevant = zones.filter(z => {
    if (serviceType === "rides")  return z.appliesToRides;
    if (serviceType === "orders") return z.appliesToOrders;
    if (serviceType === "parcel") return z.appliesToParcel;
    return true;
  });

  /* No zones configured for this service → open access */
  if (relevant.length === 0) return { allowed: true };

  for (const z of relevant) {
    const distKm = haversineKm(
      lat, lng,
      parseFloat(z.lat),
      parseFloat(z.lng),
    );
    if (distKm <= parseFloat(z.radiusKm)) {
      return { allowed: true, zoneName: z.name };
    }
  }

  return { allowed: false };
}
