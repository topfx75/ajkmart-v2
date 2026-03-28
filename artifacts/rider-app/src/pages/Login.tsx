import { useState } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import {
  Phone, Mail, User, Bike, Clock, Lightbulb, Eye, EyeOff,
  ArrowLeft, Loader2,
} from "lucide-react";

type LoginMethod = "phone" | "email" | "username";
type Step = "input" | "otp" | "pending";

type AuthResponse = {
  token: string; refreshToken?: string;
  pendingApproval?: boolean;
  user?: { roles?: string; role?: string };
};

export default function Login() {
  const { login } = useAuth();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const appName = config.platform.appName;

  const [method, setMethod] = useState<LoginMethod>("phone");
  const [step, setStep]     = useState<Step>("input");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  const [phone, setPhone]   = useState("");
  const [otp, setOtp]       = useState("");
  const [devOtp, setDevOtp] = useState("");

  const [email, setEmail]     = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailDevOtp, setEmailDevOtp] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);

  const clearError = () => setError("");

  const checkRiderRole = (res: AuthResponse): boolean => {
    const roles = (res.user?.roles || res.user?.role || "").split(",").map((r: string) => r.trim());
    if (!roles.includes("rider")) {
      setError(T("accessDenied"));
      return false;
    }
    return true;
  };

  const doLogin = async (res: AuthResponse) => {
    if (!checkRiderRole(res)) return;
    if (res.pendingApproval) { setStep("pending"); return; }
    api.storeTokens(res.token, res.refreshToken);
    const profile = await api.getMe();
    login(res.token, profile, res.refreshToken);
  };

  const sendPhoneOtp = async () => {
    if (!phone || phone.length < 10) { setError(T("enterValidPhone")); return; }
    setLoading(true); clearError();
    try {
      const res = await api.sendOtp(phone);
      setDevOtp(res.otp || "");
      setStep("otp");
    } catch(e: unknown) { setError(e instanceof Error ? e.message : T("sendOtpFailed")); }
    setLoading(false);
  };

  const verifyPhoneOtp = async () => {
    if (!otp || otp.length < 6) { setError(T("enterOtpDigits")); return; }
    setLoading(true); clearError();
    try {
      const res = await api.verifyOtp(phone, otp);
      await doLogin(res);
    } catch(e: unknown) { setError(e instanceof Error ? e.message : T("verificationFailed")); }
    setLoading(false);
  };

  const sendEmailOtpFn = async () => {
    if (!email || !email.includes("@")) { setError(T("enterValidEmail")); return; }
    setLoading(true); clearError();
    try {
      const res = await api.sendEmailOtp(email);
      setEmailDevOtp(res.otp || "");
      setStep("otp");
    } catch(e: unknown) { setError(e instanceof Error ? e.message : T("sendOtpFailed")); }
    setLoading(false);
  };

  const verifyEmailOtpFn = async () => {
    if (!emailOtp || emailOtp.length < 6) { setError(T("enterOtpDigits")); return; }
    setLoading(true); clearError();
    try {
      const res = await api.verifyEmailOtp(email, emailOtp);
      await doLogin(res);
    } catch(e: unknown) { setError(e instanceof Error ? e.message : T("verificationFailed")); }
    setLoading(false);
  };

  const loginUsername = async () => {
    if (!username || username.length < 3) { setError(T("enterUsername")); return; }
    if (!password || password.length < 6) { setError(T("enterPassword")); return; }
    setLoading(true); clearError();
    try {
      const res = await api.loginUsername(username, password);
      await doLogin(res);
    } catch(e: unknown) { setError(e instanceof Error ? e.message : T("loginFailed")); }
    setLoading(false);
  };

  const handleSubmit = () => {
    if (method === "phone") { step === "input" ? sendPhoneOtp() : verifyPhoneOtp(); }
    else if (method === "email") { step === "input" ? sendEmailOtpFn() : verifyEmailOtpFn(); }
    else loginUsername();
  };

  const selectMethod = (m: LoginMethod) => {
    setMethod(m); setStep("input"); clearError();
    setOtp(""); setEmailOtp(""); setDevOtp(""); setEmailDevOtp("");
  };

  if (step === "pending") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-600 to-emerald-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <Clock size={40} className="text-amber-500"/>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">{T("approvalPending")}</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5">
            {T("approvalMsg")} {T("approvalTakes")}
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5 text-left flex gap-2">
            <Lightbulb size={14} className="text-amber-500 flex-shrink-0 mt-0.5"/>
            <p className="text-amber-700 text-xs font-medium">{T("alreadyApproved")}</p>
          </div>
          <button onClick={() => setStep("input")} className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2">
            <ArrowLeft size={15}/> {T("backToLogin")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-600 to-emerald-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-2xl">
            <Bike size={40} className="text-green-600"/>
          </div>
          <h1 className="text-3xl font-bold text-white">{T("riderPortal")}</h1>
          <p className="text-green-200 mt-1">{appName} {T("deliveryPartner")}</p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-2xl">
          {step === "input" && (
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5">
              {(["phone", "email", "username"] as LoginMethod[]).map(m => (
                <button
                  key={m}
                  onClick={() => selectMethod(m)}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${
                    method === m ? "bg-white text-green-700 shadow-sm" : "text-gray-400"
                  }`}
                >
                  {m === "phone" ? <><Phone size={11}/> {T("phoneLabel")}</> : m === "email" ? <><Mail size={11}/> {T("email")}</> : <><User size={11}/> {T("username")}</>}
                </button>
              ))}
            </div>
          )}

          {step === "otp" && (
            <button onClick={() => { setStep("input"); clearError(); setDevOtp(""); setEmailDevOtp(""); }}
              className="text-green-600 text-sm font-semibold mb-4 flex items-center gap-1">
              <ArrowLeft size={14}/> {T("back")}
            </button>
          )}

          {method === "phone" && step === "input" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">{T("phoneLogin")}</h2>
              <p className="text-sm text-gray-500 mb-4">{T("enterRegisteredPhone")}</p>
              <div className="flex gap-2 mb-4">
                <div className="h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center text-sm font-medium text-gray-600">+92</div>
                <input type="tel" placeholder="3XX XXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="flex-1 h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" autoFocus />
              </div>
            </>
          )}
          {method === "phone" && step === "otp" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">{T("enterOtp")}</h2>
              <p className="text-sm text-gray-500 mb-1">+92{phone}</p>
              {devOtp && <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3 text-sm text-green-700"><strong>{T("devOtp")}:</strong> {devOtp}</div>}
              <input type="number" placeholder={T("enterOtpDigits")} value={otp} onChange={e => setOtp(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="w-full h-14 px-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-2xl font-bold tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-green-500 mb-3" maxLength={6} autoFocus />
              <button onClick={sendPhoneOtp} className="w-full text-sm text-gray-400 hover:text-green-600 mb-3 py-1">{T("resendOtp")}</button>
            </>
          )}

          {method === "email" && step === "input" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">{T("emailLogin")}</h2>
              <p className="text-sm text-gray-500 mb-4">{T("enterRegisteredEmail")}</p>
              <input type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-4" autoFocus />
            </>
          )}
          {method === "email" && step === "otp" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">{T("enterOtp")}</h2>
              <p className="text-sm text-gray-500 mb-1">{email}</p>
              {emailDevOtp && <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3 text-sm text-green-700"><strong>{T("devOtp")}:</strong> {emailDevOtp}</div>}
              <input type="number" placeholder={T("enterOtpDigits")} value={emailOtp} onChange={e => setEmailOtp(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="w-full h-14 px-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-2xl font-bold tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-green-500 mb-3" maxLength={6} autoFocus />
              <button onClick={sendEmailOtpFn} className="w-full text-sm text-gray-400 hover:text-green-600 mb-3 py-1">{T("resendOtp")}</button>
            </>
          )}

          {method === "username" && step === "input" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">{T("usernameLogin")}</h2>
              <p className="text-sm text-gray-500 mb-4">{T("enterUsernamePassword")}</p>
              <input type="text" placeholder={T("username")} value={username} onChange={e => setUsername(e.target.value.toLowerCase())} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-3" autoFocus />
              <div className="relative mb-4">
                <input type={showPwd ? "text" : "password"} placeholder={T("password")} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="w-full h-12 px-4 pr-12 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                <button onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                  {showPwd ? <EyeOff size={18}/> : <Eye size={18}/>}
                </button>
              </div>
            </>
          )}

          {error && <p className="text-red-500 text-sm mb-3 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <button onClick={handleSubmit} disabled={loading}
            className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? <Loader2 size={18} className="animate-spin"/> : null}
            {loading ? T("pleaseWait") :
              method === "phone" ? (step === "input" ? T("sendOtp") : T("verifyAndLogin")) :
              method === "email" ? (step === "input" ? T("sendEmailOtp") : T("verifyAndLogin")) :
              T("login")
            }
          </button>
        </div>

        <p className="text-center text-green-200 text-xs mt-6">{T("onlyVerifiedRiders")}</p>
      </div>
    </div>
  );
}
