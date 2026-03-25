import { useState } from "react";
import { useParcelBookings, useUpdateParcelBooking } from "@/hooks/use-admin";
import { formatCurrency, formatDate, getStatusColor } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Box, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

const STATUSES = ["pending", "searching", "accepted", "in_transit", "completed", "cancelled"];

export default function Parcel() {
  const { data, isLoading } = useParcelBookings();
  const updateMutation = useUpdateParcelBooking();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const handleUpdateStatus = (id: string, status: string) => {
    updateMutation.mutate({ id, status }, {
      onSuccess: () => toast({ title: "Status updated" })
    });
  };

  const bookings = data?.bookings || [];
  const filtered = bookings.filter((b: any) => b.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center">
          <Box className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Parcel Bookings</h1>
          <p className="text-muted-foreground text-sm">Manage peer-to-peer parcel deliveries</p>
        </div>
      </div>

      <Card className="p-4 rounded-2xl border-border/50 shadow-sm max-w-md">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search Booking ID..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-11 rounded-xl"
          />
        </div>
      </Card>

      <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Booking ID</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Fare</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">No bookings found.</TableCell></TableRow>
              ) : (
                filtered.map((b: any) => (
                  <TableRow key={b.id} className="hover:bg-muted/30">
                    <TableCell>
                      <p className="font-mono font-medium text-sm">{b.id.slice(-8).toUpperCase()}</p>
                      <span className="inline-block mt-1 px-2 py-0.5 bg-secondary text-secondary-foreground text-[10px] font-bold uppercase rounded">
                        {b.parcelType}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs space-y-1">
                        <p><span className="font-semibold">From:</span> {b.senderName} ({b.pickupAddress})</p>
                        <p><span className="font-semibold">To:</span> {b.receiverName} ({b.dropAddress})</p>
                      </div>
                    </TableCell>
                    <TableCell className="font-bold text-foreground">{formatCurrency(b.fare)}</TableCell>
                    <TableCell>
                      <Select value={b.status} onValueChange={(val) => handleUpdateStatus(b.id, val)}>
                        <SelectTrigger className={`w-36 h-8 text-[11px] font-bold uppercase tracking-wider border-2 ${getStatusColor(b.status)}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map(s => (
                            <SelectItem key={s} value={s} className="text-xs uppercase font-bold tracking-wider">{s.replace('_', ' ')}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{formatDate(b.createdAt)}</TableCell>
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
