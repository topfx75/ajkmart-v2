import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetcher } from "@/lib/api";
import { DollarSign, RefreshCw, CheckCircle, AlertTriangle, Eye, Filter, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

function formatCurrency(v: number | string | undefined) {
  const n = parseFloat(String(v ?? 0));
  return isNaN(n) ? "Rs. 0" : `Rs. ${n.toLocaleString("en-PK")}`;
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function PhotoModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl p-2">
        <div className="relative">
          <button
            onClick={onClose}
            className="absolute top-2 right-2 z-10 bg-black/50 text-white rounded-full p-1 hover:bg-black/70"
          >
            <X className="w-4 h-4" />
          </button>
          <img
            src={url}
            alt="COD proof photo"
            className="w-full max-h-[80vh] object-contain rounded-xl"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CodVerifications() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [page, setPage] = useState(1);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page), limit: "50" });
  if (statusFilter) params.set("status", statusFilter);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-cod-verifications", statusFilter, page],
    queryFn: () => fetcher(`/cod-verifications?${params.toString()}`),
    refetchInterval: 30_000,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, codVerified }: { id: string; codVerified: string }) =>
      fetcher(`/cod-verifications/${id}`, { method: "PATCH", body: JSON.stringify({ codVerified }) }),
    onSuccess: () => {
      toast({ title: "Verification status updated" });
      qc.invalidateQueries({ queryKey: ["admin-cod-verifications"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const orders: any[] = data?.orders ?? [];
  const total: number = data?.total ?? 0;

  const verifiedBadge = (status: string | null) => {
    if (status === "verified") return <Badge className="bg-green-600 text-white text-[10px]">Verified</Badge>;
    if (status === "flagged") return <Badge className="bg-red-600 text-white text-[10px]">Flagged</Badge>;
    return <Badge variant="secondary" className="text-[10px]">Pending</Badge>;
  };

  const photoToShow = (order: any) => order.codPhotoUrl || order.proofPhotoUrl;

  return (
    <div className="space-y-4 p-4">
      {photoUrl && <PhotoModal url={photoUrl} onClose={() => setPhotoUrl(null)} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-green-600" />
          <h1 className="text-xl font-bold">COD Photo Verification</h1>
          <Badge variant="secondary">{total} orders</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter || "all"} onValueChange={v => { setStatusFilter(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-40 h-9 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="flagged">Flagged</SelectItem>
            <SelectItem value="all">All COD</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading...</div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2">
          <DollarSign className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">No COD orders found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order: any) => {
            const photo = photoToShow(order);
            return (
              <Card key={order.id} className={`border ${order.codVerified === "flagged" ? "border-red-200" : order.codVerified === "verified" ? "border-green-200" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4 flex-wrap">
                    {photo && (
                      <button
                        onClick={() => setPhotoUrl(`${window.location.origin}${photo}`)}
                        className="shrink-0 relative group"
                        title="Click to enlarge"
                      >
                        <img
                          src={`${window.location.origin}${photo}`}
                          alt="COD proof"
                          className="w-20 h-20 object-cover rounded-xl border shadow-sm group-hover:opacity-90 transition-opacity"
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 rounded-xl">
                          <Eye className="w-5 h-5 text-white" />
                        </div>
                      </button>
                    )}

                    <div className="flex-1 space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {verifiedBadge(order.codVerified)}
                        <span className="text-xs font-mono text-muted-foreground">{order.id.slice(0, 8)}…</span>
                        <span className="font-bold text-green-700">{formatCurrency(order.total)}</span>
                      </div>
                      <div className="text-sm font-medium">
                        Rider: {order.riderName || "Unassigned"} {order.riderPhone ? `· ${order.riderPhone}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {order.deliveryAddress || "No address"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(order.createdAt)} · Status: {order.status}
                      </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs rounded-lg text-green-700 border-green-300 hover:bg-green-50"
                        disabled={updateMut.isPending || order.codVerified === "verified"}
                        onClick={() => updateMut.mutate({ id: order.id, codVerified: "verified" })}
                      >
                        <CheckCircle className="w-3.5 h-3.5 mr-1" /> Verify
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs rounded-lg text-red-700 border-red-300 hover:bg-red-50"
                        disabled={updateMut.isPending || order.codVerified === "flagged"}
                        onClick={() => updateMut.mutate({ id: order.id, codVerified: "flagged" })}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Flag
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {total > 50 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button variant="outline" size="sm" disabled={orders.length < 50} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
