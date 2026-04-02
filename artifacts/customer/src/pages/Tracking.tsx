import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { X, Phone, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import { useSocket } from "../lib/socket";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const pickupMarker = L.divIcon({
  html: `<div style="width:24px;height:24px;background:#22c55e;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3)"></div>`,
  className: "", iconSize: [24, 24], iconAnchor: [12, 12],
});
const dropMarker = L.divIcon({
  html: `<div style="width:24px;height:24px;background:#ef4444;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3)"></div>`,
  className: "", iconSize: [24, 24], iconAnchor: [12, 12],
});
const riderMarker = L.divIcon({
  html: `<div style="width:36px;height:36px;background:#1d4ed8;border:3px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(29,78,216,0.5);font-size:18px">🏍</div>`,
  className: "", iconSize: [36, 36], iconAnchor: [18, 18],
});

function MapFly({ to }: { to: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (to) map.flyTo(to, 15, { duration: 1.2 });
  }, [to]);
  return null;
}

const STATUS_STEPS = [
  { key: "searching", label: "Searching for rider", icon: "🔍" },
  { key: "bargaining", label: "Bargaining in progress", icon: "💬" },
  { key: "accepted", label: "Rider assigned", icon: "✅" },
  { key: "arrived", label: "Rider arrived", icon: "🏁" },
  { key: "in_transit", label: "On the way", icon: "🚗" },
  { key: "completed", label: "Trip complete", icon: "🎉" },
];
const STATUS_RANK: Record<string, number> = { searching: 0, bargaining: 1, accepted: 2, arrived: 3, in_transit: 4, completed: 5 };

type Props = { rideId: string };

