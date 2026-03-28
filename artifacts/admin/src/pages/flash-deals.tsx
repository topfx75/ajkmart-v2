import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Zap, Plus, Pencil, Trash2, X, Save, ShoppingBag,
  Tag, Clock, Package, TicketPercent, ToggleLeft, ToggleRight, RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetcher } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";

/* ── Types ── */
interface Product { id: string; name: string; price: string | number; category: string; image?: string }
interface FlashDeal {
  id: string; productId: string; title?: string; badge: string;
  discountPct?: number; discountFlat?: number;
  startTime: string; endTime: string; dealStock?: number; soldCount: number;
  isActive: boolean; status: "live"|"scheduled"|"expired"|"sold_out"|"inactive";
  product?: Product; createdAt: string;
}
interface PromoCode {
  id: string; code: string; description?: string;
  discountPct?: number; discountFlat?: number;
  minOrderAmount: number; maxDiscount?: number;
  usageLimit?: number; usedCount: number;
  appliesTo: string; expiresAt?: string; isActive: boolean;
  status: "active"|"inactive"|"expired"|"exhausted";
  createdAt: string;
}

/* ── Status Badge ── */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    live:       { label: "⚡ Live",       className: "bg-green-100 text-green-700 border-green-200" },
    scheduled:  { label: "🕐 Scheduled",  className: "bg-blue-100 text-blue-700 border-blue-200" },
    expired:    { label: "⏱ Expired",    className: "bg-gray-100 text-gray-600 border-gray-200" },
    sold_out:   { label: "✖ Sold Out",   className: "bg-red-100 text-red-600 border-red-200" },
    inactive:   { label: "○ Inactive",   className: "bg-gray-100 text-gray-500 border-gray-200" },
    active:     { label: "✓ Active",     className: "bg-green-100 text-green-700 border-green-200" },
    exhausted:  { label: "✖ Exhausted",  className: "bg-orange-100 text-orange-600 border-orange-200" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-gray-100 text-gray-600" };
  return <Badge variant="outline" className={`text-xs font-semibold ${cfg.className}`}>{cfg.label}</Badge>;
}

/* ── Flash Deal Form ── */
const EMPTY_DEAL = {
  productId: "", title: "", badge: "FLASH",
  discountPct: "", discountFlat: "", startTime: "", endTime: "",
  dealStock: "", isActive: true,
};

function now8601() {
  const d = new Date(); d.setSeconds(0,0);
  return d.toISOString().slice(0,16);
}
function future8601(hours = 24) {
  const d = new Date(Date.now() + hours*3600*1000); d.setSeconds(0,0);
  return d.toISOString().slice(0,16);
}

/* ── Promo Code Form ── */
const EMPTY_PROMO = {
  code: "", description: "", discountPct: "", discountFlat: "",
  minOrderAmount: "0", maxDiscount: "", usageLimit: "",
  appliesTo: "all", expiresAt: "", isActive: true,
};

