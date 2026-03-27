import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera } from "lucide-react";
import { api } from "../lib/api";
import { useState, useRef, useEffect } from "react";
import { usePlatformConfig } from "../lib/useConfig";

function useElapsedTimer(startIso?: string | null) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startIso) return;
    const base = new Date(startIso).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - base) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startIso]);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const label = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  const urgent = elapsed > 1800;
  return { label, elapsed, urgent };
}

function formatCurrency(n: number) { return `Rs. ${Math.round(n).toLocaleString()}`; }

function ElapsedBadge({ startIso }: { startIso?: string | null }) {
  const { label, urgent } = useElapsedTimer(startIso);
  if (!startIso) return null;
  return (
    <div className={`flex flex-col items-center px-3 py-2 rounded-2xl ${urgent ? "bg-red-500/80" : "bg-white/20"}`}>
      <span className="text-white text-[10px] font-bold uppercase tracking-wider">Time</span>
      <span className={`text-white font-extrabold text-base leading-tight ${urgent ? "animate-pulse" : ""}`}>{label}</span>
    </div>
  );
}

function NavButton({ label, lat, lng, address, color = "blue" }: {
  label: string; lat?: number | null; lng?: number | null; address?: string | null; color?: "blue" | "green" | "orange";
}) {
  const href = lat && lng
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
    : address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;
  if (!href) return null;
  const colors = {
    blue:   "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100",
    green:  "bg-green-50 border-green-200 text-green-700 hover:bg-green-100",
    orange: "bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100",
  };
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className={`flex items-center justify-center gap-1.5 border text-sm font-bold px-4 py-2.5 rounded-xl transition-colors ${colors[color]}`}>
      🗺️ {label}
    </a>
  );
}

function CallButton({ name, phone, label }: { name?: string | null; phone?: string | null; label?: string }) {
  if (!phone) return null;
  return (
    <a href={`tel:${phone}`}
      className="flex items-center justify-center gap-1.5 bg-green-50 border border-green-200 text-green-700 text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-green-100 transition-colors">
      📞 {label || `Call ${name || "Customer"}`}
    </a>
  );
}

/* ── Order Progress Steps ── */
const ORDER_STEPS  = ["store",    "picked_up",  "delivered"];
const ORDER_LABELS = ["Go to Store", "Picked Up", "Delivered"];
const ORDER_ICONS  = ["🏪",        "📦",         "✅"];

/* ── Ride Progress Steps ── */
const RIDE_STEPS  = ["accepted", "arrived", "in_transit", "completed"];
const RIDE_LABELS = ["Accepted", "At Pickup", "In Transit", "Done"];

