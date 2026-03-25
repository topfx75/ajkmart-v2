import { Users, ShoppingBag, Car, Pill, Box, Package, TrendingUp, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { useStats } from "@/hooks/use-admin";
import { formatCurrency, formatDate, getStatusColor } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data, isLoading } = useStats();

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-muted rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-32 bg-muted rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const statCards = [
    { title: "Total Users", value: data?.users || 0, icon: Users, color: "text-blue-600", bg: "bg-blue-100" },
    { title: "Mart & Food Orders", value: data?.orders || 0, icon: ShoppingBag, color: "text-indigo-600", bg: "bg-indigo-100" },
    { title: "Rides Booked", value: data?.rides || 0, icon: Car, color: "text-green-600", bg: "bg-green-100" },
    { title: "Pharmacy Orders", value: data?.pharmacyOrders || 0, icon: Pill, color: "text-pink-600", bg: "bg-pink-100" },
    { title: "Parcel Bookings", value: data?.parcelBookings || 0, icon: Box, color: "text-orange-600", bg: "bg-orange-100" },
    { title: "Total Products", value: data?.products || 0, icon: Package, color: "text-purple-600", bg: "bg-purple-100" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Overview</h1>
          <p className="text-muted-foreground mt-1">Welcome back. Here's what's happening today.</p>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {statCards.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <Card key={i} className="rounded-2xl border-border/50 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">{stat.title}</p>
                  <h3 className="text-3xl font-bold text-foreground">{stat.value.toLocaleString()}</h3>
                </div>
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${stat.bg}`}>
                  <Icon className={`w-7 h-7 ${stat.color}`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Revenue Section */}
      <div>
        <h2 className="text-xl font-display font-bold text-foreground mb-4">Revenue Breakdown</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="rounded-2xl bg-gradient-to-br from-primary to-blue-700 text-white shadow-lg shadow-primary/20 border-none">
            <CardContent className="p-6">
              <p className="text-white/80 font-medium text-sm mb-2 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> Grand Total
              </p>
              <h3 className="text-2xl font-bold">{formatCurrency(data?.revenue?.total || 0)}</h3>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-border/50">
            <CardContent className="p-6">
              <p className="text-muted-foreground font-medium text-sm mb-2">Mart & Food</p>
              <h3 className="text-2xl font-bold text-foreground">{formatCurrency(data?.revenue?.orders || 0)}</h3>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-border/50">
            <CardContent className="p-6">
              <p className="text-muted-foreground font-medium text-sm mb-2">Rides</p>
              <h3 className="text-2xl font-bold text-foreground">{formatCurrency(data?.revenue?.rides || 0)}</h3>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-border/50">
            <CardContent className="p-6">
              <p className="text-muted-foreground font-medium text-sm mb-2">Pharmacy</p>
              <h3 className="text-2xl font-bold text-foreground">{formatCurrency(data?.revenue?.pharmacy || 0)}</h3>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Activity Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-border/50 flex items-center justify-between bg-card">
            <h2 className="text-lg font-bold">Recent Orders</h2>
            <Link href="/orders" className="text-sm font-medium text-primary flex items-center hover:underline">
              View all <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
          <div className="divide-y divide-border/50 flex-1">
            {data?.recentOrders?.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No recent orders</div>
            ) : (
              data?.recentOrders?.map((order: any) => (
                <div key={order.id} className="p-4 sm:px-6 hover:bg-muted/50 transition-colors flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-foreground">#{order.id.slice(-6).toUpperCase()}</span>
                      <Badge variant="outline" className="capitalize text-xs font-medium bg-secondary">
                        {order.type}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-foreground mb-1">{formatCurrency(order.total)}</p>
                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide border ${getStatusColor(order.status)}`}>
                      {order.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-border/50 flex items-center justify-between bg-card">
            <h2 className="text-lg font-bold">Recent Rides</h2>
            <Link href="/rides" className="text-sm font-medium text-primary flex items-center hover:underline">
              View all <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
          <div className="divide-y divide-border/50 flex-1">
            {data?.recentRides?.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No recent rides</div>
            ) : (
              data?.recentRides?.map((ride: any) => (
                <div key={ride.id} className="p-4 sm:px-6 hover:bg-muted/50 transition-colors flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-foreground">#{ride.id.slice(-6).toUpperCase()}</span>
                      <Badge variant="outline" className="capitalize text-xs font-medium bg-secondary">
                        {ride.type}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(ride.createdAt)}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-foreground mb-1">{formatCurrency(ride.fare)}</p>
                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide border ${getStatusColor(ride.status)}`}>
                      {ride.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