/* ══════════ Main Page ══════════ */
export default function FlashDealsPage() {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"flash"|"promo">("flash");

  /* ── Flash Deals state ── */
  const [dealForm, setDealForm] = useState({ ...EMPTY_DEAL });
  const [editingDeal, setEditingDeal] = useState<FlashDeal|null>(null);
  const [dealDialog, setDealDialog] = useState(false);

  /* ── Promo Codes state ── */
  const [promoForm, setPromoForm] = useState({ ...EMPTY_PROMO });
  const [editingPromo, setEditingPromo] = useState<PromoCode|null>(null);
  const [promoDialog, setPromoDialog] = useState(false);

  /* ── Queries ── */
  const { data: dealsData, isLoading: dealsLoading } = useQuery({
    queryKey: ["admin-flash-deals"],
    queryFn: () => fetcher("/flash-deals"),
    refetchInterval: 30000,
  });
  const { data: productsData } = useQuery({
    queryKey: ["admin-products-list"],
    queryFn: () => fetcher("/products"),
  });
  const { data: promoData, isLoading: promoLoading } = useQuery({
    queryKey: ["admin-promo-codes"],
    queryFn: () => fetcher("/promo-codes"),
    refetchInterval: 60000,
  });

  const deals: FlashDeal[]   = dealsData?.deals   || [];
  const products: Product[]  = productsData?.products || [];
  const promos: PromoCode[]  = promoData?.codes    || [];

  /* ── Flash Deal Mutations ── */
  const saveDeal = useMutation({
    mutationFn: async (body: any) => {
      if (editingDeal) return fetcher(`/flash-deals/${editingDeal.id}`, { method: "PATCH", body: JSON.stringify(body) });
      return fetcher("/flash-deals", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-flash-deals"] });
      setDealDialog(false); setEditingDeal(null); setDealForm({ ...EMPTY_DEAL });
      toast({ title: editingDeal ? "Deal updated ✅" : "Flash deal created ✅" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteDeal = useMutation({
    mutationFn: (id: string) => fetcher(`/flash-deals/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-flash-deals"] }); toast({ title: "Deal deleted" }); },
  });

  const toggleDeal = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      fetcher(`/flash-deals/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-flash-deals"] }),
  });

  /* ── Promo Code Mutations ── */
  const savePromo = useMutation({
    mutationFn: async (body: any) => {
      if (editingPromo) return fetcher(`/promo-codes/${editingPromo.id}`, { method: "PATCH", body: JSON.stringify(body) });
      return fetcher("/promo-codes", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-promo-codes"] });
      setPromoDialog(false); setEditingPromo(null); setPromoForm({ ...EMPTY_PROMO });
      toast({ title: editingPromo ? "Promo code updated ✅" : "Promo code created ✅" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deletePromo = useMutation({
    mutationFn: (id: string) => fetcher(`/promo-codes/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-promo-codes"] }); toast({ title: "Promo code deleted" }); },
  });

  const togglePromo = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      fetcher(`/promo-codes/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-promo-codes"] }),
  });

  /* ── Form handlers ── */
  const openNewDeal = () => {
    setEditingDeal(null);
    setDealForm({ ...EMPTY_DEAL, startTime: now8601(), endTime: future8601(24) });
    setDealDialog(true);
  };
  const openEditDeal = (d: FlashDeal) => {
    setEditingDeal(d);
    setDealForm({
      productId: d.productId, title: d.title||"", badge: d.badge,
      discountPct: d.discountPct!=null ? String(d.discountPct) : "",
      discountFlat: d.discountFlat!=null ? String(d.discountFlat) : "",
      startTime: d.startTime.slice(0,16),
      endTime:   d.endTime.slice(0,16),
      dealStock: d.dealStock!=null ? String(d.dealStock) : "",
      isActive: d.isActive,
    });
    setDealDialog(true);
  };
  const openNewPromo = () => {
    setEditingPromo(null);
    setPromoForm({ ...EMPTY_PROMO, expiresAt: future8601(24*30) });
    setPromoDialog(true);
  };
  const openEditPromo = (p: PromoCode) => {
    setEditingPromo(p);
    setPromoForm({
      code: p.code, description: p.description||"",
      discountPct: p.discountPct!=null ? String(p.discountPct) : "",
      discountFlat: p.discountFlat!=null ? String(p.discountFlat) : "",
      minOrderAmount: String(p.minOrderAmount||0),
      maxDiscount: p.maxDiscount!=null ? String(p.maxDiscount) : "",
      usageLimit: p.usageLimit!=null ? String(p.usageLimit) : "",
      appliesTo: p.appliesTo,
      expiresAt: p.expiresAt ? p.expiresAt.slice(0,16) : "",
      isActive: p.isActive,
    });
    setPromoDialog(true);
  };

  const submitDeal = () => {
    if (!dealForm.productId) { toast({ title: "Select a product", variant: "destructive" }); return; }
    if (!dealForm.startTime || !dealForm.endTime) { toast({ title: "Set start and end time", variant: "destructive" }); return; }
    if (!dealForm.discountPct && !dealForm.discountFlat) { toast({ title: "Set either discount % or flat amount", variant: "destructive" }); return; }
    saveDeal.mutate({
      productId: dealForm.productId,
      title: dealForm.title || null,
      badge: dealForm.badge,
      discountPct: dealForm.discountPct ? Number(dealForm.discountPct) : null,
      discountFlat: dealForm.discountFlat ? Number(dealForm.discountFlat) : null,
      startTime: dealForm.startTime,
      endTime: dealForm.endTime,
      dealStock: dealForm.dealStock ? Number(dealForm.dealStock) : null,
      isActive: dealForm.isActive,
    });
  };

  const submitPromo = () => {
    if (!promoForm.code) { toast({ title: "Promo code is required", variant: "destructive" }); return; }
    if (!promoForm.discountPct && !promoForm.discountFlat) { toast({ title: "Set either discount % or flat amount", variant: "destructive" }); return; }
    savePromo.mutate({
      code: promoForm.code,
      description: promoForm.description || null,
      discountPct: promoForm.discountPct ? Number(promoForm.discountPct) : null,
      discountFlat: promoForm.discountFlat ? Number(promoForm.discountFlat) : null,
      minOrderAmount: Number(promoForm.minOrderAmount||0),
      maxDiscount: promoForm.maxDiscount ? Number(promoForm.maxDiscount) : null,
      usageLimit: promoForm.usageLimit ? Number(promoForm.usageLimit) : null,
      appliesTo: promoForm.appliesTo,
      expiresAt: promoForm.expiresAt || null,
      isActive: promoForm.isActive,
    });
  };

  /* ── Stats ── */
  const liveDeals = deals.filter(d => d.status === "live").length;
  const activePromos = promos.filter(p => p.status === "active").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{T("flashDealsPromos")}</h1>
            <p className="text-muted-foreground text-sm">{liveDeals} live deal{liveDeals!==1?"s":""} · {activePromos} active promo code{activePromos!==1?"s":""}</p>
          </div>
        </div>
        <Button
          onClick={tab === "flash" ? openNewDeal : openNewPromo}
          className="h-10 rounded-xl gap-2 shadow-md"
        >
          <Plus className="w-4 h-4" />
          {tab === "flash" ? T("newFlashDeal") : T("newPromoCode")}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-xl w-fit">
        <button
          onClick={() => setTab("flash")}
          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${tab==="flash" ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          ⚡ {T("tabFlashDeals")}
          {liveDeals > 0 && <span className="ml-2 bg-green-100 text-green-700 text-xs rounded-full px-2">{liveDeals} {T("live")}</span>}
        </button>
        <button
          onClick={() => setTab("promo")}
          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${tab==="promo" ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          🎟 {T("tabPromoCodes")}
          {activePromos > 0 && <span className="ml-2 bg-blue-100 text-blue-700 text-xs rounded-full px-2">{activePromos} active</span>}
        </button>
      </div>

      {/* ══ Flash Deals Tab ══ */}
      {tab === "flash" && (
        <div className="space-y-4">
          {dealsLoading ? (
            <div className="space-y-3">{[1,2,3].map(i=><div key={i} className="h-24 bg-muted rounded-2xl animate-pulse"/>)}</div>
          ) : deals.length === 0 ? (
            <Card className="rounded-2xl border-border/50">
              <CardContent className="p-16 text-center">
                <Zap className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3"/>
                <p className="text-muted-foreground font-medium">{T("noFlashDeals")}</p>
                <p className="text-sm text-muted-foreground/60 mt-1">{T("createFirstFlashDeal")}</p>
                <Button onClick={openNewDeal} className="mt-4 rounded-xl gap-2"><Plus className="w-4 h-4"/>{T("createFlashDeal")}</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {deals.map(deal => {
                const discountLabel = deal.discountPct
                  ? `${deal.discountPct}% OFF`
                  : deal.discountFlat ? `Rs. ${deal.discountFlat} OFF` : "Deal";
                const stockPct = deal.dealStock ? Math.round((deal.soldCount / deal.dealStock) * 100) : null;
                return (
                  <Card key={deal.id} className="rounded-2xl border-border/50 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        {/* Discount badge */}
                        <div className="w-14 h-14 bg-amber-100 rounded-xl flex flex-col items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-amber-700">{deal.badge}</span>
                          <span className="text-[10px] font-bold text-amber-600 text-center leading-tight">{discountLabel}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-foreground truncate">{deal.title || deal.product?.name || deal.productId}</p>
                            <StatusBadge status={deal.status} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{deal.product?.category || ""} · {deal.product ? `Rs. ${deal.product.price}` : ""}</p>
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="w-3 h-3"/>
                              {new Date(deal.startTime).toLocaleString("en-PK",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})} →{" "}
                              {new Date(deal.endTime).toLocaleString("en-PK",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
                            </span>
                            {deal.dealStock !== null && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Package className="w-3 h-3"/>
                                {deal.soldCount}/{deal.dealStock} sold
                              </span>
                            )}
                          </div>
                          {/* Stock progress bar */}
                          {stockPct !== null && (
                            <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden w-40">
                              <div className={`h-full rounded-full ${stockPct>=90?"bg-red-500":stockPct>=50?"bg-amber-500":"bg-green-500"}`} style={{ width: `${Math.min(stockPct,100)}%` }} />
                            </div>
                          )}
                        </div>
                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => toggleDeal.mutate({ id: deal.id, isActive: !deal.isActive })}
                            className="p-2 hover:bg-muted rounded-lg transition-colors"
                            title={deal.isActive ? "Deactivate" : "Activate"}
                          >
                            {deal.isActive
                              ? <ToggleRight className="w-5 h-5 text-green-600"/>
                              : <ToggleLeft  className="w-5 h-5 text-muted-foreground"/>}
                          </button>
                          <button onClick={() => openEditDeal(deal)} className="p-2 hover:bg-muted rounded-lg transition-colors">
                            <Pencil className="w-4 h-4 text-blue-600"/>
                          </button>
                          <button onClick={() => deleteDeal.mutate(deal.id)} className="p-2 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4 text-red-500"/>
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ Promo Codes Tab ══ */}
      {tab === "promo" && (
        <div className="space-y-4">
          {promoLoading ? (
            <div className="space-y-3">{[1,2,3].map(i=><div key={i} className="h-24 bg-muted rounded-2xl animate-pulse"/>)}</div>
          ) : promos.length === 0 ? (
            <Card className="rounded-2xl border-border/50">
              <CardContent className="p-16 text-center">
                <TicketPercent className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3"/>
                <p className="text-muted-foreground font-medium">{T("noPromoCodes")}</p>
                <p className="text-sm text-muted-foreground/60 mt-1">{T("createDiscountCodes")}</p>
                <Button onClick={openNewPromo} className="mt-4 rounded-xl gap-2"><Plus className="w-4 h-4"/>{T("createPromoCode")}</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {promos.map(p => {
                const discountLabel = p.discountPct ? `${p.discountPct}% OFF` : p.discountFlat ? `Rs.${p.discountFlat} OFF` : "Discount";
                const usagePct = p.usageLimit ? Math.round((p.usedCount / p.usageLimit) * 100) : null;
                return (
                  <Card key={p.id} className="rounded-2xl border-border/50 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="w-14 h-14 bg-blue-100 rounded-xl flex flex-col items-center justify-center flex-shrink-0">
                          <Tag className="w-4 h-4 text-blue-600 mb-0.5"/>
                          <span className="text-[10px] font-bold text-blue-700 text-center leading-tight">{discountLabel}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="font-mono font-bold text-foreground bg-muted px-2 py-0.5 rounded-lg text-sm">{p.code}</code>
                            <StatusBadge status={p.status}/>
                            <Badge variant="outline" className="text-xs capitalize">{p.appliesTo}</Badge>
                          </div>
                          {p.description && <p className="text-xs text-muted-foreground mt-1">{p.description}</p>}
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            {p.minOrderAmount > 0 && (
                              <span className="text-xs text-muted-foreground">Min order: Rs.{p.minOrderAmount}</span>
                            )}
                            {p.maxDiscount && (
                              <span className="text-xs text-muted-foreground">Max discount: Rs.{p.maxDiscount}</span>
                            )}
                            {p.expiresAt && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="w-3 h-3"/>
                                Expires {new Date(p.expiresAt).toLocaleDateString("en-PK",{month:"short",day:"numeric",year:"numeric"})}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">Used: {p.usedCount}{p.usageLimit ? `/${p.usageLimit}` : " times"}</span>
                          </div>
                          {usagePct !== null && (
                            <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden w-40">
                              <div className={`h-full rounded-full ${usagePct>=90?"bg-red-500":usagePct>=60?"bg-amber-500":"bg-blue-500"}`} style={{ width: `${Math.min(usagePct,100)}%` }} />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => togglePromo.mutate({ id: p.id, isActive: !p.isActive })}
                            className="p-2 hover:bg-muted rounded-lg transition-colors"
                          >
                            {p.isActive
                              ? <ToggleRight className="w-5 h-5 text-green-600"/>
                              : <ToggleLeft  className="w-5 h-5 text-muted-foreground"/>}
                          </button>
                          <button onClick={() => openEditPromo(p)} className="p-2 hover:bg-muted rounded-lg transition-colors">
                            <Pencil className="w-4 h-4 text-blue-600"/>
                          </button>
                          <button onClick={() => deletePromo.mutate(p.id)} className="p-2 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4 text-red-500"/>
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ Flash Deal Dialog ══ */}
      <Dialog open={dealDialog} onOpenChange={v => { setDealDialog(v); if (!v) { setEditingDeal(null); setDealForm({ ...EMPTY_DEAL }); } }}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500"/>
              {editingDeal ? T("editFlashDeal") : T("createFlashDeal")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Product selection */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Product <span className="text-red-500">*</span></label>
              <select
                value={dealForm.productId}
                onChange={e => setDealForm(f=>({...f, productId: e.target.value}))}
                className="w-full h-11 rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">— Select a product —</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} · Rs.{p.price} · {p.category}</option>
                ))}
              </select>
            </div>

            {/* Custom title */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Custom Title <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                placeholder="e.g. Mega Sale on Basmati Rice"
                value={dealForm.title}
                onChange={e => setDealForm(f=>({...f, title: e.target.value}))}
                className="h-11 rounded-xl"
              />
            </div>

            {/* Badge */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Deal Badge</label>
              <div className="flex gap-2 flex-wrap">
                {["FLASH","HOT","MEGA","LIMITED","NEW"].map(b => (
                  <button
                    key={b}
                    onClick={() => setDealForm(f=>({...f, badge: b}))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${dealForm.badge===b ? "bg-amber-500 text-white border-amber-500" : "bg-muted border-border text-muted-foreground hover:border-amber-300"}`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            {/* Discount */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Discount %</label>
                <div className="relative">
                  <Input
                    type="number" min={0} max={100}
                    placeholder="e.g. 30"
                    value={dealForm.discountPct}
                    onChange={e => setDealForm(f=>({...f, discountPct: e.target.value, discountFlat: ""}))}
                    className="h-11 rounded-xl pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">OR Flat (Rs.)</label>
                <div className="relative">
                  <Input
                    type="number" min={0}
                    placeholder="e.g. 50"
                    value={dealForm.discountFlat}
                    onChange={e => setDealForm(f=>({...f, discountFlat: e.target.value, discountPct: ""}))}
                    className="h-11 rounded-xl pr-12"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">Rs.</span>
                </div>
              </div>
            </div>

            {/* Time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Start Time <span className="text-red-500">*</span></label>
                <Input
                  type="datetime-local"
                  value={dealForm.startTime}
                  onChange={e => setDealForm(f=>({...f, startTime: e.target.value}))}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">End Time <span className="text-red-500">*</span></label>
                <Input
                  type="datetime-local"
                  value={dealForm.endTime}
                  onChange={e => setDealForm(f=>({...f, endTime: e.target.value}))}
                  className="h-11 rounded-xl"
                />
              </div>
            </div>

            {/* Stock */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Deal Stock Limit <span className="text-muted-foreground font-normal">(leave blank = unlimited)</span></label>
              <Input
                type="number" min={1}
                placeholder="e.g. 100"
                value={dealForm.dealStock}
                onChange={e => setDealForm(f=>({...f, dealStock: e.target.value}))}
                className="h-11 rounded-xl"
              />
            </div>

            {/* Active toggle */}
            <div
              onClick={() => setDealForm(f=>({...f, isActive: !f.isActive}))}
              className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${dealForm.isActive ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200"}`}
            >
              <span className="text-sm font-semibold">Active (visible to users)</span>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${dealForm.isActive ? "bg-green-500" : "bg-gray-300"}`}>
                <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 shadow transition-transform ${dealForm.isActive ? "translate-x-5" : "translate-x-0.5"}`}/>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setDealDialog(false)}>Cancel</Button>
              <Button onClick={submitDeal} disabled={saveDeal.isPending} className="flex-1 rounded-xl gap-2">
                <Save className="w-4 h-4"/>
                {saveDeal.isPending ? "Saving..." : (editingDeal ? "Update Deal" : "Create Deal")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══ Promo Code Dialog ══ */}
      <Dialog open={promoDialog} onOpenChange={v => { setPromoDialog(v); if (!v) { setEditingPromo(null); setPromoForm({ ...EMPTY_PROMO }); } }}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TicketPercent className="w-5 h-5 text-blue-500"/>
              {editingPromo ? T("editPromoCode") : T("createPromoCode")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Code */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Promo Code <span className="text-red-500">*</span></label>
              <Input
                placeholder="e.g. SAVE50 or EID2026"
                value={promoForm.code}
                onChange={e => setPromoForm(f=>({...f, code: e.target.value.toUpperCase()}))}
                className="h-11 rounded-xl font-mono font-bold tracking-widest"
                disabled={!!editingPromo}
              />
              {!editingPromo && <p className="text-xs text-muted-foreground">Auto-uppercased. Cannot be changed after creation.</p>}
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                placeholder="e.g. Eid special 50% off on all orders"
                value={promoForm.description}
                onChange={e => setPromoForm(f=>({...f, description: e.target.value}))}
                className="h-11 rounded-xl"
              />
            </div>

            {/* Discount */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Discount %</label>
                <div className="relative">
                  <Input
                    type="number" min={0} max={100}
                    placeholder="e.g. 20"
                    value={promoForm.discountPct}
                    onChange={e => setPromoForm(f=>({...f, discountPct: e.target.value, discountFlat: ""}))}
                    className="h-11 rounded-xl pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">OR Flat (Rs.)</label>
                <div className="relative">
                  <Input
                    type="number" min={0}
                    placeholder="e.g. 100"
                    value={promoForm.discountFlat}
                    onChange={e => setPromoForm(f=>({...f, discountFlat: e.target.value, discountPct: ""}))}
                    className="h-11 rounded-xl pr-12"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">Rs.</span>
                </div>
              </div>
            </div>

            {/* Min order + Max discount */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Min Order (Rs.)</label>
                <Input
                  type="number" min={0}
                  placeholder="0"
                  value={promoForm.minOrderAmount}
                  onChange={e => setPromoForm(f=>({...f, minOrderAmount: e.target.value}))}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Max Discount (Rs.)</label>
                <Input
                  type="number" min={0}
                  placeholder="no cap"
                  value={promoForm.maxDiscount}
                  onChange={e => setPromoForm(f=>({...f, maxDiscount: e.target.value}))}
                  className="h-11 rounded-xl"
                />
              </div>
            </div>

            {/* Usage limit */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Total Usage Limit <span className="text-muted-foreground font-normal">(blank = unlimited)</span></label>
              <Input
                type="number" min={1}
                placeholder="e.g. 500"
                value={promoForm.usageLimit}
                onChange={e => setPromoForm(f=>({...f, usageLimit: e.target.value}))}
                className="h-11 rounded-xl"
              />
            </div>

            {/* Applies to */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Applies To</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { val: "all",      label: "🌐 All Services" },
                  { val: "mart",     label: "🛒 Mart" },
                  { val: "food",     label: "🍔 Food" },
                  { val: "pharmacy", label: "💊 Pharmacy" },
                  { val: "parcel",   label: "📦 Parcel" },
                ].map(opt => (
                  <button
                    key={opt.val}
                    onClick={() => setPromoForm(f=>({...f, appliesTo: opt.val}))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${promoForm.appliesTo===opt.val ? "bg-blue-500 text-white border-blue-500" : "bg-muted border-border text-muted-foreground hover:border-blue-300"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Expiry */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Expiry Date & Time <span className="text-muted-foreground font-normal">(blank = never)</span></label>
              <Input
                type="datetime-local"
                value={promoForm.expiresAt}
                onChange={e => setPromoForm(f=>({...f, expiresAt: e.target.value}))}
                className="h-11 rounded-xl"
              />
            </div>

            {/* Active toggle */}
            <div
              onClick={() => setPromoForm(f=>({...f, isActive: !f.isActive}))}
              className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${promoForm.isActive ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200"}`}
            >
              <span className="text-sm font-semibold">Active (customers can use this code)</span>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${promoForm.isActive ? "bg-green-500" : "bg-gray-300"}`}>
                <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 shadow transition-transform ${promoForm.isActive ? "translate-x-5" : "translate-x-0.5"}`}/>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setPromoDialog(false)}>Cancel</Button>
              <Button onClick={submitPromo} disabled={savePromo.isPending} className="flex-1 rounded-xl gap-2">
                <Save className="w-4 h-4"/>
                {savePromo.isPending ? "Saving..." : (editingPromo ? "Update Code" : "Create Code")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