export default function Active() {
  const qc = useQueryClient();
  const { config } = usePlatformConfig();
  const [toastMsg, setToastMsg]   = useState("");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelTarget, setCancelTarget]           = useState<"order" | "ride">("ride");
  const [orderPickedUp, _setOrderPickedUp]         = useState(() => sessionStorage.getItem("orderPickedUp") === "true");
  const setOrderPickedUp = (v: boolean) => { _setOrderPickedUp(v); sessionStorage.setItem("orderPickedUp", String(v)); };
  const [proofPhoto, setProofPhoto]               = useState<string | null>(null);
  const [proofFileName, setProofFileName]         = useState<string>("");
  const photoInputRef                             = useRef<HTMLInputElement>(null);

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => { setProofPhoto(ev.target?.result as string); };
    reader.readAsDataURL(file);
  };

  const showToast = (msg: string) => { setToastMsg(msg); setTimeout(() => setToastMsg(""), 3000); };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["rider-active"],
    queryFn: () => api.getActive(),
    refetchInterval: 8000,
  });

  const updateOrderMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.updateOrder(id, status),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      qc.invalidateQueries({ queryKey: ["rider-history"] });
      qc.invalidateQueries({ queryKey: ["rider-earnings"] });
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      if (vars.status === "delivered") {
        sessionStorage.removeItem("orderPickedUp");
        setProofPhoto(null);
        showToast("🎉 Order delivered! Earnings credited.");
      } else if (vars.status === "cancelled") {
        sessionStorage.removeItem("orderPickedUp");
        setProofPhoto(null);
        setShowCancelConfirm(false);
        showToast("Order cancel ho gaya. Customer ko naya rider milega.");
      } else {
        showToast("✅ Status updated!");
      }
    },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const updateRideMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.updateRide(id, status),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rider-active"] });
      qc.invalidateQueries({ queryKey: ["rider-history"] });
      qc.invalidateQueries({ queryKey: ["rider-earnings"] });
      qc.invalidateQueries({ queryKey: ["rider-requests"] });
      if (vars.status === "completed") showToast("🎉 Ride completed! Earnings credited.");
      else if (vars.status === "cancelled") { setShowCancelConfirm(false); showToast("Ride cancel ho gaya."); }
      else showToast("✅ Status updated!");
    },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  if (isLoading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-gray-500 font-medium">Loading active task...</p>
      </div>
    </div>
  );

  const order = data?.order;
  const ride  = data?.ride;

  if (!order && !ride) return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-gradient-to-br from-green-600 to-emerald-700 px-5 pt-12 pb-6">
        <h1 className="text-2xl font-bold text-white">Active Task</h1>
        <p className="text-green-200 text-sm">No current assignment</p>
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-7xl mb-4">🏍️</p>
          <h2 className="text-xl font-bold text-gray-700">No Active Task</h2>
          <p className="text-gray-400 mt-2 text-sm">Accept an order or ride from the Home tab to get started</p>
          <button onClick={() => refetch()}
            className="mt-5 bg-green-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold">
            ↻ Refresh
          </button>
        </div>
      </div>
    </div>
  );

  /* ── Order UI step (local state) ── */
  const orderStep = orderPickedUp ? 1 : 0;

  /* ── Ride progress ── */
  const rideStep = ride ? RIDE_STEPS.indexOf(ride.status) : -1;

  /* ── Elapsed timer ── */
  const startedAt = order?.acceptedAt || order?.updatedAt || ride?.acceptedAt || ride?.updatedAt || null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-green-600 to-emerald-700 px-5 pt-12 pb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Active {order ? "Delivery" : "Ride"}</h1>
            <p className="text-green-200 text-sm mt-0.5">
              {order ? `${order.type} order — ${orderPickedUp ? "Delivering to customer" : "Pick up from store"}` : `${ride?.type} ride in progress`}
            </p>
          </div>
          <ElapsedBadge startIso={startedAt}/>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* ═══════════════════════════════════════════════════ */}
        {/* ── ACTIVE ORDER ── */}
        {/* ═══════════════════════════════════════════════════ */}
        {order && (
          <>
            {/* Order Header Card */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-xl">
                  {order.type === "food" ? "🍔" : order.type === "mart" ? "🛒" : "📦"}
                </div>
                <div className="flex-1">
                  <p className="font-bold text-white capitalize">{order.type} Order</p>
                  <p className="text-blue-200 text-xs font-mono">#{order.id.slice(-6).toUpperCase()}</p>
                </div>
                <div className="text-right">
                  <p className="font-extrabold text-white text-lg">{formatCurrency(order.total)}</p>
                  <p className="text-blue-200 text-xs">Your cut: {formatCurrency(order.total * (config.finance.riderEarningPct / 100))}</p>
                </div>
              </div>

              {/* Order Progress Bar */}
              <div className="px-4 pt-4 pb-2">
                <div className="flex items-center justify-between">
                  {ORDER_LABELS.map((label, i) => (
                    <div key={i} className="flex flex-col items-center gap-1 flex-1">
                      <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm transition-all
                        ${i <= orderStep ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-300 text-gray-300"}`}>
                        {i < orderStep ? "✓" : ORDER_ICONS[i]}
                      </div>
                      <p className={`text-[9px] font-bold text-center leading-tight ${i <= orderStep ? "text-blue-600" : "text-gray-400"}`}>{label}</p>
                      {i < ORDER_LABELS.length - 1 && (
                        <div className={`hidden`}/>
                      )}
                    </div>
                  ))}
                </div>
                {/* connector line */}
                <div className="relative -mt-7 mb-5 mx-8 h-0.5 bg-gray-200 rounded-full" style={{marginTop: "-2.2rem"}}>
                  <div className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${orderStep === 0 ? 0 : orderStep === 1 ? 50 : 100}%` }} />
                </div>
              </div>
            </div>

            {/* STEP 1: Go to Store */}
            {!orderPickedUp && (
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-orange-50 px-4 py-2.5 border-b border-orange-100">
                  <p className="text-xs font-bold text-orange-600 uppercase tracking-wide">📍 Step 1 — Go to Store</p>
                </div>
                <div className="p-4 space-y-3">
                  <div className="bg-orange-50 border border-orange-100 rounded-xl p-3">
                    <p className="text-xs text-orange-500 font-bold mb-1">🏪 Vendor / Store</p>
                    <p className="text-base font-bold text-gray-900">{order.vendorStoreName || "Store"}</p>
                    {order.vendorPhone && (
                      <p className="text-xs text-gray-500 mt-0.5">📞 {order.vendorPhone}</p>
                    )}
                  </div>

                  {/* Items Preview */}
                  {order.items && Array.isArray(order.items) && order.items.length > 0 && (
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-xs text-gray-500 font-bold mb-2">Items to Collect ({order.items.length})</p>
                      <div className="space-y-1">
                        {order.items.slice(0, 5).map((item: any, i: number) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span className="text-gray-700">{item.name} × {item.quantity}</span>
                            <span className="font-semibold text-gray-800">{formatCurrency(item.price * item.quantity)}</span>
                          </div>
                        ))}
                        {order.items.length > 5 && (
                          <p className="text-xs text-gray-400 mt-1">+{order.items.length - 5} more items</p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <NavButton label="Go to Store" address={order.vendorStoreName} color="orange" />
                    {order.vendorPhone && <CallButton phone={order.vendorPhone} label="Call Store" name={order.vendorStoreName} />}
                  </div>

                  <button
                    onClick={() => setOrderPickedUp(true)}
                    className="w-full bg-blue-600 text-white font-extrabold rounded-xl py-3.5 text-base">
                    📦 I've Picked Up the Order →
                  </button>

                  {/* Cancel Order */}
                  <button
                    onClick={() => { setCancelTarget("order"); setShowCancelConfirm(true); }}
                    className="w-full border border-red-200 text-red-500 text-sm font-bold rounded-xl py-2.5 bg-red-50">
                    ✕ Can't Pick Up — Cancel Order
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Deliver to Customer */}
            {orderPickedUp && (
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-green-50 px-4 py-2.5 border-b border-green-100">
                  <p className="text-xs font-bold text-green-600 uppercase tracking-wide">🚗 Step 2 — Deliver to Customer</p>
                </div>
                <div className="p-4 space-y-3">
                  {/* Customer info */}
                  {order.customerName && (
                    <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 flex items-center gap-2">
                      <span className="text-xl">👤</span>
                      <div>
                        <p className="text-xs text-blue-500 font-bold">Customer</p>
                        <p className="text-sm font-bold text-gray-800">{order.customerName}</p>
                        {order.customerPhone && <p className="text-xs text-gray-500">{order.customerPhone}</p>}
                      </div>
                    </div>
                  )}

                  {/* Delivery Address */}
                  <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                    <p className="text-xs text-red-500 font-bold mb-1">🔴 Delivery Address</p>
                    <p className="text-sm font-bold text-gray-900">{order.deliveryAddress || "Address not provided"}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <NavButton label="Navigate" address={order.deliveryAddress} color="blue" />
                    <CallButton name={order.customerName} phone={order.customerPhone} />
                  </div>

                  {/* ── Proof of Delivery ── */}
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                    <p className="text-xs font-bold text-blue-700 mb-2 flex items-center gap-1.5">
                      <Camera className="w-3.5 h-3.5" /> Proof of Delivery (Recommended)
                    </p>
                    {proofPhoto ? (
                      <div className="space-y-2">
                        <div className="relative rounded-xl overflow-hidden h-40 bg-gray-100">
                          <img src={proofPhoto} alt="Delivery proof" className="w-full h-full object-cover" />
                          <div className="absolute top-2 right-2">
                            <span className="bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">✓ Photo Ready</span>
                          </div>
                        </div>
                        <button onClick={() => { setProofPhoto(null); setProofFileName(""); }}
                          className="w-full text-xs text-blue-600 font-bold py-1.5 border border-blue-200 rounded-lg bg-white">
                          📷 Retake Photo
                        </button>
                      </div>
                    ) : (
                      <div>
                        <input
                          ref={photoInputRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={handlePhotoCapture}
                        />
                        <button
                          onClick={() => photoInputRef.current?.click()}
                          className="w-full border-2 border-dashed border-blue-200 rounded-xl py-4 flex flex-col items-center gap-2 bg-white text-blue-500 hover:bg-blue-50 transition-colors">
                          <Camera className="w-6 h-6" />
                          <span className="text-xs font-bold">Take Delivery Photo</span>
                          <span className="text-[10px] text-blue-400">Opens camera on your phone</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      updateOrderMut.mutate({ id: order.id, status: "delivered" });
                    }}
                    disabled={updateOrderMut.isPending}
                    className={`w-full font-extrabold rounded-xl py-3.5 text-lg disabled:opacity-60 transition-colors ${proofPhoto ? "bg-green-600 text-white" : "bg-green-500 text-white"}`}>
                    {updateOrderMut.isPending ? "Updating..." : proofPhoto ? "✅ Confirm Delivery with Proof" : "✅ Mark as Delivered"}
                  </button>

                  <button
                    onClick={() => setOrderPickedUp(false)}
                    className="w-full border border-gray-200 text-gray-500 text-sm font-bold rounded-xl py-2 bg-white">
                    ← Back to Store Step
                  </button>

                  {/* Cancel Order */}
                  <button
                    onClick={() => { setCancelTarget("order"); setShowCancelConfirm(true); }}
                    disabled={updateOrderMut.isPending}
                    className="w-full border border-red-200 text-red-500 text-sm font-bold rounded-xl py-2.5 bg-red-50">
                    ✕ Cannot Deliver — Cancel Order
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/* ── ACTIVE RIDE ── */}
        {/* ═══════════════════════════════════════════════════ */}
        {ride && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-green-600 to-emerald-600 px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-xl">
                {ride.type === "bike" ? "🏍️" : "🚗"}
              </div>
              <div className="flex-1">
                <p className="font-bold text-white capitalize">{ride.type} Ride</p>
                <p className="text-green-200 text-xs font-mono">#{ride.id.slice(-6).toUpperCase()} · {ride.distance}km</p>
              </div>
              <div className="text-right">
                <p className="font-extrabold text-white text-lg">{formatCurrency(ride.fare)}</p>
                <p className="text-green-200 text-xs">Your cut: {formatCurrency(ride.fare * (config.finance.riderEarningPct / 100))}</p>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* Ride Progress Bar */}
              {rideStep >= 0 && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <div className="flex justify-between mb-3">
                    {RIDE_LABELS.map((label, i) => (
                      <div key={i} className="flex flex-col items-center gap-1">
                        <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[11px] font-bold transition-all
                          ${i <= rideStep ? "bg-green-600 border-green-600 text-white" : "bg-white border-gray-300 text-gray-300"}`}>
                          {i < rideStep ? "✓" : i + 1}
                        </div>
                        <p className={`text-[9px] font-bold text-center ${i <= rideStep ? "text-green-600" : "text-gray-400"}`}>{label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="relative h-1.5 bg-gray-200 rounded-full">
                    <div className="absolute top-0 left-0 h-full bg-green-500 rounded-full transition-all duration-500"
                      style={{ width: `${rideStep < 0 ? 0 : (rideStep / (RIDE_STEPS.length - 1)) * 100}%` }} />
                  </div>
                </div>
              )}

              {/* Pickup → Drop route */}
              <div className="bg-green-50 rounded-xl p-3">
                <p className="text-xs text-green-600 font-bold mb-1">🟢 PICKUP</p>
                <p className="text-sm font-semibold text-gray-800">{ride.pickupAddress}</p>
              </div>
              <div className="text-center text-gray-400 text-xl font-bold">↓</div>
              <div className="bg-red-50 rounded-xl p-3">
                <p className="text-xs text-red-600 font-bold mb-1">🔴 DROP</p>
                <p className="text-sm font-semibold text-gray-800">{ride.dropAddress}</p>
              </div>

              {/* Customer Info */}
              {ride.customerName && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 flex items-center gap-2">
                  <span className="text-xl">👤</span>
                  <div className="flex-1">
                    <p className="text-xs text-blue-500 font-bold">Passenger</p>
                    <p className="text-sm font-bold text-gray-800">{ride.customerName}</p>
                    {ride.customerPhone && <p className="text-xs text-gray-500">{ride.customerPhone}</p>}
                  </div>
                </div>
              )}

              {/* Navigation + Call */}
              <div className="grid grid-cols-2 gap-2">
                {ride.status === "accepted" ? (
                  <NavButton label="Go to Pickup" lat={ride.pickupLat} lng={ride.pickupLng} address={ride.pickupAddress} color="orange" />
                ) : (
                  <NavButton label="Go to Drop" lat={ride.dropLat} lng={ride.dropLng} address={ride.dropAddress} color="blue" />
                )}
                <CallButton name={ride.customerName} phone={ride.customerPhone} />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1">
                {ride.status === "accepted" && (
                  <button
                    onClick={() => updateRideMut.mutate({ id: ride.id, status: "arrived" })}
                    disabled={updateRideMut.isPending}
                    className="flex-1 bg-purple-600 text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60">
                    📍 I'm at Pickup
                  </button>
                )}
                {ride.status === "arrived" && (
                  <button
                    onClick={() => updateRideMut.mutate({ id: ride.id, status: "in_transit" })}
                    disabled={updateRideMut.isPending}
                    className="flex-1 bg-blue-600 text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60">
                    🚗 Start Ride
                  </button>
                )}
                {ride.status === "in_transit" && (
                  <button
                    onClick={() => updateRideMut.mutate({ id: ride.id, status: "completed" })}
                    disabled={updateRideMut.isPending}
                    className="flex-1 bg-green-600 text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60">
                    ✅ Complete Ride
                  </button>
                )}
                {/* Cancel button for rides (not completed) */}
                {(ride.status === "accepted" || ride.status === "arrived" || ride.status === "in_transit") && (
                  <button
                    onClick={() => { setCancelTarget("ride"); setShowCancelConfirm(true); }}
                    disabled={updateRideMut.isPending}
                    className="px-4 bg-red-50 text-red-600 font-bold rounded-xl py-3.5 text-sm border border-red-200">
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Cancel Confirmation Dialog ─── */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="bg-red-50 px-6 py-5 flex flex-col items-center gap-3 border-b border-red-100">
              <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-7 h-7 text-red-600" />
              </div>
              <div className="text-center">
                <p className="font-bold text-gray-900 text-lg">Cancel {cancelTarget === "order" ? "Delivery" : "Ride"}?</p>
                <p className="text-sm text-gray-500 mt-1">Yeh action reversible nahi hai.</p>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-xs text-amber-800 font-medium">⚠️ Sirf emergency mein cancel karein. Zyada cancellations se account par ban lag sakta hai.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 h-12 bg-gray-100 text-gray-700 font-bold rounded-xl">
                  Wapas Jao
                </button>
                <button
                  onClick={() => {
                    setShowCancelConfirm(false);
                    if (cancelTarget === "order" && order) {
                      updateOrderMut.mutate({ id: order.id, status: "cancelled" });
                    } else if (cancelTarget === "ride" && ride) {
                      updateRideMut.mutate({ id: ride.id, status: "cancelled" });
                    }
                  }}
                  disabled={updateOrderMut.isPending || updateRideMut.isPending}
                  className="flex-1 h-12 bg-red-600 text-white font-bold rounded-xl disabled:opacity-60">
                  {(updateOrderMut.isPending || updateRideMut.isPending) ? "Cancelling..." : "Haan, Cancel Karo"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-6 left-4 right-4 z-50 bg-gray-900 text-white text-sm font-medium px-4 py-3 rounded-2xl shadow-2xl text-center">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
