import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetcher } from "@/lib/api";
import { Bus, RefreshCw, Users, CheckCircle, Clock, ChevronDown, ChevronRight, Phone, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${pct}%`,
          background: pct === 100 ? "#16a34a" : pct > 50 ? "#f59e0b" : "#3b82f6",
        }}
      />
    </div>
  );
}

function PassengerRow({ passenger }: { passenger: any }) {
  const statusColor: Record<string, string> = {
    confirmed: "bg-blue-100 text-blue-700 border-blue-200",
    boarded: "bg-amber-100 text-amber-700 border-amber-200",
    completed: "bg-green-100 text-green-700 border-green-200",
  };
  const statusLabel: Record<string, string> = {
    confirmed: "Confirmed",
    boarded: "Boarded",
    completed: "Completed",
  };

  return (
    <div className="flex items-center justify-between py-2 border-b last:border-b-0 gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{passenger.displayName}</p>
          {passenger.displayPhone && (
            <p className="text-xs text-muted-foreground flex items-center gap-0.5">
              <Phone className="w-3 h-3" /> {passenger.displayPhone}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-muted-foreground">Seat {Array.isArray(passenger.seatNumbers) ? passenger.seatNumbers.join(", ") : passenger.seatNumbers}</span>
        <Badge className={`text-[10px] border ${statusColor[passenger.status] ?? "bg-muted text-muted-foreground"}`}>
          {statusLabel[passenger.status] ?? passenger.status}
        </Badge>
      </div>
    </div>
  );
}

function ScheduleCard({ schedule }: { schedule: any }) {
  const [expanded, setExpanded] = useState(false);
  const totalBooked = schedule.totalBooked ?? 0;
  const boardedCount = schedule.boardedCount ?? 0;
  const completedCount = schedule.completedCount ?? 0;
  const confirmedCount = schedule.confirmedCount ?? 0;
  const doneCount = boardedCount + completedCount;
  const seats = schedule.totalSeats ?? 12;

  return (
    <Card className="border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-base">{schedule.routeName || "Unknown Route"}</span>
              <Badge variant="secondary" className="text-[10px]">
                <Clock className="w-3 h-3 mr-0.5" />
                {schedule.departureTime}
                {schedule.returnTime ? ` → ${schedule.returnTime}` : ""}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {schedule.routeFrom} → {schedule.routeTo}
            </p>
            {schedule.driverName && (
              <p className="text-xs text-muted-foreground">Driver: {schedule.driverName}</p>
            )}
            {schedule.vehiclePlate && (
              <p className="text-xs text-muted-foreground">Plate: {schedule.vehiclePlate}</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2 text-center text-[11px]">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5">
                <p className="font-bold text-blue-700 text-sm">{confirmedCount}</p>
                <p className="text-blue-500">Confirmed</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                <p className="font-bold text-amber-700 text-sm">{boardedCount}</p>
                <p className="text-amber-500">Boarded</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5">
                <p className="font-bold text-green-700 text-sm">{completedCount}</p>
                <p className="text-green-500">Done</p>
              </div>
            </div>
            <div className="w-40 space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{doneCount}/{totalBooked} boarded</span>
                <span>{totalBooked}/{seats} seats</span>
              </div>
              <ProgressBar value={doneCount} max={totalBooked || 1} />
            </div>
          </div>
        </div>

        {schedule.passengers?.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {expanded ? "Hide" : "Show"} {schedule.passengers.length} passenger{schedule.passengers.length !== 1 ? "s" : ""}
            </button>
            {expanded && (
              <div className="mt-2 border rounded-xl p-2">
                {schedule.passengers.map((p: any) => (
                  <PassengerRow key={p.id} passenger={p} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function VanBoardingMonitor() {
  const qc = useQueryClient();

  const { data: schedules, isLoading, refetch } = useQuery({
    queryKey: ["admin-van-boarding"],
    queryFn: () => fetcher("/van-boarding"),
    refetchInterval: 30_000,
  });

  const list: any[] = Array.isArray(schedules) ? schedules : [];
  const totalPassengers = list.reduce((s, sc) => s + (sc.totalBooked ?? 0), 0);
  const totalBoarded = list.reduce((s, sc) => s + (sc.boardedCount ?? 0) + (sc.completedCount ?? 0), 0);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Bus className="w-6 h-6 text-blue-500" />
          <h1 className="text-xl font-bold">Van Boarding Monitor</h1>
          <Badge variant="secondary">Today</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {!isLoading && list.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="border">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-extrabold text-blue-600">{list.length}</p>
              <p className="text-xs text-muted-foreground">Active Schedules</p>
            </CardContent>
          </Card>
          <Card className="border">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-extrabold text-amber-600">{totalPassengers}</p>
              <p className="text-xs text-muted-foreground">Total Passengers</p>
            </CardContent>
          </Card>
          <Card className="border">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-extrabold text-green-600">{totalBoarded}</p>
              <p className="text-xs text-muted-foreground">Boarded/Done</p>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading...</div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2">
          <Bus className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">No active van schedules today</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((schedule: any) => (
            <ScheduleCard key={schedule.id} schedule={schedule} />
          ))}
        </div>
      )}
    </div>
  );
}
