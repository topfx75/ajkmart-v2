import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Clock, CheckCircle, XCircle, Package } from "lucide-react";
import { api } from "../lib/api";

const STATUS_COLOR: Record<string, string> = {
  completed: "text-green-600 bg-green-50",
  cancelled: "text-red-500 bg-red-50",
  in_transit: "text-blue-600 bg-blue-50",
  arrived: "text-amber-600 bg-amber-50",
  accepted: "text-indigo-600 bg-indigo-50",
  searching: "text-gray-600 bg-gray-100",
  bargaining: "text-orange-600 bg-orange-50",
};

const STATUS_ICON: Record<string, any> = {
  completed: CheckCircle,
  cancelled: XCircle,
};

export default function History() {
  const [, nav] = useLocation();
  const [rides, setRides] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMyRides()
      .then(d => setRides(Array.isArray(d) ? d : (d.rides ?? [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fmt = (v?: number | string) => v != null ? `Rs. ${parseFloat(String(v)).toFixed(0)}` : "—";
  const formatDate = (s?: string) => s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={() => nav("/")} className="text-gray-600 hover:text-gray-900">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-black text-gray-900">Ride History</h1>
      </div>

      <div className="px-4 py-4 space-y-3">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : rides.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🚗</p>
            <p className="text-gray-600 font-bold">No rides yet</p>
            <p className="text-gray-400 text-sm mt-1">Your ride history will appear here</p>
            <button onClick={() => nav("/")} className="mt-6 bg-green-500 text-white font-black rounded-2xl px-6 py-3">Book a Ride</button>
          </div>
        ) : (
          rides.map(r => {
            const Icon = STATUS_ICON[r.status];
            const active = !["completed", "cancelled"].includes(r.status);
            return (
              <button
                key={r.id}
                onClick={active ? () => nav(`/tracking/${r.id}`) : undefined}
                className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-left hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${STATUS_COLOR[r.status] ?? "bg-gray-100 text-gray-500"}`}>
                      {r.status.replace("_", " ")}
                    </span>
                    {r.isParcel && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1">
                        <Package size={8} /> Parcel
                      </span>
                    )}
                    {active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 animate-pulse">LIVE</span>}
                  </div>
                  <span className="font-black text-green-600 text-lg">{fmt(r.fare)}</span>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-gray-600 truncate flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-green-500 rounded-full inline-block flex-shrink-0" />
                    {r.pickupAddress}
                  </p>
                  <p className="text-xs text-gray-400 truncate flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-red-500 rounded-full inline-block flex-shrink-0" />
                    {r.dropAddress}
                  </p>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-gray-400 flex items-center gap-1">
                    <Clock size={10} /> {formatDate(r.createdAt)}
                  </span>
                  {r.distance && <span className="text-[10px] text-gray-400">{parseFloat(r.distance).toFixed(1)} km</span>}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
