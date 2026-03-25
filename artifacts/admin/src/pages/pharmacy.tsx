import { useState } from "react";
import { usePharmacyOrders, useUpdatePharmacyOrder } from "@/hooks/use-admin";
import { formatCurrency, formatDate, getStatusColor } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pill, Search, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";

const STATUSES = ["pending", "confirmed", "preparing", "out_for_delivery", "delivered", "cancelled"];

export default function Pharmacy() {
  const { data, isLoading } = usePharmacyOrders();
  const updateMutation = useUpdatePharmacyOrder();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const handleUpdateStatus = (id: string, status: string) => {
    updateMutation.mutate({ id, status }, {
      onSuccess: () => toast({ title: "Status updated" })
    });
  };

  const orders = data?.orders || [];
  const filtered = orders.filter((o: any) => o.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-pink-100 text-pink-600 rounded-xl flex items-center justify-center">
          <Pill className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Pharmacy Orders</h1>
          <p className="text-muted-foreground text-sm">Manage medicine deliveries</p>
        </div>
      </div>

      <Card className="p-4 rounded-2xl border-border/50 shadow-sm max-w-md">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search Order ID..." 
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
                <TableHead>Order ID</TableHead>
                <TableHead>Prescription Note</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">No orders found.</TableCell></TableRow>
              ) : (
                filtered.map((order: any) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono font-medium text-sm">{order.id.slice(-8).toUpperCase()}</TableCell>
                    <TableCell className="max-w-[300px]">
                      {order.prescriptionNote ? (
                        <div className="flex items-start gap-2 bg-amber-50 text-amber-900 p-2 rounded-lg text-xs">
                          <FileText className="w-4 h-4 shrink-0 mt-0.5" />
                          <p className="truncate">{order.prescriptionNote}</p>
                        </div>
                      ) : <span className="text-muted-foreground text-xs">No note</span>}
                    </TableCell>
                    <TableCell className="font-bold">{formatCurrency(order.total)}</TableCell>
                    <TableCell>
                      <Select value={order.status} onValueChange={(val) => handleUpdateStatus(order.id, val)}>
                        <SelectTrigger className={`w-36 h-8 text-[11px] font-bold uppercase tracking-wider border-2 ${getStatusColor(order.status)}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map(s => (
                            <SelectItem key={s} value={s} className="text-xs uppercase font-bold tracking-wider">{s.replace('_', ' ')}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
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
