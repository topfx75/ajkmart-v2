import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

const fd = (d: string | Date) => new Date(d).toLocaleString("en-PK", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });

function typeIcon(type: string) {
  if (type === "order")  return "📦";
  if (type === "wallet") return "💰";
  if (type === "ride")   return "🏍️";
  if (type === "system") return "⚙️";
  if (type === "alert")  return "⚠️";
  return "🔔";
}

export default function Notifications() {
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["rider-notifications"],
    queryFn: () => api.getNotifications(),
    refetchInterval: 30000,
  });

  const notifs: any[] = data?.notifications || [];
  const unread: number = data?.unread || 0;

  const markAllMut = useMutation({
    mutationFn: () => api.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rider-notifications"] });
      qc.invalidateQueries({ queryKey: ["rider-notifs-count"] });
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-green-600 to-emerald-700 px-5 pt-12 pb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <div className="flex gap-2">
            <button onClick={() => refetch()} className="h-9 px-3 bg-white/20 text-white text-sm font-bold rounded-xl">↻</button>
            {unread > 0 && (
              <button onClick={() => markAllMut.mutate()} disabled={markAllMut.isPending}
                className="h-9 px-4 bg-white/20 text-white text-sm font-bold rounded-xl">
                ✓ Read All
              </button>
            )}
          </div>
        </div>
        <p className="text-green-200 text-sm">{unread > 0 ? `${unread} unread` : "All caught up"}</p>
      </div>

      <div className="px-4 py-4 space-y-3">
        {isLoading ? (
          [1,2,3,4,5].map(i => <div key={i} className="h-20 bg-white rounded-2xl animate-pulse"/>)
        ) : notifs.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm px-4 py-20 text-center">
            <p className="text-5xl mb-4">🔔</p>
            <p className="font-bold text-gray-700">No notifications yet</p>
            <p className="text-sm text-gray-400 mt-1">Order & delivery alerts will appear here</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <p className="text-sm font-bold text-gray-700">{notifs.length} notifications</p>
              {unread > 0 && <span className="text-xs font-bold bg-red-100 text-red-600 px-2.5 py-1 rounded-full">{unread} unread</span>}
            </div>
            <div className="divide-y divide-gray-50">
              {notifs.map((n: any) => (
                <div key={n.id} className={`px-4 py-4 flex gap-3 ${!n.isRead ? "bg-green-50/40" : ""}`}>
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 text-xl ${!n.isRead ? "bg-green-100" : "bg-gray-100"}`}>
                    {typeIcon(n.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-bold leading-snug ${!n.isRead ? "text-gray-900" : "text-gray-700"}`}>{n.title}</p>
                      {!n.isRead && <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0 mt-1.5"/>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.body}</p>
                    <p className="text-[10px] text-gray-400 mt-1.5 font-medium">{fd(n.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
