import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck, Clock, XCircle, AlertCircle, CheckCircle,
  User, Phone, CreditCard, MapPin, Calendar, Eye,
  Filter, RefreshCw, X, ChevronDown,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

function adminHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("ajkmart_admin_token")}`, "Content-Type": "application/json" };
}

const STATUS_CONFIG = {
  pending:  { label: "Pending Review", color: "text-amber-700",  bg: "bg-amber-100",  border: "border-amber-300",  dot: "bg-amber-400",  Icon: Clock },
  approved: { label: "Approved",       color: "text-green-700",  bg: "bg-green-100",  border: "border-green-300",  dot: "bg-green-500",  Icon: BadgeCheck },
  rejected: { label: "Rejected",       color: "text-red-700",    bg: "bg-red-100",    border: "border-red-300",    dot: "bg-red-500",    Icon: XCircle },
  resubmit: { label: "Resubmit",       color: "text-blue-700",   bg: "bg-blue-100",   border: "border-blue-300",   dot: "bg-blue-500",   Icon: AlertCircle },
};

type KycRecord = {
  id: string; userId: string; status: string;
  fullName?: string; cnic?: string; dateOfBirth?: string; gender?: string;
  address?: string; city?: string;
  frontIdPhoto?: string; backIdPhoto?: string; selfiePhoto?: string;
  rejectionReason?: string; reviewedAt?: string; submittedAt: string;
  userName?: string; userPhone?: string; userEmail?: string;
  user?: { name: string; phone: string; email: string; avatar?: string };
};

function PhotoModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative max-w-xl w-full" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-10 right-0 text-white hover:text-gray-300">
          <X size={24} />
        </button>
        <img src={url} alt="KYC Document" className="w-full rounded-2xl shadow-2xl max-h-[80vh] object-contain bg-white" />
      </div>
    </div>
  );
}

function RejectModal({ onConfirm, onClose, loading }: { onConfirm: (reason: string) => void; onClose: () => void; loading: boolean }) {
  const [reason, setReason] = useState("");
  const QUICK = [
    "CNIC photo is blurry or unclear",
    "CNIC photo is cut off — show all 4 corners",
    "Selfie does not match CNIC photo",
    "CNIC is expired",
    "Information provided does not match CNIC",
    "Document is not a valid CNIC",
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h3 className="font-bold text-gray-900 text-lg mb-1">Reject KYC</h3>
        <p className="text-gray-500 text-sm mb-4">Select a reason or write your own. This will be shown to the user.</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK.map(q => (
            <button key={q} onClick={() => setReason(q)}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${reason === q ? "bg-red-600 text-white border-red-600" : "bg-gray-50 text-gray-600 border-gray-200 hover:border-red-300"}`}>
              {q}
            </button>
          ))}
        </div>
        <textarea
          value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Or write a custom reason..."
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400 mb-4" />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 font-semibold text-sm py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={() => reason.trim() && onConfirm(reason.trim())} disabled={!reason.trim() || loading}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-sm py-2.5 rounded-xl transition flex items-center justify-center gap-2">
            {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : "Reject KYC"}
          </button>
        </div>
      </div>
    </div>
  );
}

