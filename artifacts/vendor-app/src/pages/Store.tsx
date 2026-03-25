import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

function fc(n: number) { return `Rs. ${Math.round(n).toLocaleString()}`; }

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DEFAULT_HOURS: Record<string, { open: string; close: string; closed: boolean }> = Object.fromEntries(
  DAYS.map(d => [d, { open: "09:00", close: "22:00", closed: false }])
);

export default function Store() {
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"info"|"hours"|"promos">("info");
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const [storeForm, setStoreForm] = useState({
    storeName:         user?.storeName || "",
    storeCategory:     user?.storeCategory || "",
    storeDescription:  user?.storeDescription || "",
    storeBanner:       user?.storeBanner || "",
    storeAnnouncement: user?.storeAnnouncement || "",
    storeDeliveryTime: user?.storeDeliveryTime || "",
    storeMinOrder:     user?.storeMinOrder ? String(user.storeMinOrder) : "0",
  });
  const sf = (k: string, v: any) => setStoreForm(f => ({ ...f, [k]: v }));

  const [hours, setHours] = useState<Record<string, { open: string; close: string; closed: boolean }>>(
    user?.storeHours ? (typeof user.storeHours === "string" ? JSON.parse(user.storeHours) : user.storeHours) as any : DEFAULT_HOURS
  );

  const storeMut = useMutation({
    mutationFn: () => api.updateStore({ ...storeForm, storeMinOrder: Number(storeForm.storeMinOrder) }),
    onSuccess: () => { refreshUser(); showToast("✅ Store info saved!"); },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const hoursMut = useMutation({
    mutationFn: () => api.updateStore({ storeHours: JSON.stringify(hours) }),
    onSuccess: () => { refreshUser(); showToast("✅ Hours saved!"); },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const { data: promoData, isLoading: promoLoading } = useQuery({ queryKey: ["vendor-promos"], queryFn: () => api.getPromos(), enabled: tab === "promos" });
  const promos = promoData?.promos || [];

  const [promoForm, setPromoForm] = useState({ code: "", description: "", discountPct: "", discountFlat: "", minOrderAmount: "", maxDiscount: "", usageLimit: "", expiresAt: "", discountType: "pct" as "pct"|"flat" });
  const pf = (k: string, v: any) => setPromoForm(f => ({ ...f, [k]: v }));

  const createPromoMut = useMutation({
    mutationFn: () => api.createPromo({
      code: promoForm.code, description: promoForm.description,
      discountPct:    promoForm.discountType === "pct"  && promoForm.discountPct  ? Number(promoForm.discountPct)  : null,
      discountFlat:   promoForm.discountType === "flat" && promoForm.discountFlat ? Number(promoForm.discountFlat) : null,
      minOrderAmount: promoForm.minOrderAmount ? Number(promoForm.minOrderAmount) : 0,
      maxDiscount:    promoForm.maxDiscount    ? Number(promoForm.maxDiscount)    : null,
      usageLimit:     promoForm.usageLimit     ? Number(promoForm.usageLimit)     : null,
      expiresAt:      promoForm.expiresAt || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendor-promos"] });
      setPromoForm({ code:"",description:"",discountPct:"",discountFlat:"",minOrderAmount:"",maxDiscount:"",usageLimit:"",expiresAt:"",discountType:"pct" });
      showToast("✅ Promo code created!");
    },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const togglePromoMut = useMutation({
    mutationFn: (id: string) => api.togglePromo(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vendor-promos"] }),
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const deletePromoMut = useMutation({
    mutationFn: (id: string) => api.deletePromo(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-promos"] }); showToast("🗑️ Promo deleted"); },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  return (
    <div className="min-h-screen bg-gray-50 page-enter">
      {/* Banner / Header */}
      <div className="relative">
        {user?.storeBanner ? (
          <img src={user.storeBanner} alt="Banner" className="w-full h-44 object-cover"/>
        ) : (
          <div
            className="w-full h-44 bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center"
            style={{ paddingTop: "env(safe-area-inset-top,0px)" }}
          >
            <p className="text-white/60 text-sm font-semibold">No banner · Add one in Store Info</p>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex flex-col justify-end px-5 pb-4"
          style={{ paddingTop: "env(safe-area-inset-top,0px)" }}>
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-xl font-extrabold text-white">{user?.storeName || "My Store"}</h1>
              {user?.storeCategory && <p className="text-white/80 text-xs capitalize mt-0.5">{user.storeCategory}</p>}
            </div>
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${user?.storeIsOpen ? "bg-green-400 text-white" : "bg-red-400 text-white"}`}>
              {user?.storeIsOpen ? "🟢 Open" : "🔴 Closed"}
            </span>
          </div>
        </div>
      </div>

      {/* Announcement Ticker */}
      {user?.storeAnnouncement && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 overflow-hidden flex items-center gap-2">
          <span className="text-base flex-shrink-0">📢</span>
          <p className="text-xs font-semibold text-amber-700 truncate">{user.storeAnnouncement}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 flex sticky top-0 z-10 card-1">
        {[
          { key: "info",   label: "Store Info", icon: "🏪" },
          { key: "hours",  label: "Hours",      icon: "🕐" },
          { key: "promos", label: "Promos",     icon: "🎟️" },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`flex-1 flex flex-col items-center py-2.5 text-xs font-bold border-b-2 transition-colors android-press min-h-0 ${tab === t.key ? "border-orange-500 text-orange-600" : "border-transparent text-gray-400"}`}
          >
            <span className="text-base mb-0.5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* ── STORE INFO TAB ── */}
        {tab === "info" && (
          <>
            <div className="bg-white rounded-2xl card-1 overflow-hidden">
              <div className="px-4 py-3.5 border-b border-gray-100">
                <p className="font-bold text-gray-800">Basic Information</p>
              </div>
              <div className="p-4 space-y-3">
                {[
                  { label: "Store Name",          key: "storeName",         placeholder: "My Awesome Store",                 type: "text" },
                  { label: "Category",             key: "storeCategory",     placeholder: "restaurant / grocery / pharmacy...", type: "text" },
                  { label: "Banner Image URL",     key: "storeBanner",       placeholder: "https://...",                       type: "url" },
                  { label: "Announcement / Notice",key: "storeAnnouncement", placeholder: "20% off on all items today!",       type: "text" },
                  { label: "Est. Delivery Time",   key: "storeDeliveryTime", placeholder: "30-45 min",                        type: "text" },
                ].map(({ label, key, placeholder, type }) => (
                  <div key={key}>
                    <label className="text-[10px] font-extrabold text-gray-400 mb-1 block uppercase tracking-widest">{label}</label>
                    <input
                      type={type} value={(storeForm as any)[key]}
                      onChange={e => sf(key, e.target.value)} placeholder={placeholder}
                      className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400 transition-all"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-[10px] font-extrabold text-gray-400 mb-1 block uppercase tracking-widest">Min Order (Rs.)</label>
                  <input
                    type="number" inputMode="numeric" value={storeForm.storeMinOrder}
                    onChange={e => sf("storeMinOrder", e.target.value)} placeholder="0"
                    className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-extrabold text-gray-400 mb-1 block uppercase tracking-widest">About Store</label>
                  <textarea
                    value={storeForm.storeDescription} onChange={e => sf("storeDescription", e.target.value)}
                    placeholder="Tell customers about your store..." rows={3}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                  />
                </div>
              </div>
            </div>
            <button onClick={() => storeMut.mutate()} disabled={storeMut.isPending} className="w-full h-13 bg-orange-500 text-white font-bold rounded-2xl disabled:opacity-60 android-press">
              {storeMut.isPending ? "Saving..." : "💾 Save Store Info"}
            </button>
          </>
        )}

        {/* ── HOURS TAB ── */}
        {tab === "hours" && (
          <>
            <div className="bg-white rounded-2xl card-1 overflow-hidden">
              <div className="px-4 py-3.5 border-b border-gray-100">
                <p className="font-bold text-gray-800">Operating Hours</p>
                <p className="text-xs text-gray-400 mt-0.5">Set per-day open/close times</p>
              </div>
              <div className="divide-y divide-gray-50">
                {DAYS.map(day => {
                  const h = hours[day] || { open: "09:00", close: "22:00", closed: false };
                  return (
                    <div key={day} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-bold text-sm text-gray-800">{day}</p>
                        <button
                          onClick={() => setHours(prev => ({ ...prev, [day]: { ...h, closed: !h.closed } }))}
                          className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors android-press min-h-0 ${h.closed ? "bg-red-100 text-red-600" : "bg-green-100 text-green-700"}`}
                        >{h.closed ? "Closed" : "Open"}</button>
                      </div>
                      {!h.closed && (
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <label className="text-[10px] text-gray-400 font-bold">OPENS</label>
                            <input type="time" value={h.open}
                              onChange={e => setHours(prev => ({ ...prev, [day]: { ...h, open: e.target.value } }))}
                              className="w-full h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"/>
                          </div>
                          <span className="text-gray-300 mt-3 font-bold">—</span>
                          <div className="flex-1">
                            <label className="text-[10px] text-gray-400 font-bold">CLOSES</label>
                            <input type="time" value={h.close}
                              onChange={e => setHours(prev => ({ ...prev, [day]: { ...h, close: e.target.value } }))}
                              className="w-full h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"/>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <button onClick={() => hoursMut.mutate()} disabled={hoursMut.isPending} className="w-full h-13 bg-orange-500 text-white font-bold rounded-2xl disabled:opacity-60 android-press">
              {hoursMut.isPending ? "Saving..." : "💾 Save Hours"}
            </button>
          </>
        )}

        {/* ── PROMOS TAB ── */}
        {tab === "promos" && (
          <>
            <div className="bg-white rounded-2xl card-1 overflow-hidden">
              <div className="px-4 py-3.5 border-b border-gray-100">
                <p className="font-bold text-gray-800">🎟️ Create Promo Code</p>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-[10px] font-extrabold text-gray-400 mb-1 block uppercase tracking-widest">Promo Code *</label>
                  <input value={promoForm.code} onChange={e => pf("code", e.target.value.toUpperCase())} placeholder="SUMMER20"
                    className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base font-extrabold tracking-[0.2em] focus:outline-none focus:ring-2 focus:ring-orange-400"/>
                </div>
                <div>
                  <label className="text-[10px] font-extrabold text-gray-400 mb-1 block uppercase tracking-widest">Discount Type</label>
                  <div className="flex gap-2">
                    <button onClick={() => pf("discountType", "pct")} className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 android-press min-h-0 ${promoForm.discountType === "pct" ? "border-orange-500 bg-orange-50 text-orange-600" : "border-gray-200 text-gray-400"}`}>
                      % Percentage
                    </button>
                    <button onClick={() => pf("discountType", "flat")} className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 android-press min-h-0 ${promoForm.discountType === "flat" ? "border-orange-500 bg-orange-50 text-orange-600" : "border-gray-200 text-gray-400"}`}>
                      Rs. Flat
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-extrabold text-gray-400 mb-1 block uppercase tracking-widest">
                      {promoForm.discountType === "pct" ? "Discount %" : "Flat Amount"} *
                    </label>
                    <input type="number" inputMode="numeric"
                      value={promoForm.discountType === "pct" ? promoForm.discountPct : promoForm.discountFlat}
                      onChange={e => pf(promoForm.discountType === "pct" ? "discountPct" : "discountFlat", e.target.value)}
                      placeholder={promoForm.discountType === "pct" ? "20" : "100"}
                      className="w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"/>
                  </div>
                  <div>
                    <label className="text-[10px] font-extrabold text-gray-400 mb-1 block uppercase tracking-widest">Min Order</label>
                    <input type="number" inputMode="numeric" value={promoForm.minOrderAmount} onChange={e => pf("minOrderAmount", e.target.value)} placeholder="500"
                      className="w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"/>
                  </div>
                  <div>
                    <label className="text-[10px] font-extrabold text-gray-400 mb-1 block uppercase tracking-widest">Usage Limit</label>
                    <input type="number" inputMode="numeric" value={promoForm.usageLimit} onChange={e => pf("usageLimit", e.target.value)} placeholder="100"
                      className="w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"/>
                  </div>
                  <div>
                    <label className="text-[10px] font-extrabold text-gray-400 mb-1 block uppercase tracking-widest">Expires On</label>
                    <input type="date" value={promoForm.expiresAt} onChange={e => pf("expiresAt", e.target.value)}
                      className="w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"/>
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-extrabold text-gray-400 mb-1 block uppercase tracking-widest">Description</label>
                    <input value={promoForm.description} onChange={e => pf("description", e.target.value)} placeholder="Get 20% off on all items"
                      className="w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"/>
                  </div>
                </div>
                <button
                  onClick={() => createPromoMut.mutate()}
                  disabled={!promoForm.code || (!promoForm.discountPct && !promoForm.discountFlat) || createPromoMut.isPending}
                  className="w-full h-12 bg-orange-500 text-white font-bold rounded-xl disabled:opacity-60 android-press"
                >{createPromoMut.isPending ? "Creating..." : "🎟️ Create Promo Code"}</button>
              </div>
            </div>

            {/* Promo List */}
            {promoLoading ? (
              <div className="h-20 skeleton rounded-2xl"/>
            ) : promos.length === 0 ? (
              <div className="text-center py-10 bg-white rounded-2xl card-1">
                <p className="text-4xl mb-2">🎟️</p>
                <p className="font-bold text-gray-600">No promo codes yet</p>
                <p className="text-gray-400 text-sm mt-1">Create your first one above</p>
              </div>
            ) : (
              promos.map((p: any) => (
                <div key={p.id} className={`bg-white rounded-2xl card-1 overflow-hidden border-2 ${p.isActive ? "border-orange-200" : "border-gray-200 opacity-60"}`}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-extrabold text-xl text-gray-800 tracking-widest">{p.code}</p>
                        {p.description && <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-xs bg-orange-50 text-orange-600 font-bold px-2.5 py-1 rounded-full">
                            {p.discountPct > 0 ? `${p.discountPct}% OFF` : `Rs. ${p.discountFlat} OFF`}
                          </span>
                          {p.minOrderAmount > 0 && <span className="text-xs text-gray-400">Min: {fc(p.minOrderAmount)}</span>}
                          {p.usageLimit && <span className="text-xs text-gray-400">{p.usedCount}/{p.usageLimit} used</span>}
                          {p.expiresAt && <span className="text-xs text-gray-400">Exp: {new Date(p.expiresAt).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        <button onClick={() => togglePromoMut.mutate(p.id)} className={`text-xs font-bold px-3 py-2 rounded-xl android-press min-h-0 ${p.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {p.isActive ? "Active" : "Off"}
                        </button>
                        <button onClick={() => deletePromoMut.mutate(p.id)} className="text-xs bg-red-50 text-red-600 font-bold px-3 py-2 rounded-xl android-press min-h-0">Del</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {toast && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center toast-in"
          style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 8px)", paddingLeft: "16px", paddingRight: "16px" }}>
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl max-w-sm w-full text-center">{toast}</div>
        </div>
      )}
    </div>
  );
}