export default function Tracking({ rideId }: Props) {
  const [, nav] = useLocation();
  const [ride, setRide] = useState<any>(null);
  const [otp, setOtp] = useState<string | null>(null);
  const [riderLoc, setRiderLoc] = useState<[number, number] | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { socket } = useSocket();
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const loadRide = async () => {
    try {
      const d = await api.getRide(rideId);
      const r = d.ride ?? d;
      setRide(r);
      setError(null);
      if (r.status === "completed") nav(`/completed/${rideId}`);
      if (r.tripOtp) setOtp(r.tripOtp);
    } catch (e: any) {
      setError(e.message || "Failed to load ride");
    }
  };

  useEffect(() => {
    loadRide();
    pollRef.current = setInterval(loadRide, 8000);

    return () => {
      clearInterval(pollRef.current);
    };
  }, [rideId]);

  useEffect(() => {
    if (!socket) return;

    const handleOtp = (data: any) => {
      if (data.rideId === rideId) setOtp(data.otp);
    };
    const handleUpdate = (data: any) => {
      if (data.id === rideId || data.rideId === rideId) {
        loadRide();
      }
    };
    const handleLocation = (data: any) => {
      if (data.rideId === rideId && data.lat && data.lng) {
        setRiderLoc([parseFloat(data.lat), parseFloat(data.lng)]);
      }
    };

    socket.on("ride:otp", handleOtp);
    socket.on("ride:update", handleUpdate);
    socket.on("rider:location", handleLocation);
    socket.emit("join:ride", { rideId });

    return () => {
      socket.off("ride:otp", handleOtp);
      socket.off("ride:update", handleUpdate);
      socket.off("rider:location", handleLocation);
    };
  }, [socket, rideId]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await api.cancelRide(rideId);
      nav("/");
    } catch {
      setCancelling(false);
    }
  };

  if (error && !ride) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center px-6">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <p className="text-gray-900 font-bold text-lg mb-1">Failed to load ride</p>
          <p className="text-gray-500 text-sm mb-4">{error}</p>
          <button onClick={() => nav("/")} className="bg-green-500 text-white font-bold rounded-2xl px-6 py-3">
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (!ride) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 font-semibold">Loading ride…</p>
        </div>
      </div>
    );
  }

  const curStep = STATUS_RANK[ride.status] ?? 0;
  const mapCenter: [number, number] = riderLoc ?? [ride.pickupLat ?? 33.72, ride.pickupLng ?? 73.04];
  const canCancel = ["searching", "bargaining", "accepted"].includes(ride.status);
  const riderArrived = ride.status === "arrived";
  const inTransit = ride.status === "in_transit";

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-black text-gray-900">Tracking Ride</h1>
          <p className="text-xs text-gray-400">#{rideId.slice(-8).toUpperCase()}</p>
        </div>
        {canCancel && (
          <button onClick={() => setShowCancelConfirm(true)} className="flex items-center gap-1 text-xs font-bold text-red-500 bg-red-50 px-3 py-1.5 rounded-xl">
            <X size={12} /> Cancel
          </button>
        )}
      </div>

      {/* OTP Banner */}
      {(riderArrived || (otp && ride.status !== "in_transit" && ride.status !== "completed")) && otp && (
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-4 py-4 text-center">
          <p className="text-xs font-bold uppercase tracking-wide opacity-90 mb-1">🏁 Rider Arrived! Share this OTP</p>
          <div className="text-5xl font-black tracking-[0.5em] my-2">{otp}</div>
          <p className="text-xs opacity-80">Give this code to your rider to start the trip</p>
        </div>
      )}

      {/* Map */}
      <div style={{ height: 220 }}>
        <MapContainer center={mapCenter} zoom={14} style={{ height: "100%", width: "100%" }} zoomControl={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapFly to={riderLoc} />
          {ride.pickupLat && <Marker position={[ride.pickupLat, ride.pickupLng]} icon={pickupMarker} />}
          {ride.dropLat && <Marker position={[ride.dropLat, ride.dropLng]} icon={dropMarker} />}
          {riderLoc && <Marker position={riderLoc} icon={riderMarker} />}
          {ride.pickupLat && riderLoc && (
            <Polyline positions={[riderLoc, [ride.pickupLat, ride.pickupLng]]} color="#3b82f6" weight={3} dashArray="8,8" />
          )}
        </MapContainer>
      </div>

      {/* Status timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Current status card */}
        <div className={`rounded-2xl p-4 text-center shadow-sm ${inTransit ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white" : riderArrived ? "bg-gradient-to-r from-amber-400 to-orange-500 text-white" : "bg-white"}`}>
          <p className="text-3xl mb-1">{STATUS_STEPS[curStep]?.icon}</p>
          <p className={`font-black text-lg ${inTransit || riderArrived ? "" : "text-gray-900"}`}>{STATUS_STEPS[curStep]?.label ?? ride.status}</p>
          {ride.riderName && (
            <div className="flex items-center justify-center gap-2 mt-1">
              <p className={`text-sm ${inTransit || riderArrived ? "opacity-80" : "text-gray-500"}`}>Driver: {ride.riderName}</p>
              {ride.riderPhone && (
                <a href={`tel:${ride.riderPhone}`} className={`inline-flex items-center gap-1 text-sm font-semibold ${inTransit || riderArrived ? "text-white/90 hover:text-white" : "text-green-600 hover:text-green-700"}`}>
                  <Phone size={14} /> {ride.riderPhone}
                </a>
              )}
            </div>
          )}
        </div>

        {/* Status steps */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Trip Progress</p>
          {STATUS_STEPS.filter(s => s.key !== "bargaining").map((step, i) => {
            const rank = STATUS_RANK[step.key] ?? i;
            const done = curStep > rank;
            const active = curStep === rank;
            return (
              <div key={step.key} className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${done ? "bg-green-500 text-white" : active ? "bg-blue-500 text-white animate-pulse" : "bg-gray-100 text-gray-400"}`}>
                  {done ? "✓" : step.icon}
                </div>
                <span className={`text-sm font-semibold ${done ? "text-gray-400 line-through" : active ? "text-gray-900" : "text-gray-400"}`}>{step.label}</span>
              </div>
            );
          })}
        </div>

        {/* Ride details */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-2">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Ride Details</p>
          <div className="flex items-start gap-2 text-sm">
            <div className="w-2 h-2 bg-green-500 rounded-full mt-1 flex-shrink-0" />
            <span className="text-gray-700">{ride.pickupAddress}</span>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <div className="w-2 h-2 bg-red-500 rounded-full mt-1 flex-shrink-0" />
            <span className="text-gray-700">{ride.dropAddress}</span>
          </div>
          <div className="border-t border-gray-100 pt-2 flex justify-between">
            <span className="text-sm text-gray-500">Fare</span>
            <span className="font-black text-green-600">Rs. {parseFloat(ride.fare ?? "0").toFixed(0)}</span>
          </div>
          {ride.isParcel && (
            <div className="text-xs text-amber-600 font-bold bg-amber-50 rounded-lg px-2 py-1">
              📦 Parcel to {ride.receiverName} {ride.receiverPhone && `· ${ride.receiverPhone}`}
            </div>
          )}
        </div>

        {canCancel && (
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="w-full border-2 border-red-200 text-red-600 font-black rounded-2xl py-3 text-sm hover:bg-red-50 transition-colors"
          >
            Cancel Ride
          </button>
        )}
      </div>

      {/* Cancel confirm modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
            <p className="font-black text-xl text-gray-900">Cancel this ride?</p>
            <p className="text-sm text-gray-500">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowCancelConfirm(false)} className="flex-1 border-2 border-gray-200 font-bold rounded-2xl py-3 text-gray-600">Keep Ride</button>
              <button onClick={handleCancel} disabled={cancelling} className="flex-1 bg-red-500 text-white font-black rounded-2xl py-3 disabled:opacity-60">
                {cancelling ? "Cancelling…" : "Yes, Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
