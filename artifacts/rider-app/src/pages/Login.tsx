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
      if (!roles.includes("rider")) {
        setError("❌ Access denied. This app is only for riders. Contact admin to be assigned as a rider.");
        setLoading(false); return;
      }
      localStorage.setItem("rider_token", res.token);
      const profile = await api.getMe();
      login(res.token, profile);
    } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-600 to-emerald-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-2xl">
            <span className="text-4xl">🏍️</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Rider Portal</h1>
          <p className="text-green-200 mt-1">AJKMart Delivery Partner</p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-2xl">
          {step === "phone" ? (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">Welcome Back!</h2>
              <p className="text-sm text-gray-500 mb-5">Enter your registered phone number</p>
              <div className="mb-4">
                <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Phone Number</label>
                <div className="flex gap-2">
                  <div className="h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center text-sm font-medium text-gray-600">+92</div>
                  <input
                    type="tel" placeholder="3XX XXXXXXX" value={phone}
                    onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === "Enter" && sendOtp()}
                    className="flex-1 h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    autoFocus
                  />
                </div>
              </div>
              {error && <p className="text-red-500 text-sm mb-3 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button
                onClick={sendOtp} disabled={loading}
                className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? <span className="animate-spin text-lg">⟳</span> : null}
                {loading ? "Sending OTP..." : "Send OTP →"}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { setStep("phone"); setError(""); }} className="text-green-600 text-sm font-semibold mb-4 flex items-center gap-1">
                ← Back
              </button>
              <h2 className="text-xl font-bold text-gray-800 mb-1">Enter OTP</h2>
              <p className="text-sm text-gray-500 mb-1">Sent to <strong>+92{phone}</strong></p>
              {devOtp && <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-4 text-sm text-green-700"><strong>Dev OTP:</strong> {devOtp}</div>}
              <div className="mb-4">
                <input
                  type="number" placeholder="Enter 6-digit OTP" value={otp}
                  onChange={e => setOtp(e.target.value)} onKeyDown={e => e.key === "Enter" && verifyOtp()}
                  className="w-full h-14 px-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-2xl font-bold tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-green-500"
                  maxLength={6} autoFocus
                />
              </div>
              {error && <p className="text-red-500 text-sm mb-3 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button
                onClick={verifyOtp} disabled={loading}
                className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? <span className="animate-spin">⟳</span> : null}
                {loading ? "Verifying..." : "Verify & Login ✓"}
              </button>
              <button onClick={sendOtp} className="w-full mt-3 text-sm text-gray-500 hover:text-green-600">Resend OTP</button>
            </>
          )}
        </div>
        <p className="text-center text-green-200 text-xs mt-6">Only verified riders can access this portal</p>
      </div>
    </div>
  );
}
