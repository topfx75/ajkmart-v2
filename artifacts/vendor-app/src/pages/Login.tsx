import { useState } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

export default function Login() {
  const { login } = useAuth();
  const [phone, setPhone]   = useState("");
  const [otp, setOtp]       = useState("");
  const [step, setStep]     = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [devOtp, setDevOtp] = useState("");

  const sendOtp = async () => {
    if (!phone || phone.length < 10) { setError("Enter a valid phone number"); return; }
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
    <div
      className="min-h-screen bg-gradient-to-br from-orange-500 via-orange-500 to-amber-600 flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top,0px)", paddingBottom: "env(safe-area-inset-bottom,0px)" }}
    >
      {/* Top decorative circles */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-20 translate-x-20 pointer-events-none" />
      <div className="absolute top-20 left-0 w-32 h-32 bg-white/10 rounded-full -translate-x-12 pointer-events-none" />

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-8 relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-24 h-24 bg-white rounded-[28px] flex items-center justify-center mx-auto mb-4 shadow-2xl">
            <span className="text-5xl">🏪</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Vendor Portal</h1>
          <p className="text-orange-100 mt-1.5 font-medium">AJKMart Business Partner</p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-2xl w-full max-w-sm">
          {step === "phone" ? (
            <>
              <h2 className="text-xl font-extrabold text-gray-800 mb-1">Welcome Back!</h2>
              <p className="text-sm text-gray-500 mb-5">Enter your registered phone number</p>
              <div className="mb-4">
                <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">Phone Number</label>
                <div className="flex gap-2">
                  <div className="h-13 px-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center text-sm font-bold text-gray-600">+92</div>
                  <input
                    type="tel" placeholder="3XX XXXXXXX" value={phone}
                    onChange={e => setPhone(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendOtp()}
                    className="flex-1 h-13 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                    autoFocus inputMode="tel"
                  />
                </div>
              </div>
              {error && <p className="text-red-600 text-sm mb-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 font-medium">{error}</p>}
              <button
                onClick={sendOtp} disabled={loading}
                className="w-full h-13 bg-orange-500 text-white font-bold rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-base android-press"
              >
                {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
                {loading ? "Sending OTP..." : "Send OTP →"}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { setStep("phone"); setError(""); }} className="text-orange-500 text-sm font-bold mb-4 flex items-center gap-1 android-press min-h-0">
                ← Back
              </button>
              <h2 className="text-xl font-extrabold text-gray-800 mb-1">Enter OTP</h2>
              <p className="text-sm text-gray-500 mb-1">Sent to <strong className="text-gray-700">+92{phone}</strong></p>
              {devOtp && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 mb-4 text-sm text-orange-700 font-medium">
                  <span className="opacity-70">Dev OTP:</span> <strong className="tracking-widest">{devOtp}</strong>
                </div>
              )}
              <div className="mb-4">
                <input
                  type="number" placeholder="• • • • • •" value={otp}
                  onChange={e => setOtp(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && verifyOtp()}
                  className="w-full h-16 px-4 bg-gray-50 border-2 border-gray-200 rounded-xl text-center text-3xl font-extrabold tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-400 transition-all"
                  maxLength={6} autoFocus inputMode="numeric"
                />
              </div>
              {error && <p className="text-red-600 text-sm mb-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 font-medium">{error}</p>}
              <button
                onClick={verifyOtp} disabled={loading}
                className="w-full h-13 bg-orange-500 text-white font-bold rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-base android-press"
              >
                {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
                {loading ? "Verifying..." : "Verify & Login ✓"}
              </button>
              <button onClick={sendOtp} className="w-full mt-3 text-sm text-gray-400 hover:text-orange-500 font-medium android-press min-h-0 py-2">Resend OTP</button>
            </>
          )}
        </div>

        <p className="text-center text-orange-100 text-xs mt-6 font-medium">Only verified vendors can access this portal</p>
      </div>
    </div>
  );
}
