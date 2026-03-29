import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { api } from "../lib/api";
import { usePlatformConfig, getRiderAuthConfig } from "../lib/useConfig";
import { useLanguage } from "../lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { executeCaptcha, loadGoogleGSIToken, loadFacebookAccessToken, decodeGoogleJwtPayload } from "@workspace/auth-utils";
import {
  Bike, ArrowLeft, ArrowRight, Loader2, Eye, EyeOff,
  Clock, User, Phone, Mail, FileText, Car, Shield, Lightbulb,
  MapPin, AlertCircle, Camera, Upload, X, CheckCircle2, Image,
} from "lucide-react";

function formatPhoneForApi(localDigits: string): string {
  const digits = localDigits.replace(/\D/g, "");
  if (digits.startsWith("0")) return digits;
  return `0${digits}`;
}

function formatPhoneForRegister(localDigits: string): string {
  const digits = localDigits.replace(/\D/g, "");
  const raw = digits.startsWith("0") ? digits : `0${digits}`;
  if (raw.length === 11) return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return raw;
}

function getPasswordStrength(pw: string): { level: number; label: TranslationKey; color: string; width: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { level: 1, label: "passwordWeak", color: "bg-red-500", width: "w-1/4" };
  if (score <= 2) return { level: 2, label: "passwordFair", color: "bg-orange-500", width: "w-2/4" };
  if (score <= 3) return { level: 3, label: "passwordGood", color: "bg-yellow-500", width: "w-3/4" };
  return { level: 4, label: "passwordStrong", color: "bg-green-500", width: "w-full" };
}

function formatCnic(val: string): string {
  const digits = val.replace(/\D/g, "").slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

const VEHICLE_TYPES = [
  { value: "Bike / Motorcycle", labelKey: "bikeMotorcycle" as TranslationKey },
  { value: "Car", labelKey: "carVehicle" as TranslationKey },
  { value: "Rickshaw / QingQi", labelKey: "rickshawVan" as TranslationKey },
  { value: "Van", labelKey: "vanVehicle" as TranslationKey },
];

const AJK_CITIES = [
  "Muzaffarabad", "Mirpur", "Rawalakot", "Bagh", "Kotli",
  "Bhimber", "Pallandri", "Hajira", "Athmuqam", "Hattian Bala",
  "Neelum", "Haveli", "Jhelum Valley", "Other",
];

const INPUT = "w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:bg-white transition-all";
const SELECT = "w-full h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 appearance-none transition-all";

interface UploadedDoc {
  label: string;
  url: string;
  preview: string;
}

function FileUploadBox({ label, icon, value, onChange, required, uploading }: {
  label: string; icon: React.ReactNode; value: UploadedDoc | null;
  onChange: (file: File) => void; required?: boolean; uploading?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={`border-2 border-dashed rounded-xl p-3 transition-all ${value ? "border-green-300 bg-green-50/50" : "border-gray-200 bg-gray-50/50 hover:border-gray-400"}`}>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { if (e.target.files?.[0]) onChange(e.target.files[0]); }} />
      {value ? (
        <div className="flex items-center gap-3">
          <img src={value.preview} alt={label} className="w-14 h-14 rounded-lg object-cover border border-green-200" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-green-700 flex items-center gap-1"><CheckCircle2 size={12} /> {label}</p>
            <p className="text-[10px] text-green-600 truncate">{value.url ? "Uploaded" : "Ready"}</p>
          </div>
          <button onClick={() => inputRef.current?.click()} className="text-[10px] text-gray-600 font-bold hover:text-gray-900 px-2 py-1 rounded-lg hover:bg-gray-100">
            Change
          </button>
        </div>
      ) : (
        <button onClick={() => inputRef.current?.click()} disabled={uploading}
          className="w-full flex flex-col items-center gap-1.5 py-2 disabled:opacity-50">
          {uploading ? <Loader2 size={20} className="text-gray-500 animate-spin" /> : icon}
          <span className="text-xs font-semibold text-gray-600">{label} {required && <span className="text-red-500">*</span>}</span>
          <span className="text-[10px] text-gray-400">Tap to capture or upload</span>
        </button>
      )}
    </div>
  );
}