function KycDetailPanel({ record, onClose, onApprove, onReject }: {
  record: KycRecord; onClose: () => void;
  onApprove: () => void; onReject: (reason: string) => void;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const qc = useQueryClient();

  const approveMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/kyc/admin/${record.id}/approve`, { method: "POST", headers: adminHeaders() });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Approval failed"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-kyc"] }); onApprove(); onClose(); },
  });

  const rejectMut = useMutation({
    mutationFn: async (reason: string) => {
      const r = await fetch(`${API_BASE}/kyc/admin/${record.id}/reject`, { method: "POST", headers: adminHeaders(), body: JSON.stringify({ reason }) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Rejection failed"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-kyc"] }); setShowReject(false); onReject(""); onClose(); },
  });

  const { data: fullRecord } = useQuery({
    queryKey: ["admin-kyc-detail", record.id],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/kyc/admin/${record.id}`, { headers: adminHeaders() });
      if (!r.ok) throw new Error("Failed to fetch details");
      return r.json() as Promise<KycRecord>;
    },
  });

  const details = fullRecord ?? record;
  const stConf = STATUS_CONFIG[details.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;

  const fullApiUrl = (path?: string) => {
    if (!path) return null;
    if (path.startsWith("http")) return path;
    return `${window.location.origin}${path}`;
  };

  return (
    <>
      {photoUrl && <PhotoModal url={photoUrl} onClose={() => setPhotoUrl(null)} />}
      {showReject && <RejectModal onConfirm={r => rejectMut.mutate(r)} onClose={() => setShowReject(false)} loading={rejectMut.isPending} />}

      <div className="fixed inset-0 z-40 flex items-start justify-end bg-black/40 p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg h-full max-h-[calc(100vh-2rem)] overflow-y-auto" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center gap-3 z-10">
            <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${stConf.bg} ${stConf.color} border ${stConf.border}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${stConf.dot}`} />
              {stConf.label}
            </div>
            <span className="text-gray-400 text-xs flex-1">#{record.id.slice(-8)}</span>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100">
              <X size={18} className="text-gray-500" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            {/* User info */}
            <div className="bg-gray-50 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">
                  {(details.userName ?? details.userPhone ?? "?")[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="font-bold text-gray-900">{details.userName ?? "—"}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                    <span className="flex items-center gap-1"><Phone size={11} /> {details.userPhone}</span>
                    {details.userEmail && <span className="flex items-center gap-1">✉ {details.userEmail}</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Personal details */}
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="bg-blue-600 px-4 py-2.5">
                <p className="text-white font-semibold text-sm">Personal Information</p>
              </div>
              <div className="divide-y divide-gray-50">
                {[
                  { icon: User,       label: "Full Name",    val: details.fullName },
                  { icon: CreditCard, label: "CNIC",         val: details.cnic },
                  { icon: Calendar,   label: "Date of Birth",val: details.dateOfBirth },
                  { icon: User,       label: "Gender",       val: details.gender },
                  { icon: MapPin,     label: "City",         val: details.city },
                  { icon: MapPin,     label: "Address",      val: details.address },
                ].map(({ icon: Icon, label, val }) => (
                  <div key={label} className="flex items-center gap-3 px-4 py-2.5">
                    <Icon size={14} className="text-gray-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-gray-400">{label}</p>
                      <p className="text-sm text-gray-800 font-medium">{val ?? <span className="text-gray-300 italic text-xs">Not provided</span>}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Document photos */}
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="bg-blue-600 px-4 py-2.5">
                <p className="text-white font-semibold text-sm">Submitted Documents</p>
              </div>
              <div className="p-4 grid grid-cols-3 gap-3">
                {[
                  { key: "frontIdPhoto" as const, label: "CNIC Front" },
                  { key: "backIdPhoto"  as const, label: "CNIC Back" },
                  { key: "selfiePhoto"  as const, label: "Selfie" },
                ].map(({ key, label }) => {
                  const url = fullApiUrl(details[key]);
                  return (
                    <div key={key} className="text-center">
                      {url ? (
                        <button onClick={() => setPhotoUrl(url)} className="w-full group relative">
                          <img src={url} alt={label} className="w-full h-24 object-cover rounded-xl border border-gray-100" />
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 rounded-xl transition flex items-center justify-center">
                            <Eye size={18} className="text-white" />
                          </div>
                        </button>
                      ) : (
                        <div className="w-full h-24 bg-gray-100 rounded-xl flex items-center justify-center">
                          <XCircle size={20} className="text-gray-300" />
                        </div>
                      )}
                      <p className="text-[10px] text-gray-500 mt-1">{label}</p>
                      <p className="text-[10px]">{url ? <span className="text-green-600">✓ Uploaded</span> : <span className="text-red-400">Missing</span>}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rejection reason */}
            {details.rejectionReason && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                <p className="text-red-700 font-semibold text-sm mb-1">Rejection Reason</p>
                <p className="text-red-600 text-sm">{details.rejectionReason}</p>
              </div>
            )}

            {/* Timestamps */}
            <div className="text-xs text-gray-400 space-y-1">
              <p>Submitted: {new Date(details.submittedAt).toLocaleString("en-PK")}</p>
              {details.reviewedAt && <p>Reviewed: {new Date(details.reviewedAt).toLocaleString("en-PK")}</p>}
            </div>

            {/* Actions */}
            {details.status === "pending" && (
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowReject(true)}
                  className="flex-1 border-2 border-red-300 text-red-600 font-bold text-sm py-3 rounded-xl hover:bg-red-50 transition flex items-center justify-center gap-2">
                  <XCircle size={16} /> Reject
                </button>
                <button onClick={() => approveMut.mutate()} disabled={approveMut.isPending}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold text-sm py-3 rounded-xl transition flex items-center justify-center gap-2 shadow-md shadow-green-100">
                  {approveMut.isPending ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><CheckCircle size={16} /> Approve</>}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function KycPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<KycRecord | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-kyc", statusFilter],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/kyc/admin/list?status=${statusFilter}&limit=50`, { headers: adminHeaders() });
      if (!r.ok) throw new Error("Failed to fetch KYC list");
      return r.json() as Promise<{ records: KycRecord[] }>;
    },
    refetchInterval: 30000,
  });

  const records = data?.records ?? [];
  const counts = {
    all: records.length,
    pending: records.filter(r => r.status === "pending").length,
    approved: records.filter(r => r.status === "approved").length,
    rejected: records.filter(r => r.status === "rejected").length,
  };

  const FILTERS = [
    { key: "all",      label: "All",       count: counts.all },
    { key: "pending",  label: "Pending",   count: counts.pending },
    { key: "approved", label: "Approved",  count: counts.approved },
    { key: "rejected", label: "Rejected",  count: counts.rejected },
  ];

  return (
    <div className="p-6 space-y-6">
      {selected && (
        <KycDetailPanel
          record={selected}
          onClose={() => setSelected(null)}
          onApprove={() => { qc.invalidateQueries({ queryKey: ["admin-kyc"] }); }}
          onReject={() => { qc.invalidateQueries({ queryKey: ["admin-kyc"] }); }}
        />
      )}

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">KYC Verification</h1>
          <p className="text-gray-500 text-sm mt-1">Review and manage user identity verification requests</p>
        </div>
        <button onClick={() => refetch()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-2 rounded-xl hover:bg-gray-50 transition">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total",    val: records.length,                        color: "bg-gray-100",   text: "text-gray-700",  Icon: Filter },
          { label: "Pending",  val: counts.pending,  onClick: () => setStatusFilter("pending"),  color: "bg-amber-50",   text: "text-amber-700", Icon: Clock },
          { label: "Approved", val: counts.approved, onClick: () => setStatusFilter("approved"), color: "bg-green-50",   text: "text-green-700", Icon: BadgeCheck },
          { label: "Rejected", val: counts.rejected, onClick: () => setStatusFilter("rejected"), color: "bg-red-50",     text: "text-red-700",   Icon: XCircle },
        ].map(({ label, val, color, text, Icon, onClick }) => (
          <div key={label} onClick={onClick} className={`${color} rounded-2xl p-4 flex items-center gap-3 ${onClick ? "cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-blue-300 transition" : ""}`}>
            <Icon size={20} className={text} />
            <div>
              <p className={`text-2xl font-bold ${text}`}>{val}</p>
              <p className="text-xs text-gray-500 font-medium">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setStatusFilter(f.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition ${statusFilter === f.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"}`}>
            {f.label}
            {f.count > 0 && <span className={`px-1.5 py-0.5 rounded-full text-xs ${statusFilter === f.key ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"}`}>{f.count}</span>}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Loading KYC submissions…</p>
          </div>
        ) : records.length === 0 ? (
          <div className="p-12 text-center">
            <BadgeCheck size={40} className="text-gray-200 mx-auto mb-3" />
            <p className="font-semibold text-gray-500">No submissions found</p>
            <p className="text-gray-400 text-sm mt-1">{statusFilter !== "all" ? "Try a different filter" : "No KYC requests yet"}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {/* Header */}
            <div className="grid grid-cols-12 gap-4 px-5 py-3 bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              <div className="col-span-3">User</div>
              <div className="col-span-3">CNIC / Name</div>
              <div className="col-span-2">City</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Submitted</div>
            </div>
            {records.map(rec => {
              const stConf = STATUS_CONFIG[rec.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
              const StIcon = stConf.Icon;
              return (
                <div key={rec.id} onClick={() => setSelected(rec)} className="grid grid-cols-12 gap-4 px-5 py-3.5 hover:bg-gray-50 cursor-pointer transition items-center">
                  <div className="col-span-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm shrink-0">
                        {(rec.userName ?? rec.userPhone ?? "?")[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{rec.userName ?? "—"}</p>
                        <p className="text-xs text-gray-400 flex items-center gap-1 truncate"><Phone size={10} /> {rec.userPhone}</p>
                      </div>
                    </div>
                  </div>
                  <div className="col-span-3">
                    <p className="text-sm font-medium text-gray-700 truncate">{rec.fullName ?? "—"}</p>
                    <p className="text-xs text-gray-400 font-mono">{rec.cnic ?? "—"}</p>
                  </div>
                  <div className="col-span-2 text-sm text-gray-600">{rec.city ?? "—"}</div>
                  <div className="col-span-2">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${stConf.bg} ${stConf.color} border ${stConf.border}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${stConf.dot}`} />
                      {stConf.label}
                    </span>
                  </div>
                  <div className="col-span-2 text-xs text-gray-400">
                    {new Date(rec.submittedAt).toLocaleDateString("en-PK", { day: "2-digit", month: "short" })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
