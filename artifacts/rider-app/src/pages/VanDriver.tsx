import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bus, Users, CheckCircle, MapPin, Clock, Calendar, ChevronRight, AlertCircle } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useState } from "react";

interface VanSchedule {
  id: string;
  routeId: string;
  departureTime: string;
  returnTime?: string;
  routeName?: string;
  routeFrom?: string;
  routeTo?: string;
  totalSeats?: number;
  date: string;
  bookedCount: number;
  bookedSeats: number[];
}

interface Passenger {
  id: string;
  seatNumbers: number[];
  status: string;
  passengerName?: string;
  passengerPhone?: string;
  paymentMethod: string;
  fare: string;
  boardedAt?: string;
  userName?: string;
  userPhone?: string;
}

async function fetchTodaySchedules(): Promise<VanSchedule[]> {
  const data = await apiFetch("/van/driver/today");
  return data ?? [];
}

async function fetchPassengers(scheduleId: string, date: string): Promise<Passenger[]> {
  const data = await apiFetch(`/van/driver/schedules/${scheduleId}/date/${date}/passengers`);
  return data ?? [];
}

async function markBoarded(bookingId: string): Promise<void> {
  await apiFetch(`/van/driver/bookings/${bookingId}/board`, { method: "PATCH", body: JSON.stringify({}) });
}

async function completeTrip(scheduleId: string, date: string): Promise<void> {
  await apiFetch(`/van/driver/schedules/${scheduleId}/date/${date}/complete`, { method: "PATCH", body: JSON.stringify({}) });
}

const STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-blue-100 text-blue-700",
  boarded:   "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  completed: "bg-gray-100 text-gray-600",
};

export default function VanDriver() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedSchedule, setSelectedSchedule] = useState<VanSchedule | null>(null);
  const [error, setError] = useState("");

  const { data: schedules = [], isLoading } = useQuery<VanSchedule[]>({
    queryKey: ["van-driver-today"],
    queryFn: fetchTodaySchedules,
    refetchInterval: 60_000,
  });

  const { data: passengers = [], isLoading: loadingPassengers } = useQuery<Passenger[]>({
    queryKey: ["van-passengers", selectedSchedule?.id, selectedSchedule?.date],
    queryFn: () => selectedSchedule ? fetchPassengers(selectedSchedule.id, selectedSchedule.date) : Promise.resolve([]),
    enabled: !!selectedSchedule,
    refetchInterval: 30_000,
  });

  const boardMut = useMutation({
    mutationFn: (bookingId: string) => markBoarded(bookingId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["van-passengers"] }),
    onError: (e: Error) => setError(e.message),
  });

  const completeMut = useMutation({
    mutationFn: () => selectedSchedule ? completeTrip(selectedSchedule.id, selectedSchedule.date) : Promise.resolve(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["van-passengers"] });
      qc.invalidateQueries({ queryKey: ["van-driver-today"] });
      setSelectedSchedule(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const boardedCount = passengers.filter(p => p.status === "boarded" || p.status === "completed").length;
  const confirmedCount = passengers.filter(p => p.status === "confirmed").length;

  if (isLoading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-gray-500 text-sm">Loading your schedule…</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-900 to-indigo-700 px-4 pt-12 pb-6 text-white">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
            <Bus className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Van Service</h1>
            <p className="text-indigo-200 text-sm">Today's route assignments</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
            <button className="ml-auto font-bold" onClick={() => setError("")}>×</button>
          </div>
        )}

        {!selectedSchedule ? (
          <>
            {schedules.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
                <Bus className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">No schedules today</p>
                <p className="text-gray-400 text-sm mt-1">You have no van routes assigned for today.</p>
              </div>
            ) : (
              schedules.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSchedule(s)}
                  className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-left hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900">{s.routeName || s.routeId}</div>
                      <div className="text-sm text-gray-500 mt-0.5">{s.routeFrom} → {s.routeTo}</div>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="flex items-center gap-1 text-sm text-indigo-600 font-medium">
                          <Clock className="w-4 h-4" />{s.departureTime}
                        </span>
                        <span className="flex items-center gap-1 text-sm text-gray-500">
                          <Users className="w-4 h-4" />{s.bookedCount}/{s.totalSeats ?? "?"} booked
                        </span>
                        <span className="flex items-center gap-1 text-sm text-gray-400">
                          <Calendar className="w-4 h-4" />{s.date}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400 mt-1" />
                  </div>
                </button>
              ))
            )}
          </>
        ) : (
          <>
            {/* Back + header */}
            <div className="flex items-center gap-2">
              <button onClick={() => setSelectedSchedule(null)} className="text-indigo-600 font-semibold text-sm hover:underline flex items-center gap-1">
                ← Back
              </button>
              <span className="text-gray-400">|</span>
              <span className="font-semibold text-gray-800">{selectedSchedule.routeName}</span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Boarded", value: boardedCount, color: "text-green-600 bg-green-50" },
                { label: "Pending", value: confirmedCount, color: "text-blue-600 bg-blue-50" },
                { label: "Total", value: passengers.length, color: "text-gray-700 bg-gray-50" },
              ].map(s => (
                <div key={s.label} className={`rounded-xl p-3 text-center ${s.color}`}>
                  <div className="text-2xl font-bold">{s.value}</div>
                  <div className="text-xs font-medium mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Passengers */}
            {loadingPassengers ? (
              <div className="text-center py-8 text-gray-400">Loading passengers…</div>
            ) : passengers.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
                <Users className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">No confirmed bookings for today yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {passengers.map(p => (
                  <div key={p.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900">{p.passengerName || p.userName || "Unknown"}</div>
                        <div className="text-sm text-gray-500">{p.passengerPhone || p.userPhone || ""}</div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[p.status] || "bg-gray-100 text-gray-600"}`}>{p.status}</span>
                          <span className="text-xs text-gray-400">{p.paymentMethod} · Rs {parseFloat(p.fare).toFixed(0)}</span>
                        </div>
                        <div className="flex gap-1 mt-1.5">
                          {(Array.isArray(p.seatNumbers) ? p.seatNumbers as number[] : []).map(s => (
                            <span key={s} className="bg-indigo-100 text-indigo-700 text-xs font-bold rounded px-1.5 py-0.5">Seat {s}</span>
                          ))}
                        </div>
                      </div>
                      {p.status === "confirmed" && (
                        <button
                          onClick={() => boardMut.mutate(p.id)}
                          disabled={boardMut.isPending}
                          className="ml-3 flex items-center gap-1.5 bg-green-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Board
                        </button>
                      )}
                      {(p.status === "boarded" || p.status === "completed") && (
                        <div className="ml-3 flex items-center gap-1 text-green-600 text-xs font-semibold">
                          <CheckCircle className="w-4 h-4" />Boarded
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Complete trip */}
            {passengers.some(p => p.status === "confirmed" || p.status === "boarded") && (
              <button
                onClick={() => {
                  if (confirm("Mark entire trip as completed? This will complete all boarded passenger bookings.")) {
                    completeMut.mutate();
                  }
                }}
                disabled={completeMut.isPending}
                className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-5 h-5" />
                {completeMut.isPending ? "Completing…" : "Complete Trip"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
