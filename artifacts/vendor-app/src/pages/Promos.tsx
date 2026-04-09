import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { PageHeader } from "../components/PageHeader";
import { PullToRefresh } from "../components/PullToRefresh";
import { PageError, SkeletonList } from "../components/PageStates";
import { fc, CARD, INPUT, SELECT, BTN_PRIMARY, BTN_SECONDARY, LABEL, errMsg } from "../lib/ui";

const EMPTY_PROMO = {
  title: "",
  code: "",
  discountType: "percentage" as "percentage" | "fixed",
  discountValue: "",
  minOrder: "",
  maxUses: "",
  expiresAt: "",
};

export default function Promos() {
  const qc = useQueryClient();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_PROMO });
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };
  const f = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["vendor-promos"],
    queryFn: () => apiFetch("/vendor/promos"),
    retry: 2,
  });

  const promos: any[] = data?.promos ?? data ?? [];

  const createMut = useMutation({
    mutationFn: () => apiFetch("/vendor/promos", {
      method: "POST",
      body: JSON.stringify({
        title:         form.title.trim(),
        code:          form.code.trim().toUpperCase(),
        discountType:  form.discountType,
        discountValue: Number(form.discountValue),
        minOrder:      form.minOrder ? Number(form.minOrder) : null,
        maxUses:       form.maxUses  ? Number(form.maxUses)  : null,
        expiresAt:     form.expiresAt || null,
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-promos"] }); setShowAdd(false); setForm({ ...EMPTY_PROMO }); showToast("✅ Promo created!"); },
    onError: (e: Error) => showToast("❌ " + errMsg(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/vendor/promos/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendor-promos"] }); showToast("🗑️ Promo deleted"); },
    onError: (e: Error) => showToast("❌ " + errMsg(e)),
  });

  const validate = () => {
    if (!form.title.trim())      { showToast("❌ Title required"); return false; }
    if (!form.code.trim())       { showToast("❌ Promo code required"); return false; }
    if (!form.discountValue || Number.isNaN(Number(form.discountValue)) || Number(form.discountValue) <= 0) { showToast("❌ Valid discount value required"); return false; }
    if (form.discountType === "percentage" && Number(form.discountValue) > 100) { showToast("❌ Percentage cannot exceed 100"); return false; }
    return true;
  };

  return (
    <PullToRefresh onRefresh={async () => { await refetch(); }}>
      <div className="px-4 pt-4 pb-6 space-y-4">
        <PageHeader
          title={T("promotions")}
          subtitle={`${promos.length} ${T("activePromos")}`}
          actions={
            <button onClick={() => setShowAdd(!showAdd)} className={BTN_PRIMARY + " h-9 px-4 text-sm"}
              aria-expanded={showAdd} aria-controls="promo-add-form">
              {showAdd ? T("cancel") : `+ ${T("newPromo")}`}
            </button>
          }
        />

        {/* Add form */}
        {showAdd && (
          <div id="promo-add-form" className={`${CARD} space-y-4`}>
            <h3 className="font-extrabold text-gray-800 text-sm">{T("createPromotion")}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>{T("promoTitle")} *</label>
                <input value={form.title} onChange={e => f("title", e.target.value)} placeholder="Eid Sale 20% Off" className={INPUT} aria-required="true" />
              </div>
              <div>
                <label className={LABEL}>{T("promoCode")} *</label>
                <input value={form.code} onChange={e => f("code", e.target.value.toUpperCase())} placeholder="EID20" className={INPUT + " font-mono uppercase"} aria-required="true" />
              </div>
              <div>
                <label className={LABEL}>{T("discountType")} *</label>
                <select value={form.discountType} onChange={e => f("discountType", e.target.value)} className={SELECT}>
                  <option value="percentage">{T("percentage")} (%)</option>
                  <option value="fixed">{T("fixedAmount")} (Rs.)</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>{T("discountValue")} *</label>
                <input type="number" min="0" value={form.discountValue} onChange={e => f("discountValue", e.target.value)} placeholder={form.discountType === "percentage" ? "20" : "50"} className={INPUT} aria-required="true" />
              </div>
              <div>
                <label className={LABEL}>{T("minOrder")} (Rs.)</label>
                <input type="number" min="0" value={form.minOrder} onChange={e => f("minOrder", e.target.value)} placeholder={T("optional")} className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>{T("maxUses")}</label>
                <input type="number" min="1" value={form.maxUses} onChange={e => f("maxUses", e.target.value)} placeholder={T("unlimited")} className={INPUT} />
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL}>{T("expiresAt")}</label>
                <input type="datetime-local" value={form.expiresAt} onChange={e => f("expiresAt", e.target.value)} className={INPUT} />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => { setShowAdd(false); setForm({ ...EMPTY_PROMO }); }} className={BTN_SECONDARY + " flex-1 h-11"}>{T("cancel")}</button>
              <button onClick={() => { if (validate()) createMut.mutate(); }} disabled={createMut.isPending} className={BTN_PRIMARY + " flex-1 h-11"}>
                {createMut.isPending ? T("creating") : T("createPromo")}
              </button>
            </div>
          </div>
        )}

        {isError && (
          <PageError
            message={T("somethingWentWrong")}
            onRetry={() => refetch()}
            retryLabel={T("tryAgain")}
          />
        )}

        {/* Promos list */}
        {isLoading ? (
          <SkeletonList count={3} />
        ) : promos.length === 0 ? (
          <div className={`${CARD} flex flex-col items-center justify-center h-40 text-center`} aria-live="polite">
            <span className="text-4xl mb-3">🏷️</span>
            <p className="font-bold text-gray-700">{T("noPromosYet")}</p>
            <p className="text-xs text-gray-400 mt-1">{T("createFirstPromo")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {promos.map((promo: any) => {
              const expired = promo.expiresAt && new Date(promo.expiresAt) < new Date();
              return (
                <div key={promo.id} className={`${CARD} flex items-start gap-3`}>
                  <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0 text-lg">🏷️</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-extrabold text-gray-800 text-sm">{promo.title}</p>
                      <span className="font-mono bg-orange-50 text-orange-700 border border-orange-200 text-[10px] px-2 py-0.5 rounded-lg font-bold">{promo.code}</span>
                      {expired && <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">Expired</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {promo.discountType === "percentage"
                        ? `${promo.discountValue}% off`
                        : `${fc(promo.discountValue)} off`}
                      {promo.minOrder ? ` · Min order ${fc(promo.minOrder)}` : ""}
                      {promo.maxUses  ? ` · Max ${promo.maxUses} uses` : ""}
                    </p>
                    {promo.expiresAt && (
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Expires: {new Date(promo.expiresAt).toLocaleDateString("en-PK")}
                      </p>
                    )}
                    {promo.usedCount != null && (
                      <p className="text-[10px] text-gray-400">Used {promo.usedCount} time{promo.usedCount !== 1 ? "s" : ""}</p>
                    )}
                  </div>
                  <button
                    onClick={() => { if (confirm("Delete this promo?")) deleteMut.mutate(promo.id); }}
                    disabled={deleteMut.isPending}
                    className="text-xs text-red-400 hover:text-red-600 font-bold flex-shrink-0 mt-1">
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-xl z-50 max-w-xs text-center">
            {toast}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
