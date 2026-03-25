import { useState } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useQuery } from "@tanstack/react-query";
import { Header } from "../components/Header";

function fc(n: number) { return `Rs. ${Math.round(n).toLocaleString()}`; }
function fd(d: string | Date) { return new Date(d).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" }); }

export default function Profile() {
  const { user, logout, refreshUser } = useAuth();
  const [editing, setEditing]   = useState(false);
  const [name, setName]         = useState(user?.name || "");
  const [email, setEmail]       = useState(user?.email || "");
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const { data: statsData } = useQuery({ queryKey: ["vendor-stats"], queryFn: () => api.getStats() });

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
    <div className="min-h-screen bg-gray-50 page-enter">
      <Header pb="pb-20">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">My Account</h1>
            <p className="text-orange-100 text-sm mt-0.5">Vendor settings & info</p>
          </div>
          <button
            onClick={logout}
            className="text-orange-100 text-sm bg-white/20 px-3.5 py-2 rounded-xl font-bold android-press min-h-0"
          >Logout</button>
        </div>
      </Header>

      <div className="px-4 -mt-12 pb-4 space-y-3">
        {/* Vendor Card */}
        <div className="bg-white rounded-3xl card-2 p-5 flex items-center gap-4">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-4xl font-extrabold text-white flex-shrink-0 shadow-lg">
            {(user?.storeName || user?.name || "V")[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-extrabold text-gray-900 truncate">{user?.storeName || "My Store"}</h2>
            <p className="text-gray-500 text-sm mt-0.5">{user?.name || user?.phone}</p>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {user?.storeCategory && (
                <span className="text-xs bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full font-bold capitalize">{user.storeCategory}</span>
              )}
              <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-bold">✓ Verified</span>
            </div>
          </div>
        </div>

        {/* Revenue Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl p-4 text-center card-1">
            <p className="text-3xl font-extrabold text-orange-500">{user?.stats?.totalOrders || statsData?.month?.orders || 0}</p>
            <p className="text-xs text-gray-500 mt-1 font-medium">Total Orders</p>
          </div>
          <div className="bg-white rounded-2xl p-4 text-center card-1">
            <p className="text-xl font-extrabold text-amber-500">{fc(user?.stats?.totalRevenue || 0)}</p>
            <p className="text-xs text-gray-500 mt-1 font-medium">Total Earned</p>
          </div>
        </div>

        {/* Wallet */}
        <div className="bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl p-5 text-white card-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-orange-100 font-medium">Wallet Balance</p>
              <p className="text-4xl font-extrabold mt-0.5 tracking-tight">{fc(user?.walletBalance || 0)}</p>
            </div>
            <div className="text-right bg-white/15 rounded-2xl px-4 py-2">
              <p className="text-xs text-orange-100 font-medium">Commission</p>
              <p className="text-3xl font-extrabold">85%</p>
            </div>
          </div>
          <p className="text-xs text-orange-100 mt-3 border-t border-white/20 pt-2.5 font-medium">
            Earnings credited after each delivery · 15% platform fee
          </p>
        </div>

        {/* Personal Info */}
        <div className="bg-white rounded-2xl card-1 overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-800">Personal Information</h3>
            <button
              onClick={() => { setEditing(!editing); setName(user?.name||""); setEmail(user?.email||""); }}
              className="text-orange-500 text-sm font-bold android-press min-h-0 py-1 px-2"
            >
              {editing ? "Cancel" : "✏️ Edit"}
            </button>
          </div>
          <div className="p-4 space-y-3">
            {editing ? (
              <>
                <div>
                  <label className="text-xs font-bold text-gray-400 mb-1.5 block uppercase tracking-wide">Full Name</label>
                  <input
                    value={name} onChange={e => setName(e.target.value)}
                    className="w-full h-12 px-4 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-gray-50"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-400 mb-1.5 block uppercase tracking-wide">Email</label>
                  <input
                    value={email} onChange={e => setEmail(e.target.value)} type="email" inputMode="email"
                    className="w-full h-12 px-4 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-gray-50"
                    placeholder="email@example.com"
                  />
                </div>
                <button
                  onClick={saveProfile} disabled={saving}
                  className="w-full h-12 bg-orange-500 text-white font-bold rounded-xl disabled:opacity-60 android-press"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </>
            ) : (
              [
                { label: "Name",  value: user?.name },
                { label: "Phone", value: user?.phone },
                { label: "Email", value: user?.email },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center py-2.5 border-b border-gray-50 last:border-0">
                  <span className="text-sm text-gray-400 font-medium">{label}</span>
                  <span className="text-sm font-semibold text-gray-800">{value || "—"}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Security */}
        <div className="bg-white rounded-2xl card-1 overflow-hidden">
          <div className="px-4 py-3.5 border-b border-gray-100">
            <h3 className="font-bold text-gray-800">🔒 Security & Session</h3>
          </div>
          <div className="p-4 space-y-2.5">
            {[
              { label: "Last Login",    value: user?.lastLoginAt ? fd(user.lastLoginAt) : "Just now" },
              { label: "Member Since",  value: user?.createdAt ? fd(user.createdAt) : "—" },
              { label: "Account Status",value: "✓ Active & Verified", highlight: true },
            ].map(({ label, value, highlight }) => (
              <div key={label} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-400 font-medium">{label}</span>
                <span className={`text-sm font-bold ${highlight ? "text-green-600" : "text-gray-700"}`}>{value}</span>
              </div>
            ))}
            <div className="bg-blue-50 rounded-xl p-3 mt-2">
              <p className="text-xs text-blue-700 font-medium leading-relaxed">🔐 Your session is secured with a unique token. Logout if using a shared device.</p>
            </div>
          </div>
        </div>

        {/* Logout */}
        <div className="bg-white rounded-2xl card-1 p-4">
          <button
            onClick={logout}
            className="w-full h-13 bg-red-50 border border-red-200 text-red-600 font-bold rounded-xl android-press"
          >
            🚪 Logout from This Device
          </button>
          <p className="text-center text-xs text-gray-400 mt-2">To report issues, contact AJKMart admin</p>
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
