import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth, type AuthUser } from "../lib/auth";
import { api, apiFetch } from "../lib/api";
import { usePlatformConfig, getRiderAuthConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { TwoFactorVerify, MagicLinkSender, executeCaptcha, loadGoogleGSIToken, loadFacebookAccessToken, formatPhoneForApi, canonicalizePhone } from "@workspace/auth-utils";
import {
  Phone, Mail, User, Bike, Clock, Lightbulb, Eye, EyeOff,
  ArrowLeft, Loader2, Shield,
} from "lucide-react";

type LoginMethod = "phone" | "email" | "username" | "google" | "facebook" | "magicLink";
type Step = "continue" | "input" | "otp" | "pending" | "rejected" | "2fa";

type AuthResponse = {
  token?: string; refreshToken?: string;
  pendingApproval?: boolean;
  setupRequired?: boolean; setupOnly?: boolean;
  requires2FA?: boolean;
  tempToken?: string; userId?: string;
  user?: { roles?: string; role?: string; name?: string; email?: string };
  isNewUser?: boolean; needsProfileCompletion?: boolean;
};

function getDeviceFingerprint(): string {
  const nav = window.navigator;
  const raw = [nav.userAgent, nav.language, screen.width, screen.height, screen.colorDepth, new Date().getTimezoneOffset()].join("|");
  let hash = 0;
  for (let i = 0; i < raw.length; i++) { hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0; }
  return Math.abs(hash).toString(36);
}

async function getCaptchaToken(enabled: boolean, siteKey: string | undefined, action: string): Promise<string | undefined> {
  if (!enabled) return undefined;
  try {
    return await executeCaptcha(action, siteKey);
  } catch {
    return undefined;
  }
}

export default function Login() {
  const { login, setTwoFactorPending: setGlobalTwoFaPending } = useAuth();
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const appName = config.platform.appName;
  const logoSrc = config.platform.logoUrl || `${import.meta.env.BASE_URL}logo.svg`;
  const auth = getRiderAuthConfig(config);
  const captchaSiteKey = config.auth?.captchaSiteKey;
  const googleClientId = config.auth?.googleClientId;
  const facebookAppId = config.auth?.facebookAppId;
  const [, navigate] = useLocation();

  const enabledMethods: LoginMethod[] = [];
  if (auth.phoneOtp) enabledMethods.push("phone");
  if (auth.emailOtp) enabledMethods.push("email");
  if (auth.usernamePassword) enabledMethods.push("username");

  const defaultMethod = enabledMethods[0] ?? (auth.google ? "google" : auth.facebook ? "facebook" : auth.magicLink ? "magicLink" : "phone");
  const [method, setMethod] = useState<LoginMethod>(defaultMethod);
  const [step, setStep] = useState<Step>("continue");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [identifier, setIdentifier] = useState("");
  const [otpChannel, setOtpChannel] = useState("");
  const [fallbackChannels, setFallbackChannels] = useState<string[]>([]);
  const checkIdentifierAbort = useRef<AbortController | null>(null);

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState("");

  const [email, setEmail] = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailDevOtp, setEmailDevOtp] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loginRejectionReason, setLoginRejectionReason] = useState<string | null>(null);

  const [failedAttempts, setFailedAttempts] = useState(() => {
    try { return parseInt(sessionStorage.getItem("rider_login_attempts") || "0", 10) || 0; } catch { return 0; }
  });
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(() => {
    try {
      const stored = sessionStorage.getItem("rider_lockout_until");
      const val = stored ? parseInt(stored, 10) : null;
      return val && val > Date.now() ? val : null;
    } catch { return null; }
  });
  const [lockoutRemaining, setLockoutRemaining] = useState(() => {
    try {
      const stored = sessionStorage.getItem("rider_lockout_until");
      const val = stored ? parseInt(stored, 10) : null;
      if (val && val > Date.now()) return Math.ceil((val - Date.now()) / 1000);
      return 0;
    } catch { return 0; }
  });

  const [otpCooldown, setOtpCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = (sec = 60) => {
    setOtpCooldown(sec);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setOtpCooldown(prev => {
        if (prev <= 1) { if (cooldownRef.current) clearInterval(cooldownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const [twoFaPending, setTwoFaPending] = useState<AuthResponse | null>(null);
  const [twoFaError, setTwoFaError] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);

  const clearError = () => setError("");

  const checkIdentifier = async () => {
    const id = identifier.trim();
    if (!id) { setError("Please enter your phone, email, or username"); return; }

    /* Cancel any in-flight request from a previous attempt */
    if (checkIdentifierAbort.current) checkIdentifierAbort.current.abort();
    checkIdentifierAbort.current = new AbortController();

    setLoading(true); clearError();
    try {
      const data = await apiFetch("/auth/check-identifier", {
        method: "POST",
        body: JSON.stringify({ identifier: id, role: "rider", deviceId: getDeviceFingerprint() }),
        signal: checkIdentifierAbort.current.signal,
      });

      if (data.action === "blocked" || data.isBanned) {
        setError("This account has been suspended. Please contact support.");
        setLoading(false); return;
      }
      if (data.action === "locked") {
        setError(`Account temporarily locked. Please try again in ${data.lockedMinutes} minute(s).`);
        setLoading(false); return;
      }
      if (data.action === "registration_closed") {
        setError("New registrations are currently closed. Please contact support.");
        setLoading(false); return;
      }
      if (data.action === "no_method") {
        setError("No login methods are currently available. Please contact support.");
        setLoading(false); return;
      }
      if (data.action === "register") {
        setLoading(false);
        navigate("/register");
        return;
      }
      if (data.action === "force_google") {
        if (auth.google) {
          setMethod("google");
          setStep("input");
        } else {
          setError("This account is linked to Google. Please sign in with Google.");
        }
        setLoading(false); return;
      }
      if (data.action === "force_facebook") {
        if (auth.facebook) {
          setMethod("facebook");
          setStep("input");
        } else {
          setError("This account is linked to Facebook. Please sign in with Facebook.");
        }
        setLoading(false); return;
      }
      if (data.action === "send_phone_otp") {
        const normalized = canonicalizePhone(id) ?? id;
        setPhone(normalized);
        setMethod("phone");
        setLoading(true);
        try {
          const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "login_phone_otp");
          const r = await api.sendOtp(formatPhoneForApi(normalized), captchaToken);
          if (r.otpRequired === false && r.token) {
            await doLogin(r as AuthResponse);
            setLoading(false); return;
          }
          if (r.bypassed) {
            try {
              const vRes = await api.verifyOtp(formatPhoneForApi(normalized), "1234", getDeviceFingerprint());
              await doLogin(vRes);
            } catch (e: unknown) { setError(e instanceof Error ? e.message : "Bypass verification failed"); setStep("input"); }
            setLoading(false); return;
          }
          if (r.otp || r.devMode) setDevOtp(r.otp || "");
          setOtpChannel(r.channel || "sms");
          setFallbackChannels(r.fallbackChannels || []);
          setStep("otp");
          startCooldown(60);
        } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to send OTP"); setStep("input"); }
        setLoading(false); return;
      }
      if (data.action === "send_email_otp") {
        setEmail(id);
        setMethod("email");
        setStep("otp");
        setLoading(true);
        try {
          const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "login_email_otp");
          const r = await api.sendEmailOtp(id, captchaToken);
          if (r.otp || r.devMode) setEmailDevOtp(r.otp || "");
          setOtpChannel("email");
          setFallbackChannels([]);
          startCooldown(60);
        } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to send OTP"); setStep("input"); }
        setLoading(false); return;
      }
      setMethod("username");
      setUsername(id);
      setStep("input");
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Check failed. Please try again.");
    }
    setLoading(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const magicToken = params.get("magic_token");
    if (magicToken) {
      setLoading(true);
      api.magicLinkVerify({ token: magicToken })
        .then(async (res: AuthResponse) => {
          await doLogin(res);
          /* Clean up token from URL only AFTER login resolves successfully */
          window.history.replaceState({}, "", window.location.pathname);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : T("loginFailed"));
          /* Still clean up the URL on failure to prevent retry loops */
          window.history.replaceState({}, "", window.location.pathname);
        })
        .finally(() => setLoading(false));
    }
  }, [login, navigate, setGlobalTwoFaPending]);

  useEffect(() => {
    if (!lockoutUntil) return;
    const interval = setInterval(() => {
      const rem = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
      setLockoutRemaining(rem);
      if (rem <= 0) {
        setLockoutUntil(null);
        setFailedAttempts(0);
        try { sessionStorage.removeItem("rider_lockout_until"); sessionStorage.removeItem("rider_login_attempts"); } catch (ssErr) {
            if (import.meta.env.DEV) console.warn("[Login] Could not clear lockout keys from sessionStorage:", ssErr);
          }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const isLockedOut = lockoutUntil !== null && lockoutRemaining > 0;

  const checkRiderRole = (res: AuthResponse): boolean => {
    const roles = (res.user?.roles || res.user?.role || "").split(",").map((r: string) => r.trim());
    if (!roles.includes("rider")) {
      api.storeTokens(res.token, res.refreshToken);
      apiFetch("/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
      api.clearTokens();
      setError(T("accessDenied"));
      return false;
    }
    return true;
  };

  const doLogin = async (res: AuthResponse) => {
    if (res.requires2FA) {
      setTwoFaPending(res);
      setStep("2fa");
      setGlobalTwoFaPending(true);
      return;
    }
    if (!checkRiderRole(res)) return;
    /* setupRequired / setupOnly means the account isn't fully activated yet —
       treat the same as pendingApproval (show the pending screen, don't store setup token) */
    if (res.setupRequired || res.setupOnly) { api.clearTokens(); setStep("pending"); return; }
    if (res.pendingApproval) { setStep("pending"); return; }
    if (!res.token) { setStep("pending"); return; }
    api.storeTokens(res.token, res.refreshToken);
    /* Fetch full profile. If it fails (e.g. brief network blip), clear the tokens
       and show an error — we do NOT proceed with a structurally invalid user object.
       This avoids both an unsafe cast AND downstream undefined-access crashes. The
       error is set directly (not via handleAuthError) so it cannot inflate the lockout
       counter, which should only count credential failures, not profile-fetch failures. */
    let profile: AuthUser;
    try {
      profile = await api.getMe() as AuthUser;
    } catch (fetchErr: unknown) {
      api.clearTokens();
      const msg = fetchErr instanceof Error ? fetchErr.message : T("loginFailed");
      setError(`${T("loginFailed")} (${msg})`);
      return;
    }
    login(res.token, profile, res.refreshToken);
  };

  const handleAuthError = (e: unknown) => {
    const errAny = e as Record<string, unknown> | null | undefined;
    /* Detected account rejected during login — route to rejection screen.
       Backend sends code:"APPROVAL_REJECTED" + approvalStatus:"rejected" on 403. */
    if (errAny && (errAny.code === "APPROVAL_REJECTED" || errAny.approvalStatus === "rejected")) {
      setLoginRejectionReason((errAny.rejectionReason as string | null | undefined) ?? null);
      setStep("rejected");
      return;
    }
    const msg = e instanceof Error ? e.message : T("loginFailed");
    if (auth.lockoutEnabled) {
      const isLockError = msg.toLowerCase().includes("locked") || msg.toLowerCase().includes("too many");
      if (isLockError) {
        setLockoutUntil(Date.now() + auth.lockoutDurationSec * 1000);
        setLockoutRemaining(auth.lockoutDurationSec);
        setError(T("accountLockedMsg"));
        return;
      }
      setFailedAttempts(prev => {
        const next = prev + 1;
        try { sessionStorage.setItem("rider_login_attempts", String(next)); } catch (ssErr) {
          if (import.meta.env.DEV) console.warn("[Login] Could not persist login attempt count to sessionStorage:", ssErr);
        }
        if (next >= auth.lockoutMaxAttempts) {
          const until = Date.now() + auth.lockoutDurationSec * 1000;
          setLockoutUntil(until);
          setLockoutRemaining(auth.lockoutDurationSec);
          try { sessionStorage.setItem("rider_lockout_until", String(until)); } catch (ssErr) {
            if (import.meta.env.DEV) console.warn("[Login] Could not persist lockout expiry to sessionStorage — lockout state will not survive page refresh:", ssErr);
            /* Surface to user: lockout is applied now but won't persist across tab reloads */
            setError(T("accountLockedMsg"));
          }
        }
        return next;
      });
    }
    setError(msg);
  };

  const switchToMethod = (m: LoginMethod) => {
    setMethod(m);
    setStep("input");
    setError("");
    setOtp(""); setEmailOtp(""); setPassword("");
    setDevOtp(""); setEmailDevOtp("");
  };

  const [phoneFallbackEmail, setPhoneFallbackEmail] = useState("");
  const [showEmailFallback, setShowEmailFallback] = useState(false);

  const sendPhoneOtp = async (channel?: string) => {
    if (!phone || phone.length < 10) { setError(T("enterValidPhone")); return; }
    setLoading(true); clearError(); setShowEmailFallback(false);
    try {
      const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "login_phone_otp");
      if (auth.captchaEnabled && !captchaToken) { setError(T("captchaRequired")); setLoading(false); return; }
      const res = await api.sendOtp(formatPhoneForApi(phone), captchaToken, channel);
      if (res.otpRequired === false && res.token) {
        await doLogin(res as AuthResponse);
        setLoading(false); return;
      }
      if (res.otp || res.devMode) setDevOtp(res.otp || "");
      setOtpChannel(res.channel || "sms");
      setFallbackChannels(res.fallbackChannels || []);
      setStep("otp");
      startCooldown(60);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : T("sendOtpFailed");
      setError(msg);
      if (auth.emailOtp) setShowEmailFallback(true);
    }
    setLoading(false);
  };

  const switchToEmailFallback = async () => {
    if (!phoneFallbackEmail || !phoneFallbackEmail.includes("@")) { setError(T("enterValidEmail")); return; }
    setLoading(true); clearError(); setShowEmailFallback(false);
    try {
      const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "login_email_otp");
      const res = await api.sendEmailOtp(phoneFallbackEmail, captchaToken);
      if (res.otp || res.devMode) setEmailDevOtp(res.otp || "");
      setEmail(phoneFallbackEmail);
      setMethod("email");
      setStep("otp");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : T("sendOtpFailed")); }
    setLoading(false);
  };

  const verifyPhoneOtp = async () => {
    if (!otp || otp.length < 6) { setError(T("enterOtpDigits")); return; }
    setLoading(true); clearError();
    try {
      const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "verify_phone_otp");
      if (auth.captchaEnabled && !captchaToken) { setError(T("captchaRequired")); setLoading(false); return; }
      const res = await api.verifyOtp(formatPhoneForApi(phone), otp, getDeviceFingerprint(), captchaToken);
      await doLogin(res);
    } catch (e: unknown) { handleAuthError(e); }
    setLoading(false);
  };

  const sendEmailOtpFn = async () => {
    if (!email || !email.includes("@")) { setError(T("enterValidEmail")); return; }
    setLoading(true); clearError();
    try {
      const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "login_email_otp");
      if (auth.captchaEnabled && !captchaToken) { setError(T("captchaRequired")); setLoading(false); return; }
      const res = await api.sendEmailOtp(email, captchaToken);
      if (res.otp || res.devMode) setEmailDevOtp(res.otp || "");
      if (res.channel === "console") {
        setError("Email OTP could not be sent — email delivery is not configured. Check server logs for the OTP (dev/staging only).");
        setLoading(false);
        return;
      }
      setOtpChannel("email");
      setFallbackChannels([]);
      setStep("otp");
      startCooldown(60);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : T("sendOtpFailed")); }
    setLoading(false);
  };

  const verifyEmailOtpFn = async () => {
    if (!emailOtp || emailOtp.length < 6) { setError(T("enterOtpDigits")); return; }
    setLoading(true); clearError();
    try {
      const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "verify_email_otp");
      if (auth.captchaEnabled && !captchaToken) { setError(T("captchaRequired")); setLoading(false); return; }
      const res = await api.verifyEmailOtp(email, emailOtp, getDeviceFingerprint(), captchaToken);
      await doLogin(res);
    } catch (e: unknown) { handleAuthError(e); }
    setLoading(false);
  };

  const loginUsername = async () => {
    if (!username || username.length < 3) { setError(T("enterUsername")); return; }
    if (!password || password.length < 6) { setError(T("enterPassword")); return; }
    setLoading(true); clearError();
    try {
      const captchaToken = await getCaptchaToken(auth.captchaEnabled, captchaSiteKey, "login_password");
      if (auth.captchaEnabled && !captchaToken) { setError(T("captchaRequired")); setLoading(false); return; }
      const res = await api.loginUsername(username, password, captchaToken, getDeviceFingerprint());
      await doLogin(res);
    } catch (e: unknown) { handleAuthError(e); }
    setLoading(false);
  };

  const handleSubmit = () => {
    if (isLockedOut) return;
    if (method === "phone") { step === "input" ? sendPhoneOtp() : verifyPhoneOtp(); }
    else if (method === "email") { step === "input" ? sendEmailOtpFn() : verifyEmailOtpFn(); }
    else if (method === "username") loginUsername();
  };

  const selectMethod = (m: LoginMethod) => {
    setMethod(m); setStep("input"); clearError();
    setOtp(""); setEmailOtp(""); setDevOtp(""); setEmailDevOtp("");
  };

  const handleMagicLinkSend = useCallback(async (emailAddr: string) => {
    await api.sendMagicLink(emailAddr);
  }, []);

  const handleSocialGoogle = async () => {
    if (!googleClientId) { setError(T("socialLoginComingSoon")); return; }
    setLoading(true); clearError();
    try {
      const idToken = await loadGoogleGSIToken(googleClientId);
      const res = await api.socialGoogle({ idToken });
      await doLogin(res);
    } catch (e: unknown) { handleAuthError(e); }
    setLoading(false);
  };

  const handleSocialFacebook = async () => {
    if (!facebookAppId) { setError(T("socialLoginComingSoon")); return; }
    setLoading(true); clearError();
    try {
      const accessToken = await loadFacebookAccessToken(facebookAppId);
      const res = await api.socialFacebook({ accessToken });
      await doLogin(res);
    } catch (e: unknown) { handleAuthError(e); }
    setLoading(false);
  };

  useEffect(() => {
    if (step === "input" && method === "google") { handleSocialGoogle(); }
    if (step === "input" && method === "facebook") { handleSocialFacebook(); }
  }, [step, method]);

  const finalize2fa = useCallback(async (res: Record<string, unknown>, tempToken: string) => {
    const finalToken = (res.token as string) || tempToken;
    const refreshTk = (res.refreshToken as string) || twoFaPending?.refreshToken;
    const postRes: AuthResponse = { ...res, token: finalToken, refreshToken: refreshTk };
    if (!checkRiderRole(postRes)) { setGlobalTwoFaPending(false); return; }
    if (postRes.pendingApproval) { setStep("pending"); setGlobalTwoFaPending(false); return; }
    api.storeTokens(finalToken, refreshTk);
    let profile;
    try {
      profile = await api.getMe();
    } catch (fetchErr: unknown) {
      api.clearTokens();
      setTwoFaError(fetchErr instanceof Error ? fetchErr.message : T("loginFailed"));
      setGlobalTwoFaPending(false);
      return;
    }
    login(finalToken, profile, refreshTk);
    setGlobalTwoFaPending(false);
  }, [twoFaPending, login, setGlobalTwoFaPending, T]);

  const handle2faVerify = useCallback(async (code: string) => {
    if (!twoFaPending) return;
    const tempToken = twoFaPending.tempToken;
    if (!tempToken) {
      setTwoFaError("Session error: 2FA token is missing. Please go back and log in again.");
      return;
    }
    setTwoFaLoading(true);
    setTwoFaError("");
    try {
      const res = await api.twoFactorVerify({ code, tempToken, deviceFingerprint: getDeviceFingerprint() });
      await finalize2fa(res, tempToken);
    } catch (e: unknown) {
      setTwoFaError(e instanceof Error ? e.message : T("verificationFailed"));
    }
    setTwoFaLoading(false);
  }, [twoFaPending, finalize2fa, T]);

  const handle2faBackup = useCallback(async (code: string) => {
    if (!twoFaPending) return;
    const tempToken = twoFaPending.tempToken;
    if (!tempToken) {
      setTwoFaError("Session error: 2FA token is missing. Please go back and log in again.");
      return;
    }
    setTwoFaLoading(true);
    setTwoFaError("");
    try {
      const res = await api.twoFactorRecovery({ backupCode: code, tempToken, deviceFingerprint: getDeviceFingerprint() });
      await finalize2fa(res, tempToken);
    } catch (e: unknown) {
      setTwoFaError(e instanceof Error ? e.message : T("verificationFailed"));
    }
    setTwoFaLoading(false);
  }, [twoFaPending, finalize2fa, T]);

  const formatLockoutTime = (sec: number) => {
    if (sec >= 60) return `${Math.ceil(sec / 60)} ${T("minutes")}`;
    return `${sec} ${T("seconds")}`;
  };

  if (step === "2fa") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-72 h-72 rounded-full bg-white/[0.02]" />
        <div className="absolute bottom-[-15%] left-[-10%] w-64 h-64 rounded-full bg-green-500/[0.04]" />
        <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl relative z-10">
          <button onClick={() => { setStep("input"); setTwoFaPending(null); setGlobalTwoFaPending(false); }}
            className="text-gray-900 text-sm font-semibold mb-4 flex items-center gap-1">
            <ArrowLeft size={14} /> {T("back")}
          </button>
          <TwoFactorVerify
            onVerify={handle2faVerify}
            onBackupCode={handle2faBackup}
            verifyLoading={twoFaLoading}
            verifyError={twoFaError}
            showTrustDevice={false}
          />
        </div>
      </div>
    );
  }

  if (step === "pending") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-72 h-72 rounded-full bg-white/[0.02]" />
        <div className="absolute bottom-[-15%] left-[-10%] w-64 h-64 rounded-full bg-green-500/[0.04]" />
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl relative z-10">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <Clock size={40} className="text-amber-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">{T("approvalPending")}</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5">
            {T("approvalMsg")} {T("approvalTakes")}
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-5 text-left flex gap-2">
            <Lightbulb size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-amber-700 text-xs font-medium">{T("alreadyApproved")}</p>
          </div>
          <button onClick={() => { setStep("input"); setError(null); }} className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2">
            <ArrowLeft size={15} /> {T("backToLogin")}
          </button>
          <p className="text-gray-400 text-xs mt-3">{T("alreadyApproved") || "If admin has approved your account, go back and log in again."}</p>
        </div>
      </div>
    );
  }

  if (step === "rejected") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-72 h-72 rounded-full bg-white/[0.02]" />
        <div className="absolute bottom-[-15%] left-[-10%] w-64 h-64 rounded-full bg-red-500/[0.04]" />
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl relative z-10">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <Shield size={40} className="text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">{T("approvalRejected") || "Application Rejected"}</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-4">
            {T("approvalRejectedMsg") || "Your rider application was not approved. Please contact support for more information."}
          </p>
          {loginRejectionReason && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-5 text-left">
              <p className="text-red-700 text-xs font-semibold mb-1">Reason:</p>
              <p className="text-red-600 text-xs">{loginRejectionReason}</p>
            </div>
          )}
          <button onClick={() => { setStep("input"); setLoginRejectionReason(null); setError(null); }} className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2">
            <ArrowLeft size={15} /> {T("backToLogin")}
          </button>
        </div>
      </div>
    );
  }

  const hasSocial = auth.google || auth.facebook;
  const hasMagicLink = auth.magicLink;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-20%] right-[-10%] w-72 h-72 rounded-full bg-white/[0.02]" />
      <div className="absolute bottom-[-15%] left-[-10%] w-64 h-64 rounded-full bg-green-500/[0.04]" />
      <div className="absolute top-[30%] left-[5%] w-40 h-40 rounded-full bg-white/[0.015]" />

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <img
            src={logoSrc}
            alt="AJKMart"
            className="mx-auto mb-4"
            style={{ height: 72, width: "auto", maxWidth: 240, objectFit: "contain", filter: "brightness(0) invert(1)" }}
          />
          <h1 className="text-3xl font-bold text-white">{T("riderPortal")}</h1>
          <p className="text-white/40 mt-1">{appName} {T("deliveryPartner")}</p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-2xl">
          {isLockedOut && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-center">
              <Shield size={24} className="text-red-500 mx-auto mb-2" />
              <p className="text-sm font-bold text-red-700 mb-1">{T("accountLocked")}</p>
              <p className="text-xs text-red-600">
                {T("accountLockedMsg")} {formatLockoutTime(lockoutRemaining)}
              </p>
              <div className="mt-2 text-2xl font-mono font-bold text-red-700">
                {Math.floor(lockoutRemaining / 60).toString().padStart(2, "0")}:{(lockoutRemaining % 60).toString().padStart(2, "0")}
              </div>
            </div>
          )}

          {step === "continue" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">Welcome 👋</h2>
              <p className="text-sm text-gray-500 mb-5">Enter your phone, email, or username to continue</p>
              <label className="text-xs font-bold text-gray-400 mb-1.5 block uppercase tracking-wider">Phone / Email / Username</label>
              <input
                type="text"
                placeholder="+923001234567 or email or username"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                onKeyDown={e => e.key === "Enter" && checkIdentifier()}
                className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all mb-4"
                autoFocus
              />
              {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl"><p className="text-red-600 text-sm font-medium">{error}</p></div>}
              <button onClick={checkIdentifier} disabled={loading || isLockedOut}
                className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-sm">
                {loading ? <><Loader2 size={18} className="animate-spin" /> Checking...</> : "Continue →"}
              </button>
              {(hasSocial || hasMagicLink) && (
                <>
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-xs text-gray-400 font-medium">{T("orContinueWith")}</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <div className="space-y-2">
                    {auth.google && (
                      <button onClick={handleSocialGoogle} disabled={loading || isLockedOut}
                        className="w-full h-11 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                        <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                        {T("signInWithGoogle")}
                      </button>
                    )}
                    {auth.facebook && (
                      <button onClick={handleSocialFacebook} disabled={loading || isLockedOut}
                        className="w-full h-11 bg-[#1877F2] rounded-xl text-sm font-semibold text-white hover:bg-[#166FE5] transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                        {T("signInWithFacebook")}
                      </button>
                    )}
                    {auth.magicLink && (
                      <div className="mt-1">
                        <MagicLinkSender onSend={handleMagicLinkSend} title={T("magicLinkLogin")} subtitle={T("enterRegisteredEmail")} />
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="mt-4 text-center">
                <Link to="/register" className="text-sm text-gray-500">
                  New rider?{" "}
                  <span className="text-gray-900 font-bold hover:underline">Register here</span>
                </Link>
              </div>
            </>
          )}

          {step === "input" && enabledMethods.length > 1 && (
            <>
              <button onClick={() => { setStep("continue"); clearError(); setDevOtp(""); setEmailDevOtp(""); }}
                className="text-gray-900 text-sm font-semibold mb-4 flex items-center gap-1">
                <ArrowLeft size={14} /> Change identifier
              </button>
              <div className="flex gap-1 bg-gray-100 rounded-full p-1 mb-5">
                {enabledMethods.map(m => (
                  <button
                    key={m}
                    onClick={() => selectMethod(m)}
                    className={`flex-1 py-2 text-xs font-bold rounded-full transition-all flex items-center justify-center gap-1 ${method === m ? "bg-gray-900 text-white shadow-sm" : "text-gray-400"
                      }`}
                  >
                    {m === "phone" ? <><Phone size={11} /> {T("phoneLabel")}</> : m === "email" ? <><Mail size={11} /> {T("email")}</> : <><User size={11} /> {T("username")}</>}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === "otp" && (
            <button onClick={() => { setStep("continue"); clearError(); setDevOtp(""); setEmailDevOtp(""); }}
              className="text-gray-900 text-sm font-semibold mb-4 flex items-center gap-1">
              <ArrowLeft size={14} /> {T("back")}
            </button>
          )}

          {method === "phone" && step === "input" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">{T("phoneLogin")}</h2>
              <p className="text-sm text-gray-500 mb-4">{T("enterRegisteredPhone")}</p>
              <div className="flex gap-2 mb-1">
                <div className="h-12 px-3 bg-gray-100 border border-gray-200 rounded-xl flex items-center text-sm font-bold text-gray-700 select-none gap-1" title="Pakistan only">🇵🇰 +92</div>
                <input type="tel" placeholder="3XX XXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="flex-1 h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" autoFocus inputMode="numeric" />
              </div>
              <p className="text-[10px] text-gray-400 mb-3">Pakistan only (+92)</p>
              {showEmailFallback && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
                  <p className="text-xs text-amber-700 font-semibold mb-2">SMS not working? Use email OTP instead:</p>
                  <div className="flex gap-2">
                    <input type="email" placeholder="your@email.com" value={phoneFallbackEmail} onChange={e => setPhoneFallbackEmail(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && switchToEmailFallback()}
                      className="flex-1 h-10 px-3 bg-white border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"/>
                    <button onClick={switchToEmailFallback} disabled={loading}
                      className="h-10 px-3 bg-gray-900 text-white text-xs font-bold rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-1">
                      <Mail size={12}/> Send
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {method === "phone" && step === "otp" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">{T("enterOtp")}</h2>
              <p className="text-sm text-gray-500 mb-1">+92{phone}</p>
              {otpChannel && (
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className="text-xs font-semibold text-gray-400">
                    via {otpChannel === "whatsapp" ? "📱 WhatsApp" : otpChannel === "email" ? "✉️ Email" : "💬 SMS"}
                  </span>
                  {fallbackChannels.length > 0 && fallbackChannels.map(ch => (
                    <button key={ch} onClick={() => { if (otpCooldown <= 0) sendPhoneOtp(ch); }}
                      disabled={otpCooldown > 0}
                      className="text-xs text-gray-900 hover:text-gray-700 font-bold disabled:opacity-40">
                      · Send via {ch === "whatsapp" ? "WhatsApp" : ch === "email" ? "Email" : "SMS"}
                    </button>
                  ))}
                </div>
              )}
              {devOtp && <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 mb-3"><p className="text-xs text-orange-600 font-bold uppercase tracking-wide mb-0.5">{T("devOtp")}</p><p className="text-orange-700 font-extrabold text-xl tracking-[0.4em]">{devOtp}</p></div>}
              <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder={T("enterOtpDigits")} value={otp} onChange={e => setOtp(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="w-full h-14 px-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-2xl font-bold tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-gray-900 mb-3" maxLength={6} autoFocus />
              <button onClick={() => { if (otpCooldown === 0) sendPhoneOtp(); }} disabled={otpCooldown > 0}
                className="w-full text-sm text-gray-400 hover:text-gray-900 mb-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed">
                {otpCooldown > 0 ? `${T("resendOtp")} (${otpCooldown}s)` : T("resendOtp")}
              </button>
              {auth.emailOtp && !showEmailFallback && (
                <button onClick={() => setShowEmailFallback(true)} className="w-full text-xs text-amber-600 hover:text-amber-700 py-1 font-semibold">
                  Not receiving SMS? Use email OTP instead
                </button>
              )}
              {showEmailFallback && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-1">
                  <p className="text-xs text-amber-700 font-semibold mb-2">Enter your email to receive OTP:</p>
                  <div className="flex gap-2">
                    <input type="email" placeholder="your@email.com" value={phoneFallbackEmail} onChange={e => setPhoneFallbackEmail(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && switchToEmailFallback()}
                      className="flex-1 h-10 px-3 bg-white border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"/>
                    <button onClick={switchToEmailFallback} disabled={loading}
                      className="h-10 px-3 bg-gray-900 text-white text-xs font-bold rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-1">
                      <Mail size={12}/> Send
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {method === "email" && step === "input" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">{T("emailLogin")}</h2>
              <p className="text-sm text-gray-500 mb-4">{T("enterRegisteredEmail")}</p>
              <input type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 mb-4" autoFocus />
            </>
          )}
          {method === "email" && step === "otp" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">{T("enterOtp")}</h2>
              <p className="text-sm text-gray-500 mb-1">{email}</p>
              {otpChannel === "email" && (
                <span className="text-xs font-semibold text-gray-400 mb-2 block">via ✉️ Email</span>
              )}
              {emailDevOtp && <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 mb-3"><p className="text-xs text-orange-600 font-bold uppercase tracking-wide mb-0.5">{T("devOtp")}</p><p className="text-orange-700 font-extrabold text-xl tracking-[0.4em]">{emailDevOtp}</p></div>}
              <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder={T("enterOtpDigits")} value={emailOtp} onChange={e => setEmailOtp(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="w-full h-14 px-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-2xl font-bold tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-gray-900 mb-3" maxLength={6} autoFocus />
              <button onClick={() => { if (otpCooldown === 0) sendEmailOtpFn(); }} disabled={otpCooldown > 0}
                className="w-full text-sm text-gray-400 hover:text-gray-900 mb-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed">
                {otpCooldown > 0 ? `${T("resendOtp")} (${otpCooldown}s)` : T("resendOtp")}
              </button>
            </>
          )}

          {method === "username" && step === "input" && (
            <>
              <h2 className="text-xl font-bold text-gray-800 mb-1">{T("usernameLogin")}</h2>
              <p className="text-sm text-gray-500 mb-4">Phone, email, or username</p>
              <input type="text" placeholder="Phone, email, or username" value={username} onChange={e => setUsername(e.target.value.trim())} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 mb-3" autoFocus />
              <div className="relative mb-4">
                <input type={showPwd ? "text" : "password"} placeholder={T("password")} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  className="w-full h-12 px-4 pr-12 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                <button onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                  {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </>
          )}

          {auth.lockoutEnabled && failedAttempts > 0 && !isLockedOut && (step === "input" || step === "otp") && (() => {
            const remaining = auth.lockoutMaxAttempts - failedAttempts;
            const alts: { m: LoginMethod; label: string; icon: ReactNode }[] = [];
            if (method !== "phone" && auth.phoneOtp) alts.push({ m: "phone", label: "Phone OTP", icon: <Phone size={11} /> });
            if (method !== "email" && auth.emailOtp) alts.push({ m: "email", label: "Email OTP", icon: <Mail size={11} /> });
            if (method !== "username" && auth.usernamePassword) alts.push({ m: "username", label: "Password", icon: <User size={11} /> });
            return (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-3">
                <p className="text-xs text-amber-700 font-semibold mb-1">
                  ⚠️ {failedAttempts} {T("failedAttempts")} &middot; {remaining} remaining
                </p>
                {alts.length > 0 && (
                  <>
                    <p className="text-[10px] text-amber-600 mb-1.5">Try a different sign-in method:</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {alts.map(({ m, label, icon }) => (
                        <button key={m} onClick={() => switchToMethod(m)}
                          className="flex items-center gap-1 text-[11px] bg-white border border-amber-300 text-amber-800 rounded-lg px-2.5 py-1 font-semibold hover:bg-amber-100 transition-colors">
                          {icon} {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {step !== "continue" && error && <p className="text-red-500 text-sm mb-3 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {step === "input" && enabledMethods.includes(method as "phone" | "email" | "username") && (
            <button onClick={handleSubmit} disabled={loading || isLockedOut}
              className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              {loading ? T("pleaseWait") :
                method === "phone" ? T("sendOtp") :
                  method === "email" ? T("sendEmailOtp") :
                    T("login")
              }
            </button>
          )}

          {step === "otp" && (
            <button onClick={handleSubmit} disabled={loading || isLockedOut}
              className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              {loading ? T("pleaseWait") : T("verifyAndLogin")}
            </button>
          )}

          {step === "input" && (hasSocial || hasMagicLink) && (
            <div className="mt-5">
              {enabledMethods.length > 0 && (
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-400 font-medium">{T("orContinueWith")}</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              )}
              <div className="space-y-2">
                {auth.google && (
                  <button onClick={handleSocialGoogle} disabled={loading || isLockedOut}
                    className="w-full h-11 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                    <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                    {T("signInWithGoogle")}
                  </button>
                )}
                {auth.facebook && (
                  <button onClick={handleSocialFacebook} disabled={loading || isLockedOut}
                    className="w-full h-11 bg-[#1877F2] rounded-xl text-sm font-semibold text-white hover:bg-[#166FE5] transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                    {T("signInWithFacebook")}
                  </button>
                )}
                {auth.magicLink && (
                  <div className="mt-2">
                    <MagicLinkSender
                      onSend={handleMagicLinkSend}
                      title={T("magicLinkLogin")}
                      subtitle={T("enterRegisteredEmail")}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {step === "input" && (
            <div className="mt-5 flex flex-col items-center gap-2">
              <Link href="/register" className="text-sm text-gray-900 font-semibold hover:text-gray-700">
                {T("dontHaveAccount")} {T("register")}
              </Link>
              {(auth.phoneOtp || auth.emailOtp || auth.usernamePassword) && (
                <Link href="/forgot-password" className="text-sm text-gray-500 hover:text-gray-700">
                  {T("forgotPassword")}
                </Link>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-white/30 text-xs mt-6">{T("onlyVerifiedRiders")}</p>
      </div>
    </div>
  );   
}
