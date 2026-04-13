import { Package, TrendingUp, Calendar, Trophy } from "lucide-react";
import { formatCurrency } from "./helpers";

interface StatsGridProps {
  deliveriesToday: number;
  earningsToday: number;
  weekEarnings: number;
  totalDeliveries: number;
  currency: string;
}

export function StatsGrid({
  deliveriesToday,
  earningsToday,
  weekEarnings,
  totalDeliveries,
  currency,
}: StatsGridProps) {
  const stats = [
    {
      icon: <Package size={15} className="text-indigo-300" />,
      label: "Today",
      value: String(deliveriesToday),
      sub: "deliveries",
    },
    {
      icon: <TrendingUp size={15} className="text-green-300" />,
      label: "Earned",
      value: formatCurrency(earningsToday, currency),
      sub: "today",
    },
    {
      icon: <Calendar size={15} className="text-blue-300" />,
      label: "Week",
      value: formatCurrency(weekEarnings, currency),
      sub: "earnings",
    },
    {
      icon: <Trophy size={15} className="text-amber-300" />,
      label: "Total",
      value: String(totalDeliveries),
      sub: "lifetime",
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-2 mt-3" role="list" aria-label="Daily statistics">
      {stats.map((s, i) => (
        <div
          key={s.label}
          className="bg-white/[0.06] backdrop-blur-sm rounded-2xl p-2.5 text-center border border-white/[0.06] animate-[slideUp_0.3s_ease-out]"
          style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
          role="listitem"
        >
          <div className="flex justify-center mb-1.5">
            <div className="w-7 h-7 rounded-xl bg-white/[0.06] flex items-center justify-center">
              {s.icon}
            </div>
          </div>
          <p className="text-[13px] font-extrabold leading-tight text-white">{s.value}</p>
          <p className="text-[9px] text-white/30 mt-0.5 font-semibold uppercase tracking-wider">
            {s.sub}
          </p>
        </div>
      ))}
    </div>
  );
}
