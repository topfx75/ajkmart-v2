import { RefreshCw, AlertTriangle, ClipboardList, Wallet, Bell } from "lucide-react";

export function SkeletonCard({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`bg-white rounded-3xl border border-gray-100 p-4 animate-pulse shadow-sm ${className}`} aria-hidden="true">
      <div className="flex gap-3 items-center">
        <div className="w-10 h-10 bg-gray-100 rounded-2xl flex-shrink-0" />
        <div className="flex-1 space-y-2">
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className={`h-3 bg-gray-100 rounded-full ${i === 0 ? "w-3/4" : "w-1/2"}`} />
          ))}
        </div>
        <div className="h-5 w-16 bg-gray-100 rounded-full" />
      </div>
    </div>
  );
}

export function SkeletonList({ count = 5, lines = 2 }: { count?: number; lines?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading content">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

interface PageErrorProps {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function PageError({ message = "Something went wrong. Please try again.", onRetry, retryLabel = "Try Again", className = "" }: PageErrorProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${className}`} role="alert" aria-live="assertive">
      <div className="w-16 h-16 bg-red-50 rounded-3xl flex items-center justify-center mb-4">
        <AlertTriangle size={28} className="text-red-400" aria-hidden="true" />
      </div>
      <p className="font-bold text-gray-800 text-base mb-1">Something went wrong</p>
      <p className="text-sm text-gray-400 mb-5 max-w-xs">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 h-10 px-5 bg-gray-900 text-white font-bold rounded-xl text-sm hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-700 focus:ring-offset-2"
          aria-label={retryLabel}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

type EmptyIcon = "list" | "wallet" | "bell" | string;

interface PageEmptyProps {
  icon?: EmptyIcon;
  emoji?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

function EmptyIconEl({ icon }: { icon: EmptyIcon }) {
  if (icon === "list")   return <ClipboardList size={32} className="text-gray-300" aria-hidden="true" />;
  if (icon === "wallet") return <Wallet size={32} className="text-gray-300" aria-hidden="true" />;
  if (icon === "bell")   return <Bell size={32} className="text-gray-300" aria-hidden="true" />;
  return <ClipboardList size={32} className="text-gray-300" aria-hidden="true" />;
}

export function PageEmpty({ icon, emoji, title, subtitle, action, className = "" }: PageEmptyProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 text-center ${className}`} role="status" aria-live="polite">
      <div className="w-16 h-16 bg-gray-100 rounded-3xl flex items-center justify-center mb-4">
        {emoji
          ? <span className="text-3xl" role="img" aria-hidden="true">{emoji}</span>
          : <EmptyIconEl icon={icon ?? "list"} />
        }
      </div>
      <p className="font-bold text-gray-700 text-base mb-1">{title}</p>
      {subtitle && <p className="text-sm text-gray-400 max-w-xs mb-4">{subtitle}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
