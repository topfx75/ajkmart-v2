import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetcher } from "@/lib/api";
import { BellOff, RefreshCw, BellRing, Clock, User, Phone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

function timeLeft(until: string | null): string {
  if (!until) return "Until manually disabled";
  const diff = new Date(until).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}

export default function SilenceMode() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: riders, isLoading, refetch } = useQuery({
    queryKey: ["admin-silence-mode"],
    queryFn: () => fetcher("/riders/silence-mode"),
    refetchInterval: 20_000,
  });

  const disableMut = useMutation({
    mutationFn: (riderId: string) =>
      fetcher(`/riders/${riderId}/silence-mode`, {
        method: "PATCH",
        body: JSON.stringify({ silenceMode: false }),
      }),
    onSuccess: (_, riderId) => {
      toast({ title: "Silence mode disabled", description: `Rider has been notified.` });
      qc.invalidateQueries({ queryKey: ["admin-silence-mode"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const list: any[] = Array.isArray(riders) ? riders : [];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BellOff className="w-6 h-6 text-orange-500" />
          <h1 className="text-xl font-bold">Rider Silence Mode</h1>
          <Badge variant={list.length > 0 ? "destructive" : "secondary"}>
            {list.length} silenced
          </Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading...</div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2">
          <BellRing className="w-10 h-10 text-green-500" />
          <p className="text-sm font-medium text-green-700">All riders have notifications enabled</p>
          <p className="text-xs text-muted-foreground">No riders are currently in silence mode</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((rider: any) => (
            <Card key={rider.id} className="border border-orange-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <BellOff className="w-4 h-4 text-orange-500" />
                      <span className="font-semibold text-sm">
                        {rider.displayName || rider.name || "Unknown Rider"}
                      </span>
                    </div>
                    {(rider.displayPhone || rider.phone) && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="w-3 h-3" />
                        {rider.displayPhone || rider.phone}
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-xs text-orange-600">
                      <Clock className="w-3 h-3" />
                      {timeLeft(rider.silenceModeUntil)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs rounded-lg text-orange-700 border-orange-300 hover:bg-orange-50"
                    disabled={disableMut.isPending}
                    onClick={() => disableMut.mutate(rider.id)}
                  >
                    <BellRing className="w-3.5 h-3.5 mr-1" /> Force Enable
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
