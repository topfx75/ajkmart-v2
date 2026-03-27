import { useState } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";

type LoginMethod = "phone" | "email" | "username";
type Step = "input" | "otp" | "pending";

const FEATURES = [
  { icon: "📦", title: "Order Management",   desc: "Accept & track orders in real-time" },
  { icon: "🍽️", title: "Product Control",    desc: "Add, edit & manage your menu easily" },
  { icon: "💰", title: "Instant Earnings",   desc: "Wallet credited after every delivery" },
  { icon: "🎟️", title: "Promo Codes",        desc: "Create discount offers for customers" },
];

export default function Login() {
  const { login } = useAuth();
  const { config } = usePlatformConfig();
  const appName           = config.platform.appName;
  const businessAddress   = config.platform.businessAddress;
  const vendorEarningsPct = Math.round(100 - (config.platform.vendorCommissionPct ?? 15));

  const [method, setMethod] = useState<LoginMethod>("phone");
  const [step, setStep]     = useState<Step>("input");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  /* Phone OTP */
  const [phone, setPhone] = useState("");
  const [otp, setOtp]     = useState("");
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

  const checkVendorRole = (res: any): boolean => {
    const roles = (res.user?.roles || res.user?.role || "").split(",").map((r: string) => r.trim());
    if (!roles.includes("vendor")) {
      setError("❌ Access denied. This portal is only for vendors. Contact admin to get vendor access.");
      return false;
    }
    return true;
  };

  const doLogin = async (res: any) => {
    if (!checkVendorRole(res)) return;
    if (res.pendingApproval) { setStep("pending"); return; }
    localStorage.setItem("vendor_token", res.token);
    const profile = await api.getMe();
    login(res.token, profile);
  };

  /* Phone OTP */
  const sendPhoneOtp = async () => {
    if (!phone || phone.length < 10) { setError("Enter a valid phone number (10 digits)"); return; }
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
    try { await doLogin(await api.verifyOtp(phone, otp)); } catch(e: any) { setError(e.message); }
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
    try { await doLogin(await api.verifyEmailOtp(email, emailOtp)); } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  /* Username */
  const loginUsername = async () => {
    if (!username || username.length < 3) { setError("Enter your username"); return; }
    if (!password || password.length < 6) { setError("Enter your password"); return; }
    setLoading(true); clearError();
    try { await doLogin(await api.loginUsername(username, password)); } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  const handleSubmit = () => {
    if (method === "phone") step === "input" ? sendPhoneOtp() : verifyPhoneOtp();
    else if (method === "email") step === "input" ? sendEmailOtp() : verifyEmailOtp();
    else loginUsername();
  };

  const selectMethod = (m: LoginMethod) => {
    setMethod(m); setStep("input"); clearError();
    setOtp(""); setEmailOtp(""); setDevOtp(""); setEmailDevOtp("");
  };

  /* ── Pending Approval Screen ── */
  if (step === "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-500 to-amber-600 p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <span className="text-4xl">⏳</span>
          </div>
          <h2 className="text-2xl font-extrabold text-gray-800 mb-3">Approval Pending</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5">
            Your vendor account is awaiting admin approval. You'll be notified once approved. This typically takes 24-48 hours.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5 text-left">
            <p className="text-amber-700 text-xs font-medium">💡 Already approved? Try logging in again.</p>
          </div>
          <button onClick={() => setStep("input")} className="w-full h-11 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors text-sm">
            ← Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row" style={{ paddingTop: "env(safe-area-inset-top,0px)" }}>

      {/* ── Left Panel — Branding (desktop only) ── */}
      <div className="hidden md:flex md:w-1/2 lg:w-3/5 bg-gradient-to-br from-orange-500 to-amber-600 flex-col justify-between p-10 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-white/10 rounded-full pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-white/10 rounded-full pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-lg"><span className="text-2xl">🏪</span></div>
            <div>
              <p className="text-white font-extrabold text-xl leading-tight">{appName}</p>
              <p className="text-orange-100 text-sm font-medium">Vendor Portal</p>
            </div>
          </div>
        </div>
        <div className="relative z-10">
          <h1 className="text-4xl lg:text-5xl font-extrabold text-white leading-tight mb-4">
            Grow your<br/>business with<br/><span className="text-amber-200">{appName}</span>
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
        <div className="relative z-10">
          <p className="text-orange-200 text-sm">© 2025 {appName} · {businessAddress} · {vendorEarningsPct}% vendor earnings</p>
        </div>
      </div>

      {/* ── Right Panel — Login Form ── */}
      <div className="flex-1 bg-gradient-to-br from-orange-500 to-amber-600 md:bg-none md:bg-gray-50 flex flex-col items-center justify-center px-5 py-12 md:px-12 relative">
        <div className="md:hidden absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -translate-y-16 translate-x-16 pointer-events-none" />

        <div className="w-full max-w-sm relative z-10">
          {/* Mobile logo */}
          <div className="text-center mb-8 md:hidden">
            <div className="w-20 h-20 bg-white rounded-[24px] flex items-center justify-center mx-auto mb-4 shadow-2xl"><span className="text-4xl">🏪</span></div>
            <h1 className="text-3xl font-extrabold text-white">Vendor Portal</h1>
            <p className="text-orange-100 mt-1 font-medium">{appName} Business Partner</p>
          </div>

          {/* Desktop heading */}
          <div className="hidden md:block mb-8">
            <h2 className="text-3xl font-extrabold text-gray-900">Welcome back 👋</h2>
            <p className="text-gray-500 mt-1">Login to your {appName} vendor account</p>
          </div>

          {/* Form Card */}
          <div className="bg-white rounded-3xl p-6 shadow-2xl">
            {/* Method Tabs */}
            {step === "input" && (
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5">
                {(["phone", "email", "username"] as LoginMethod[]).map(m => (
                  <button key={m} onClick={() => selectMethod(m)}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                      method === m ? "bg-white text-orange-600 shadow-sm" : "text-gray-400"
                    }`}>
                    {m === "phone" ? "📱 Phone" : m === "email" ? "✉️ Email" : "👤 Username"}
                  </button>
                ))}
              </div>
            )}

            {/* Back button on OTP step */}
            {step === "otp" && (
              <button onClick={() => { setStep("input"); clearError(); setDevOtp(""); setEmailDevOtp(""); }}
                className="text-orange-500 text-sm font-bold mb-4 flex items-center gap-1">← Back</button>
            )}

            {/* Phone OTP — Input */}
            {method === "phone" && step === "input" && (
              <>
                <h2 className="text-xl font-extrabold text-gray-800 mb-1 md:hidden">Welcome Back!</h2>
                <p className="text-sm text-gray-500 mb-4">Enter your registered phone number</p>
                <div className="mb-4">
                  <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">Phone Number</label>
                  <div className="flex gap-2">
                    <div className="h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center text-sm font-bold text-gray-600 flex-shrink-0">+92</div>
                    <input type="tel" placeholder="3XX XXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                      className="flex-1 h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all" autoFocus inputMode="tel" />
                  </div>
                </div>
              </>
            )}

            {/* Phone OTP — Verify */}
            {method === "phone" && step === "otp" && (
              <>
                <h2 className="text-xl font-extrabold text-gray-800 mb-1">Enter OTP</h2>
                <p className="text-sm text-gray-500 mb-1">Sent to <strong className="text-gray-700">+92{phone}</strong></p>
                {devOtp && <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 mb-3">
                  <p className="text-xs text-orange-600 font-bold uppercase tracking-wide mb-0.5">Dev OTP</p>
                  <p className="text-orange-700 font-extrabold text-xl tracking-[0.4em]">{devOtp}</p>
                </div>}
                <input type="number" placeholder="• • • • • •" value={otp} onChange={e => setOtp(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="w-full h-16 px-4 mb-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-center text-3xl font-extrabold tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all" maxLength={6} autoFocus inputMode="numeric" />
              </>
            )}

            {/* Email OTP — Input */}
            {method === "email" && step === "input" && (
              <>
                <p className="text-sm text-gray-500 mb-4">Login with your registered email address</p>
                <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">Email Address</label>
                <input type="email" placeholder="your@business.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 mb-4 transition-all" autoFocus />
              </>
            )}

            {/* Email OTP — Verify */}
            {method === "email" && step === "otp" && (
              <>
                <h2 className="text-xl font-extrabold text-gray-800 mb-1">Enter Email OTP</h2>
                <p className="text-sm text-gray-500 mb-1">Sent to <strong className="text-gray-700">{email}</strong></p>
                {emailDevOtp && <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 mb-3">
                  <p className="text-xs text-orange-600 font-bold uppercase tracking-wide mb-0.5">Dev OTP</p>
                  <p className="text-orange-700 font-extrabold text-xl tracking-[0.4em]">{emailDevOtp}</p>
                </div>}
                <input type="number" placeholder="• • • • • •" value={emailOtp} onChange={e => setEmailOtp(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="w-full h-16 px-4 mb-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-center text-3xl font-extrabold tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all" maxLength={6} autoFocus inputMode="numeric" />
              </>
            )}

            {/* Username + Password */}
            {method === "username" && step === "input" && (
              <>
                <p className="text-sm text-gray-500 mb-4">Login with your username and password</p>
                <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">Username</label>
                <input type="text" placeholder="your_username" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 mb-3 transition-all" autoFocus autoCapitalize="none" />
                <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">Password</label>
                <div className="relative mb-4">
                  <input type={showPwd ? "text" : "password"} placeholder="Your password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                    className="w-full h-12 px-4 pr-12 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all" />
                  <button onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600 text-sm">{showPwd ? "🙈" : "👁️"}</button>
                </div>
              </>
            )}

            {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl"><p className="text-red-600 text-sm font-medium">{error}</p></div>}

            <button onClick={handleSubmit} disabled={loading}
              className="w-full h-12 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-base">
              {loading
                ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Please wait...</>
                : method === "phone"
                  ? (step === "input" ? "Send OTP →" : "Verify & Login ✓")
                  : method === "email"
                  ? (step === "input" ? "Send Email OTP →" : "Verify & Login ✓")
                  : "Login →"
              }
            </button>

            {step === "otp" && (
              <button onClick={method === "phone" ? sendPhoneOtp : sendEmailOtp}
                className="w-full mt-3 text-sm text-gray-400 hover:text-orange-500 font-medium py-2 transition-colors">
                Resend OTP
              </button>
            )}

            <p className="text-center text-xs text-gray-400 mt-4">Only verified vendors can access this portal</p>
          </div>
        </div>
      </div>
    </div>
  );
}
