import { useState } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { fc, CARD, CARD_HEADER, INPUT, BTN_PRIMARY, BTN_SECONDARY, LABEL, ROW } from "../lib/ui";

function fd(d: string | Date) { return new Date(d).toLocaleDateString("en-PK", { day:"numeric", month:"long", year:"numeric" }); }

export default function Profile() {
  const { user, logout, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName]       = useState(user?.name || "");
  const [email, setEmail]     = useState(user?.email || "");
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.updateProfile({ name, email });
      await refreshUser();
      setEditing(false);
      showToast("✅ Profile updated!");
    } catch(e: any) { showToast("❌ " + e.message); }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 md:bg-transparent md:min-h-0">
      <PageHeader
        title="My Account"
        subtitle="Vendor profile & settings"
        actions={
          <button onClick={logout}
            className="h-9 px-4 bg-white/20 md:bg-red-50 md:text-red-600 text-white text-sm font-bold rounded-xl android-press min-h-0">
            🚪 Logout
          </button>
        }
      />

      <div className="px-4 py-4 md:px-0 md:py-4">
        <div className="md:grid md:grid-cols-3 md:gap-6 space-y-4 md:space-y-0">
          {/* ── Left Column ── */}
          <div className="space-y-4">
            {/* Vendor Identity Card */}
            <div className={CARD}>
              <div className="p-5 text-center border-b border-gray-100">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-4xl font-extrabold text-white mx-auto mb-3 shadow-md">
                  {(user?.storeName || user?.name || "V")[0].toUpperCase()}
                </div>
                <h2 className="text-lg font-extrabold text-gray-900">{user?.storeName || "My Store"}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{user?.name || user?.phone}</p>
                <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
                  {user?.storeCategory && <span className="text-xs bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full font-bold capitalize">{user.storeCategory}</span>}
                  <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-bold">✓ Verified</span>
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
              <p className="text-xs text-orange-100 mt-3 border-t border-white/20 pt-2.5 font-medium">
                Earnings credited after each delivery · 15% platform fee
              </p>
            </div>
          </div>

          {/* ── Middle Column ── */}
          <div className="space-y-4">
            <div className={CARD}>
              <div className={CARD_HEADER}>
                <p className="font-bold text-gray-800 text-sm">Personal Information</p>
                <button onClick={() => { setEditing(!editing); setName(user?.name||""); setEmail(user?.email||""); }}
                  className="text-orange-500 text-sm font-bold android-press min-h-0 py-1">
                  {editing ? "Cancel" : "✏️ Edit"}
                </button>
              </div>
              <div className="p-4 space-y-3">
                {editing ? (
                  <>
                    <div>
                      <label className={LABEL}>Full Name</label>
                      <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className={INPUT}/>
                    </div>
                    <div>
                      <label className={LABEL}>Email</label>
                      <input value={email} onChange={e => setEmail(e.target.value)} type="email" inputMode="email" placeholder="email@example.com" className={INPUT}/>
                    </div>
                    <button onClick={saveProfile} disabled={saving} className={BTN_PRIMARY}>
                      {saving ? "Saving..." : "✓ Save Changes"}
                    </button>
                  </>
                ) : (
                  [
                    { label: "Name",  value: user?.name  },
                    { label: "Phone", value: user?.phone },
                    { label: "Email", value: user?.email },
                  ].map(({ label, value }) => (
                    <div key={label} className={ROW}>
                      <span className="text-sm text-gray-400 font-medium">{label}</span>
                      <span className="text-sm font-semibold text-gray-800">{value || "—"}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── Right Column ── */}
          <div className="space-y-4">
            <div className={CARD}>
              <div className={CARD_HEADER}>
                <p className="font-bold text-gray-800 text-sm">🔒 Security & Session</p>
              </div>
              <div className="p-4">
                {[
                  { label:"Last Login",     value: user?.lastLoginAt ? fd(user.lastLoginAt) : "Just now",  hl:false },
                  { label:"Member Since",   value: user?.createdAt ? fd(user.createdAt) : "—",             hl:false },
                  { label:"Account Status", value: "✓ Active & Verified",                                   hl:true  },
                ].map(({ label, value, hl }) => (
                  <div key={label} className={ROW}>
                    <span className="text-sm text-gray-400 font-medium">{label}</span>
                    <span className={`text-sm font-bold ${hl ? "text-green-600" : "text-gray-700"}`}>{value}</span>
                  </div>
                ))}
                <div className="bg-blue-50 rounded-xl p-3 mt-3">
                  <p className="text-xs text-blue-700 font-medium leading-relaxed">🔐 Your session is secured with encrypted authentication. Logout if using a shared device.</p>
                </div>
              </div>
            </div>

            <button onClick={logout} className={`${BTN_SECONDARY} border-red-200 text-red-600`}>
              🚪 Logout from This Device
            </button>
            <p className="text-center text-xs text-gray-400">To report issues, contact AJKMart admin</p>
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
