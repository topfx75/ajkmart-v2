import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { MapPin, Navigation, Search, X, Package, ChevronDown, ChevronUp, Car, Bike } from "lucide-react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const pickupIcon = L.divIcon({
  html: `<div style="width:28px;height:28px;background:#22c55e;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:12px">📍</div>`,
  className: "", iconSize: [28, 28], iconAnchor: [14, 14],
});
const dropIcon = L.divIcon({
  html: `<div style="width:28px;height:28px;background:#ef4444;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:12px">🎯</div>`,
  className: "", iconSize: [28, 28], iconAnchor: [14, 14],
});

type LocResult = { lat: number; lng: number; display_name: string };

function MapClickHandler({ onPickup, onDrop, mode }: { onPickup: (l: LocResult) => void; onDrop: (l: LocResult) => void; mode: "pickup" | "drop" }) {
  useMapEvents({
    click: async (e) => {
      const { lat, lng } = e.latlng;
      const name = await api.reverseGeocode(lat, lng);
      const loc = { lat, lng, display_name: name };
      if (mode === "pickup") onPickup(loc);
      else onDrop(loc);
    },
  });
  return null;
}

const RIDE_TYPES = [
  { id: "bike", label: "Bike", icon: "🏍️", desc: "Fastest & cheapest" },
  { id: "auto", label: "Auto", icon: "🛺", desc: "Comfortable & affordable" },
  { id: "car", label: "Car", icon: "🚗", desc: "Premium & spacious" },
];

const PKG_TYPES = ["document", "food", "fragile", "clothing", "electronics", "other"];

