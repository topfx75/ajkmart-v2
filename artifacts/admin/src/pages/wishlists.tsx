import { useState } from "react";
import { useWishlistAnalytics, useUserWishlist, useClearUserWishlist } from "@/hooks/use-admin";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Heart, Search, TrendingUp, Users, Package, Trash2, Eye, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/format";

export default function Wishlists() {
  const { data, isLoading } = useWishlistAnalytics();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserName, setSelectedUserName] = useState<string>("");
  const clearWishlist = useClearUserWishlist();
  const { data: userWishlist, isLoading: wishlistLoading } = useUserWishlist(selectedUserId);

  const handleClear = (userId: string) => {
    clearWishlist.mutate(userId, {
      onSuccess: (d: any) => toast({ title: `Cleared ${d?.cleared ?? 0} items` }),
      onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const analytics = data ?? { totalItems: 0, uniqueUsers: 0, uniqueProducts: 0, dailyTrend: [], mostWishlisted: [], recentActivity: [] };
  const mostWishlisted = analytics.mostWishlisted ?? [];
  const recentActivity = (analytics.recentActivity ?? []).filter((a: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (a.userName || "").toLowerCase().includes(q) ||
      (a.userPhone || "").includes(q) ||
      (a.productName || "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 sm:w-12 sm:h-12 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center shrink-0">
            <Heart className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">Wishlists</h1>
            <p className="text-muted-foreground text-xs sm:text-sm">Platform-wide wishlist analytics and user drill-down</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center">
          <Heart className="w-5 h-5 text-rose-500 mx-auto mb-1" />
          <p className="text-3xl font-bold text-foreground">{analytics.totalItems}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Wishlisted Items</p>
        </Card>
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center">
          <Users className="w-5 h-5 text-blue-500 mx-auto mb-1" />
          <p className="text-3xl font-bold text-foreground">{analytics.uniqueUsers}</p>
          <p className="text-xs text-muted-foreground mt-1">Users with Wishlists</p>
        </Card>
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm text-center">
          <Package className="w-5 h-5 text-amber-500 mx-auto mb-1" />
          <p className="text-3xl font-bold text-foreground">{analytics.uniqueProducts}</p>
          <p className="text-xs text-muted-foreground mt-1">Unique Products</p>
        </Card>
      </div>

      {(analytics.dailyTrend ?? []).length > 0 && (
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" /> Daily Wishlist Trend (Last 30 Days)
          </h3>
          <div className="flex items-end gap-[2px] h-32">
            {(() => {
              const trend = analytics.dailyTrend ?? [];
              const max = Math.max(...trend.map((d: any) => d.count), 1);
              return trend.map((d: any) => (
                <div
                  key={d.date}
                  className="flex-1 bg-rose-400 hover:bg-rose-500 rounded-t transition-colors cursor-default relative group"
                  style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 4 : 1 }}
                  title={`${d.date}: ${d.count} items`}
                >
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-background text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                    {d.date.slice(5)}: {d.count}
                  </div>
                </div>
              ));
            })()}
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
            <span>{(analytics.dailyTrend ?? [])[0]?.date?.slice(5)}</span>
            <span>{(analytics.dailyTrend ?? []).at(-1)?.date?.slice(5)}</span>
          </div>
        </Card>
      )}

      {mostWishlisted.length > 0 && (
        <Card className="p-4 rounded-2xl border-border/50 shadow-sm">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-rose-500" /> Most Wishlisted Products
          </h3>
          <div className="space-y-2">
            {mostWishlisted.slice(0, 10).map((p: any, i: number) => (
              <div key={p.productId} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                <span className="text-xs font-bold text-muted-foreground w-6 text-center">#{i + 1}</span>
                {p.image && <img src={p.image} alt="" className="w-8 h-8 rounded object-cover" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name || "Unknown Product"}</p>
                  {p.price != null && <p className="text-xs text-muted-foreground">Rs. {p.price}</p>}
                </div>
                <Badge variant="outline" className="bg-rose-50 text-rose-600 border-rose-200 text-xs">
                  {p.count} saves
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by user name, phone, or product..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-10 rounded-xl bg-muted/30 border-border/50 text-sm"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[500px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="font-semibold">User</TableHead>
                <TableHead className="font-semibold">Product</TableHead>
                <TableHead className="font-semibold text-right">Date</TableHead>
                <TableHead className="font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : recentActivity.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground">No wishlist activity found.</TableCell></TableRow>
              ) : (
                recentActivity.map((a: any) => (
                  <TableRow key={a.id} className="hover:bg-muted/30">
                    <TableCell>
                      <p className="text-sm font-medium">{a.userName || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">{a.userPhone}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{a.productName || "Unknown Product"}</p>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {formatDate(a.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setSelectedUserId(a.userId); setSelectedUserName(a.userName || "User"); }}
                        className="h-7 text-xs"
                      >
                        <Eye className="w-3 h-3 mr-1" /> View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={!!selectedUserId} onOpenChange={open => { if (!open) setSelectedUserId(null); }}>
        <DialogContent className="w-[95vw] max-w-lg rounded-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-rose-500" />
              {selectedUserName}'s Wishlist
            </DialogTitle>
          </DialogHeader>
          {wishlistLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">{userWishlist?.total ?? 0} items</p>
                {(userWishlist?.total ?? 0) > 0 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => selectedUserId && handleClear(selectedUserId)}
                    disabled={clearWishlist.isPending}
                    className="h-7 text-xs"
                  >
                    <Trash2 className="w-3 h-3 mr-1" /> Clear All
                  </Button>
                )}
              </div>
              {(userWishlist?.items ?? []).map((item: any) => (
                <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                  {item.image && <img src={item.image} alt="" className="w-10 h-10 rounded object-cover" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name || "Unknown"}</p>
                    {item.category && <p className="text-xs text-muted-foreground">{item.category}</p>}
                  </div>
                  {item.price != null && <span className="text-sm font-bold">Rs. {item.price}</span>}
                </div>
              ))}
              {(userWishlist?.items ?? []).length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-4">No items in wishlist</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
