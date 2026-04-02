import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!phone.trim()) { setErr("Enter your phone number"); return; }
    setLoading(true);
    try {
      await api.sendOtp(phone.trim());
      setStep("otp");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!otp.trim()) { setErr("Enter the OTP"); return; }
    setLoading(true);
    try {
      const d = await api.verifyOtp(phone.trim(), otp.trim());
      if (d.token) await login(d.token);
      else setErr("Login failed — try again");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-600 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-green-200">
            <span className="text-4xl">🚗</span>
          </div>
          <h1 className="text-3xl font-black text-gray-900">AJKMart Rides</h1>
          <p className="text-gray-500 mt-1">Book a ride in seconds</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl shadow-gray-100 p-6 border border-gray-100">
          {step === "phone" ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Mobile Number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full border-2 border-gray-200 rounded-2xl px-4 py-3.5 text-lg font-semibold focus:border-green-500 focus:outline-none transition-colors"
                  autoFocus
                />
              </div>
              {err && <p className="text-red-500 text-sm font-medium">{err}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white font-black rounded-2xl py-4 text-lg disabled:opacity-60 shadow-lg shadow-green-200 transition-opacity"
              >
                {loading ? "Sending OTP…" : "Continue →"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">OTP sent to {phone}</label>
                  <button type="button" onClick={() => { setStep("phone"); setOtp(""); setErr(""); }} className="text-xs text-green-600 font-bold hover:underline">Change</button>
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={otp}
                  onChange={e => setOtp(e.target.value.slice(0, 6))}
                  placeholder="• • • • • •"
                  className="w-full border-2 border-gray-200 rounded-2xl px-4 py-3.5 text-3xl font-black text-center tracking-[0.5em] focus:border-green-500 focus:outline-none transition-colors"
                  autoFocus
                />
              </div>
              {err && <p className="text-red-500 text-sm font-medium">{err}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white font-black rounded-2xl py-4 text-lg disabled:opacity-60 shadow-lg shadow-green-200 transition-opacity"
              >
                {loading ? "Verifying…" : "Verify & Sign In"}
              </button>
              <button type="button" onClick={handleSendOtp} disabled={loading} className="w-full text-green-600 font-bold py-2 text-sm hover:underline disabled:opacity-50">
                Resend OTP
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
