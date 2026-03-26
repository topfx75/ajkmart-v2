import { useState } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

const FEATURES = [
  { icon: "📦", title: "Order Management",   desc: "Accept & track orders in real-time" },
  { icon: "🍽️", title: "Product Control",    desc: "Add, edit & manage your menu easily" },
  { icon: "💰", title: "Instant Earnings",   desc: "Wallet credited after every delivery" },
  { icon: "🎟️", title: "Promo Codes",        desc: "Create discount offers for customers" },
];

export default function Login() {
  const { login } = useAuth();
  const [phone, setPhone]     = useState("");
  const [otp, setOtp]         = useState("");
  const [step, setStep]       = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [devOtp, setDevOtp]   = useState("");

  const sendOtp = async () => {
    if (!phone || phone.length < 10) { setError("Enter a valid phone number (10 digits)"); return; }
    setLoading(true); setError("");
    try {
      const res = await api.sendOtp(phone);
      setDevOtp(res.otp || "");
      setStep("otp");
    } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  const verifyOtp = async () => {
    if (!otp || otp.length < 6) { setError("Enter the 6-digit OTP"); return; }
    setLoading(true); setError("");
    try {
      const res = await api.verifyOtp(phone, otp);
      const roles = (res.user.roles || res.user.role || "").split(",").map((r: string) => r.trim());
      if (!roles.includes("vendor")) {
        setError("❌ Access denied. This portal is only for vendors. Contact admin to get vendor access.");
        setLoading(false); return;
      }
      localStorage.setItem("vendor_token", res.token);
      const profile = await api.getMe();
      login(res.token, profile);
    } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row" style={{ paddingTop: "env(safe-area-inset-top,0px)" }}>

      {/* ── Left Panel — Branding (desktop only) ── */}
      <div className="hidden md:flex md:w-1/2 lg:w-3/5 bg-gradient-to-br from-orange-500 to-amber-600 flex-col justify-between p-10 relative overflow-hidden">
        {/* Decorative */}
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-white/10 rounded-full pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-white/10 rounded-full pointer-events-none" />
        <div className="absolute top-1/2 right-0 w-40 h-40 bg-white/5 rounded-full pointer-events-none" />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-lg">
              <span className="text-2xl">🏪</span>
            </div>
            <div>
              <p className="text-white font-extrabold text-xl leading-tight">AJKMart</p>
              <p className="text-orange-100 text-sm font-medium">Vendor Portal</p>
            </div>
          </div>
        </div>

        {/* Headline */}
        <div className="relative z-10">
          <h1 className="text-4xl lg:text-5xl font-extrabold text-white leading-tight mb-4">
            Grow your<br/>business with<br/>
            <span className="text-amber-200">AJKMart</span>
          </h1>
          <p className="text-orange-100 text-lg font-medium mb-10 leading-relaxed">
            Manage orders, products, and earnings — all from one powerful vendor dashboard.
          </p>

          <div className="grid grid-cols-2 gap-4">
            {FEATURES.map(f => (
              <div key={f.title} className="bg-white/15 backdrop-blur-sm rounded-2xl p-4">
                <span className="text-2xl mb-2 block">{f.icon}</span>
                <p className="text-white font-bold text-sm">{f.title}</p>
                <p className="text-orange-100 text-xs mt-0.5">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10">
          <p className="text-orange-200 text-sm">© 2025 AJKMart · AJK, Pakistan · 85% commission guaranteed</p>
        </div>
      </div>

      {/* ── Right Panel — Login Form ── */}
      <div className="flex-1 bg-gradient-to-br from-orange-500 to-amber-600 md:bg-none md:bg-gray-50 flex flex-col items-center justify-center px-5 py-12 md:px-12 relative">
        {/* Mobile decorative circles */}
        <div className="md:hidden absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -translate-y-16 translate-x-16 pointer-events-none" />
        <div className="md:hidden absolute top-16 left-0 w-24 h-24 bg-white/10 rounded-full -translate-x-8 pointer-events-none" />

        <div className="w-full max-w-sm relative z-10">
          {/* Mobile logo */}
          <div className="text-center mb-8 md:hidden">
            <div className="w-20 h-20 bg-white rounded-[24px] flex items-center justify-center mx-auto mb-4 shadow-2xl">
              <span className="text-4xl">🏪</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white">Vendor Portal</h1>
            <p className="text-orange-100 mt-1 font-medium">AJKMart Business Partner</p>
          </div>

          {/* Desktop heading */}
          <div className="hidden md:block mb-8">
            <h2 className="text-3xl font-extrabold text-gray-900">Welcome back 👋</h2>
            <p className="text-gray-500 mt-1">Login to your AJKMart vendor account</p>
          </div>

          {/* Form Card */}
          <div className="bg-white rounded-3xl p-6 shadow-2xl">
            {step === "phone" ? (
              <>
                <h2 className="text-xl font-extrabold text-gray-800 mb-1 md:hidden">Welcome Back!</h2>
                <p className="text-sm text-gray-500 mb-5">Enter your registered phone number</p>

                <div className="mb-4">
                  <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">Phone Number</label>
                  <div className="flex gap-2">
                    <div className="h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center text-sm font-bold text-gray-600 flex-shrink-0">+92</div>
                    <input
                      type="tel" placeholder="3XX XXXXXXX" value={phone}
                      onChange={e => setPhone(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && sendOtp()}
                      className="flex-1 h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition-all"
                      autoFocus inputMode="tel"
                    />
                  </div>
                </div>

                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-red-600 text-sm font-medium">{error}</p>
                  </div>
                )}

                <button onClick={sendOtp} disabled={loading}
                  className="w-full h-12 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-base android-press">
                  {loading
                    ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Sending...</>
                    : "Send OTP →"
                  }
                </button>

                <p className="text-center text-xs text-gray-400 mt-4">Only verified vendors can access this portal</p>
              </>
            ) : (
              <>
                <button onClick={() => { setStep("phone"); setError(""); otp && setOtp(""); }}
                  className="text-orange-500 text-sm font-bold mb-4 flex items-center gap-1 android-press min-h-0">← Back</button>
                <h2 className="text-xl font-extrabold text-gray-800 mb-1">Enter OTP</h2>
                <p className="text-sm text-gray-500 mb-1">Sent to <strong className="text-gray-700">+92{phone}</strong></p>

                {devOtp && (
                  <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 mb-4">
                    <p className="text-xs text-orange-600 font-bold uppercase tracking-wide mb-0.5">Dev OTP (remove in production)</p>
                    <p className="text-orange-700 font-extrabold text-xl tracking-[0.4em]">{devOtp}</p>
                  </div>
                )}

                <input
                  type="number" placeholder="• • • • • •" value={otp}
                  onChange={e => setOtp(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && verifyOtp()}
                  className="w-full h-16 px-4 mb-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-center text-3xl font-extrabold tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-400 transition-all"
                  maxLength={6} autoFocus inputMode="numeric"
                />

                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-red-600 text-sm font-medium">{error}</p>
                  </div>
                )}

                <button onClick={verifyOtp} disabled={loading}
                  className="w-full h-12 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-base android-press">
                  {loading
                    ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Verifying...</>
                    : "Verify & Login ✓"
                  }
                </button>

                <button onClick={sendOtp} className="w-full mt-3 text-sm text-gray-400 hover:text-orange-500 font-medium py-2 transition-colors">Resend OTP</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
