import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { PageHeader } from "../components/PageHeader";
import { fc, CARD, INPUT, BTN_PRIMARY, LABEL } from "../lib/ui";

const CITIES = ["Muzaffarabad","Mirpur","Rawalakot","Bagh","Kotli","Bhimber","Jhelum","Rawalpindi","Islamabad","Lahore","Karachi","Other"];
const BANKS  = ["EasyPaisa","JazzCash","MCB","HBL","UBL","Meezan Bank","Bank Alfalah","NBP","Allied Bank","Other"];
const BIZ_TYPES = ["Sole Proprietorship","Partnership","Private Limited","Trust / NGO","Individual / Freelancer"];

function fd(d: string | Date) {
  return new Date(d).toLocaleDateString("en-PK", { day:"numeric", month:"long", year:"numeric" });
}

type EditSection = "personal" | "bank" | null;

export default function Profile() {
  const { user, logout, refreshUser } = useAuth();
  const { config } = usePlatformConfig();

  const { data: notifData } = useQuery({
    queryKey: ["vendor-notifs-count"],
    queryFn: () => api.getNotifications(),
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const unread: number = notifData?.unread || 0;

  const [editing, setEditing] = useState<EditSection>(null);
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState("");

  // Personal info form state
  const [name, setName]               = useState(user?.name || "");
  const [email, setEmail]             = useState(user?.email || "");
  const [cnic, setCnic]               = useState(user?.cnic || "");
  const [city, setCity]               = useState(user?.city || "");
  const [address, setAddress]         = useState(user?.address || "");
  const [businessType, setBusinessType] = useState(user?.businessType || "");

  // Bank info form state
  const [bankName, setBankName]               = useState(user?.bankName || "");
  const [bankAccount, setBankAccount]         = useState(user?.bankAccount || "");
  const [bankAccountTitle, setBankAccountTitle] = useState(user?.bankAccountTitle || "");

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };

  const startEdit = (section: EditSection) => {
    if (section === "personal") {
      setName(user?.name || ""); setEmail(user?.email || ""); setCnic(user?.cnic || "");
      setCity(user?.city || ""); setAddress(user?.address || ""); setBusinessType(user?.businessType || "");
    } else if (section === "bank") {
      setBankName(user?.bankName || ""); setBankAccount(user?.bankAccount || ""); setBankAccountTitle(user?.bankAccountTitle || "");
    }
    setEditing(section);
  };

  const saveSection = async (section: EditSection) => {
    setSaving(true);
    try {
      if (section === "personal") {
        await api.updateProfile({ name, email, cnic, city, address, businessType } as any);
      } else if (section === "bank") {
        await api.updateProfile({ bankName, bankAccount, bankAccountTitle } as any);
      }
      await refreshUser();
      setEditing(null);
      showToast("✅ Changes saved successfully!");
    } catch (e: any) {
      showToast("❌ " + (e.message || "Failed to save"));
    }
    setSaving(false);
  };

  const SELECT = "w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-orange-400 appearance-none";

  const InfoRow = ({ label, value, empty = "Not set" }: { label: string; value?: string | null; empty?: string }) => (
    <div className="flex justify-between items-start py-3 border-b border-gray-50 last:border-0 gap-3">
      <span className="text-sm text-gray-400 font-medium flex-shrink-0">{label}</span>
      <span className={`text-sm font-semibold text-right ${value ? "text-gray-800" : "text-gray-300 italic"}`}>{value || empty}</span>
    </div>
  );

  const completionFields = [user?.name, user?.email, user?.cnic, user?.city, user?.bankName, user?.bankAccount];
  const completedCount   = completionFields.filter(Boolean).length;
  const completionPct    = Math.round((completedCount / completionFields.length) * 100);

  return (
    <div className="bg-gray-50 md:bg-transparent">
      <PageHeader
        title="My Account"
        subtitle="Vendor profile & settings"
        actions={
          <div className="flex items-center gap-2">
            <Link href="/notifications" className="relative h-9 w-9 flex items-center justify-center bg-white/20 md:bg-gray-100 text-white md:text-gray-700 rounded-xl android-press min-h-0">
              🔔
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-extrabold rounded-full w-4 h-4 flex items-center justify-center">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
            <button onClick={logout}
              className="h-9 px-4 bg-white/20 md:bg-red-50 md:text-red-600 text-white text-sm font-bold rounded-xl android-press min-h-0">
              🚪 Logout
            </button>
          </div>
        }
      />

      <div className="px-4 py-4 md:px-0 md:py-4">
        <div className="md:grid md:grid-cols-3 md:gap-6 space-y-4 md:space-y-0">

          {/* ── Column 1: Identity + Wallet ── */}
          <div className="space-y-4">
            {/* Mobile Quick Links */}
            <div className="md:hidden grid grid-cols-3 gap-3">
              {[
                { href: "/store",         icon: "🏪", label: "My Store"      },
                { href: "/analytics",     icon: "📈", label: "Analytics"     },
                { href: "/notifications", icon: "🔔", label: "Notifications", badge: unread },
              ].map(item => (
                <Link key={item.href} href={item.href}
                  className="bg-white rounded-2xl shadow-sm p-3 flex flex-col items-center gap-1.5 android-press relative">
                  <span className="text-2xl">{item.icon}</span>
                  <span className="text-[10px] font-bold text-gray-600">{item.label}</span>
                  {(item as any).badge > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-extrabold rounded-full w-5 h-5 flex items-center justify-center">
                      {(item as any).badge > 9 ? "9+" : (item as any).badge}
                    </span>
                  )}
                </Link>
              ))}
            </div>

            {/* Business Identity Card */}
            <div className={CARD}>
              <div className="p-5 text-center border-b border-gray-100">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-4xl font-extrabold text-white mx-auto mb-3 shadow-md">
                  {(user?.storeName || user?.name || "V")[0].toUpperCase()}
                </div>
                <h2 className="text-lg font-extrabold text-gray-900">{user?.storeName || "My Store"}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{user?.name || user?.phone}</p>
                {user?.businessType && (
                  <p className="text-xs text-gray-400 mt-0.5">{user.businessType}</p>
                )}
                <div className="flex items-center justify-center gap-2 mt-2.5 flex-wrap">
                  {user?.storeCategory && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full font-bold capitalize">{user.storeCategory}</span>
                  )}
                  <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-bold">✓ Verified</span>
                  {user?.city && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full font-bold">📍 {user.city}</span>
                  )}
                </div>
              </div>
              <div className="p-4 grid grid-cols-2 gap-3">
                <div className="text-center bg-orange-50 rounded-xl p-3">
                  <p className="text-2xl font-extrabold text-orange-500">{user?.stats?.totalOrders || 0}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Total Orders</p>
                </div>
                <div className="text-center bg-amber-50 rounded-xl p-3">
                  <p className="text-lg font-extrabold text-amber-600">{fc(user?.stats?.totalRevenue || 0)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Total Earned</p>
                </div>
              </div>
            </div>

            {/* Profile Completion */}
            <div className="bg-white rounded-2xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-gray-700">Profile Completion</p>
                <span className={`text-sm font-extrabold ${completionPct >= 80 ? "text-green-600" : completionPct >= 50 ? "text-orange-500" : "text-red-500"}`}>{completionPct}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="h-2 rounded-full bg-gradient-to-r from-orange-400 to-amber-500 transition-all"
                  style={{ width: `${completionPct}%` }}/>
              </div>
              {completionPct < 100 && (
                <p className="text-xs text-gray-400 mt-2">Complete your profile to unlock all features</p>
              )}
            </div>

            {/* Wallet */}
            <div className="bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl p-4 text-white shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-orange-100 font-medium">Wallet Balance</p>
                  <p className="text-3xl font-extrabold mt-0.5">{fc(user?.walletBalance || 0)}</p>
                </div>
                <div className="text-right bg-white/15 rounded-2xl px-4 py-2.5">
                  <p className="text-xs text-orange-100 font-medium">Commission</p>
                  <p className="text-3xl font-extrabold">85%</p>
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-white/20 flex items-center justify-between">
                <p className="text-xs text-orange-100 font-medium">Platform fee: 15% per order</p>
                <Link href="/wallet" className="text-xs bg-white/20 text-white font-bold px-3 py-1 rounded-lg">Withdraw →</Link>
              </div>
            </div>

            {/* Security */}
            <div className={CARD}>
              <div className="px-4 py-3.5 border-b border-gray-100">
                <p className="font-bold text-gray-800 text-sm">🔒 Security & Session</p>
              </div>
              <div className="px-4 py-3">
                <InfoRow label="Member Since" value={user?.createdAt ? fd(user.createdAt) : "—"} />
                <InfoRow label="Last Login"   value={user?.lastLoginAt ? fd(user.lastLoginAt) : "Now"} />
                <InfoRow label="Status"       value="✓ Active & Verified" />
                <div className="bg-blue-50 rounded-xl p-3 mt-2">
                  <p className="text-xs text-blue-700 font-medium">🔐 Session secured via encrypted authentication. Logout if using a shared device.</p>
                </div>
              </div>
            </div>

            <button onClick={logout} className="w-full h-12 border-2 border-red-200 text-red-500 font-bold rounded-2xl hover:bg-red-50 transition-colors text-sm">
              🚪 Logout from This Device
            </button>
          </div>

          {/* ── Column 2: Personal Information ── */}
          <div className="space-y-4">
            <div className={CARD}>
              <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="font-bold text-gray-800 text-sm">👤 Personal Information</p>
                  <p className="text-xs text-gray-400 mt-0.5">Contact & identity details</p>
                </div>
                <button onClick={() => editing === "personal" ? setEditing(null) : startEdit("personal")}
                  className="text-orange-500 text-sm font-bold android-press min-h-0 py-1">
                  {editing === "personal" ? "Cancel" : "✏️ Edit"}
                </button>
              </div>

              {editing === "personal" ? (
                <div className="p-4 space-y-3">
                  <div>
                    <label className={LABEL}>Full Name *</label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" className={INPUT}/>
                  </div>
                  <div>
                    <label className={LABEL}>Email Address</label>
                    <input value={email} onChange={e => setEmail(e.target.value)} type="email" inputMode="email" placeholder="email@company.com" className={INPUT}/>
                  </div>
                  <div>
                    <label className={LABEL}>CNIC / National ID</label>
                    <input value={cnic} onChange={e => setCnic(e.target.value)} inputMode="numeric" placeholder="XXXXX-XXXXXXX-X" className={INPUT}/>
                    <p className="text-[10px] text-gray-400 mt-1">Format: 42101-1234567-8 · Required for verification</p>
                  </div>
                  <div>
                    <label className={LABEL}>City</label>
                    <select value={city} onChange={e => setCity(e.target.value)} className={SELECT}>
                      <option value="">Select city</option>
                      {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Business Address</label>
                    <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, Area, City" className={INPUT}/>
                  </div>
                  <div>
                    <label className={LABEL}>Business Type</label>
                    <select value={businessType} onChange={e => setBusinessType(e.target.value)} className={SELECT}>
                      <option value="">Select business type</option>
                      {BIZ_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <button onClick={() => saveSection("personal")} disabled={saving} className={BTN_PRIMARY}>
                    {saving ? "Saving..." : "✓ Save Changes"}
                  </button>
                </div>
              ) : (
                <div className="px-4 py-3">
                  <InfoRow label="Full Name"      value={user?.name} />
                  <InfoRow label="Phone"          value={user?.phone} empty="—" />
                  <InfoRow label="Email"          value={user?.email} />
                  <InfoRow label="CNIC"           value={user?.cnic} />
                  <InfoRow label="City"           value={user?.city} />
                  <InfoRow label="Address"        value={user?.address} />
                  <InfoRow label="Business Type"  value={user?.businessType} />
                </div>
              )}
            </div>

            {/* Quick Actions — Desktop only */}
            <div className="hidden md:block bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3.5 border-b border-gray-100">
                <p className="font-bold text-gray-800 text-sm">⚡ Quick Links</p>
              </div>
              <div className="p-4 space-y-2">
                {[
                  { href: "/store",         icon: "🏪", label: "Manage Store Settings" },
                  { href: "/analytics",     icon: "📈", label: "Business Analytics"    },
                  { href: "/orders",        icon: "📦", label: "Orders"                },
                  { href: "/wallet",        icon: "💰", label: "Wallet & Withdrawals"  },
                  { href: "/notifications", icon: "🔔", label: "Notifications", badge: unread },
                ].map(item => (
                  <Link key={item.href} href={item.href}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-orange-50 transition-colors relative">
                    <span className="text-lg">{item.icon}</span>
                    <span className="text-sm font-semibold text-gray-700">{item.label}</span>
                    {(item as any).badge > 0 && (
                      <span className="ml-auto bg-red-500 text-white text-[10px] font-extrabold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                        {(item as any).badge}
                      </span>
                    )}
                    <span className="ml-auto text-gray-300 text-sm">→</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* ── Column 3: Bank / Withdrawal Account ── */}
          <div className="space-y-4">
            <div className={CARD}>
              <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="font-bold text-gray-800 text-sm">🏦 Withdrawal Account</p>
                  <p className="text-xs text-gray-400 mt-0.5">Bank or mobile wallet for payouts</p>
                </div>
                <button onClick={() => editing === "bank" ? setEditing(null) : startEdit("bank")}
                  className="text-orange-500 text-sm font-bold android-press min-h-0 py-1">
                  {editing === "bank" ? "Cancel" : "✏️ Edit"}
                </button>
              </div>

              {editing === "bank" ? (
                <div className="p-4 space-y-3">
                  <div>
                    <label className={LABEL}>Bank / Mobile Wallet *</label>
                    <select value={bankName} onChange={e => setBankName(e.target.value)} className={SELECT}>
                      <option value="">Select bank or wallet</option>
                      {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Account / Phone Number *</label>
                    <input value={bankAccount} onChange={e => setBankAccount(e.target.value)} inputMode="numeric" placeholder="03XX-XXXXXXX or IBAN" className={INPUT}/>
                  </div>
                  <div>
                    <label className={LABEL}>Account Holder Name *</label>
                    <input value={bankAccountTitle} onChange={e => setBankAccountTitle(e.target.value)} placeholder="Full name as on account" className={INPUT}/>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3">
                    <p className="text-xs text-amber-700 font-medium">⚠️ Ensure details match your bank records. Incorrect info may delay withdrawals.</p>
                  </div>
                  <button onClick={() => saveSection("bank")} disabled={saving} className={BTN_PRIMARY}>
                    {saving ? "Saving..." : "✓ Save Account Details"}
                  </button>
                </div>
              ) : (
                <div className="px-4 py-3">
                  {user?.bankName ? (
                    <>
                      <div className="flex items-center gap-3 bg-orange-50 rounded-xl p-3.5 mb-3">
                        <span className="text-2xl">{user.bankName.includes("Easy") ? "📱" : user.bankName.includes("Jazz") ? "📱" : "🏦"}</span>
                        <div>
                          <p className="font-bold text-gray-800 text-sm">{user.bankName}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{user.bankAccount}</p>
                          <p className="text-xs text-gray-500">{user.bankAccountTitle}</p>
                        </div>
                        <span className="ml-auto text-xs bg-green-100 text-green-700 font-bold px-2 py-0.5 rounded-full">✓ Set</span>
                      </div>
                      <InfoRow label="Bank"           value={user.bankName}         />
                      <InfoRow label="Account No."    value={user.bankAccount}      />
                      <InfoRow label="Account Title"  value={user.bankAccountTitle} />
                    </>
                  ) : (
                    <div className="py-6 text-center">
                      <p className="text-3xl mb-2">🏦</p>
                      <p className="text-sm font-bold text-gray-600">No account set</p>
                      <p className="text-xs text-gray-400 mt-1">Add your bank account to receive withdrawals</p>
                      <button onClick={() => startEdit("bank")}
                        className="mt-3 px-4 py-2 bg-orange-50 text-orange-600 font-bold rounded-xl text-sm">
                        + Add Account
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Payout Policy */}
            <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100 rounded-2xl p-4">
              <p className="font-bold text-orange-700 text-sm mb-2">💡 Payout Policy</p>
              <div className="space-y-2">
                {[
                  { icon: "✅", text: "85% earnings — 15% platform fee" },
                  { icon: "💸", text: "Minimum withdrawal: Rs. 500" },
                  { icon: "⏱️", text: "Processed in 24–48 hours by admin" },
                  { icon: "🔒", text: "CNIC verification required for large withdrawals" },
                ].map((p, i) => (
                  <div key={i} className="flex gap-2 text-xs text-orange-700">
                    <span className="flex-shrink-0">{p.icon}</span>
                    <span>{p.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* AJKMart Vendor Agreement + Links */}
            <div className="bg-gray-100 rounded-2xl p-4 space-y-3">
              <p className="text-xs text-gray-500 text-center leading-relaxed">
                By using {config.platform.appName} Vendor Portal, you agree to our vendor terms.
                {" "}For support: <a href={`tel:${config.platform.supportPhone}`} className="font-bold text-orange-500">{config.platform.supportPhone}</a>
              </p>
              {config.platform.supportHours && (
                <p className="text-xs text-gray-400 text-center">⏰ {config.platform.supportHours}</p>
              )}
              {config.platform.supportEmail && (
                <p className="text-xs text-gray-500 text-center">
                  ✉️ <a href={`mailto:${config.platform.supportEmail}`} className="text-orange-500 hover:text-orange-700">{config.platform.supportEmail}</a>
                </p>
              )}
              {(config.platform.socialFacebook || config.platform.socialInstagram) && (
                <div className="flex gap-3 justify-center">
                  {config.platform.socialFacebook && (
                    <a href={config.platform.socialFacebook} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800">📘 Facebook</a>
                  )}
                  {config.platform.socialInstagram && (
                    <a href={config.platform.socialInstagram} target="_blank" rel="noopener noreferrer" className="text-xs text-pink-600 hover:text-pink-800">📸 Instagram</a>
                  )}
                </div>
              )}
              {(config.content.tncUrl || config.content.privacyUrl || config.content.refundPolicyUrl || config.content.faqUrl || config.content.aboutUrl || config.features.chat) && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {config.content.tncUrl && (
                    <a href={config.content.tncUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-orange-600 underline underline-offset-2 hover:text-orange-800 transition-colors">
                      📋 Terms of Service
                    </a>
                  )}
                  {config.content.privacyUrl && (
                    <a href={config.content.privacyUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-orange-600 underline underline-offset-2 hover:text-orange-800 transition-colors">
                      🔒 Privacy Policy
                    </a>
                  )}
                  {config.content.refundPolicyUrl && (
                    <a href={config.content.refundPolicyUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-orange-600 underline underline-offset-2 hover:text-orange-800 transition-colors">
                      ↩️ Refund Policy
                    </a>
                  )}
                  {config.content.faqUrl && (
                    <a href={config.content.faqUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-orange-600 underline underline-offset-2 hover:text-orange-800 transition-colors">
                      ❓ Help & FAQs
                    </a>
                  )}
                  {config.content.aboutUrl && (
                    <a href={config.content.aboutUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-orange-600 underline underline-offset-2 hover:text-orange-800 transition-colors">
                      ℹ️ About Us
                    </a>
                  )}
                  {config.features.chat && (
                    <a href={`https://wa.me/${config.platform.supportPhone.replace(/^0/, "92")}`} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-green-600 underline underline-offset-2 hover:text-green-800 transition-colors">
                      💬 {config.content.supportMsg || "Live Support"}
                    </a>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-400 text-center">{config.platform.businessAddress}</p>
            </div>
          </div>

        </div>
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
