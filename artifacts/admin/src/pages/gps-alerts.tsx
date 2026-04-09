import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetcher } from "@/lib/api";
import { Shield, ShieldOff, RefreshCw, CheckCircle, AlertTriangle, MapPin, Clock, User, Filter } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function GpsAlerts() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [resolved, setResolved] = useState<string>("false");
  const [riderIdFilter, setRiderIdFilter] = useState("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ resolved, page: String(page), limit: "50" });
  if (riderIdFilter.trim()) params.set("riderId", riderIdFilter.trim());

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-gps-alerts", resolved, riderIdFilter, page],
    queryFn: () => fetcher(`/gps-alerts?${params.toString()}`),
    refetchInterval: 15_000,
  });

  const resolveMut = useMutation({
    mutationFn: ({ id, resolvedVal }: { id: string; resolvedVal: boolean }) =>
      fetcher(`/gps-alerts/${id}`, { method: "PATCH", body: JSON.stringify({ resolved: resolvedVal }) }),
    onSuccess: () => {
      toast({ title: "Alert updated" });
      qc.invalidateQueries({ queryKey: ["admin-gps-alerts"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const resetViolationsMut = useMutation({
    mutationFn: (riderId: string) =>
      fetcher(`/gps-alerts/rider/${riderId}/reset-violations`, { method: "PATCH" }),
    onSuccess: () => {
      toast({ title: "Violations reset" });
      qc.invalidateQueries({ queryKey: ["admin-gps-alerts"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const alerts: any[] = data?.alerts ?? [];
  const total: number = data?.total ?? 0;

  const violationTypeLabel = (type: string) => {
    if (type === "speed") return "Speed";
    if (type === "emulator") return "Emulator";
    if (type === "mock_provider") return "Mock GPS";
    return type;
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ShieldOff className="w-6 h-6 text-red-500" />
          <h1 className="text-xl font-bold">GPS Spoofing Alerts</h1>
          <Badge variant="secondary">{total} total</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={resolved} onValueChange={v => { setResolved(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-40 h-9 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="false">Unresolved</SelectItem>
            <SelectItem value="true">Resolved</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="h-9 pl-8 w-52 rounded-xl text-sm"
            placeholder="Filter by Rider ID..."
            value={riderIdFilter}
            onChange={e => { setRiderIdFilter(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading...</div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 gap-2">
          <Shield className="w-8 h-8 text-green-500" />
          <p className="text-muted-foreground text-sm">No GPS alerts found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert: any) => (
            <Card key={alert.id} className={`border ${alert.resolved ? "border-border" : "border-red-200 bg-red-50/30"}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={alert.autoOffline ? "destructive" : "secondary"} className="text-[10px]">
                        {violationTypeLabel(alert.violationType)}
                      </Badge>
                      {alert.autoOffline && (
                        <Badge className="bg-red-600 text-white text-[10px]">Auto-Offline</Badge>
                      )}
                      {alert.resolved && (
                        <Badge className="bg-green-600 text-white text-[10px]">Resolved</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      <User className="w-3.5 h-3.5 text-muted-foreground" />
                      {alert.riderName || "Unknown Rider"} — {alert.riderPhone || alert.riderId}
                    </div>
                    <div className="text-xs text-muted-foreground">{alert.reason}</div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {parseFloat(String(alert.latitude)).toFixed(5)}, {parseFloat(String(alert.longitude)).toFixed(5)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(alert.createdAt)}
                      </span>
                      <span>Violation #{alert.violationCount}</span>
                    </div>
                    {alert.resolved && alert.resolvedAt && (
                      <div className="text-xs text-green-600">
                        Resolved at {formatDate(alert.resolvedAt)} by {alert.resolvedBy || "admin"}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {!alert.resolved ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs rounded-lg text-green-700 border-green-300 hover:bg-green-50"
                          disabled={resolveMut.isPending}
                          onClick={() => resolveMut.mutate({ id: alert.id, resolvedVal: true })}
                        >
                          <CheckCircle className="w-3.5 h-3.5 mr-1" /> Resolve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs rounded-lg text-orange-700 border-orange-300 hover:bg-orange-50"
                          disabled={resetViolationsMut.isPending}
                          onClick={() => resetViolationsMut.mutate(alert.riderId)}
                        >
                          Reset Violations
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs rounded-lg"
                        disabled={resolveMut.isPending}
                        onClick={() => resolveMut.mutate({ id: alert.id, resolvedVal: false })}
                      >
                        Re-open
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {total > 50 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button variant="outline" size="sm" disabled={alerts.length < 50} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
