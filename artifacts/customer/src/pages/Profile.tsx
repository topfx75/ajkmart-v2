import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  User, Shield, Settings, ChevronLeft, Camera, Lock, Eye, EyeOff,
  Globe, Bell, BellOff, CheckCircle, Clock, XCircle, AlertCircle,
  Save, Phone, Mail, CreditCard, MapPin, Edit2, LogOut,
  Upload, FileText, ChevronRight, ChevronDown, RefreshCw, BadgeCheck,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cn } from "../lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type Tab = "personal" | "kyc" | "security" | "settings";

const LEVEL_CONFIG = {
  bronze: { label: "Bronze", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", bar: "bg-amber-400", icon: "🥉", pct: 20, tip: "Add name, email & address to reach Silver" },
  silver: { label: "Silver", color: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200", bar: "bg-slate-400", icon: "🥈", pct: 60, tip: "Complete CNIC & KYC to reach Gold" },
  gold:   { label: "Gold",   color: "text-yellow-600", bg: "bg-yellow-50", border: "border-yellow-200", bar: "bg-yellow-400", icon: "🥇", pct: 100, tip: "You've reached the highest account level!" },
};

const KYC_STATUS = {
  none:     { label: "Not Verified",   color: "text-gray-500",  bg: "bg-gray-50",   border: "border-gray-200",  Icon: AlertCircle },
  pending:  { label: "Under Review",   color: "text-amber-600", bg: "bg-amber-50",  border: "border-amber-200", Icon: Clock },
  verified: { label: "Verified",       color: "text-green-600", bg: "bg-green-50",  border: "border-green-200", Icon: BadgeCheck },
  rejected: { label: "Rejected",       color: "text-red-600",   bg: "bg-red-50",    border: "border-red-200",   Icon: XCircle },
};

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ur", label: "اردو (Urdu)" },
  { code: "roman", label: "Roman Urdu" },
  { code: "en_roman", label: "English + Roman" },
  { code: "en_ur", label: "English + Urdu" },
];

/* ── Helpers ── */
function Field({ label, value, icon: Icon }: { label: string; value?: string | null; icon: React.ElementType }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon size={15} className="text-gray-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] text-gray-400 leading-none mb-0.5">{label}</p>
        <p className="text-sm text-gray-800 font-medium truncate">{value || <span className="text-gray-300 font-normal italic text-xs">Not provided</span>}</p>
      </div>
    </div>
  );
}

function Toast({ msg, type }: { msg: string; type: "success" | "error" }) {
  return (
    <div className={cn(
      "fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 max-w-xs animate-in slide-in-from-top",
      type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
    )}>
      {type === "success" ? <CheckCircle size={16} /> : <XCircle size={16} />}
      {msg}
    </div>
  );
}

function PhotoUploadBox({
  label, hint, file, preview, onChange, required,
}: {
  label: string; hint: string;
  file: File | null; preview: string | null;
  onChange: (f: File) => void;
  required?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 mb-1.5">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</p>
      <div
        onClick={() => ref.current?.click()}
        className={cn(
          "relative border-2 border-dashed rounded-2xl overflow-hidden cursor-pointer transition group",
          preview ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50"
        )}
        style={{ height: 140 }}
      >
        {preview ? (
          <>
            <img src={preview} alt={label} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
              <p className="text-white text-xs font-semibold">Change Photo</p>
            </div>
            <div className="absolute top-2 right-2 bg-green-500 rounded-full p-0.5">
              <CheckCircle size={14} className="text-white" />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-4">
            <div className="w-10 h-10 rounded-xl bg-gray-200 group-hover:bg-blue-100 transition flex items-center justify-center">
              <Upload size={18} className="text-gray-400 group-hover:text-blue-500" />
            </div>
            <p className="text-xs text-gray-500 text-center">{hint}</p>
          </div>
        )}
      </div>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onChange(f); e.target.value = ""; }}
      />
    </div>
  );
}

