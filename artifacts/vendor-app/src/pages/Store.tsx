import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { PageHeader } from "../components/PageHeader";
import { fc, CARD, CARD_HEADER, INPUT, TEXTAREA, BTN_PRIMARY, LABEL } from "../lib/ui";

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DEFAULT_HOURS = Object.fromEntries(DAYS.map(d => [d, { open:"09:00", close:"22:00", closed:false }]));

export default function Store() {
  const { user, refreshUser } = useAuth();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const promoEnabled = config.vendor?.promoEnabled !== false;
  const qc = useQueryClient();
  const [tab, setTab] = useState<"info"|"hours"|"promos">("info");
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const [sf, setSf] = useState({
    storeName:         user?.storeName || "",
    storeCategory:     user?.storeCategory || "",
    storeDescription:  user?.storeDescription || "",
    storeBanner:       user?.storeBanner || "",
    storeAnnouncement: user?.storeAnnouncement || "",
    storeDeliveryTime: user?.storeDeliveryTime || "",
    storeMinOrder:     user?.storeMinOrder ? String(user.storeMinOrder) : "0",
  });
  const s = (k: string, v: any) => setSf(p => ({ ...p, [k]: v }));

  const [hours, setHours] = useState<Record<string, { open:string; close:string; closed:boolean }>>(() => {
    if (!user?.storeHours) return DEFAULT_HOURS;
    if (typeof user.storeHours === "string") {
      try { return JSON.parse(user.storeHours); } catch { return DEFAULT_HOURS; }
    }
    return user.storeHours;
  });

  useEffect(() => {
    if (!user) return;
    setSf({
      storeName:         user.storeName || "",
      storeCategory:     user.storeCategory || "",
      storeDescription:  user.storeDescription || "",
      storeBanner:       user.storeBanner || "",
      storeAnnouncement: user.storeAnnouncement || "",
      storeDeliveryTime: user.storeDeliveryTime || "",
      storeMinOrder:     user.storeMinOrder ? String(user.storeMinOrder) : "0",
    });
    if (user.storeHours) {
      const parsed = typeof user.storeHours === "string"
        ? (() => { try { return JSON.parse(user.storeHours as string); } catch { return null; } })()
        : user.storeHours;
      if (parsed) setHours(parsed);
    }
  }, [user?.id, user?.storeName, user?.storeHours]);

  const storeMut = useMutation({
    mutationFn: () => api.updateStore({ ...sf, storeMinOrder: Number(sf.storeMinOrder) }),
    onSuccess: () => { refreshUser(); showToast("✅ Store info saved!"); },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const hoursMut = useMutation({
    mutationFn: () => api.updateStore({ storeHours: JSON.stringify(hours) }),
    onSuccess: () => { refreshUser(); showToast("✅ Hours saved!"); },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const { data: promoData, isLoading: promoLoad } = useQuery({ queryKey: ["vendor-promos"], queryFn: () => api.getPromos(), enabled: tab === "promos" });
  const promos = promoData?.promos || [];

  const [pf, setPf] = useState({ code:"", description:"", discountPct:"", discountFlat:"", minOrderAmount:"", usageLimit:"", expiresAt:"", type:"pct" as "pct"|"flat" });
  const p = (k: string, v: any) => setPf(x => ({ ...x, [k]: v }));

  const createPromoMut = useMutation({
    mutationFn: () => api.createPromo({
      code: pf.code, description: pf.description,
      discountPct:    pf.type==="pct"  && pf.discountPct  ? Number(pf.discountPct)  : null,
      discountFlat:   pf.type==="flat" && pf.discountFlat ? Number(pf.discountFlat) : null,
      minOrderAmount: pf.minOrderAmount ? Number(pf.minOrderAmount) : 0,
      usageLimit:     pf.usageLimit ? Number(pf.usageLimit) : null,
      expiresAt:      pf.expiresAt || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-promos"] }); setPf({ code:"",description:"",discountPct:"",discountFlat:"",minOrderAmount:"",usageLimit:"",expiresAt:"",type:"pct" }); showToast("✅ Promo created!"); },
    onError: (e: any) => showToast("❌ " + e.message),
  });

  const togglePromoMut = useMutation({
    mutationFn: (id: string) => api.togglePromo(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vendor-promos"] }),
    onError: (e: any) => showToast("❌ " + (e.message || "Promo update failed")),
  });

  const deletePromoMut = useMutation({
    mutationFn: (id: string) => api.deletePromo(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-promos"] }); showToast("🗑️ Promo deleted"); },
    onError: (e: any) => showToast("❌ " + (e.message || "Delete failed")),
  });

  const TABS = [
    { key:"info",   label:"Store Info", icon:"🏪" },
    { key:"hours",  label:"Hours",      icon:"🕐" },
    { key:"promos", label:"Promos",     icon:"🎟️" },
  ];

  return (
    <div className="bg-gray-50 md:bg-transparent">
      <PageHeader
        title={T("myStore")}
        subtitle={user?.storeName || T("storeSettings")}
        actions={
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${user?.storeIsOpen ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
            {user?.storeIsOpen ? "🟢 Open" : "🔴 Closed"}
          </span>
        }
      />

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 flex sticky top-0 z-10">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`flex-1 flex flex-col md:flex-row items-center md:justify-center md:gap-2 py-3 text-[11px] md:text-sm font-bold border-b-2 transition-colors android-press min-h-0
              ${tab === t.key ? "border-orange-500 text-orange-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            <span className="text-lg md:text-base mb-0.5 md:mb-0">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-4 py-4 space-y-4 md:px-0 md:py-4">
        {/* ── STORE INFO ── */}
        {tab === "info" && (
          <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
            <div className="space-y-4">
              {user?.storeBanner && (
                <div className="rounded-2xl overflow-hidden h-36 bg-gray-100">
                  <img src={user.storeBanner} alt="Banner" className="w-full h-full object-cover"/>
                </div>
              )}
              <div className={`${CARD} p-4 space-y-3`}>
                {[
                  { label:"Store Name",           key:"storeName",         placeholder:"My Awesome Store",                  type:"text" },
                  { label:"Category",             key:"storeCategory",     placeholder:"restaurant / grocery / pharmacy...", type:"text" },
                  { label:"Announcement / Notice",key:"storeAnnouncement", placeholder:"20% off all items today!",           type:"text" },
                ].map(({ label, key, placeholder, type }) => (
                  <div key={key}>
                    <label className={LABEL}>{label}</label>
                    <input type={type} value={(sf as any)[key]} onChange={e => s(key, e.target.value)} placeholder={placeholder} className={INPUT}/>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <div className={`${CARD} p-4 space-y-3`}>
                {[
                  { label:"Banner Image URL",     key:"storeBanner",       placeholder:"https://...",      type:"url"  },
                  { label:"Est. Delivery Time",   key:"storeDeliveryTime", placeholder:"30-45 min",        type:"text" },
                ].map(({ label, key, placeholder, type }) => (
                  <div key={key}>
                    <label className={LABEL}>{label}</label>
                    <input type={type} value={(sf as any)[key]} onChange={e => s(key, e.target.value)} placeholder={placeholder} className={INPUT}/>
                  </div>
                ))}
                <div>
                  <label className={LABEL}>Min Order (Rs.)</label>
                  <input type="number" inputMode="numeric" value={sf.storeMinOrder} onChange={e => s("storeMinOrder", e.target.value)} placeholder="0" className={INPUT}/>
                </div>
                <div>
                  <label className={LABEL}>About Store</label>
                  <textarea value={sf.storeDescription} onChange={e => s("storeDescription", e.target.value)} placeholder="Tell customers about your store..." rows={3} className={TEXTAREA}/>
                </div>
              </div>
              <button onClick={() => storeMut.mutate()} disabled={storeMut.isPending} className={BTN_PRIMARY}>
                {storeMut.isPending ? "Saving..." : "💾 Save Store Info"}
              </button>
            </div>
          </div>
        )}

        {/* ── HOURS ── */}
        {tab === "hours" && (
          <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
            <div className={CARD}>
              <div className={`${CARD_HEADER} bg-gray-50`}>
                <p className="font-bold text-gray-800 text-sm">Operating Hours</p>
                <p className="text-xs text-gray-400">Per-day open/close times</p>
              </div>
              <div className="divide-y divide-gray-50">
                {DAYS.slice(0,4).map(day => {
                  const h = hours[day] || { open:"09:00", close:"22:00", closed:false };
                  return (
                    <div key={day} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-bold text-sm text-gray-800">{day}</p>
                        <button onClick={() => setHours(prev => ({ ...prev, [day]: { ...h, closed: !h.closed } }))}
                          className={`text-xs font-bold px-3 py-1.5 rounded-full android-press min-h-0 ${h.closed ? "bg-red-100 text-red-600" : "bg-green-100 text-green-700"}`}>
                          {h.closed ? "Closed" : "Open"}
                        </button>
                      </div>
                      {!h.closed && (
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <p className="text-[10px] text-gray-400 font-bold mb-1">OPENS</p>
                            <input type="time" value={h.open} onChange={e => setHours(prev => ({ ...prev, [day]: { ...h, open: e.target.value } }))}
                              className="w-full h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-orange-400 text-sm"/>
                          </div>
                          <span className="text-gray-300 font-bold mt-4">—</span>
                          <div className="flex-1">
                            <p className="text-[10px] text-gray-400 font-bold mb-1">CLOSES</p>
                            <input type="time" value={h.close} onChange={e => setHours(prev => ({ ...prev, [day]: { ...h, close: e.target.value } }))}
                              className="w-full h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-orange-400 text-sm"/>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className={CARD}>
              <div className={`${CARD_HEADER} bg-gray-50`}>
                <p className="font-bold text-gray-800 text-sm">Weekend Hours</p>
              </div>
              <div className="divide-y divide-gray-50">
                {DAYS.slice(4).map(day => {
                  const h = hours[day] || { open:"09:00", close:"22:00", closed:false };
                  return (
                    <div key={day} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-bold text-sm text-gray-800">{day}</p>
                        <button onClick={() => setHours(prev => ({ ...prev, [day]: { ...h, closed: !h.closed } }))}
                          className={`text-xs font-bold px-3 py-1.5 rounded-full android-press min-h-0 ${h.closed ? "bg-red-100 text-red-600" : "bg-green-100 text-green-700"}`}>
                          {h.closed ? "Closed" : "Open"}
                        </button>
                      </div>
                      {!h.closed && (
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <p className="text-[10px] text-gray-400 font-bold mb-1">OPENS</p>
                            <input type="time" value={h.open} onChange={e => setHours(prev => ({ ...prev, [day]: { ...h, open: e.target.value } }))}
                              className="w-full h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-orange-400 text-sm"/>
                          </div>
                          <span className="text-gray-300 font-bold mt-4">—</span>
                          <div className="flex-1">
                            <p className="text-[10px] text-gray-400 font-bold mb-1">CLOSES</p>
                            <input type="time" value={h.close} onChange={e => setHours(prev => ({ ...prev, [day]: { ...h, close: e.target.value } }))}
                              className="w-full h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-orange-400 text-sm"/>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="md:col-span-2 mt-4 md:mt-0">
              <button onClick={() => hoursMut.mutate()} disabled={hoursMut.isPending} className={BTN_PRIMARY}>
                {hoursMut.isPending ? "Saving..." : "💾 Save Hours"}
              </button>
            </div>
          </div>
        )}

        {/* ── PROMOS ── */}
        {tab === "promos" && !promoEnabled && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
            <p className="text-4xl mb-3">🔒</p>
            <p className="font-bold text-amber-800 text-base">Promo Codes Disabled</p>
            <p className="text-sm text-amber-600 mt-1 leading-relaxed">Admin ne abhi promo code creation disable ki hui hai. Jald hi wapas aayega!</p>
          </div>
        )}
        {tab === "promos" && promoEnabled && (
          <div className="md:grid md:grid-cols-2 md:gap-6 space-y-4 md:space-y-0">
            <div>
              <div className={`${CARD} p-4 space-y-3`}>
                <p className="font-bold text-gray-800 text-base">🎟️ Create Promo Code</p>
                <div>
                  <label className={LABEL}>Promo Code *</label>
                  <input value={pf.code} onChange={e => p("code", e.target.value.toUpperCase())} placeholder="SUMMER20"
                    className={`${INPUT} font-extrabold tracking-[0.2em]`}/>
                </div>
                <div>
                  <label className={LABEL}>Discount Type</label>
                  <div className="flex gap-2">
                    <button onClick={() => p("type","pct")}  className={`flex-1 h-11 rounded-xl text-sm font-bold border-2 android-press min-h-0 ${pf.type==="pct"  ? "border-orange-500 bg-orange-50 text-orange-600" : "border-gray-200 text-gray-400"}`}>% Percentage</button>
                    <button onClick={() => p("type","flat")} className={`flex-1 h-11 rounded-xl text-sm font-bold border-2 android-press min-h-0 ${pf.type==="flat" ? "border-orange-500 bg-orange-50 text-orange-600" : "border-gray-200 text-gray-400"}`}>Rs. Flat</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>{pf.type === "pct" ? "Discount %" : "Flat Amount"} *</label>
                    <input type="number" inputMode="numeric" value={pf.type==="pct" ? pf.discountPct : pf.discountFlat} onChange={e => p(pf.type==="pct" ? "discountPct" : "discountFlat", e.target.value)} placeholder={pf.type==="pct" ? "20" : "100"} className={INPUT}/>
                  </div>
                  <div>
                    <label className={LABEL}>Min Order (Rs.)</label>
                    <input type="number" inputMode="numeric" value={pf.minOrderAmount} onChange={e => p("minOrderAmount",e.target.value)} placeholder="500" className={INPUT}/>
                  </div>
                  <div>
                    <label className={LABEL}>Usage Limit</label>
                    <input type="number" inputMode="numeric" value={pf.usageLimit} onChange={e => p("usageLimit",e.target.value)} placeholder="100" className={INPUT}/>
                  </div>
                  <div>
                    <label className={LABEL}>Expires On</label>
                    <input type="date" value={pf.expiresAt} onChange={e => p("expiresAt",e.target.value)} className={INPUT}/>
                  </div>
                  <div className="col-span-2">
                    <label className={LABEL}>Description</label>
                    <input value={pf.description} onChange={e => p("description",e.target.value)} placeholder="Get 20% off on all items" className={INPUT}/>
                  </div>
                </div>
                <button onClick={() => createPromoMut.mutate()} disabled={!pf.code || (!pf.discountPct && !pf.discountFlat) || createPromoMut.isPending} className={BTN_PRIMARY}>
                  {createPromoMut.isPending ? "Creating..." : "🎟️ Create Promo Code"}
                </button>
              </div>
            </div>

            <div>
              <p className="font-bold text-gray-700 text-sm mb-3">Active Promo Codes</p>
              {promoLoad ? (
                <div className="h-16 skeleton rounded-2xl"/>
              ) : promos.length === 0 ? (
                <div className={`${CARD} px-4 py-12 text-center`}>
                  <p className="text-4xl mb-2">🎟️</p>
                  <p className="font-bold text-gray-600 text-base">No promo codes yet</p>
                  <p className="text-sm text-gray-400 mt-1">Create your first one</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {promos.map((pm: any) => (
                    <div key={pm.id} className={`${CARD} border-2 ${pm.isActive ? "border-orange-200" : "border-gray-200 opacity-60"}`}>
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-extrabold text-xl text-gray-800 tracking-widest">{pm.code}</p>
                            {pm.description && <p className="text-xs text-gray-500 mt-0.5">{pm.description}</p>}
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <span className="text-xs bg-orange-50 text-orange-600 font-bold px-2.5 py-1 rounded-full">
                                {pm.discountPct > 0 ? `${pm.discountPct}% OFF` : `Rs. ${pm.discountFlat} OFF`}
                              </span>
                              {pm.minOrderAmount > 0 && <span className="text-xs text-gray-400">Min: {fc(pm.minOrderAmount)}</span>}
                              {pm.usageLimit && <span className="text-xs text-gray-400">{pm.usedCount}/{pm.usageLimit} used</span>}
                            </div>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <button onClick={() => togglePromoMut.mutate(pm.id)} className={`h-9 px-3 text-xs font-bold rounded-xl android-press min-h-0 ${pm.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                              {pm.isActive ? "Active" : "Off"}
                            </button>
                            <button onClick={() => deletePromoMut.mutate(pm.id)} className="h-9 px-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl android-press min-h-0">Del</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
