import { useState, useCallback, useRef } from "react";
import {
  Star, Search, RefreshCw, Download, Upload, CheckCircle2, XCircle,
  ShieldAlert, ShieldCheck, AlertTriangle, MessageSquare, Play,
  Filter, CalendarDays, ChevronDown, ChevronUp, Eye, EyeOff, Trash2, Pencil,
} from "lucide-react";
import {
  useAdminReviews, useModerationQueue, useApproveReview,
  useRejectReview, useRunRatingSuspension, useEditVendorReply, useDeleteVendorReply,
} from "@/hooks/use-admin";
import { fetcher, getApiBase, getToken } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";

type Review = {
  id: string;
  type: "order" | "ride";
  rating: number;
  riderRating?: number | null;
  comment: string | null;
  orderType: string | null;
  hidden: boolean;
  status?: string;
  moderationNote?: string | null;
  vendorReply?: string | null;
  deletedAt: string | null;
  createdAt: string;
  reviewerId: string;
  subjectId: string | null;
  reviewerName: string | null;
  reviewerPhone: string | null;
  subjectName: string | null;
  subjectPhone: string | null;
  orderId?: string | null;
};

/* ── Helpers ── */
function StarDisplay({ value }: { value: number }) {
  return (
    <span className="text-sm leading-none">
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} className={i <= value ? "text-amber-400" : "text-gray-200"}>★</span>
      ))}
    </span>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} className={`w-3 h-3 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-gray-300"}`} />
      ))}
    </span>
  );
}

const STAR_COLORS: Record<number, string> = {
  5: "bg-green-100 text-green-700",
  4: "bg-lime-100 text-lime-700",
  3: "bg-yellow-100 text-yellow-700",
  2: "bg-orange-100 text-orange-700",
  1: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "visible") return <Badge className="bg-green-100 text-green-700 border-0 text-[10px]">Visible</Badge>;
  if (status === "pending_moderation") return <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px]">Pending</Badge>;
  if (status === "rejected") return <Badge className="bg-red-100 text-red-700 border-0 text-[10px]">Rejected</Badge>;
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
}