export default function Register() {
  const { config } = usePlatformConfig();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);

  const auth = getRiderAuthConfig(config);
  const captchaSiteKey = config.auth?.captchaSiteKey;

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");

  const [cnic, setCnic] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [vehicleReg, setVehicleReg] = useState("");
  const [drivingLicense, setDrivingLicense] = useState("");

  const [vehiclePhoto, setVehiclePhoto] = useState<UploadedDoc | null>(null);
  const [cnicPhoto, setCnicPhoto] = useState<UploadedDoc | null>(null);
  const [licensePhoto, setLicensePhoto] = useState<UploadedDoc | null>(null);
  const [uploadingField, setUploadingField] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [verifyChannel, setVerifyChannel] = useState<"phone" | "email">("phone");

  const [completed, setCompleted] = useState(false);

  const availabilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [availabilityStatus, setAvailabilityStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");

  const clearError = () => setError("");

  const handleFileUpload = useCallback(async (file: File, field: string, setter: (doc: UploadedDoc) => void) => {
    setUploadingField(field);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const preview = base64;
      const res = await api.uploadFile({ file: base64, filename: file.name, mimeType: file.type });
      setter({ label: file.name, url: res.url, preview });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed. Please try again.");
    }
    setUploadingField("");
  }, []);

  useEffect(() => {
    if (!username || username.length < 3) { setUsernameStatus("idle"); return; }
    if (usernameTimer.current) clearTimeout(usernameTimer.current);
    usernameTimer.current = setTimeout(async () => {
      setUsernameStatus("checking");
      try {
        const res = await api.checkAvailable({ username });
        if (res.username && !res.username.available) setUsernameStatus("taken");
        else setUsernameStatus("available");
      } catch { setUsernameStatus("taken"); }
    }, 600);
    return () => { if (usernameTimer.current) clearTimeout(usernameTimer.current); };
  }, [username]);

  useEffect(() => {
    if (name && !username) {
      const suggested = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
      if (suggested.length >= 3) setUsername(suggested);
    }
  }, [name]);

  useEffect(() => {
    if (!phone || phone.length < 10 || !email || !email.includes("@")) {
      setAvailabilityStatus("idle");
      return;
    }
    if (availabilityTimer.current) clearTimeout(availabilityTimer.current);
    availabilityTimer.current = setTimeout(async () => {
      setAvailabilityStatus("checking");
      try {
        await api.checkAvailable({ phone: formatPhoneForApi(phone), email });
        setAvailabilityStatus("available");
      } catch {
        setAvailabilityStatus("taken");
      }
    }, 800);
    return () => { if (availabilityTimer.current) clearTimeout(availabilityTimer.current); };
  }, [phone, email]);

  const handleSocialAutofill = async (provider: "google" | "facebook") => {
    const googleClientId = config.auth?.googleClientId;
    const facebookAppId = config.auth?.facebookAppId;
    if (provider === "google" && !googleClientId) { setError(T("socialLoginComingSoon")); return; }
    if (provider === "facebook" && !facebookAppId) { setError(T("socialLoginComingSoon")); return; }
    setLoading(true); clearError();
    try {
      if (provider === "google") {
        const idToken = await loadGoogleGSIToken(googleClientId!);
        const payload = decodeGoogleJwtPayload(idToken);
        if (payload.name) setName(payload.name);
        if (payload.email) setEmail(payload.email);
      } else {
        const accessToken = await loadFacebookAccessToken(facebookAppId!);
        const fbRes = await fetch(`https://graph.facebook.com/me?fields=name,email&access_token=${accessToken}`);
        if (!fbRes.ok) throw new Error("Failed to fetch Facebook profile");
        const fbData = await fbRes.json();
        if (fbData.error) throw new Error(fbData.error.message || "Facebook profile error");
        if (fbData.name) setName(fbData.name);
        if (fbData.email) setEmail(fbData.email);
      }
      setStep(2);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : T("loginFailed")); }
    setLoading(false);
  };

  const validateStep1 = (): boolean => {
    if (!name.trim()) { setError(T("nameRequired")); return false; }
    if (!phone || phone.length < 10) { setError(T("enterValidPhone")); return false; }
    if (!email || !email.includes("@")) { setError(T("enterValidEmail")); return false; }
    if (!address.trim()) { setError("Home address is required"); return false; }
    if (!city) { setError("Please select your city"); return false; }
    if (!emergencyContact.trim() || emergencyContact.replace(/\D/g, "").length < 10) {
      setError("Valid emergency contact number is required"); return false;
    }
    if (availabilityStatus === "taken") { setError(T("loginFailed")); return false; }
    if (username && usernameStatus === "taken") { setError("Username is already taken. Please choose another."); return false; }
    return true;
  };

  const validateStep2 = (): boolean => {
    const cnicDigits = cnic.replace(/\D/g, "");
    if (cnicDigits.length !== 13) { setError(T("cnicRequired")); return false; }
    if (!vehicleType) { setError(T("vehicleTypeRequired")); return false; }
    if (!vehicleReg.trim()) { setError(T("vehicleRegRequired")); return false; }
    if (!drivingLicense.trim()) { setError(T("drivingLicenseRequired")); return false; }
    if (!vehiclePhoto) { setError("Vehicle photo is required. Please upload a clear photo of your vehicle."); return false; }
    return true;
  };

  const validateStep3 = (): boolean => {
    if (password.length < 8) { setError(T("passwordMinLength")); return false; }
    if (password !== confirmPw) { setError(T("passwordsDoNotMatch")); return false; }
    if (!acceptedTerms) { setError(T("termsRequired")); return false; }
    return true;
  };

  const checkAvailability = async (): Promise<boolean> => {
    try {
      await api.checkAvailable({ phone: formatPhoneForApi(phone), email, ...(username ? { username } : {}) });
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : T("loginFailed"));
      return false;
    }
  };

  const goNextStep = async () => {
    clearError();
    if (step === 1) {
      if (!validateStep1()) return;
      setLoading(true);
      const available = await checkAvailability();
      setLoading(false);
      if (!available) return;
      setStep(2);
    } else if (step === 2) {
      if (!validateStep2()) return;
      setStep(3);
    } else if (step === 3) {
      if (!validateStep3()) return;
      setLoading(true);
      try {
        let captchaToken: string | undefined;
        if (auth.captchaEnabled) {
          try { captchaToken = await executeCaptcha("register", captchaSiteKey); } catch { /* noop */ }
          if (!captchaToken) { setError(T("captchaRequired")); setLoading(false); return; }
        }
        const selectedChannel = (() => {
          if (!auth.phoneOtp && auth.emailOtp) return "email" as const;
          if (auth.phoneOtp && !auth.emailOtp) return "phone" as const;
          return verifyChannel;
        })();
        setVerifyChannel(selectedChannel);

        const docsArray: { type: string; url: string }[] = [];
        if (cnicPhoto?.url) docsArray.push({ type: "cnic", url: cnicPhoto.url });
        if (licensePhoto?.url) docsArray.push({ type: "driving_license", url: licensePhoto.url });

        const regData = {
          name: name.trim(),
          phone: formatPhoneForRegister(phone),
          email: email.trim(),
          cnic: cnic.trim(),
          vehicleType,
          vehicleRegistration: vehicleReg.trim(),
          drivingLicense: drivingLicense.trim(),
          password,
          captchaToken,
          address: address.trim(),
          city: city.trim(),
          emergencyContact: emergencyContact.trim(),
          vehiclePlate: vehicleReg.trim(),
          vehiclePhoto: vehiclePhoto?.url || undefined,
          documents: docsArray.length > 0 ? JSON.stringify(docsArray) : undefined,
          ...(username ? { username: username.trim() } : {}),
        };
        if (auth.phoneOtp) {
          const res = await api.registerRider(regData);
          if (selectedChannel === "email") {
            const emailRes = await api.sendEmailOtp(email.trim(), captchaToken);
            if (emailRes.otp) setDevOtp(emailRes.otp);
          } else {
            if (res.otp) setDevOtp(res.otp);
          }
        } else {
          await api.emailRegisterRider(regData);
          const emailRes = await api.sendEmailOtp(email.trim(), captchaToken);
          if (emailRes.otp) setDevOtp(emailRes.otp);
        }
        setStep(4);
      } catch (e: unknown) { setError(e instanceof Error ? e.message : T("loginFailed")); }
      setLoading(false);
    } else if (step === 4) {
      if (!otp || otp.length < 6) { setError(T("enterOtpDigits")); return; }
      setLoading(true);
      try {
        let captchaToken: string | undefined;
        if (auth.captchaEnabled) {
          captchaToken = await executeCaptcha("register_verify_otp", config.auth?.captchaSiteKey || "");
        }
        if (verifyChannel === "phone") {
          await api.verifyOtp(formatPhoneForApi(phone), otp, undefined, captchaToken);
        } else {
          await api.verifyEmailOtp(email, otp, undefined, captchaToken);
        }
        setCompleted(true);
      } catch (e: unknown) { setError(e instanceof Error ? e.message : T("verificationFailed")); }
      setLoading(false);
    }
  };

  const stepLabels: TranslationKey[] = ["step1PersonalInfo", "step2VehicleInfo", "step3Security", "step4Verification"];

  if (completed) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-72 h-72 rounded-full bg-white/[0.02]" />
        <div className="absolute bottom-[-15%] left-[-10%] w-64 h-64 rounded-full bg-green-500/[0.04]" />
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl relative z-10">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <Clock size={40} className="text-amber-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">{T("pendingAdminApproval")}</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5">{T("pendingApprovalMsg")}</p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-left flex gap-2">
            <Lightbulb size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-amber-700 text-xs font-medium">{T("approvalTakes")}</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-5 text-left flex gap-2">
            <Shield size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-blue-700 text-xs font-medium">
              Admin will review your documents and vehicle photo before activating your account.
            </p>
          </div>
          <Link href="/" className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors text-sm flex items-center justify-center gap-2">
            <ArrowLeft size={15} /> {T("goToLogin")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-20%] right-[-10%] w-72 h-72 rounded-full bg-white/[0.02]" />
      <div className="absolute bottom-[-15%] left-[-10%] w-64 h-64 rounded-full bg-green-500/[0.04]" />
      <div className="absolute top-[30%] left-[5%] w-40 h-40 rounded-full bg-white/[0.015]" />

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-white/[0.08] backdrop-blur-sm border border-white/[0.06] rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-xl">
            <Bike size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">{T("registerAsRider")}</h1>
          <p className="text-white/40 mt-1 text-sm">{T("joinAsDeliveryPartner")}</p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-2xl">
          <div className="flex items-center gap-1 mb-6">
            {[1, 2, 3, 4].map(s => (
              <div key={s} className="flex-1 flex flex-col items-center gap-1">
                <div className={`w-full h-1.5 rounded-full transition-all ${s <= step ? "bg-gray-900" : "bg-gray-200"}`} />
                <span className={`text-[10px] font-semibold ${s <= step ? "text-gray-900" : "text-gray-400"}`}>
                  {T(stepLabels[s - 1])}
                </span>
              </div>
            ))}
          </div>

          {step === 1 && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                  <User size={11} /> {T("nameRequired")}
                </label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder={T("fullName")} className={INPUT} autoFocus />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                  <Phone size={11} /> {T("phoneRequired")}
                </label>
                <div className="flex gap-2">
                  <div className="h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center text-sm font-medium text-gray-600">+92</div>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="3XX XXXXXXX" className={`flex-1 ${INPUT}`} />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                  <Mail size={11} /> {T("emailRequired")}
                </label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" className={INPUT} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                  <MapPin size={11} /> Home Address <span className="text-red-500">*</span>
                </label>
                <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Full home address" className={INPUT} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                  <MapPin size={11} /> City <span className="text-red-500">*</span>
                </label>
                <select value={city} onChange={e => setCity(e.target.value)} className={SELECT}>
                  <option value="">Select your city</option>
                  {AJK_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                  <Phone size={11} /> Emergency Contact <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <div className="h-12 px-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center text-sm font-medium text-gray-600">+92</div>
                  <input type="tel" value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)}
                    placeholder="Family member / friend" className={`flex-1 ${INPUT}`} />
                </div>
                <p className="text-[10px] text-gray-400 mt-1">In case of emergency during delivery</p>
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                  <User size={11} /> Username (Optional)
                </label>
                <input value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  placeholder="e.g. rider_ali" className={INPUT} maxLength={20} />
                {usernameStatus !== "idle" && (
                  <p className={`text-[10px] mt-1 font-medium ${
                    usernameStatus === "checking" ? "text-gray-400" :
                    usernameStatus === "available" ? "text-green-600" : "text-red-500"
                  }`}>
                    {usernameStatus === "checking" ? "Checking..." :
                     usernameStatus === "available" ? "Username available" : "Username already taken"}
                  </p>
                )}
                <p className="text-[10px] text-gray-400 mt-0.5">You can use this to log in with username + password later</p>
              </div>

              {availabilityStatus !== "idle" && (
                <div className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
                  availabilityStatus === "checking" ? "bg-gray-50 text-gray-500" :
                  availabilityStatus === "available" ? "bg-green-50 text-green-700" :
                  "bg-red-50 text-red-600"
                }`}>
                  {availabilityStatus === "checking" ? T("checkingAvailability") :
                   availabilityStatus === "available" ? T("phoneEmailAvailable") :
                   T("alreadyRegistered")}
                </div>
              )}

              {(auth.google || auth.facebook) && (
                <div className="pt-2">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span className="text-xs text-gray-400 font-medium">{T("orContinueWith")}</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <div className="space-y-2">
                    {auth.google && (
                      <button onClick={() => handleSocialAutofill("google")} disabled={loading}
                        className="w-full h-11 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                        {T("signInWithGoogle")}
                      </button>
                    )}
                    {auth.facebook && (
                      <button onClick={() => handleSocialAutofill("facebook")} disabled={loading}
                        className="w-full h-11 bg-[#1877F2] rounded-xl text-sm font-semibold text-white hover:bg-[#166FE5] transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                        {T("signInWithFacebook")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                  <FileText size={11} /> {T("cnicRequired")}
                </label>
                <input value={cnic} onChange={e => setCnic(formatCnic(e.target.value))} placeholder="00000-0000000-0"
                  className={INPUT} inputMode="numeric" autoFocus />
                <p className="text-[10px] text-gray-400 mt-1">{T("cnicFormat")}</p>
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                  <Car size={11} /> {T("vehicleTypeRequired")}
                </label>
                <select value={vehicleType} onChange={e => setVehicleType(e.target.value)} className={SELECT}>
                  <option value="">{T("selectVehicleType")}</option>
                  {VEHICLE_TYPES.map(v => (
                    <option key={v.value} value={v.value}>{T(v.labelKey)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                  <Car size={11} /> Registration / Plate # <span className="text-red-500">*</span>
                </label>
                <input value={vehicleReg} onChange={e => setVehicleReg(e.target.value.toUpperCase())} placeholder="e.g. AJK 1234"
                  className={`${INPUT} uppercase`} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">
                  {T("drivingLicenseRequired")}
                </label>
                <input value={drivingLicense} onChange={e => setDrivingLicense(e.target.value)} placeholder="License number"
                  className={INPUT} />
              </div>

              <div className="border-t border-gray-100 pt-3 mt-1">
                <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Camera size={12} /> Photos & Documents
                </p>
                <div className="space-y-2">
                  <FileUploadBox
                    label="Vehicle Photo"
                    icon={<Image size={20} className="text-gray-500" />}
                    value={vehiclePhoto}
                    onChange={f => handleFileUpload(f, "vehicle", setVehiclePhoto)}
                    required
                    uploading={uploadingField === "vehicle"}
                  />
                  <FileUploadBox
                    label="CNIC Photo (Front)"
                    icon={<FileText size={20} className="text-blue-500" />}
                    value={cnicPhoto}
                    onChange={f => handleFileUpload(f, "cnic", setCnicPhoto)}
                    uploading={uploadingField === "cnic"}
                  />
                  <FileUploadBox
                    label="Driving License Photo"
                    icon={<FileText size={20} className="text-purple-500" />}
                    value={licensePhoto}
                    onChange={f => handleFileUpload(f, "license", setLicensePhoto)}
                    uploading={uploadingField === "license"}
                  />
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-2.5 mt-2 flex items-start gap-2">
                  <AlertCircle size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-blue-700 leading-relaxed">
                    <strong>Vehicle photo is mandatory.</strong> Upload clear photos for faster admin approval. Documents will be verified before your account is activated.
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                  <Shield size={11} /> {T("passwordRequired")}
                </label>
                <div className="relative">
                  <input type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                    placeholder={T("passwordRequired")} className={`${INPUT} pr-12`} autoFocus />
                  <button onClick={() => setShowPwd(v => !v)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                    {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {password && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${getPasswordStrength(password).color} ${getPasswordStrength(password).width}`} />
                      </div>
                      <span className="text-[10px] font-bold text-gray-500">{T(getPasswordStrength(password).label)}</span>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">
                  {T("confirmPassword")}
                </label>
                <input type={showPwd ? "text" : "password"} value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                  placeholder={T("confirmPassword")} className={INPUT} />
                {confirmPw && password !== confirmPw && (
                  <p className="text-[10px] text-red-500 mt-1">{T("passwordsDoNotMatch")}</p>
                )}
              </div>
              <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
                <input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-gray-900" />
                <span className="text-xs text-gray-600 leading-relaxed">
                  {T("acceptTerms")}
                  {config.content.tncUrl && (
                    <> — <a href={config.content.tncUrl} target="_blank" rel="noopener noreferrer" className="text-gray-900 underline font-semibold">Terms</a></>
                  )}
                  {config.content.privacyUrl && (
                    <> | <a href={config.content.privacyUrl} target="_blank" rel="noopener noreferrer" className="text-gray-900 underline font-semibold">Privacy</a></>
                  )}
                </span>
              </label>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <div className="text-center mb-2">
                <h3 className="text-lg font-bold text-gray-800">{T("enterOtp")}</h3>
                <p className="text-sm text-gray-500">
                  {verifyChannel === "phone" ? `+92${phone}` : email}
                </p>
              </div>
              {auth.phoneOtp && auth.emailOtp && (
                <div className="flex gap-2 justify-center mb-2">
                  <button type="button" onClick={async () => {
                    if (verifyChannel === "phone") return;
                    setVerifyChannel("phone"); setOtp(""); setDevOtp("");
                    try {
                      const res = await api.sendOtp(formatPhoneForApi(phone));
                      if (res.otp) setDevOtp(res.otp);
                    } catch {}
                  }}
                    className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${verifyChannel === "phone" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                    {T("verifyViaPhone")}
                  </button>
                  <button type="button" onClick={async () => {
                    if (verifyChannel === "email") return;
                    setVerifyChannel("email"); setOtp(""); setDevOtp("");
                    try {
                      const res = await api.sendEmailOtp(email.trim());
                      if (res.otp) setDevOtp(res.otp);
                    } catch {}
                  }}
                    className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${verifyChannel === "email" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                    {T("verifyViaEmail")}
                  </button>
                </div>
              )}
              {devOtp && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700">
                  <strong>{T("devOtp")}:</strong> {devOtp}
                </div>
              )}
              <input type="number" placeholder={T("enterOtpDigits")} value={otp} onChange={e => setOtp(e.target.value)}
                onKeyDown={e => e.key === "Enter" && goNextStep()}
                className="w-full h-14 px-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-2xl font-bold tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-gray-900"
                maxLength={6} autoFocus />
            </div>
          )}

          {error && <p className="text-red-500 text-sm mt-3 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 mt-5">
            {step > 1 && (
              <button onClick={() => { setStep(step - 1); clearError(); }}
                className="h-12 px-5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1">
                <ArrowLeft size={14} /> {T("previousStep")}
              </button>
            )}
            <button onClick={goNextStep} disabled={loading || !!uploadingField}
              className="flex-1 h-12 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              {loading ? T("pleaseWait") :
                step === 4 ? T("verifyAndLogin") :
                  step === 3 ? T("submitRegistration") :
                    <>{T("nextStep")} <ArrowRight size={14} /></>
              }
            </button>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-gray-900 font-semibold hover:text-gray-700">
              {T("alreadyHaveAccount")} {T("login")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