/* ── KYC Section ── */
function KycSection({ onToast }: { onToast: (msg: string, t: "success" | "error") => void }) {
  const { user, setUser } = useAuth();
  const qc = useQueryClient();
  const [step, setStep] = useState(0); // 0=status, 1=personal, 2=documents, 3=selfie, 4=review
  const [form, setForm] = useState({
    fullName: user?.name ?? "",
    cnic: user?.cnic ?? "",
    dateOfBirth: "",
    gender: "",
    address: user?.address ?? "",
    city: user?.city ?? "",
  });
  const [photos, setPhotos] = useState<{ front: File | null; back: File | null; selfie: File | null }>({
    front: null, back: null, selfie: null,
  });
  const [previews, setPreviews] = useState<{ front: string | null; back: string | null; selfie: string | null }>({
    front: null, back: null, selfie: null,
  });

  const previewUrlsRef = useRef<string[]>([]);

  const setPhoto = (key: "front" | "back" | "selfie", file: File) => {
    setPhotos(p => ({ ...p, [key]: file }));
    setPreviews(prev => {
      if (prev[key]) URL.revokeObjectURL(prev[key]!);
      const url = URL.createObjectURL(file);
      previewUrlsRef.current.push(url);
      return { ...prev, [key]: url };
    });
  };

  const { data: kycData, isLoading: kycLoading, refetch: refetchKyc } = useQuery({
    queryKey: ["kyc-status"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/kyc/status`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("customer_token")}` },
      });
      if (!r.ok) throw new Error("Failed to fetch KYC status");
      return r.json() as Promise<{ status: string; record: any }>;
    },
  });

  useEffect(() => {
    const ref = previewUrlsRef;
    return () => {
      ref.current.forEach(url => URL.revokeObjectURL(url));
      ref.current = [];
    };
  }, []);

  const submitMut = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("fullName", form.fullName.trim());
      fd.append("cnic", form.cnic.replace(/[-\s]/g, ""));
      fd.append("dateOfBirth", form.dateOfBirth);
      fd.append("gender", form.gender);
      fd.append("address", form.address.trim());
      fd.append("city", form.city.trim());
      if (photos.front)  fd.append("frontIdPhoto", photos.front);
      if (photos.back)   fd.append("backIdPhoto",  photos.back);
      if (photos.selfie) fd.append("selfiePhoto",  photos.selfie);

      const r = await fetch(`${BASE}/api/kyc/submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("customer_token")}` },
        body: fd,
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Submission failed"); }
      return r.json();
    },
    onSuccess: () => {
      setUser({ ...user!, kycStatus: "pending" });
      qc.invalidateQueries({ queryKey: ["kyc-status"] });
      refetchKyc();
      setStep(0);
      onToast("KYC submit ho gaya! 24 hours mein review hoga.", "success");
    },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  const kycStatus = kycData?.status ?? user?.kycStatus ?? "none";
  const record = kycData?.record;
  const kycConf = KYC_STATUS[kycStatus as keyof typeof KYC_STATUS] ?? KYC_STATUS.none;
  const KycIcon = kycConf.Icon;

  const canResubmit = kycStatus === "rejected" || kycStatus === "none";

  const STEPS = ["Personal Info", "Documents", "Selfie", "Review"];

  const stepValid = (): boolean => {
    if (step === 1) return !!(form.fullName.trim() && /^\d{13}$/.test(form.cnic.replace(/[-\s]/g, "")) && form.dateOfBirth && form.gender);
    if (step === 2) return !!(photos.front && photos.back);
    if (step === 3) return !!photos.selfie;
    return true;
  };

  const f = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [key]: e.target.value }));

  if (kycLoading) {
    return (
      <div className="space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)}
      </div>
    );
  }

  /* ── Step 0: Status view ── */
  if (step === 0) {
    return (
      <div className="space-y-4">
        {/* Main status card */}
        <div className={cn("rounded-2xl border p-5", kycConf.bg, kycConf.border)}>
          <div className="flex items-center gap-3 mb-3">
            <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", kycStatus === "verified" ? "bg-green-500" : kycStatus === "pending" ? "bg-amber-400" : kycStatus === "rejected" ? "bg-red-400" : "bg-gray-200")}>
              <KycIcon size={22} color="white" />
            </div>
            <div>
              <p className="font-bold text-gray-900">Identity Verification (KYC)</p>
              <p className={cn("text-sm font-semibold", kycConf.color)}>{kycConf.label}</p>
            </div>
          </div>

          {kycStatus === "verified" && (
            <div className="bg-green-500 rounded-xl px-4 py-3 flex items-center gap-3">
              <BadgeCheck size={20} className="text-white shrink-0" />
              <div>
                <p className="text-white font-semibold text-sm">Account Verified ✓</p>
                <p className="text-green-100 text-xs">Your identity has been verified successfully</p>
              </div>
            </div>
          )}

          {kycStatus === "pending" && (
            <div className="space-y-2">
              <div className="bg-amber-400/20 rounded-xl px-4 py-3">
                <p className="text-amber-800 font-semibold text-sm">Review in Progress</p>
                <p className="text-amber-700 text-xs mt-0.5">Our team reviews submissions within 24 hours. You'll be notified once done.</p>
              </div>
              <button onClick={() => refetchKyc()} className="flex items-center gap-1.5 text-xs text-amber-600 font-medium">
                <RefreshCw size={11} /> Refresh status
              </button>
            </div>
          )}

          {kycStatus === "rejected" && record?.rejectionReason && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-red-700 font-semibold text-sm mb-1">Rejection Reason</p>
              <p className="text-red-600 text-sm">{record.rejectionReason}</p>
            </div>
          )}

          {kycStatus === "none" && (
            <p className="text-gray-500 text-sm">Verify your identity to unlock higher transaction limits and build trust with AJKMart.</p>
          )}
        </div>

        {/* Benefits */}
        {kycStatus !== "verified" && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="font-semibold text-gray-800 text-sm mb-3">Why Verify?</p>
            <div className="space-y-2.5">
              {[
                { icon: "🛡️", title: "Higher Security",    desc: "Your account is protected against fraud" },
                { icon: "💳", title: "Higher Limits",      desc: "Increase your wallet & transaction limits" },
                { icon: "🏆", title: "Gold Account Level", desc: "Unlock Gold tier membership & benefits" },
                { icon: "✅", title: "Verified Badge",     desc: "Build trust with verified identity" },
              ].map(b => (
                <div key={b.title} className="flex items-start gap-3">
                  <span className="text-base leading-none mt-0.5">{b.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{b.title}</p>
                    <p className="text-xs text-gray-500">{b.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submitted details */}
        {record && kycStatus !== "none" && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50">
              <p className="text-sm font-semibold text-gray-800">Submitted Details</p>
            </div>
            <div className="px-4 py-2 divide-y divide-gray-50">
              <Field label="Full Name"     value={record.fullName}    icon={User} />
              <Field label="CNIC Number"   value={record.cnic}        icon={CreditCard} />
              <Field label="Date of Birth" value={record.dateOfBirth} icon={FileText} />
              <Field label="City"          value={record.city}        icon={MapPin} />
            </div>
            <div className="px-4 pb-3 flex gap-2">
              {record.hasFrontId  && <div className="text-xs text-green-600 bg-green-50 rounded-lg px-2 py-1 flex items-center gap-1"><CheckCircle size={11} /> CNIC Front</div>}
              {record.hasBackId   && <div className="text-xs text-green-600 bg-green-50 rounded-lg px-2 py-1 flex items-center gap-1"><CheckCircle size={11} /> CNIC Back</div>}
              {record.hasSelfie   && <div className="text-xs text-green-600 bg-green-50 rounded-lg px-2 py-1 flex items-center gap-1"><CheckCircle size={11} /> Selfie</div>}
            </div>
            {record.submittedAt && (
              <div className="px-4 pb-4 text-xs text-gray-400">
                Submitted: {new Date(record.submittedAt).toLocaleString("en-PK")}
                {record.reviewedAt && ` · Reviewed: ${new Date(record.reviewedAt).toLocaleString("en-PK")}`}
              </div>
            )}
          </div>
        )}

        {canResubmit && (
          <button
            onClick={() => setStep(1)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm py-3.5 rounded-2xl transition flex items-center justify-center gap-2 shadow-md shadow-blue-100"
          >
            <FileText size={16} />
            {kycStatus === "rejected" ? "Resubmit KYC" : "Start KYC Verification"}
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    );
  }

  /* ── Stepper header ── */
  return (
    <div className="space-y-5">
      {/* Progress stepper */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-gray-800">Identity Verification</p>
          <p className="text-xs text-gray-400">Step {step} of 4</p>
        </div>
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => {
            const idx = i + 1;
            const active = step === idx;
            const done = step > idx;
            return (
              <div key={s} className="flex items-center flex-1">
                <div className={cn(
                  "flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0 transition",
                  done  ? "bg-green-500 text-white" :
                  active ? "bg-blue-600 text-white ring-2 ring-blue-200" :
                  "bg-gray-100 text-gray-400"
                )}>
                  {done ? <CheckCircle size={14} /> : idx}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={cn("flex-1 h-0.5 mx-1", done ? "bg-green-400" : "bg-gray-100")} />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex mt-2">
          {STEPS.map((s, i) => (
            <p key={s} className={cn(
              "flex-1 text-[10px] font-medium text-center",
              step === i + 1 ? "text-blue-600" : step > i + 1 ? "text-green-600" : "text-gray-400"
            )}>{s}</p>
          ))}
        </div>
      </div>

      {/* Step 1: Personal Info */}
      {step === 1 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="bg-blue-600 px-4 py-3 flex items-center gap-2">
            <User size={16} className="text-white" />
            <p className="text-white font-bold text-sm">Personal Information</p>
          </div>
          <div className="px-4 py-4 space-y-3.5">
            {[
              { key: "fullName",    label: "Full Name",    placeholder: "As on CNIC", type: "text" },
              { key: "cnic",        label: "CNIC Number",  placeholder: "3740512345678 (13 digits)", type: "text" },
              { key: "dateOfBirth", label: "Date of Birth", placeholder: "", type: "date" },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key}>
                <label className="text-xs font-semibold text-gray-600 block mb-1">{label} <span className="text-red-400">*</span></label>
                <input
                  type={type}
                  value={(form as any)[key]}
                  onChange={f(key as keyof typeof form)}
                  placeholder={placeholder}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition"
                />
              </div>
            ))}
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Gender <span className="text-red-400">*</span></label>
              <select
                value={form.gender}
                onChange={f("gender")}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition bg-white"
              >
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other / Prefer not to say</option>
              </select>
            </div>
            {[
              { key: "address", label: "Home Address", placeholder: "Street, house no." },
              { key: "city",    label: "City",         placeholder: "Rawalakot, Mirpur..." },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-xs font-semibold text-gray-600 block mb-1">{label}</label>
                <input
                  type="text"
                  value={(form as any)[key]}
                  onChange={f(key as keyof typeof form)}
                  placeholder={placeholder}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Documents */}
      {step === 2 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="bg-blue-600 px-4 py-3 flex items-center gap-2">
            <CreditCard size={16} className="text-white" />
            <p className="text-white font-bold text-sm">CNIC / ID Card Photos</p>
          </div>
          <div className="px-4 py-4 space-y-4">
            <div className="bg-blue-50 rounded-xl p-3 flex items-start gap-2">
              <AlertCircle size={15} className="text-blue-500 shrink-0 mt-0.5" />
              <p className="text-blue-700 text-xs leading-relaxed">Take clear photos of your CNIC. All 4 corners must be visible. Avoid glare and blur.</p>
            </div>
            <PhotoUploadBox
              label="CNIC Front Side"
              hint="Tap to upload front of CNIC"
              file={photos.front}
              preview={previews.front}
              onChange={f => setPhoto("front", f)}
              required
            />
            <PhotoUploadBox
              label="CNIC Back Side"
              hint="Tap to upload back of CNIC"
              file={photos.back}
              preview={previews.back}
              onChange={f => setPhoto("back", f)}
              required
            />
          </div>
        </div>
      )}

      {/* Step 3: Selfie */}
      {step === 3 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="bg-blue-600 px-4 py-3 flex items-center gap-2">
            <Camera size={16} className="text-white" />
            <p className="text-white font-bold text-sm">Selfie with CNIC</p>
          </div>
          <div className="px-4 py-4 space-y-4">
            <div className="bg-blue-50 rounded-xl p-3 flex items-start gap-2">
              <AlertCircle size={15} className="text-blue-500 shrink-0 mt-0.5" />
              <div className="text-blue-700 text-xs leading-relaxed">
                <p className="font-semibold mb-1">Instructions:</p>
                <ul className="space-y-0.5 list-disc list-inside">
                  <li>Hold your CNIC next to your face</li>
                  <li>Make sure both your face and CNIC are clearly visible</li>
                  <li>Use good lighting, avoid sunglasses or hats</li>
                  <li>Your face must match the photo on CNIC</li>
                </ul>
              </div>
            </div>
            <PhotoUploadBox
              label="Selfie with CNIC"
              hint="Hold CNIC next to your face and take a photo"
              file={photos.selfie}
              preview={previews.selfie}
              onChange={f => setPhoto("selfie", f)}
              required
            />
          </div>
        </div>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="bg-blue-600 px-4 py-3 flex items-center gap-2">
              <CheckCircle size={16} className="text-white" />
              <p className="text-white font-bold text-sm">Review & Submit</p>
            </div>
            <div className="px-4 py-3 divide-y divide-gray-50">
              <Field label="Full Name"     value={form.fullName}    icon={User} />
              <Field label="CNIC Number"   value={form.cnic}        icon={CreditCard} />
              <Field label="Date of Birth" value={form.dateOfBirth} icon={FileText} />
              <Field label="Gender"        value={form.gender}      icon={User} />
              <Field label="City"          value={form.city}        icon={MapPin} />
              <Field label="Address"       value={form.address}     icon={MapPin} />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">Uploaded Documents</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: "front" as const, label: "CNIC Front" },
                { key: "back"  as const, label: "CNIC Back" },
                { key: "selfie"as const, label: "Selfie" },
              ].map(({ key, label }) => (
                <div key={key} className="text-center">
                  {previews[key] ? (
                    <img src={previews[key]!} className="w-full h-20 object-cover rounded-xl mb-1" alt={label} />
                  ) : (
                    <div className="w-full h-20 bg-gray-100 rounded-xl mb-1 flex items-center justify-center">
                      <XCircle size={18} className="text-gray-300" />
                    </div>
                  )}
                  <p className="text-[10px] text-gray-500">{label}</p>
                  {previews[key] && <p className="text-[10px] text-green-600 font-medium">✓ Ready</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
            <p className="font-semibold mb-1">Before submitting:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>All information must match your CNIC exactly</li>
              <li>Photos must be clear and readable</li>
              <li>False information may result in account suspension</li>
            </ul>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          onClick={() => step === 1 ? setStep(0) : setStep(s => s - 1)}
          className="flex-1 border border-gray-200 text-gray-600 font-semibold text-sm py-3 rounded-xl hover:bg-gray-50 transition"
        >
          {step === 1 ? "Cancel" : "Back"}
        </button>
        {step < 4 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!stepValid()}
            className={cn(
              "flex-1 font-bold text-sm py-3 rounded-xl transition flex items-center justify-center gap-2",
              stepValid()
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            )}
          >
            Next <ChevronRight size={16} />
          </button>
        ) : (
          <button
            onClick={() => submitMut.mutate()}
            disabled={submitMut.isPending}
            className="flex-2 flex-1 bg-green-600 hover:bg-green-700 text-white font-bold text-sm py-3 rounded-xl transition flex items-center justify-center gap-2 shadow-md shadow-green-100"
          >
            {submitMut.isPending
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <><CheckCircle size={16} /> Submit KYC</>
            }
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Personal Section ── */
function PersonalSection({ onToast }: { onToast: (msg: string, t: "success" | "error") => void }) {
  const qc = useQueryClient();
  const { user, setUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", cnic: "", city: "", address: "" });
  const avatarRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) setForm({ name: user.name ?? "", email: user.email ?? "", cnic: user.cnic ?? "", city: user.city ?? "", address: user.address ?? "" });
  }, [user]);

  const saveMut = useMutation({
    mutationFn: () => api.updateProfile({ name: form.name.trim() || undefined, email: form.email.trim() || undefined, cnic: form.cnic.trim() || undefined, city: form.city.trim() || undefined, address: form.address.trim() || undefined }),
    onSuccess: (d) => { setUser({ ...user!, ...d }); qc.invalidateQueries({ queryKey: ["cust-profile"] }); setEditing(false); onToast("Profile updated!", "success"); },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  const avatarMut = useMutation({
    mutationFn: (file: File) => api.uploadAvatar(file),
    onSuccess: (d) => { setUser({ ...user!, avatar: d.avatarUrl }); onToast("Photo updated!", "success"); },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  const level = LEVEL_CONFIG[user?.accountLevel as keyof typeof LEVEL_CONFIG ?? "bronze"] ?? LEVEL_CONFIG.bronze;
  const kycConf = KYC_STATUS[user?.kycStatus as keyof typeof KYC_STATUS ?? "none"] ?? KYC_STATUS.none;
  const KycIcon = kycConf.Icon;

  return (
    <div className="space-y-4">
      {/* Hero card */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-20 h-20 rounded-2xl bg-white/20 overflow-hidden ring-2 ring-white/40">
              {user?.avatar
                ? <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-white">
                    {(user?.name ?? user?.phone ?? "?")[0].toUpperCase()}
                  </div>
              }
            </div>
            <button onClick={() => avatarRef.current?.click()} disabled={avatarMut.isPending}
              className="absolute -bottom-1 -right-1 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-md hover:bg-gray-50 transition">
              {avatarMut.isPending ? <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> : <Camera size={13} className="text-blue-600" />}
            </button>
            <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) avatarMut.mutate(f); e.target.value = ""; }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-lg leading-tight truncate">{user?.name ?? "—"}</p>
            <p className="text-white/70 text-sm truncate">{user?.phone}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-base">{level.icon}</span>
              <span className="text-sm font-semibold">{level.label} Member</span>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-white/70 mb-1.5">
            <span>Account Level</span>
            <span>{level.pct}%</span>
          </div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-500", level.bar)} style={{ width: `${level.pct}%` }} />
          </div>
          <p className="text-xs text-white/60 mt-1.5">{level.tip}</p>
        </div>
      </div>

      {/* KYC quick status */}
      <div className={cn("flex items-center justify-between gap-3 px-4 py-3 rounded-xl border", kycConf.bg, kycConf.border)}>
        <div className="flex items-center gap-2">
          <KycIcon size={16} className={kycConf.color} />
          <div>
            <p className={cn("font-semibold text-sm", kycConf.color)}>KYC: {kycConf.label}</p>
            {user?.kycStatus === "none" && <p className="text-gray-400 text-xs">Verify your identity for higher limits</p>}
          </div>
        </div>
        {user?.kycStatus !== "verified" && (
          <ChevronDown size={15} className="text-gray-400" />
        )}
      </div>

      {/* Info */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
          <p className="font-semibold text-gray-800 text-sm">Personal Information</p>
          <button onClick={() => editing ? saveMut.mutate() : setEditing(true)} disabled={saveMut.isPending}
            className={cn("flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition",
              editing ? "bg-blue-500 text-white hover:bg-blue-600" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
            {saveMut.isPending ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : editing ? <><Save size={12} /> Save</> : <><Edit2 size={12} /> Edit</>}
          </button>
        </div>
        <div className="px-4 py-2">
          {editing ? (
            <div className="space-y-3 py-2">
              {[
                { key: "name", label: "Full Name", placeholder: "Your full name", Icon: User },
                { key: "email", label: "Email", placeholder: "email@example.com", Icon: Mail },
                { key: "cnic", label: "CNIC", placeholder: "3740512345678", Icon: CreditCard },
                { key: "city", label: "City", placeholder: "Rawalakot, Mirpur...", Icon: MapPin },
                { key: "address", label: "Address", placeholder: "Home address", Icon: MapPin },
              ].map(({ key, label, placeholder, Icon }) => (
                <div key={key}>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1"><Icon size={12} /> {label}</label>
                  <input className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition"
                    value={(form as any)[key]} placeholder={placeholder}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} />
                </div>
              ))}
              <button onClick={() => setEditing(false)} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 pt-1">Cancel</button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              <Field label="Phone" value={user?.phone} icon={Phone} />
              <Field label="Full Name" value={user?.name} icon={User} />
              <Field label="Email" value={user?.email} icon={Mail} />
              <Field label="CNIC" value={user?.cnic} icon={CreditCard} />
              <Field label="City" value={user?.city} icon={MapPin} />
              <Field label="Address" value={user?.address} icon={MapPin} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Security Section ── */
function SecuritySection({ onToast }: { onToast: (msg: string, t: "success" | "error") => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [show, setShow] = useState({ current: false, next: false, confirm: false });

  const pwMut = useMutation({
    mutationFn: () => {
      if (form.next !== form.confirm) throw new Error("Passwords don't match");
      if (form.next.length < 6) throw new Error("Password must be at least 6 characters");
      return api.setPassword(form.next, user?.totpEnabled || !!form.current ? form.current : undefined);
    },
    onSuccess: () => { setForm({ current: "", next: "", confirm: "" }); onToast("Password updated!", "success"); },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <p className="font-semibold text-gray-800 text-sm flex items-center gap-2">
            <Lock size={15} className="text-blue-500" /> Change Password
          </p>
        </div>
        <div className="px-4 py-4 space-y-3">
          {[
            { key: "current", label: "Current Password", show: show.current, toggle: () => setShow(p => ({ ...p, current: !p.current })) },
            { key: "next",    label: "New Password",     show: show.next,    toggle: () => setShow(p => ({ ...p, next: !p.next })) },
            { key: "confirm", label: "Confirm Password", show: show.confirm, toggle: () => setShow(p => ({ ...p, confirm: !p.confirm })) },
          ].map(({ key, label, show: vis, toggle }) => (
            <div key={key}>
              <label className="text-xs font-medium text-gray-500 block mb-1">{label}</label>
              <div className="relative">
                <input type={vis ? "text" : "password"}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition"
                  value={(form as any)[key]} placeholder="••••••••"
                  onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} />
                <button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {vis ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          ))}
          <button onClick={() => pwMut.mutate()} disabled={pwMut.isPending || !form.next}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm py-2.5 rounded-xl transition flex items-center justify-center gap-2">
            {pwMut.isPending ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Lock size={14} /> Update Password</>}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-4 space-y-3">
        <p className="font-semibold text-gray-800 text-sm flex items-center gap-2"><Shield size={15} className="text-blue-500" /> Account Info</p>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span className="text-gray-400">Member Since</span>
            <span className="font-medium">{user?.createdAt ? new Date(user.createdAt).toLocaleDateString("en-PK", { month: "short", year: "numeric" }) : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">2FA Status</span>
            <span className={cn("font-medium text-xs px-2 py-0.5 rounded-full", user?.totpEnabled ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500")}>
              {user?.totpEnabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Phone</span>
            <span className="font-medium">{user?.phone}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Settings Section ── */
function SettingsSection({ onToast }: { onToast: (msg: string, t: "success" | "error") => void }) {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ["cust-settings"], queryFn: api.getSettings });
  const saveMut = useMutation({
    mutationFn: (patch: any) => api.updateSettings(patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cust-settings"] }); onToast("Settings saved!", "success"); },
    onError: (e: Error) => onToast(e.message, "error"),
  });

  if (isLoading) return <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-14 bg-gray-100 rounded-2xl animate-pulse" />)}</div>;

  const NOTIFS = [
    { key: "notifOrders", label: "Order updates" },
    { key: "notifWallet", label: "Wallet transactions" },
    { key: "notifRides",  label: "Ride updates" },
    { key: "notifDeals",  label: "Deals & offers" },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <p className="font-semibold text-gray-800 text-sm flex items-center gap-2"><Globe size={15} className="text-blue-500" /> Language</p>
        </div>
        <div className="px-4 py-3 grid grid-cols-2 gap-2">
          {LANGUAGES.map(l => (
            <button key={l.code} onClick={() => saveMut.mutate({ language: l.code })}
              className={cn("px-3 py-2 rounded-xl text-sm font-medium border transition text-left",
                settings?.language === l.code ? "bg-blue-600 text-white border-blue-600" : "bg-gray-50 text-gray-600 border-gray-100 hover:border-blue-300")}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50">
          <p className="font-semibold text-gray-800 text-sm flex items-center gap-2"><Bell size={15} className="text-blue-500" /> Notifications</p>
        </div>
        <div className="divide-y divide-gray-50">
          {NOTIFS.map(({ key, label }) => {
            const val = settings?.[key] ?? true;
            return (
              <div key={key} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  {val ? <Bell size={14} className="text-blue-500" /> : <BellOff size={14} className="text-gray-400" />}
                  {label}
                </div>
                <button onClick={() => saveMut.mutate({ [key]: !val })} disabled={saveMut.isPending}
                  className={cn("w-11 h-6 rounded-full transition-all relative", val ? "bg-blue-600" : "bg-gray-200")}>
                  <span className={cn("absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all", val ? "left-5" : "left-0.5")} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Main Profile ── */
export default function Profile() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("personal");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const kycConf = KYC_STATUS[user?.kycStatus as keyof typeof KYC_STATUS ?? "none"] ?? KYC_STATUS.none;

  const TABS: { id: Tab; label: string; icon: React.ElementType; badge?: string }[] = [
    { id: "personal", label: "Profile",  icon: User },
    { id: "kyc",      label: "KYC",      icon: BadgeCheck, badge: user?.kycStatus === "none" ? "!" : user?.kycStatus === "rejected" ? "!" : undefined },
    { id: "security", label: "Security", icon: Shield },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate("/")} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 transition text-gray-600">
            <ChevronLeft size={20} />
          </button>
          <h1 className="font-bold text-gray-900 text-base flex-1">My Profile</h1>
          <button onClick={logout} className="flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition">
            <LogOut size={13} /> Logout
          </button>
        </div>
        <div className="max-w-lg mx-auto flex border-t border-gray-50">
          {TABS.map(({ id, label, icon: Icon, badge }) => (
            <button key={id} onClick={() => setTab(id)}
              className={cn("flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-semibold transition border-b-2 relative",
                tab === id ? "border-blue-500 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-600")}>
              <Icon size={13} />
              {label}
              {badge && (
                <span className="absolute top-1.5 right-2 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5">
        {tab === "personal" && <PersonalSection onToast={showToast} />}
        {tab === "kyc"      && <KycSection      onToast={showToast} />}
        {tab === "security" && <SecuritySection onToast={showToast} />}
        {tab === "settings" && <SettingsSection onToast={showToast} />}
      </div>
    </div>
  );
}