export default function Booking() {
  const { user, logout } = useAuth();
  const [, nav] = useLocation();

  const [pickup, setPickup] = useState<LocResult | null>(null);
  const [drop, setDrop] = useState<LocResult | null>(null);
  const [mapMode, setMapMode] = useState<"pickup" | "drop">("pickup");
  const [mapCenter] = useState<[number, number]>([33.7215, 73.0433]);

  const [pickupQuery, setPickupQuery] = useState("");
  const [dropQuery, setDropQuery] = useState("");
  const [pickupResults, setPickupResults] = useState<LocResult[]>([]);
  const [dropResults, setDropResults] = useState<LocResult[]>([]);

  const [rideType, setRideType] = useState("car");
  const [estimate, setEstimate] = useState<any>(null);
  const [estimating, setEstimating] = useState(false);

  const [isBargaining, setIsBargaining] = useState(false);
  const [offeredFare, setOfferedFare] = useState("");

  const [isParcel, setIsParcel] = useState(false);
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [packageType, setPackageType] = useState("");
  const [showParcelFields, setShowParcelFields] = useState(false);

  const [booking, setBooking] = useState(false);
  const [err, setErr] = useState("");

  const pickupTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dropTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const searchPickup = (q: string) => {
    setPickupQuery(q);
    clearTimeout(pickupTimeout.current);
    if (q.length < 3) { setPickupResults([]); return; }
    pickupTimeout.current = setTimeout(async () => {
      const r = await api.geocode(q);
      setPickupResults(r.slice(0, 5));
    }, 400);
  };

  const searchDrop = (q: string) => {
    setDropQuery(q);
    clearTimeout(dropTimeout.current);
    if (q.length < 3) { setDropResults([]); return; }
    dropTimeout.current = setTimeout(async () => {
      const r = await api.geocode(q);
      setDropResults(r.slice(0, 5));
    }, 400);
  };

  const getEstimate = useCallback(async () => {
    if (!pickup || !drop) return;
    setEstimating(true);
    try {
      const d = await api.estimate({
        pickupLat: pickup.lat, pickupLng: pickup.lng,
        dropLat: drop.lat, dropLng: drop.lng, type: rideType,
      });
      setEstimate(d);
      setOfferedFare(String(Math.round(d.fare)));
    } catch {
    } finally {
      setEstimating(false);
    }
  }, [pickup, drop, rideType]);

  useEffect(() => { getEstimate(); }, [pickup, drop, rideType]);

  const handleBook = async () => {
    if (!pickup || !drop) { setErr("Select pickup and drop locations"); return; }
    if (!estimate) { setErr("Could not estimate fare"); return; }
    if (isParcel && !receiverName.trim()) { setErr("Enter receiver name"); return; }
    if (isBargaining && !(parseFloat(offeredFare) > 0)) { setErr("Offered fare must be greater than zero"); return; }
    setErr("");
    setBooking(true);
    try {
      const d = await api.bookRide({
        pickupLat: pickup.lat, pickupLng: pickup.lng,
        pickupAddress: pickup.display_name.slice(0, 200),
        dropLat: drop.lat, dropLng: drop.lng,
        dropAddress: drop.display_name.slice(0, 200),
        type: rideType, fare: estimate.fare,
        paymentMethod: "cash",
        isBargaining, offeredFare: isBargaining ? parseFloat(offeredFare) : undefined,
        isParcel, receiverName: isParcel ? receiverName : undefined,
        receiverPhone: isParcel ? receiverPhone : undefined,
        packageType: isParcel ? packageType : undefined,
      });
      nav(`/tracking/${d.ride?.id ?? d.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBooking(false);
    }
  };

  const fmt = (v?: number) => v != null ? `Rs. ${v.toFixed(0)}` : "…";

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🚗</span>
          <div>
            <h1 className="font-black text-gray-900 text-lg leading-none">AJKMart Rides</h1>
            <p className="text-xs text-gray-400">Hi, {user?.name || user?.phone}</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={() => nav("/wallet")} className="text-xs font-bold text-green-600 px-3 py-1.5 rounded-xl bg-green-50">💰 Wallet</button>
          <button onClick={() => nav("/history")} className="text-xs font-bold text-gray-500 px-3 py-1.5 rounded-xl bg-gray-100">History</button>
          <button onClick={() => nav("/profile")} className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition" title="Profile">
            {user?.avatar
              ? <img src={user.avatar} alt="" className="w-8 h-8 rounded-xl object-cover" />
              : <span className="text-sm font-bold text-gray-600">{(user?.name ?? user?.phone ?? "?")[0].toUpperCase()}</span>
            }
          </button>
        </div>
      </div>

      {/* Map */}
      <div className="relative" style={{ height: 240 }}>
        <MapContainer
          center={pickup ? [pickup.lat, pickup.lng] : mapCenter}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapClickHandler onPickup={l => { setPickup(l); setPickupQuery(l.display_name); }} onDrop={l => { setDrop(l); setDropQuery(l.display_name); }} mode={mapMode} />
          {pickup && <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon} />}
          {drop && <Marker position={[drop.lat, drop.lng]} icon={dropIcon} />}
        </MapContainer>
        <div className="absolute bottom-3 left-3 z-[1000] flex gap-2">
          <button onClick={() => setMapMode("pickup")} className={`text-xs font-bold px-3 py-1.5 rounded-full border-2 shadow ${mapMode === "pickup" ? "bg-green-500 text-white border-green-600" : "bg-white text-gray-700 border-gray-200"}`}>
            📍 Set Pickup
          </button>
          <button onClick={() => setMapMode("drop")} className={`text-xs font-bold px-3 py-1.5 rounded-full border-2 shadow ${mapMode === "drop" ? "bg-red-500 text-white border-red-600" : "bg-white text-gray-700 border-gray-200"}`}>
            🎯 Set Drop
          </button>
        </div>
      </div>

      {/* Booking form */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Pickup */}
        <div className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100">
          <label className="text-[10px] font-bold text-green-600 uppercase tracking-wide">📍 Pickup</label>
          <div className="relative">
            <input
              value={pickupQuery}
              onChange={e => searchPickup(e.target.value)}
              placeholder="Search pickup location…"
              className="w-full pt-1 text-sm font-semibold focus:outline-none placeholder:text-gray-400"
            />
            {pickupQuery && <button onClick={() => { setPickupQuery(""); setPickup(null); setPickupResults([]); }} className="absolute right-0 top-1"><X size={14} className="text-gray-400" /></button>}
          </div>
          {pickupResults.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-gray-100 pt-2">
              {pickupResults.map((r, i) => (
                <button key={i} onClick={() => { setPickup(r); setPickupQuery(r.display_name); setPickupResults([]); }}
                  className="w-full text-left text-xs text-gray-700 py-1.5 hover:text-green-600 flex items-start gap-2">
                  <MapPin size={12} className="shrink-0 mt-0.5 text-green-500" /> {r.display_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Drop */}
        <div className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100">
          <label className="text-[10px] font-bold text-red-500 uppercase tracking-wide">🎯 Drop</label>
          <div className="relative">
            <input
              value={dropQuery}
              onChange={e => searchDrop(e.target.value)}
              placeholder="Search drop location…"
              className="w-full pt-1 text-sm font-semibold focus:outline-none placeholder:text-gray-400"
            />
            {dropQuery && <button onClick={() => { setDropQuery(""); setDrop(null); setDropResults([]); }} className="absolute right-0 top-1"><X size={14} className="text-gray-400" /></button>}
          </div>
          {dropResults.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-gray-100 pt-2">
              {dropResults.map((r, i) => (
                <button key={i} onClick={() => { setDrop(r); setDropQuery(r.display_name); setDropResults([]); }}
                  className="w-full text-left text-xs text-gray-700 py-1.5 hover:text-red-500 flex items-start gap-2">
                  <Navigation size={12} className="shrink-0 mt-0.5 text-red-500" /> {r.display_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Ride type */}
        <div className="flex gap-2">
          {RIDE_TYPES.map(t => (
            <button key={t.id} onClick={() => setRideType(t.id)}
              className={`flex-1 rounded-2xl p-3 border-2 text-center transition-all ${rideType === t.id ? "border-green-500 bg-green-50" : "border-gray-200 bg-white"}`}>
              <span className="text-2xl block">{t.icon}</span>
              <span className="text-xs font-black block mt-1">{t.label}</span>
              <span className="text-[9px] text-gray-500 block">{t.desc}</span>
            </button>
          ))}
        </div>

        {/* Fare estimate */}
        {(pickup && drop) && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            {estimating ? (
              <div className="flex items-center gap-2 text-sm text-gray-500"><div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /> Estimating fare…</div>
            ) : estimate ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-semibold">Estimated Fare</span>
                  <span className="text-2xl font-black text-green-600">{fmt(estimate.fare)}</span>
                </div>
                {estimate.distance && (
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Distance</span>
                    <span className="font-semibold">{parseFloat(estimate.distance).toFixed(1)} km{estimate.distanceSource === "haversine" ? " (est.)" : ""}</span>
                  </div>
                )}
                {estimate.surgeMultiplier > 1 && (
                  <div className="text-xs text-orange-500 font-bold">⚡ {estimate.surgeMultiplier}x surge pricing active</div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Parcel toggle */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <button onClick={() => { setIsParcel(!isParcel); setShowParcelFields(!isParcel); }}
            className="w-full flex items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2 font-bold text-sm text-gray-700"><Package size={16} className="text-amber-500" /> Send a Parcel</span>
            <div className={`w-11 h-6 rounded-full transition-colors ${isParcel ? "bg-amber-500" : "bg-gray-200"} relative`}>
              <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isParcel ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
          </button>
          {isParcel && (
            <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Receiver Name *</label>
                <input value={receiverName} onChange={e => setReceiverName(e.target.value)} placeholder="John Doe"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-amber-400 focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Receiver Phone</label>
                <input type="tel" value={receiverPhone} onChange={e => setReceiverPhone(e.target.value)} placeholder="+91 98765 43210"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-amber-400 focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Package Type</label>
                <div className="flex flex-wrap gap-1.5">
                  {PKG_TYPES.map(p => (
                    <button key={p} onClick={() => setPackageType(p === packageType ? "" : p)}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${packageType === p ? "border-amber-400 bg-amber-50 text-amber-700" : "border-gray-200 text-gray-500"}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bargaining */}
        {estimate && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <button onClick={() => setIsBargaining(!isBargaining)}
              className="w-full flex items-center justify-between px-4 py-3">
              <span className="font-bold text-sm text-gray-700">💬 Offer Your Price (InDrive)</span>
              {isBargaining ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
            </button>
            {isBargaining && (
              <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Your Offer (Rs.)</label>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-black text-gray-400">Rs.</span>
                  <input
                    type="number"
                    value={offeredFare}
                    onChange={e => setOfferedFare(e.target.value)}
                    className="flex-1 text-2xl font-black border-2 border-orange-200 rounded-xl px-3 py-2 focus:border-orange-400 focus:outline-none"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1.5">Suggested: {fmt(estimate?.fare)} · Riders can accept or counter your offer</p>
              </div>
            )}
          </div>
        )}

        {err && <p className="text-red-500 text-sm font-medium text-center">{err}</p>}

        <button
          onClick={handleBook}
          disabled={!pickup || !drop || !estimate || booking}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white font-black rounded-2xl py-4 text-lg disabled:opacity-50 shadow-lg shadow-green-200 transition-opacity sticky bottom-4"
        >
          {booking ? "Booking…" : isBargaining ? `Offer ${offeredFare ? `Rs. ${offeredFare}` : "…"} to Riders` : `Book for ${estimate ? fmt(estimate.fare) : "…"}`}
        </button>
      </div>
    </div>
  );
}
