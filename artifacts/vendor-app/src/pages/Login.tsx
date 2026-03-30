import { useState, useEffect } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";

type LoginMethod = "phone" | "email" | "username";
type Step = "input" | "otp" | "pending";

export default function Login() {
  const { login } = useAuth();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const appName           = config.platform.appName;
  const businessAddress   = config.platform.businessAddress;
  const vendorEarningsPct = Math.round(100 - (config.platform.vendorCommissionPct ?? 15));

  const FEATURES = [
    { icon: "📦", titleKey: "orderManagement" as TranslationKey,   descKey: "manageOrdersDesc" as TranslationKey },
    { icon: "🍽️", titleKey: "productControl" as TranslationKey,    descKey: "productControlDesc" as TranslationKey },
    { icon: "💰", titleKey: "instantEarnings" as TranslationKey,   descKey: "instantEarningsDesc" as TranslationKey },
    { icon: "🎟️", titleKey: "promoCodes" as TranslationKey,        descKey: "promoCodesDesc" as TranslationKey },
  ];

  const [method, setMethod] = useState<LoginMethod>("phone");
  const [step, setStep]     = useState<Step>("input");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  const [phone, setPhone] = useState("");
  const [otp, setOtp]     = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const [email, setEmail]     = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailDevOtp, setEmailDevOtp] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);

  const clearError = () => setError("");

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  const startCooldown = () => setResendCooldown(30);

  const checkVendorRole = (res: any): boolean => {
    const raw = res.user?.roles ?? res.user?.role ?? "";
    const roles = Array.isArray(raw) ? raw : String(raw).split(",").map((r: string) => r.trim());
    if (!roles.includes("vendor")) {
      setError(T("accessDeniedVendor"));
      return false;
    }
    const status = res.user?.status;
    if (status === "banned" || status === "suspended") {
      setError(T("accountSuspended") || "Your account has been suspended. Please contact support.");
      return false;
    }
    return true;
  };

  const doLogin = async (res: any) => {
    if (!checkVendorRole(res)) return;
    if (res.pendingApproval) { setStep("pending"); return; }
    api.storeTokens(res.token, res.refreshToken);
    const profile = await api.getMe();
    login(res.token, profile, res.refreshToken);
  };

  const sendPhoneOtp = async () => {
    if (!phone || phone.length < 10) { setError(T("enterPhoneNumber")); return; }
    setLoading(true); clearError();
    try {
      const res = await api.sendOtp(phone);
      setDevOtp(import.meta.env.DEV ? (res.otp || "") : "");
      setStep("otp");
      startCooldown();
    } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  const verifyPhoneOtp = async () => {
    if (!otp || otp.length < 6) { setError(T("enterOtp")); return; }
    setLoading(true); clearError();
    try { await doLogin(await api.verifyOtp(phone, otp)); } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  const sendEmailOtp = async () => {
    if (!email || !email.includes("@")) { setError(T("enterEmail")); return; }
    setLoading(true); clearError();
    try {
      const res = await api.sendEmailOtp(email);
      setEmailDevOtp(import.meta.env.DEV ? (res.otp || "") : "");
      setStep("otp");
      startCooldown();
    } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  const verifyEmailOtp = async () => {
    if (!emailOtp || emailOtp.length < 6) { setError(T("enterOtp")); return; }
    setLoading(true); clearError();
    try { await doLogin(await api.verifyEmailOtp(email, emailOtp)); } catch(e: any) { setError(e.message); }
    setLoading(false);
  };

  const loginUsername = async () => {
    if (!username || username.length < 3) { setError(T("enterUsername")); return; }
    if (!password || password.length < 6) { setError(T("enterPassword")); return; }
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

  if (step === "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-500 to-amber-600 p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <span className="text-4xl">⏳</span>
          </div>
          <h2 className="text-2xl font-extrabold text-gray-800 mb-3">{T("approvalPending")}</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5">
            {T("vendorApprovalMsg")}
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5 text-left">
            <p className="text-amber-700 text-xs font-medium">💡 {T("alreadyApproved")}</p>
          </div>
          <button onClick={() => setStep("input")} className="w-full h-11 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors text-sm">
            ← {T("backToLogin")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row" style={{ paddingTop: "env(safe-area-inset-top,0px)" }}>

      <div className="hidden md:flex md:w-1/2 lg:w-3/5 bg-gradient-to-br from-orange-500 to-amber-600 flex-col justify-between p-10 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-white/10 rounded-full pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-white/10 rounded-full pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-lg"><span className="text-2xl">🏪</span></div>
            <div>
              <p className="text-white font-extrabold text-xl leading-tight">{appName}</p>
              <p className="text-orange-100 text-sm font-medium">{T("vendorPortal")}</p>
            </div>
          </div>
        </div>
        <div className="relative z-10">
          <h1 className="text-4xl lg:text-5xl font-extrabold text-white leading-tight mb-4">
            {T("growBusiness")}<br/><span className="text-amber-200">{appName}</span>
          </h1>
          <p className="text-orange-100 text-lg font-medium mb-10 leading-relaxed">
            {T("manageDescription")}
          </p>
          <div className="grid grid-cols-2 gap-4">
            {FEATURES.map(f => (
              <div key={f.titleKey} className="bg-white/15 backdrop-blur-sm rounded-2xl p-4">
                <span className="text-2xl mb-2 block">{f.icon}</span>
                <p className="text-white font-bold text-sm">{T(f.titleKey)}</p>
                <p className="text-orange-100 text-xs mt-0.5">{T(f.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10">
          <p className="text-orange-200 text-sm">© 2025 {appName} · {businessAddress} · {vendorEarningsPct}% {T("vendorEarningsLabel")}</p>
        </div>
      </div>

      <div className="flex-1 bg-gradient-to-br from-orange-500 to-amber-600 md:bg-none md:bg-gray-50 flex flex-col items-center justify-center px-5 py-12 md:px-12 relative">
        <div className="md:hidden absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -translate-y-16 translate-x-16 pointer-events-none" />

        <div className="w-full max-w-sm relative z-10">
          <div className="text-center mb-8 md:hidden">
            <div className="w-20 h-20 bg-white rounded-[24px] flex items-center justify-center mx-auto mb-4 shadow-2xl"><span className="text-4xl">🏪</span></div>
            <h1 className="text-3xl font-extrabold text-white">{T("vendorPortal")}</h1>
            <p className="text-orange-100 mt-1 font-medium">{appName} {T("businessPartner")}</p>
          </div>

          <div className="hidden md:block mb-8">
            <h2 className="text-3xl font-extrabold text-gray-900">{T("vendorWelcome")} 👋</h2>
            <p className="text-gray-500 mt-1">{T("loginToVendor")}</p>
          </div>

          <div className="bg-white rounded-3xl p-6 shadow-2xl">
            {step === "input" && (
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5">
                {(["phone", "email", "username"] as LoginMethod[]).map(m => (
                  <button key={m} onClick={() => selectMethod(m)}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                      method === m ? "bg-white text-orange-600 shadow-sm" : "text-gray-400"
                    }`}>
                    {m === "phone" ? `📱 ${T("phone")}` : m === "email" ? `✉️ ${T("email")}` : `👤 ${T("usernameLabel")}`}
                  </button>
                ))}
              </div>
            )}

            {step === "otp" && (
              <button onClick={() => { setStep("input"); clearError(); setDevOtp(""); setEmailDevOtp(""); }}
                className="text-orange-500 text-sm font-bold mb-4 flex items-center gap-1">← {T("back")}</button>
            )}

            {method === "phone" && step === "input" && (
              <>
                <h2 className="text-xl font-extrabold text-gray-800 mb-1 md:hidden">{T("welcomeBackExcl")}</h2>
                <p className="text-sm text-gray-500 mb-4">{T("enterPhoneNumber")}</p>
                <div className="mb-4">
                  <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("phoneNumberLabel")}</label>
                  <div className="flex gap-2">
                    <div className="h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center text-sm font-bold text-gray-600 flex-shrink-0">+92</div>
                    <input type="tel" placeholder="3XX XXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                      className="flex-1 h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all" autoFocus inputMode="tel" />
                  </div>
                </div>
              </>
            )}

            {method === "phone" && step === "otp" && (
              <>
                <h2 className="text-xl font-extrabold text-gray-800 mb-1">{T("enterOtp")}</h2>
                <p className="text-sm text-gray-500 mb-1">{T("sentTo_")} <strong className="text-gray-700">+92{phone}</strong></p>
                {devOtp && <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 mb-3">
                  <p className="text-xs text-orange-600 font-bold uppercase tracking-wide mb-0.5">{T("devOtp")}</p>
                  <p className="text-orange-700 font-extrabold text-xl tracking-[0.4em]">{devOtp}</p>
                </div>}
                <input type="text" inputMode="numeric" placeholder="• • • • • •" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="w-full h-16 px-4 mb-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-center text-3xl font-extrabold tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all" maxLength={6} autoFocus />
              </>
            )}

            {method === "email" && step === "input" && (
              <>
                <p className="text-sm text-gray-500 mb-4">{T("loginWith")} {T("email")}</p>
                <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("emailAddress")}</label>
                <input type="email" placeholder="your@business.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 mb-4 transition-all" autoFocus />
              </>
            )}

            {method === "email" && step === "otp" && (
              <>
                <h2 className="text-xl font-extrabold text-gray-800 mb-1">{T("enterEmailOtp")}</h2>
                <p className="text-sm text-gray-500 mb-1">{T("sentTo_")} <strong className="text-gray-700">{email}</strong></p>
                {emailDevOtp && <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 mb-3">
                  <p className="text-xs text-orange-600 font-bold uppercase tracking-wide mb-0.5">{T("devOtp")}</p>
                  <p className="text-orange-700 font-extrabold text-xl tracking-[0.4em]">{emailDevOtp}</p>
                </div>}
                <input type="text" inputMode="numeric" placeholder="• • • • • •" value={emailOtp} onChange={e => setEmailOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="w-full h-16 px-4 mb-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-center text-3xl font-extrabold tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all" maxLength={6} autoFocus />
              </>
            )}

            {method === "username" && step === "input" && (
              <>
                <p className="text-sm text-gray-500 mb-4">{T("loginWith")} {T("usernameLabel")}</p>
                <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("usernameLabel")}</label>
                <input type="text" placeholder="your_username" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-orange-400 mb-3 transition-all" autoFocus autoCapitalize="none" />
                <label className="text-xs font-extrabold text-gray-400 mb-1.5 block uppercase tracking-wider">{T("passwordLabel")}</label>
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
                ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> {T("pleaseWait")}</>
                : method === "phone"
                  ? (step === "input" ? `${T("sendOtp")} →` : `${T("verifyLogin")} ✓`)
                  : method === "email"
                  ? (step === "input" ? `${T("sendOtp")} →` : `${T("verifyLogin")} ✓`)
                  : `${T("login")} →`
              }
            </button>

            {step === "otp" && (
              <button
                onClick={() => { if (resendCooldown > 0) return; (method === "phone" ? sendPhoneOtp : sendEmailOtp)(); }}
                disabled={resendCooldown > 0}
                className="w-full mt-3 text-sm text-gray-400 hover:text-orange-500 font-medium py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {resendCooldown > 0 ? `${T("resendOtp")} (${resendCooldown}s)` : T("resendOtp")}
              </button>
            )}

            <p className="text-center text-xs text-gray-400 mt-4">{T("onlyVendorsAccess")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
