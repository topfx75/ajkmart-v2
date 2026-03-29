import { useState, useCallback } from "react";
import { Link } from "wouter";
import { api } from "../lib/api";
import { usePlatformConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { useAuth } from "../lib/auth";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { TwoFactorSetup, TwoFactorVerify } from "@workspace/auth-utils";
import {
  ArrowLeft, Shield, ShieldCheck, ShieldOff, Loader2,
} from "lucide-react";

type ViewState = "main" | "setup" | "verify-disable";

export default function SecuritySettings() {
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const { user } = useAuth();
  const T = (key: TranslationKey) => tDual(key, language);

  const [view, setView] = useState<ViewState>("main");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  const [is2faEnabled, setIs2faEnabled] = useState(() => !!user?.twoFactorEnabled);

  const [setupData, setSetupData] = useState<{
    qrCodeDataUrl: string;
    secret: string;
    backupCodes: string[];
  } | null>(null);

  const [verifyError, setVerifyError] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  const handleToggle2fa = async () => {
    if (is2faEnabled) {
      setView("verify-disable");
    } else {
      setLoading(true);
      setError("");
      try {
        const data = await api.twoFactorSetup();
        setSetupData({
          qrCodeDataUrl: data.qrDataUrl || data.qrCodeDataUrl || data.qrCode || "",
          secret: data.secret || "",
          backupCodes: data.backupCodes || [],
        });
        setView("setup");
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : T("sendOtpFailed"));
      }
      setLoading(false);
    }
  };

  const handleSetupVerify = useCallback(async (code: string) => {
    setVerifyLoading(true);
    setVerifyError("");
    try {
      const res = await api.twoFactorEnable({ code });
      if (res.backupCodes && setupData) {
        setSetupData({ ...setupData, backupCodes: res.backupCodes });
      }
      setIs2faEnabled(true);
      if (!res.backupCodes || res.backupCodes.length === 0) {
        setView("main");
      }
      showToast(T("twoFactorEnableSuccess"));
    } catch (e: unknown) {
      setVerifyError(e instanceof Error ? e.message : T("verificationFailed"));
    }
    setVerifyLoading(false);
  }, [T, setupData]);

  const handleDisableVerify = useCallback(async (code: string) => {
    setVerifyLoading(true);
    setVerifyError("");
    try {
      await api.twoFactorDisable({ code });
      setIs2faEnabled(false);
      setView("main");
      showToast(T("twoFactorDisableSuccess"));
    } catch (e: unknown) {
      setVerifyError(e instanceof Error ? e.message : T("verificationFailed"));
    }
    setVerifyLoading(false);
  }, [T]);


  if (view === "setup" && setupData) {
    return (
      <div className="min-h-screen bg-[#F5F6F8] pb-24">
        <div className="bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 px-5 pt-14 pb-8 rounded-b-[2rem] relative overflow-hidden">
          <div className="absolute top-[-30%] right-[-15%] w-64 h-64 rounded-full bg-white/[0.02]" />
          <div className="absolute bottom-[-20%] left-[-10%] w-48 h-48 rounded-full bg-green-500/[0.04]" />
          <button onClick={() => setView("main")} className="text-white/60 text-sm font-semibold mb-3 flex items-center gap-1 relative z-10">
            <ArrowLeft size={14} /> {T("back")}
          </button>
          <h1 className="text-xl font-bold text-white relative z-10">{T("twoFactorAuthentication")}</h1>
        </div>
        <div className="px-4 -mt-4 relative z-10">
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
            <TwoFactorSetup
              qrCodeDataUrl={setupData.qrCodeDataUrl}
              secret={setupData.secret}
              backupCodes={setupData.backupCodes}
              onVerify={handleSetupVerify}
              verifyLoading={verifyLoading}
              verifyError={verifyError}
              appName={config.platform.appName}
            />
          </div>
        </div>
      </div>
    );
  }

  if (view === "verify-disable") {
    return (
      <div className="min-h-screen bg-[#F5F6F8] pb-24">
        <div className="bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 px-5 pt-14 pb-8 rounded-b-[2rem] relative overflow-hidden">
          <div className="absolute top-[-30%] right-[-15%] w-64 h-64 rounded-full bg-white/[0.02]" />
          <div className="absolute bottom-[-20%] left-[-10%] w-48 h-48 rounded-full bg-green-500/[0.04]" />
          <button onClick={() => setView("main")} className="text-white/60 text-sm font-semibold mb-3 flex items-center gap-1 relative z-10">
            <ArrowLeft size={14} /> {T("back")}
          </button>
          <h1 className="text-xl font-bold text-white relative z-10">{T("twoFactorVerification")}</h1>
        </div>
        <div className="px-4 -mt-4 relative z-10">
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
            <TwoFactorVerify
              onVerify={handleDisableVerify}
              verifyLoading={verifyLoading}
              verifyError={verifyError}
              showTrustDevice={false}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F6F8] pb-24">
      <div className="bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 px-5 pt-14 pb-8 rounded-b-[2rem] relative overflow-hidden">
        <div className="absolute top-[-30%] right-[-15%] w-64 h-64 rounded-full bg-white/[0.02]" />
        <div className="absolute bottom-[-20%] left-[-10%] w-48 h-48 rounded-full bg-green-500/[0.04]" />
        <div className="flex items-center gap-3 mb-2 relative z-10">
          <Link href="/profile" className="text-white/60 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-bold text-white">{T("securitySettings")}</h1>
        </div>
      </div>

      <div className="px-4 mt-4 space-y-4 max-w-md mx-auto">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${is2faEnabled ? "bg-green-100" : "bg-gray-100"}`}>
              {is2faEnabled ? <ShieldCheck size={24} className="text-green-600" /> : <Shield size={24} className="text-gray-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-bold text-gray-900">{T("twoFactorAuthentication")}</h3>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{T("twoFactorDesc")}</p>
              <div className="mt-3 flex items-center gap-2">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${is2faEnabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {is2faEnabled ? T("twoFactorEnabled") : T("twoFactorDisabled")}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <button onClick={handleToggle2fa} disabled={loading}
              className={`w-full h-11 font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-60 ${is2faEnabled
                  ? "border-2 border-red-200 text-red-500 hover:bg-red-50"
                  : "bg-gray-900 hover:bg-gray-800 text-white"
                }`}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : is2faEnabled ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}
              {loading ? T("pleaseWait") : is2faEnabled ? T("disable2fa") : T("enable2fa")}
            </button>
          </div>

          {error && <p className="text-red-500 text-sm mt-3 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>
      </div>

      {toast && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none"
          style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 12px)", paddingLeft: "16px", paddingRight: "16px" }}>
          <div className="bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-2xl max-w-sm w-full text-center pointer-events-auto">{toast}</div>
        </div>
      )}
    </div>
  );
}
