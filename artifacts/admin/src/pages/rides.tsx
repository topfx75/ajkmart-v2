import { useState } from "react";
import { useRides, useUpdateRide } from "@/hooks/use-admin";
import { formatCurrency, formatDate, getStatusColor } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Car, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

const STATUSES = ["searching", "accepted", "arrived", "in_transit", "completed", "cancelled"];

export default function Rides() {
  const { data, isLoading } = useRides();
  const updateMutation = useUpdateRide();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const handleUpdateStatus = (id: string, status: string) => {
    updateMutation.mutate({ id, status }, {
      onSuccess: () => toast({ title: "Ride status updated" })
    });
  };

  const rides = data?.rides || [];
  const filtered = rides.filter((r: any) => r.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-green-100 text-green-600 rounded-xl flex items-center justify-center">
            <Car className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Rides</h1>
            <p className="text-muted-foreground text-sm">Manage bike and car bookings</p>
          </div>
        </div>
      </div>

      <Card className="p-4 rounded-2xl border-border/50 shadow-sm">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search by Ride ID..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-11 rounded-xl bg-muted/30 border-border/50"
          />
        </div>
      </Card>

      <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="font-semibold">Ride ID / Type</TableHead>
                <TableHead className="font-semibold">Route</TableHead>
                <TableHead className="font-semibold">Distance</TableHead>
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
                  <TableRow key={ride.id} className="hover:bg-muted/30">
                    <TableCell>
                      <p className="font-mono font-medium text-sm">{ride.id.slice(-8).toUpperCase()}</p>
                      <p className="text-xs font-bold uppercase text-primary tracking-wide mt-1">{ride.type}</p>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                          <p className="text-xs text-foreground truncate">{ride.pickupAddress || 'Pickup'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                          <p className="text-xs text-foreground truncate">{ride.dropAddress || 'Drop'}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{ride.distance} km</TableCell>
                    <TableCell className="font-bold text-foreground">{formatCurrency(ride.fare)}</TableCell>
                    <TableCell>
                      <Select value={ride.status} onValueChange={(val) => handleUpdateStatus(ride.id, val)}>
                        <SelectTrigger className={`w-36 h-8 text-[11px] font-bold uppercase tracking-wider border-2 ${getStatusColor(ride.status)}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map(s => (
                            <SelectItem key={s} value={s} className="text-xs uppercase font-bold tracking-wider">{s.replace('_', ' ')}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                      {formatDate(ride.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
