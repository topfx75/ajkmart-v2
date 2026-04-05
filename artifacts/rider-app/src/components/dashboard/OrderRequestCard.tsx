import { CheckCircle, MapPin, Navigation, X, XCircle } from "lucide-react";
import { AcceptCountdown } from "./AcceptCountdown";
import { RequestAge } from "./RequestAge";
import { OrderTypeIcon } from "./Icons";
import { MiniMap } from "./MiniMap";
import { formatCurrency, buildMapsDeepLink, ACCEPT_TIMEOUT_SEC } from "./helpers";

interface OrderRequestCardProps {
  order: any;
  earnings: number;
  currency: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onDismiss: (id: string) => void;
  acceptPending: boolean;
  rejectPending: boolean;
  anyAcceptPending: boolean;
  T: (key: string) => string;
}

export function OrderRequestCard({
  order: o,
  earnings,
  currency,
  onAccept,
  onReject,
  onDismiss,
  acceptPending,
  rejectPending,
  anyAcceptPending,
  T,
}: OrderRequestCardProps) {
  const isExpired =
    (Date.now() - new Date(o.createdAt).getTime()) / 1000 >= ACCEPT_TIMEOUT_SEC;

  return (
    <div className="p-4 animate-[slideUp_0.3s_ease-out] border-b border-gray-50 last:border-0">
      <div className="flex items-start gap-3">
        <AcceptCountdown createdAt={o.createdAt} onExpired={() => onDismiss(o.id)} />
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 flex items-center justify-center flex-shrink-0 shadow-sm">
          <OrderTypeIcon type={o.type} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <p className="font-extrabold text-gray-900 text-[15px] capitalize tracking-tight">
              {o.type} Delivery
            </p>
            <RequestAge createdAt={o.createdAt} />
          </div>
          {o.vendorStoreName && (
            <p className="text-xs text-blue-600 font-semibold truncate flex items-center gap-1">
              <MapPin size={10} /> {o.vendorStoreName}
            </p>
          )}
          <p className="text-xs text-gray-400 truncate mt-0.5 flex items-center gap-1">
            <Navigation size={10} className="text-gray-300" />{" "}
            {o.deliveryAddress || "Destination"}
          </p>
        </div>
        <div className="bg-green-500 text-white rounded-2xl px-3 py-1.5 flex-shrink-0 text-right shadow-sm shadow-green-200">
          <p className="text-base font-extrabold leading-tight">
            +{formatCurrency(earnings, currency)}
          </p>
          <p className="text-[9px] text-green-100 font-semibold">{T("yourEarnings")}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-2 flex-wrap">
        {o.total && (
          <div className="bg-gray-50 rounded-xl px-2.5 py-1 border border-gray-100">
            <p className="text-xs font-bold text-gray-700">
              {formatCurrency(o.total, currency)}
            </p>
            <p className="text-[9px] text-gray-400">{T("orderTotal")}</p>
          </div>
        )}
        {o.itemCount && (
          <div className="bg-gray-50 rounded-xl px-2.5 py-1 border border-gray-100">
            <p className="text-xs font-bold text-gray-700">{o.itemCount} items</p>
            <p className="text-[9px] text-gray-400">{T("toCollect")}</p>
          </div>
        )}
        {o.distanceKm && (
          <div className="bg-blue-50 rounded-xl px-2.5 py-1 border border-blue-100">
            <p className="text-xs font-bold text-blue-700">
              {parseFloat(o.distanceKm).toFixed(1)} km
            </p>
            <p className="text-[9px] text-blue-400">{T("distance")}</p>
          </div>
        )}
      </div>

      {o.vendorLat != null && o.vendorLng != null && (
        <MiniMap
          pickupLat={o.vendorLat ? parseFloat(o.vendorLat) : null}
          pickupLng={o.vendorLng ? parseFloat(o.vendorLng) : null}
          dropLat={o.deliveryLat ? parseFloat(o.deliveryLat) : null}
          dropLng={o.deliveryLng ? parseFloat(o.deliveryLng) : null}
        />
      )}

      <div className="flex gap-2 mt-3">
        {o.deliveryAddress && (
          <a
            href={buildMapsDeepLink(null, null, o.deliveryAddress)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open delivery address in maps"
            className="flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-600 text-xs font-bold px-3 py-2.5 rounded-xl hover:bg-blue-100 transition-colors"
          >
            <MapPin size={14} />
          </a>
        )}
        <button
          onClick={() => onReject(o.id)}
          disabled={rejectPending}
          className="border border-red-200 text-red-400 font-bold px-3 py-2.5 rounded-xl text-sm hover:bg-red-50 transition-colors flex items-center gap-1 disabled:opacity-60"
          aria-label="Reject order"
        >
          <XCircle size={14} /> Reject
        </button>
        <button
          onClick={() => onDismiss(o.id)}
          className="border border-gray-200 text-gray-400 font-bold px-3 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors flex items-center"
          aria-label="Dismiss order request"
        >
          <X size={16} />
        </button>
        <button
          onClick={() => onAccept(o.id)}
          disabled={isExpired || acceptPending || anyAcceptPending}
          className="flex-1 bg-gray-900 hover:bg-gray-800 text-white font-extrabold py-2.5 rounded-xl text-sm disabled:opacity-60 transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-sm"
          aria-label="Accept order"
        >
          <CheckCircle size={15} />
          {acceptPending ? T("accepting") : T("acceptOrder")}
        </button>
      </div>
    </div>
  );
}
