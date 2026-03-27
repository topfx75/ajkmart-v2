import { useState } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";

type LoginMethod = "phone" | "email" | "username";
type Step = "input" | "otp" | "pending";

export default function Login() {
  const { login } = useAuth();
  const { config } = usePlatformConfig();
  const appName = config.platform.appName;

  const [method, setMethod] = useState<LoginMethod>("phone");
  const [step, setStep]     = useState<Step>("input");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  /* Phone OTP */
  const [phone, setPhone]   = useState("");
  const [otp, setOtp]       = useState("");
  const [devOtp, setDevOtp] = useState("");

  /* Email OTP */
  const [email, setEmail]     = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailDevOtp, setEmailDevOtp] = useState("");

  /* Username */
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);

  const clearError = () => setError("");

  const checkRiderRole = (res: any): boolean => {
    const roles = (res.user?.roles || res.user?.role || "").split(",").map((r: string) => r.trim());
    if (!roles.includes("rider")) {
      setError("❌ Access denied. This app is only for riders. Contact admin to be assigned as a rider.");
      return false;
    }
    return true;
  };

  const doLogin = async (res: any) => {
    if (!checkRiderRole(res)) return;
    if (res.pendingApproval) { setStep("pending"); return; }
    api.storeTokens(res.token, res.refreshToken);
    const profile = await api.getMe();
    login(res.token, profile, res.refreshToken);
  };

  /* Phone OTP */
  const sendPhoneOtp = async () => {
    if (!phone || phone.length < 10) { setError("Enter a valid phone number"); return; }
    setLoading(true); clearError();
    try {
      const res = await api.sendOtp(phone);
      setDevOtp(res.otp || "");
      setStep("otp");
    } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  const verifyPhoneOtp = async () => {
    if (!otp || otp.length < 6) { setError("Enter the 6-digit OTP"); return; }
    setLoading(true); clearError();
    try {
      const res = await api.verifyOtp(phone, otp);
      await doLogin(res);
    } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  /* Email OTP */
  const sendEmailOtp = async () => {
    if (!email || !email.includes("@")) { setError("Enter a valid email address"); return; }
    setLoading(true); clearError();
    try {
      const res = await api.sendEmailOtp(email);
      setEmailDevOtp(res.otp || "");
      setStep("otp");
    } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  const verifyEmailOtp = async () => {
    if (!emailOtp || emailOtp.length < 6) { setError("Enter the 6-digit OTP"); return; }
    setLoading(true); clearError();
    try {
      const res = await api.verifyEmailOtp(email, emailOtp);
      await doLogin(res);
    } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  /* Username + Password */
  const loginUsername = async () => {
    if (!username || username.length < 3) { setError("Enter your username"); return; }
    if (!password || password.length < 6) { setError("Enter your password"); return; }
    setLoading(true); clearError();
    try {
      const res = await api.loginUsername(username, password);
      await doLogin(res);
    } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  const handleSubmit = () => {
    if (method === "phone") { step === "input" ? sendPhoneOtp() : verifyPhoneOtp(); }
    else if (method === "email") { step === "input" ? sendEmailOtp() : verifyEmailOtp(); }
    else loginUsername();
  };

  const selectMethod = (m: LoginMethod) => {
    setMethod(m); setStep("input"); clearError();
    setOtp(""); setEmailOtp(""); setDevOtp(""); setEmailDevOtp("");
  };

  /* ── Pending Approval Screen ── */
  if (step === "pending") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-600 to-emerald-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <span className="text-4xl">⏳</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">Approval Pending</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5">
            Your account is awaiting admin approval. You'll be able to log in once approved. This typically takes 24-48 hours.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5 text-left">
            <p className="text-amber-700 text-xs font-medium">💡 If you've already been approved, try logging in again.</p>
          </div>
          <button onClick={() => setStep("input")} className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-colors text-sm">
            ← Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-600 to-emerald-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-2xl">
            <span className="text-4xl">🏍️</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Rider Portal</h1>
          <p className="text-green-200 mt-1">{appName} Delivery Partner</p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-2xl">
          {/* Method Tabs */}
          {step === "input" && (
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5">
              {(["phone", "email", "username"] as LoginMethod[]).map(m => (
                <button
                  key={m}
                  onClick={() => selectMethod(m)}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                    method === m ? "bg-white text-green-700 shadow-sm" : "text-gray-400"
                  }`}
                >
                  {m === "phone" ? "📱 Phone" : m === "email" ? "✉️ Email" : "👤 Username"}
                </button>
              ))}
            </div>
          )}

          {/* Back button on OTP step */}
          {step === "otp" && (
            <button onClick={() => { setStep("input"); clearError(); setDevOtp(""); setEmailDevOtp(""); }}
              className="text-green-600 text-sm font-semibold mb-4 flex items-center gap-1">
              ← Back
            </button>
          )}

          {/* Phone OTP */}
          {method === "phone" && step === "input" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">Phone Login</h2>
              <p className="text-sm text-gray-500 mb-4">Enter your registered phone number</p>
              <div className="flex gap-2 mb-4">
                <div className="h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center text-sm font-medium text-gray-600">+92</div>
                <input type="tel" placeholder="3XX XXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="flex-1 h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" autoFocus />
              </div>
            </>
          )}
          {method === "phone" && step === "otp" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">Enter OTP</h2>
              <p className="text-sm text-gray-500 mb-1">Sent to <strong>+92{phone}</strong></p>
              {devOtp && <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3 text-sm text-green-700"><strong>Dev OTP:</strong> {devOtp}</div>}
              <input type="number" placeholder="Enter 6-digit OTP" value={otp} onChange={e => setOtp(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="w-full h-14 px-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-2xl font-bold tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-green-500 mb-3" maxLength={6} autoFocus />
              <button onClick={sendPhoneOtp} className="w-full text-sm text-gray-400 hover:text-green-600 mb-3 py-1">Resend OTP</button>
            </>
          )}

          {/* Email OTP */}
          {method === "email" && step === "input" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">Email Login</h2>
              <p className="text-sm text-gray-500 mb-4">Enter your registered email address</p>
              <input type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-4" autoFocus />
            </>
          )}
          {method === "email" && step === "otp" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">Enter Email OTP</h2>
              <p className="text-sm text-gray-500 mb-1">Sent to <strong>{email}</strong></p>
              {emailDevOtp && <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3 text-sm text-green-700"><strong>Dev OTP:</strong> {emailDevOtp}</div>}
              <input type="number" placeholder="Enter 6-digit OTP" value={emailOtp} onChange={e => setEmailOtp(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="w-full h-14 px-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-2xl font-bold tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-green-500 mb-3" maxLength={6} autoFocus />
              <button onClick={sendEmailOtp} className="w-full text-sm text-gray-400 hover:text-green-600 mb-3 py-1">Resend OTP</button>
            </>
          )}

          {/* Username + Password */}
          {method === "username" && step === "input" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">Username Login</h2>
              <p className="text-sm text-gray-500 mb-4">Enter your username and password</p>
              <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-3" autoFocus />
              <div className="relative">
                <input type={showPwd ? "text" : "password"} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="w-full h-12 px-4 pr-12 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-4" />
                <button onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                  {showPwd ? "🙈" : "👁️"}
                </button>
              </div>
            </>
          )}

          {error && <p className="text-red-500 text-sm mb-3 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <button onClick={handleSubmit} disabled={loading}
            className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? <span className="animate-spin text-lg">⟳</span> : null}
            {loading ? "Please wait..." :
              method === "phone" ? (step === "input" ? "Send OTP →" : "Verify & Login ✓") :
              method === "email" ? (step === "input" ? "Send Email OTP →" : "Verify & Login ✓") :
              "Login →"
            }
          </button>
        </div>

        <p className="text-center text-green-200 text-xs mt-6">Only verified riders can access this portal</p>
      </div>
    </div>
  );
}
