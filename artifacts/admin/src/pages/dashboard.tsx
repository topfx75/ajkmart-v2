import { Users, ShoppingBag, Car, Pill, Box, Package, TrendingUp, ArrowRight, Wallet, Download, Trophy, Star } from "lucide-react";
import { Link } from "wouter";
import { useStats, useRevenueTrend, useLeaderboard } from "@/hooks/use-admin";
import { formatCurrency, formatDate, getStatusColor } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { fetcher } from "@/lib/api";

function exportDashboard() {
  fetcher("/dashboard-export").then((data: any) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }).catch(() => alert("Export failed"));
}

export default function Dashboard() {
  const { data, isLoading } = useStats();
  const { data: trendData } = useRevenueTrend();
  const { data: lbData }    = useLeaderboard();

  if (isLoading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded-lg" />
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-24 sm:h-32 bg-muted rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const statCards = [
    { title: "Users", value: data?.users || 0, icon: Users, color: "text-blue-600", bg: "bg-blue-100", href: "/users" },
    { title: "Orders", value: data?.orders || 0, icon: ShoppingBag, color: "text-indigo-600", bg: "bg-indigo-100", href: "/orders" },
    { title: "Rides", value: data?.rides || 0, icon: Car, color: "text-green-600", bg: "bg-green-100", href: "/rides" },
    { title: "Pharmacy", value: data?.pharmacyOrders || 0, icon: Pill, color: "text-pink-600", bg: "bg-pink-100", href: "/pharmacy" },
    { title: "Parcels", value: data?.parcelBookings || 0, icon: Box, color: "text-orange-600", bg: "bg-orange-100", href: "/parcel" },
    { title: "Products", value: data?.products || 0, icon: Package, color: "text-purple-600", bg: "bg-purple-100", href: "/products" },
  ];

  const trend = trendData?.trend || [];
  const vendors = lbData?.vendors || [];
  const riders  = lbData?.riders  || [];

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">Overview</h1>
          <p className="text-muted-foreground mt-1 text-sm">Welcome back. Here's your platform summary.</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportDashboard} className="h-9 rounded-xl gap-2 shrink-0">
          <Download className="w-4 h-4" /> Export
        </Button>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
        {statCards.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <Link key={i} href={stat.href}>
              <Card className="rounded-2xl border-border/50 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 cursor-pointer active:scale-95">
                <CardContent className="p-4 sm:p-6 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1 truncate">{stat.title}</p>
                    <h3 className="text-2xl sm:text-3xl font-bold text-foreground">{stat.value.toLocaleString()}</h3>
                  </div>
                  <div className={`w-11 h-11 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shrink-0 ${stat.bg}`}>
                    <Icon className={`w-5 h-5 sm:w-7 sm:h-7 ${stat.color}`} />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Revenue Section */}
      <div>
        <h2 className="text-lg sm:text-xl font-display font-bold text-foreground mb-3 sm:mb-4">Revenue Breakdown</h2>
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Card className="col-span-2 sm:col-span-2 lg:col-span-1 rounded-2xl bg-gradient-to-br from-primary to-blue-700 text-white shadow-lg shadow-primary/20 border-none">
            <CardContent className="p-4 sm:p-6">
              <p className="text-white/80 font-medium text-xs sm:text-sm mb-1 sm:mb-2 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> Grand Total
              </p>
              <h3 className="text-xl sm:text-2xl font-bold">{formatCurrency(data?.revenue?.total || 0)}</h3>
            </CardContent>
          </Card>
          {[
            { label: "Mart & Food", value: data?.revenue?.orders || 0 },
            { label: "Rides", value: data?.revenue?.rides || 0 },
            { label: "Pharmacy", value: data?.revenue?.pharmacy || 0 },
          ].map((rev, i) => (
            <Card key={i} className="rounded-2xl border-border/50">
              <CardContent className="p-4 sm:p-6">
                <p className="text-muted-foreground font-medium text-xs sm:text-sm mb-1">{rev.label}</p>
                <h3 className="text-lg sm:text-2xl font-bold text-foreground">{formatCurrency(rev.value)}</h3>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Revenue Sparkline — 7-day trend */}
      {trend.length > 0 && (
        <Card className="rounded-2xl border-border/50 shadow-sm p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" /> 7-Day Revenue Trend
          </h2>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={d => new Date(d).toLocaleDateString("en-US", { weekday: "short" })} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} width={40} />
                <Tooltip
                  contentStyle={{ borderRadius: "12px", fontSize: "12px", border: "1px solid hsl(var(--border))" }}
                  formatter={(v: any) => [`Rs. ${Math.round(v).toLocaleString()}`, "Revenue"]}
                  labelFormatter={l => new Date(l).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                />
                <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2}
                  fill="url(#revGrad)" dot={{ fill: "hsl(var(--primary))", r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Leaderboards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        {/* Top Vendors */}
        <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-border/50 flex items-center justify-between bg-card">
            <h2 className="text-base sm:text-lg font-bold flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500" /> Top Vendors
            </h2>
            <Link href="/vendors" className="text-xs sm:text-sm font-semibold text-primary flex items-center hover:underline gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-border/50">
            {!vendors.length ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No vendor data yet</div>
            ) : vendors.map((v: any, idx: number) => (
              <div key={v.id} className="px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0
                  ${idx === 0 ? "bg-amber-100 text-amber-700" : idx === 1 ? "bg-slate-100 text-slate-600" : idx === 2 ? "bg-orange-100 text-orange-600" : "bg-muted text-muted-foreground"}`}>
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{v.name || v.phone}</p>
                  <p className="text-xs text-muted-foreground">{v.totalOrders} orders</p>
                </div>
                <p className="font-bold text-sm text-foreground shrink-0">{formatCurrency(v.totalRevenue)}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Top Riders */}
        <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-border/50 flex items-center justify-between bg-card">
            <h2 className="text-base sm:text-lg font-bold flex items-center gap-2">
              <Star className="w-4 h-4 text-green-600" /> Top Riders
            </h2>
            <Link href="/riders" className="text-xs sm:text-sm font-semibold text-primary flex items-center hover:underline gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-border/50">
            {!riders.length ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No rider data yet</div>
            ) : riders.map((r: any, idx: number) => (
              <div key={r.id} className="px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0
                  ${idx === 0 ? "bg-amber-100 text-amber-700" : idx === 1 ? "bg-slate-100 text-slate-600" : idx === 2 ? "bg-orange-100 text-orange-600" : "bg-muted text-muted-foreground"}`}>
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{r.name || r.phone}</p>
                  <p className="text-xs text-muted-foreground">{r.completedTrips} trips</p>
                </div>
                <p className="font-bold text-sm text-foreground shrink-0">{formatCurrency(r.totalEarned)}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-8">
        {/* Recent Orders */}
        <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-border/50 flex items-center justify-between bg-card">
            <h2 className="text-base sm:text-lg font-bold flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-indigo-600" /> Recent Orders
            </h2>
            <Link href="/orders" className="text-xs sm:text-sm font-semibold text-primary flex items-center hover:underline gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-border/50">
            {!data?.recentOrders?.length ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No recent orders</div>
            ) : (
              data.recentOrders.map((order: any) => (
                <div key={order.id} className="px-4 sm:px-6 py-3 sm:py-4 hover:bg-muted/40 transition-colors flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">#{order.id.slice(-6).toUpperCase()}</span>
                      <Badge variant="outline" className="capitalize text-[10px] font-medium">{order.type}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-sm mb-1">{formatCurrency(order.total)}</p>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getStatusColor(order.status)}`}>
                      {order.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Recent Rides */}
        <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-border/50 flex items-center justify-between bg-card">
            <h2 className="text-base sm:text-lg font-bold flex items-center gap-2">
              <Car className="w-4 h-4 text-green-600" /> Recent Rides
            </h2>
            <Link href="/rides" className="text-xs sm:text-sm font-semibold text-primary flex items-center hover:underline gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-border/50">
            {!data?.recentRides?.length ? (
              <div className="p-8 text-center text-muted-foreground text-sm">No recent rides</div>
            ) : (
              data.recentRides.map((ride: any) => (
                <div key={ride.id} className="px-4 sm:px-6 py-3 sm:py-4 hover:bg-muted/40 transition-colors flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">#{ride.id.slice(-6).toUpperCase()}</span>
                      <Badge variant="outline" className="capitalize text-[10px] font-medium">{ride.type}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(ride.createdAt)}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-sm mb-1">{formatCurrency(ride.fare)}</p>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getStatusColor(ride.status)}`}>
                      {ride.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Quick Links on Mobile */}
      <div className="lg:hidden">
        <h2 className="text-base font-bold mb-3">Quick Access</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Pharmacy", href: "/pharmacy", icon: Pill, color: "text-pink-600", bg: "bg-pink-50 border-pink-200" },
            { label: "Parcels", href: "/parcel", icon: Box, color: "text-orange-600", bg: "bg-orange-50 border-orange-200" },
            { label: "Transactions", href: "/transactions", icon: Wallet, color: "text-sky-600", bg: "bg-sky-50 border-sky-200" },
            { label: "Settings", href: "/settings", icon: Package, color: "text-gray-600", bg: "bg-gray-50 border-gray-200" },
          ].map(item => (
            <Link key={item.href} href={item.href}>
              <div className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer active:scale-95 transition-transform ${item.bg}`}>
                <item.icon className={`w-5 h-5 ${item.color}`} />
                <span className={`font-semibold text-sm ${item.color}`}>{item.label}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