function ReviewRow({ r, selected, onToggle, onHide, onDelete, hideLoading, deleteLoading, onEditReply, onDeleteReply, T }: {
  r: Review;
  selected: boolean;
  onToggle: () => void;
  onHide: () => void;
  onDelete: () => void;
  hideLoading: boolean;
  deleteLoading: boolean;
  onEditReply: (id: string, currentReply: string) => void;
  onDeleteReply: (id: string) => void;
  T: (k: TranslationKey) => string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`p-4 flex items-start gap-3 border-b last:border-0 ${r.deletedAt ? "opacity-50 bg-red-50/30" : r.hidden ? "bg-yellow-50/30" : ""}`}>
      {!r.deletedAt && (
        <Checkbox checked={selected} onCheckedChange={onToggle} className="mt-0.5 flex-shrink-0" />
      )}
      {r.deletedAt && <div className="w-4 flex-shrink-0" />}

      <div className="flex flex-col gap-1.5 flex-shrink-0 min-w-[90px]">
        <Badge variant="outline" className={r.type === "ride" ? "border-blue-300 text-blue-700 text-[10px]" : "border-orange-300 text-orange-700 text-[10px]"}>
          {r.type === "ride" ? `🚗 ${T("rideReviews").split(" ")[0]}` : `📦 ${T("orderReviews").split(" ")[0]}`}
        </Badge>
        <span className={`text-xs font-bold rounded-full px-2 py-0.5 text-center ${STAR_COLORS[r.rating] ?? "bg-gray-100 text-gray-600"}`}>
          {r.rating}★
        </span>
        {r.status && <StatusBadge status={r.status} />}
        {r.hidden && !r.deletedAt && (
          <Badge variant="secondary" className="text-yellow-700 bg-yellow-100 border-yellow-200 text-[10px]">{T("hiddenLabel")}</Badge>
        )}
        {r.deletedAt && (
          <Badge variant="destructive" className="text-[10px]">{T("deletedLabel")}</Badge>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {r.riderRating ? (
            <>
              <span className="text-xs text-muted-foreground font-medium">Vendor:</span>
              <StarDisplay value={r.rating} />
              <span className="text-xs text-muted-foreground font-medium">{T("riderReviews").split(" ")[0]}:</span>
              <StarDisplay value={r.riderRating} />
            </>
          ) : (
            <StarDisplay value={r.rating} />
          )}
          {r.moderationNote && (
            <span className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
              <AlertTriangle className="w-2.5 h-2.5" /> {r.moderationNote}
            </span>
          )}
        </div>
        {r.orderType && r.type === "order" && (
          <Badge variant="outline" className="text-[10px] capitalize mt-1">{r.orderType}</Badge>
        )}

        {/* Comment preview / full expand */}
        {r.comment ? (
          <div>
            <p className={`text-sm text-foreground mt-1.5 italic ${expanded ? "" : "line-clamp-2"}`}>
              "{r.comment}"
            </p>
            {r.comment.length > 120 && (
              <button
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-0.5 text-[11px] text-primary mt-0.5 hover:underline"
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {expanded ? T("hideReview").replace("Hide", "Collapse") : T("viewFullReview")}
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-1">{T("noCommentAdded")}</p>
        )}

        {r.vendorReply && (
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-2 mt-2">
            <MessageSquare className="w-3 h-3 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-700 flex-1"><strong>Vendor Reply:</strong> {r.vendorReply}</p>
            {!r.deletedAt && r.type === "order" && (
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => onEditReply(r.id, r.vendorReply!)}
                  className="p-1 rounded hover:bg-blue-100 text-blue-600" title="Edit reply">
                  <Pencil className="w-3 h-3" />
                </button>
                <button onClick={() => onDeleteReply(r.id)}
                  className="p-1 rounded hover:bg-red-100 text-red-500" title="Delete reply">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2 text-xs text-muted-foreground">
          <span>
            {T("reviewerLabel")}: <span className="font-medium text-foreground">{r.reviewerName ?? r.reviewerId.slice(0, 8)}</span>
            {r.reviewerPhone && <span className="ml-1 text-gray-400">· {r.reviewerPhone}</span>}
          </span>
          {r.subjectName && (
            <span>{T("subjectLabel")}: <span className="font-medium text-foreground">{r.subjectName}</span>
              {r.subjectPhone && <span className="ml-1 text-gray-400">· {r.subjectPhone}</span>}
            </span>
          )}
          <span>{formatDate(r.createdAt)}</span>
          {r.orderId && <span>Order: {r.orderId.slice(0, 8)}</span>}
        </div>
      </div>

      {!r.deletedAt && (
        <div className="flex gap-2 flex-shrink-0">
          <Button
            size="sm" variant="outline"
            className="h-8 w-8 p-0"
            title={r.hidden ? T("unhideReview") : T("hideReview")}
            onClick={onHide}
            disabled={hideLoading}
          >
            {r.hidden
              ? <Eye className="h-3.5 w-3.5 text-green-600" />
              : <EyeOff className="h-3.5 w-3.5 text-yellow-600" />}
          </Button>
          <Button
            size="sm" variant="outline"
            className="h-8 w-8 p-0 border-red-200 hover:bg-red-50"
            title={T("deleteReview")}
            onClick={onDelete}
            disabled={deleteLoading}
          >
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Moderation Queue Modal ── */
function ModerationModal({ onClose, T }: { onClose: () => void; T: (k: TranslationKey) => string }) {
  const { data, isLoading } = useModerationQueue();
  const approveM = useApproveReview();
  const rejectM = useRejectReview();
  const { toast } = useToast();
  const reviews: any[] = data?.reviews || [];

  const approve = (id: string) => {
    approveM.mutate(id, {
      onSuccess: () => toast({ title: "Review approved ✅" }),
      onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });
  };

  const reject = (id: string) => {
    rejectM.mutate(id, {
      onSuccess: () => toast({ title: "Review rejected" }),
      onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-500" />
            Moderation Queue {reviews.length > 0 && <Badge className="bg-amber-100 text-amber-700 border-0">{reviews.length}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {isLoading && <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}
        {!isLoading && reviews.length === 0 && (
          <div className="py-10 text-center text-muted-foreground">
            <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-green-400" />
            <p className="font-medium">All clear! No reviews pending moderation.</p>
          </div>
        )}

        <div className="space-y-3 mt-2">
          {reviews.map((r: any) => (
            <div key={r.id} className="border rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StarRow rating={r.rating} />
                  <Badge variant="outline" className="text-xs capitalize">{r.orderType}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
              </div>
              <p className="text-sm">{r.comment || <em className="text-muted-foreground">No comment</em>}</p>
              {r.moderationNote && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs text-amber-700">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  <span>AI Flag: {r.moderationNote}</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">By: {r.reviewerName || r.reviewerPhone || r.userId}</p>
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700 h-8 text-xs"
                  onClick={() => approve(r.id)} disabled={approveM.isPending || rejectM.isPending}>
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                </Button>
                <Button size="sm" variant="destructive" className="flex-1 h-8 text-xs"
                  onClick={() => reject(r.id)} disabled={approveM.isPending || rejectM.isPending}>
                  <XCircle className="w-3 h-3 mr-1" /> Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Import Modal ── */
function ImportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [csvText, setCsvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCsvText(String(ev.target?.result || ""));
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!csvText.trim()) { toast({ title: "Paste or upload a CSV file first", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const data = await fetcher("/reviews/import", { method: "POST", body: JSON.stringify({ csvData: csvText }) });
      setResult(data);
      onSuccess();
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" /> Import Reviews CSV
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <p className="text-xs text-muted-foreground">Required columns: <code>orderType, orderId, stars</code>. Optional: <code>userId, vendorId, riderId, comment, vendorReply, status</code>.</p>

          <div className="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer hover:bg-muted/30"
            onClick={() => fileRef.current?.click()}>
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Click to upload CSV file</p>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </div>

          <textarea
            className="w-full border rounded-xl p-3 text-xs font-mono h-28 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Or paste CSV content here..."
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
          />

          {result && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm space-y-1">
              <p className="font-semibold text-green-700">Import Complete</p>
              <p>Imported: <strong>{result.imported}</strong> &nbsp; Skipped: <strong>{result.skipped}</strong> &nbsp; Errors: <strong>{result.errored}</strong></p>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={handleImport} disabled={loading}>
              {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
              Import
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditReplyModal({ reviewId, currentReply, onClose, onSave, saving }: {
  reviewId: string; currentReply: string; onClose: () => void;
  onSave: (id: string, reply: string) => void; saving: boolean;
}) {
  const [reply, setReply] = useState(currentReply);
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-blue-500" /> Edit Vendor Reply
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <textarea
            className="w-full border rounded-xl p-3 text-sm h-28 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder="Edit vendor reply..."
          />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 rounded-xl" onClick={onClose}>Cancel</Button>
            <Button className="flex-1 rounded-xl" onClick={() => onSave(reviewId, reply)} disabled={saving || !reply.trim()}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ReviewsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const [page, setPage] = useState(1);
  const [typeFilter, setType] = useState("all");
  const [starsFilter, setStars] = useState("all");
  const [statusFilter, setStatus] = useState("all");
  const [subjectFilter, setSubject] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [showModQueue, setShowModQueue] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const limit = 25;

  const buildQS = useCallback((p = page) => {
    const params = new URLSearchParams({ page: String(p), limit: String(limit) });
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (starsFilter !== "all") params.set("stars", starsFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (subjectFilter !== "all") params.set("subject", subjectFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (debouncedQ) params.set("q", debouncedQ);
    return params.toString();
  }, [page, typeFilter, starsFilter, statusFilter, subjectFilter, dateFrom, dateTo, debouncedQ]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-reviews", page, typeFilter, starsFilter, statusFilter, subjectFilter, dateFrom, dateTo, debouncedQ],
    queryFn: () => fetcher(`/reviews?${buildQS()}`),
    staleTime: 10_000,
  });

  const { data: queueData } = useModerationQueue();
  const runSuspensionM = useRunRatingSuspension();
  const editReplyM = useEditVendorReply();
  const deleteReplyM = useDeleteVendorReply();
  const [editReplyModal, setEditReplyModal] = useState<{ id: string; reply: string } | null>(null);

  const reviews: Review[] = data?.reviews ?? [];
  const total: number = data?.total ?? 0;
  const pages: number = data?.pages ?? 1;
  const pendingCount = queueData?.total || 0;

  const hideOrder = useMutation({
    mutationFn: (id: string) => fetcher(`/reviews/${id}/hide`, { method: "PATCH" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-reviews"] }); toast({ title: T("visibilityToggled") }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteOrder = useMutation({
    mutationFn: (id: string) => fetcher(`/reviews/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-reviews"] }); toast({ title: T("reviewDeleted") }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const hideRide = useMutation({
    mutationFn: (id: string) => fetcher(`/ride-ratings/${id}/hide`, { method: "PATCH" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-reviews"] }); toast({ title: T("visibilityToggled") }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteRide = useMutation({
    mutationFn: (id: string) => fetcher(`/ride-ratings/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-reviews"] }); toast({ title: T("reviewDeleted") }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleHide(r: Review) {
    if (r.type === "order") hideOrder.mutate(r.id);
    else hideRide.mutate(r.id);
  }
  function handleDelete(r: Review) {
    if (!confirm(`${T("deleteReview")} #${r.id.slice(0, 8)}?`)) return;
    if (r.type === "order") deleteOrder.mutate(r.id);
    else deleteRide.mutate(r.id);
  }

  const allIds = reviews.filter(r => !r.deletedAt).map(r => r.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  }
  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkHide() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`${T("toggleVisibility")} ${ids.length} review(s)?`)) return;
    const toHide = reviews.filter(r => ids.includes(r.id) && r.type === "order");
    const toHideR = reviews.filter(r => ids.includes(r.id) && r.type === "ride");
    await Promise.all([
      ...toHide.map(r => fetcher(`/reviews/${r.id}/hide`, { method: "PATCH" })),
      ...toHideR.map(r => fetcher(`/ride-ratings/${r.id}/hide`, { method: "PATCH" })),
    ]);
    qc.invalidateQueries({ queryKey: ["admin-reviews"] });
    setSelected(new Set());
    toast({ title: `${ids.length} ${T("visibilityToggled").toLowerCase()}` });
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`${T("deleteReview")} ${ids.length} review(s)?`)) return;
    const orders = reviews.filter(r => ids.includes(r.id) && r.type === "order");
    const rides = reviews.filter(r => ids.includes(r.id) && r.type === "ride");
    await Promise.all([
      ...orders.map(r => fetcher(`/reviews/${r.id}`, { method: "DELETE" })),
      ...rides.map(r => fetcher(`/ride-ratings/${r.id}`, { method: "DELETE" })),
    ]);
    qc.invalidateQueries({ queryKey: ["admin-reviews"] });
    setSelected(new Set());
    toast({ title: `${ids.length} ${T("reviewDeleted").toLowerCase()}` });
  }

  function handleFilterChange(setter: (v: string) => void) {
    return (v: string) => { setter(v); setPage(1); setSelected(new Set()); };
  }

  const handleSearch = (v: string) => {
    setSearchQ(v);
    clearTimeout((window as any).__reviewSearchTimeout);
    (window as any).__reviewSearchTimeout = setTimeout(() => {
      setDebouncedQ(v);
      setPage(1);
    }, 400);
  };

  const handleExport = async () => {
    const qs = new URLSearchParams();
    if (statusFilter !== "all") qs.set("status", statusFilter);
    if (typeFilter !== "all") qs.set("type", typeFilter);
    const token = getToken();
    const base = getApiBase();
    const url = `${base}/reviews/export?${qs.toString()}`;
    const res = await fetch(url, { headers: token ? { "x-admin-token": token } : {} });
    if (!res.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `reviews-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const runSuspension = () => {
    runSuspensionM.mutate(undefined, {
      onSuccess: (d: any) => toast({ title: "Auto-suspension job ran ✅", description: d.message }),
      onError: (e: any) => toast({ title: "Job failed", description: e.message, variant: "destructive" }),
    });
  };

  const statusStats = [
    { label: T("totalInView"), value: total, color: "text-blue-600" },
    { label: T("visibleLabel"), value: reviews.filter(r => r.status === "visible" || (!r.hidden && !r.deletedAt)).length, color: "text-green-600" },
    { label: T("pendingLabel") || "Pending", value: reviews.filter(r => r.status === "pending_moderation").length, color: "text-amber-600" },
    { label: T("deletedLabel"), value: reviews.filter(r => !!r.deletedAt).length, color: "text-red-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Star className="h-6 w-6 text-amber-400" />
            {T("reviewManagement")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {T("moderateCustomerReviews")} · {total} {T("totalInView")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowModQueue(true)} className="relative">
            <ShieldAlert className="w-4 h-4 mr-1 text-amber-500" />
            Moderation Queue
            {pendingCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">{pendingCount}</span>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
            <Upload className="w-4 h-4 mr-1" /> Import CSV
          </Button>
          <Button variant="outline" size="sm" onClick={runSuspension} disabled={runSuspensionM.isPending}>
            {runSuspensionM.isPending
              ? <div className="w-4 h-4 border-2 border-foreground border-t-transparent rounded-full animate-spin mr-1" />
              : <Play className="w-4 h-4 mr-1 text-orange-500" />}
            Run Auto-Suspend
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statusStats.map(s => (
          <Card key={s.label} className="p-4 text-center">
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">{s.label}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />

          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by reviewer or comment..."
              className="pl-8 h-8 text-xs"
              value={searchQ}
              onChange={e => handleSearch(e.target.value)}
            />
          </div>

          <Select value={typeFilter} onValueChange={handleFilterChange(setType)}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder={T("reviewType")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{T("allTypes")}</SelectItem>
              <SelectItem value="order">{T("orderReviews")}</SelectItem>
              <SelectItem value="ride">{T("rideReviews")}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={starsFilter} onValueChange={handleFilterChange(setStars)}>
            <SelectTrigger className="w-28 h-8 text-xs"><SelectValue placeholder={T("starsFilter")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{T("allStars")}</SelectItem>
              {[5, 4, 3, 2, 1].map(s => <SelectItem key={s} value={String(s)}>{s} ★</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={handleFilterChange(setStatus)}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder={T("reviewStatus")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{T("allStatus")}</SelectItem>
              <SelectItem value="visible">{T("visibleLabel")}</SelectItem>
              <SelectItem value="pending_moderation">Pending</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="hidden">{T("hiddenLabel")}</SelectItem>
              <SelectItem value="deleted">{T("deletedLabel")}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={subjectFilter} onValueChange={handleFilterChange(setSubject)}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder={T("allSubjects")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{T("allSubjects")}</SelectItem>
              <SelectItem value="vendor">{T("vendorReviews")}</SelectItem>
              <SelectItem value="rider">{T("riderReviews")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <CalendarDays className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              className="h-8 text-xs w-36"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }}
              className="h-8 text-xs w-36"
            />
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}>
                {T("clearDates")}
              </Button>
            )}
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center justify-between bg-primary/5 border border-primary/10 rounded-lg px-3 py-2">
            <span className="text-xs font-medium text-primary">
              {selected.size} {T("selectedCount")}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={bulkHide}>
                <EyeOff className="h-3 w-3 mr-1" /> {T("toggleVisibility")}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px] border-red-200 text-red-600 hover:bg-red-50" onClick={bulkDelete}>
                <Trash2 className="h-3 w-3 mr-1" /> {T("deleteReview")}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setSelected(new Set())}>
                {T("clearSelection")}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="divide-y">
          <div className="bg-muted/30 p-2 px-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{T("onThisPage")}</span>
            </div>
            <div className="text-[10px] text-muted-foreground font-medium">
              Page {page} of {pages}
            </div>
          </div>

          {isLoading ? (
            <div className="p-12 text-center"><RefreshCw className="h-8 w-8 animate-spin mx-auto text-muted-foreground/20" /></div>
          ) : reviews.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <p>{T("noReviewsFound")}</p>
              <Button variant="link" size="sm" onClick={() => { setType("all"); setStars("all"); setStatus("all"); setSubject("all"); setDateFrom(""); setDateTo(""); setSearchQ(""); setDebouncedQ(""); }}>
                {T("adjustFilters")}
              </Button>
            </div>
          ) : (
            reviews.map(r => (
              <ReviewRow
                key={r.id}
                r={r}
                selected={selected.has(r.id)}
                onToggle={() => toggleOne(r.id)}
                onHide={() => handleHide(r)}
                onDelete={() => handleDelete(r)}
                hideLoading={hideOrder.isPending || hideRide.isPending}
                deleteLoading={deleteOrder.isPending || deleteRide.isPending}
                onEditReply={(id, reply) => setEditReplyModal({ id, reply })}
                onDeleteReply={(id) => {
                  if (!confirm("Delete this vendor reply?")) return;
                  deleteReplyM.mutate(id, {
                    onSuccess: () => toast({ title: "Vendor reply deleted" }),
                    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
                  });
                }}
                T={T}
              />
            ))
          )}
        </div>
      </Card>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-1 pb-8">
          <Button
            variant="outline" size="sm" className="h-8 text-xs"
            disabled={page === 1}
            onClick={() => { setPage(p => p - 1); setSelected(new Set()); }}
          >
            {T("previousPage")}
          </Button>
          <div className="flex items-center gap-1 mx-2">
            {[...Array(pages)].map((_, i) => {
              const p = i + 1;
              if (pages > 7 && Math.abs(p - page) > 2 && p !== 1 && p !== pages) {
                if (Math.abs(p - page) === 3) return <span key={p} className="text-muted-foreground">...</span>;
                return null;
              }
              return (
                <Button
                  key={p}
                  variant={page === p ? "default" : "outline"}
                  size="sm" className="h-8 w-8 text-xs p-0"
                  onClick={() => { setPage(p); setSelected(new Set()); }}
                >
                  {p}
                </Button>
              );
            })}
          </div>
          <Button
            variant="outline" size="sm" className="h-8 text-xs"
            disabled={page === pages}
            onClick={() => { setPage(p => p + 1); setSelected(new Set()); }}
          >
            {T("nextPage") || "Next"}
          </Button>
        </div>
      )}

      {showModQueue && <ModerationModal onClose={() => setShowModQueue(false)} T={T} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onSuccess={() => refetch()} />}

      {editReplyModal && (
        <EditReplyModal
          reviewId={editReplyModal.id}
          currentReply={editReplyModal.reply}
          onClose={() => setEditReplyModal(null)}
          onSave={(id, reply) => {
            editReplyM.mutate({ id, reply }, {
              onSuccess: () => { toast({ title: "Vendor reply updated" }); setEditReplyModal(null); },
              onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
            });
          }}
          saving={editReplyM.isPending}
        />
      )}
    </div>
  );
}
