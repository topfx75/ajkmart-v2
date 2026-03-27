import { useState } from "react";
import { useRidesEnriched, useUpdateRide } from "@/hooks/use-admin";
import { formatCurrency, formatDate, getStatusColor } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Car, Search, User, MapPin, Navigation } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const STATUSES = ["searching", "accepted", "arrived", "in_transit", "completed", "cancelled", "ongoing"];

export default function Rides() {
  const { data, isLoading } = useRidesEnriched();
  const updateMutation = useUpdateRide();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedRide, setSelectedRide] = useState<any>(null);

  const handleUpdateStatus = (id: string, status: string) => {
    updateMutation.mutate({ id, status }, {
      onSuccess: () => toast({ title: "Ride status updated ✅" }),
      onError: err => toast({ title: "Update failed", description: err.message, variant: "destructive" })
    });
  };

  const rides = data?.rides || [];
  const q = search.toLowerCase();
  const filtered = rides.filter((r: any) => {
    const matchSearch = r.id.toLowerCase().includes(q)
      || (r.userName || "").toLowerCase().includes(q)
      || (r.userPhone || "").includes(q);
    const matchType = typeFilter === "all" || r.type === typeFilter;
    return matchSearch && matchType;
  });

  const bikeCount = rides.filter((r: any) => r.type === "bike").length;
  const carCount = rides.filter((r: any) => r.type === "car").length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 sm:w-12 sm:h-12 bg-green-100 text-green-600 rounded-xl flex items-center justify-center shrink-0">
            <Car className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">Rides</h1>
            <p className="text-muted-foreground text-xs sm:text-sm">{bikeCount} bike · {carCount} car · {rides.length} total</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-3 sm:p-4 rounded-2xl border-border/50 shadow-sm flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by ID, name or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-10 sm:h-11 rounded-xl bg-muted/30 border-border/50 text-sm"
          />
        </div>
        <div className="flex gap-2 shrink-0">
          {["all", "bike", "car"].map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold capitalize transition-colors border ${
                typeFilter === t ? "bg-primary text-white border-primary" : "bg-muted/30 border-border/50 text-muted-foreground hover:border-primary"
              }`}
            >
              {t === "bike" ? "🏍️ Bike" : t === "car" ? "🚗 Car" : "All"}
            </button>
          ))}
        </div>
      </Card>

      <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="font-semibold">Ride / Type</TableHead>
                <TableHead className="font-semibold">Customer</TableHead>
                <TableHead className="font-semibold">Route</TableHead>
                <TableHead className="font-semibold">Fare</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Loading rides...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No rides found.</TableCell></TableRow>
              ) : (
                filtered.map((ride: any) => (
                  <TableRow key={ride.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedRide(ride)}>
                    <TableCell>
                      <p className="font-mono font-medium text-sm">{ride.id.slice(-8).toUpperCase()}</p>
                      <Badge
                        variant="outline"
                        className={`mt-1 text-[10px] font-bold uppercase ${ride.type === 'bike' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-sky-50 text-sky-600 border-sky-200'}`}
                      >
                        {ride.type === 'bike' ? '🏍️' : '🚗'} {ride.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {ride.userName ? (
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                            <User className="w-3.5 h-3.5 text-green-600" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold">{ride.userName}</p>
                            <p className="text-xs text-muted-foreground">{ride.userPhone}</p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Unknown</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[180px]">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-xs">
                          <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                          <span className="truncate">{ride.pickupAddress || '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs">
                          <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                          <span className="truncate">{ride.dropAddress || '—'}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-bold">{formatCurrency(ride.fare)}</p>
                      <p className="text-xs text-muted-foreground">{ride.distance} km</p>
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Select value={ride.status} onValueChange={(val) => handleUpdateStatus(ride.id, val)}>
                        <SelectTrigger className={`w-32 sm:w-36 h-8 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider border-2 ${getStatusColor(ride.status)}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map(s => (
                            <SelectItem key={s} value={s} className="text-xs uppercase font-bold">{s.replace('_', ' ')}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
                      {formatDate(ride.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Ride Detail Modal */}
      <Dialog open={!!selectedRide} onOpenChange={open => { if (!open) setSelectedRide(null); }}>
        <DialogContent className="w-[95vw] max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Car className="w-5 h-5 text-green-600" />
              Ride Detail
            </DialogTitle>
          </DialogHeader>
          {selectedRide && (
            <div className="space-y-4 mt-2">
              <div className="bg-muted/40 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ride ID</span>
                  <span className="font-mono font-bold">{selectedRide.id.slice(-8).toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant="outline" className={`text-[10px] font-bold uppercase ${selectedRide.type === 'bike' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-sky-50 text-sky-600 border-sky-200'}`}>
                    {selectedRide.type === 'bike' ? '🏍️' : '🚗'} {selectedRide.type}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="font-semibold">{selectedRide.userName || "Unknown"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phone</span>
                  <span>{selectedRide.userPhone || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fare</span>
                  <span className="font-bold text-foreground">{formatCurrency(selectedRide.fare)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Distance</span>
                  <span>{selectedRide.distance} km</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment</span>
                  <span className="capitalize font-medium">{selectedRide.paymentMethod}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase border ${getStatusColor(selectedRide.status)}`}>
                    {selectedRide.status.replace('_', ' ')}
                  </span>
                </div>
                {selectedRide.riderName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rider</span>
                    <span className="font-semibold">{selectedRide.riderName}</span>
                  </div>
                )}
              </div>

              {/* Route */}
              <div className="bg-gradient-to-b from-green-50 to-red-50 border border-green-200 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-muted-foreground mb-2 flex items-center gap-1">
                  <Navigation className="w-3.5 h-3.5" /> Route
                </p>
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-bold text-green-700 uppercase tracking-wide">Pickup</p>
                    <p className="text-sm">{selectedRide.pickupAddress || "—"}</p>
                  </div>
                </div>
                <div className="border-l-2 border-dashed border-muted ml-[7px] h-3" />
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide">Drop</p>
                    <p className="text-sm">{selectedRide.dropAddress || "—"}</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Booked: {formatDate(selectedRide.createdAt)}</span>
                <span>Updated: {formatDate(selectedRide.updatedAt)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
