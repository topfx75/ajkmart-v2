import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import QRCode from "react-native-qrcode-svg";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual } from "@workspace/i18n";
import { useGetWallet } from "@workspace/api-client-react";

const C   = Colors.light;
const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

type TxFilter = "all" | "credit" | "debit";

type PayMethod = {
  id: string;
  label: string;
  description?: string;
  manualNumber?: string;
  manualName?: string;
  manualInstructions?: string;
  iban?: string;
  accountTitle?: string;
  bankName?: string;
};

type DepositStep = "method" | "details" | "amount" | "confirm" | "done";

/* ─── Transaction Item ─── */
function TxItem({ tx }: { tx: any }) {
  const isPending  = tx.type === "deposit" && (!tx.reference || tx.reference === "pending");
  const isApproved = tx.type === "deposit" && tx.reference?.startsWith("approved:");
  const isRejected = tx.type === "deposit" && tx.reference?.startsWith("rejected:");
  const isCredit   = tx.type === "credit" || isApproved;
  const date = new Date(tx.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
  const time = new Date(tx.createdAt).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });

  let iconName: string = isCredit
    ? (tx.description?.includes("top-up") ? "add-circle" : tx.description?.includes("Received") ? "arrow-down" : "arrow-down")
    : (tx.description?.includes("ride") ? "car" : tx.description?.includes("Order") ? "bag" : tx.description?.includes("pharmacy") ? "medkit" : tx.description?.includes("arcel") ? "cube" : "arrow-up");

  if (tx.type === "deposit") {
    iconName = isPending ? "time-outline" : isApproved ? "checkmark-circle" : "close-circle";
  }

  const amtColor = isPending ? C.textMuted : isRejected ? C.danger : isCredit ? C.success : C.danger;
  const prefix   = isPending ? "" : isCredit ? "+" : "−";
  const suffix   = isPending ? " (Pending)" : isRejected ? " (Rejected)" : "";
  const bgColor  = isPending ? "#FEF3C7" : isRejected ? "#FEE2E2" : isCredit ? "#D1FAE5" : "#FEE2E2";
  const iconColor = isPending ? "#D97706" : isRejected ? C.danger : isCredit ? C.success : C.danger;

  return (
    <View style={ws.txRow}>
      <View style={[ws.txIcon, { backgroundColor: bgColor }]}>
        <Ionicons name={iconName as any} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={ws.txDesc} numberOfLines={1}>{tx.description}</Text>
        <Text style={ws.txDate}>{date} • {time}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[ws.txAmt, { color: amtColor }]}>
          {prefix}Rs. {Number(tx.amount).toLocaleString()}
        </Text>
        {suffix ? <Text style={{ fontSize: 9, color: amtColor, fontFamily: "Inter_500Medium" }}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

/* ─── Method Icon ─── */
function MethodIcon({ id, size = 24 }: { id: string; size?: number }) {
  const name = id === "jazzcash" ? "phone-portrait" : id === "easypaisa" ? "phone-portrait" : "business";
  const color = id === "jazzcash" ? "#E53E3E" : id === "easypaisa" ? "#38A169" : "#2B6CB0";
  return <Ionicons name={name as any} size={size} color={color} />;
}

/* ═══════════════════════════ DEPOSIT FLOW ═══════════════════════════════════ */
function DepositModal({ onClose, onSuccess, token }: { onClose: () => void; onSuccess: () => void; token: string | null }) {
  const [step, setStep]               = useState<DepositStep>("method");
  const [methods, setMethods]         = useState<PayMethod[]>([]);
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [methodsError, setMethodsError]     = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PayMethod | null>(null);
  const [amount, setAmount]           = useState("");
  const [txId, setTxId]               = useState("");
  const [senderAcNo, setSenderAcNo]   = useState("");
  const [note, setNote]               = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [err, setErr]                 = useState("");
  const { showToast } = useToast();

  useEffect(() => {
    fetch(`${API}/payments/methods`)
      .then(r => r.json())
      .then((data: any) => {
        const depositable: PayMethod[] = (data.methods || [])
          .filter((m: any) => ["jazzcash", "easypaisa", "bank"].includes(m.id));
        if (depositable.length === 0) setMethodsError(true);
        else setMethods(depositable);
      })
      .catch(() => setMethodsError(true))
      .finally(() => setLoadingMethods(false));
  }, []);

  const STEPS: DepositStep[] = ["method", "details", "amount", "confirm"];
  const stepIdx = STEPS.indexOf(step);

  const selectMethod = (m: PayMethod) => {
    setSelectedMethod(m);
    setErr("");
    setStep("details");
  };

  const goToAmount = () => {
    setErr("");
    setStep("amount");
  };

  const goToConfirm = () => {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt < 100) { setErr("Minimum deposit Rs. 100 hai"); return; }
    if (!txId.trim()) { setErr("Transaction ID daalna zaroori hai"); return; }
    setErr("");
    setStep("confirm");
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErr("");
    try {
      const res = await fetch(`${API}/wallet/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          amount: parseFloat(amount),
          paymentMethod: selectedMethod!.id,
          transactionId: txId.trim(),
          accountNumber: senderAcNo.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Request fail ho gayi"); setSubmitting(false); return; }
      setStep("done");
      onSuccess();
    } catch {
      setErr("Network error. Dobara try karein.");
    }
    setSubmitting(false);
  };

  const copyToClipboard = (text: string) => {
    Clipboard.setStringAsync(text);
    showToast("Copied!", "success");
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={ws.overlay} onPress={onClose}>
        <Pressable style={[ws.sheet, { maxHeight: "90%" }]} onPress={e => e.stopPropagation()}>
          <View style={ws.handle} />

          {/* Step bar (hidden on done) */}
          {step !== "done" && stepIdx >= 0 && (
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {STEPS.map((_, i) => (
                  <View key={i} style={[ds.stepBar, i <= stepIdx && { backgroundColor: C.primary }]} />
                ))}
              </View>
              <Text style={ds.stepTxt}>Step {stepIdx + 1}/{STEPS.length}</Text>
            </View>
          )}

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* ── DONE ── */}
            {step === "done" && (
              <View style={{ alignItems: "center", paddingVertical: 16 }}>
                <View style={ds.doneIcon}>
                  <Ionicons name="checkmark-circle" size={64} color={C.primary} />
                </View>
                <Text style={ds.doneTitle}>Request Submitted!</Text>
                <Text style={ds.doneSub}>1-2 hours mein approve ho ga. Wallet automatically credit ho jayega.</Text>
                <View style={ds.doneSummary}>
                  <View style={ds.summaryRow}>
                    <Text style={ds.summaryLbl}>Method</Text>
                    <Text style={ds.summaryVal}>{selectedMethod?.label}</Text>
                  </View>
                  <View style={ds.summaryRow}>
                    <Text style={ds.summaryLbl}>Transaction ID</Text>
                    <Text style={[ds.summaryVal, { fontFamily: "Inter_700Bold" }]}>{txId}</Text>
                  </View>
                  <View style={[ds.summaryRow, { borderTopWidth: 1, borderTopColor: "#E2E8F0", paddingTop: 10, marginTop: 4 }]}>
                    <Text style={ds.summaryLbl}>Amount</Text>
                    <Text style={[ds.summaryVal, { fontSize: 22, color: C.primary }]}>Rs. {parseFloat(amount).toLocaleString()}</Text>
                  </View>
                </View>
                <Pressable onPress={onClose} style={[ws.actionBtn, { backgroundColor: C.primary, marginTop: 8 }]}>
                  <Text style={ws.actionBtnTxt}>Done</Text>
                </Pressable>
              </View>
            )}

            {/* ── METHOD STEP ── */}
            {step === "method" && (
              <View>
                <Text style={ws.sheetTitle}>💳 Add Money</Text>
                <Text style={ds.subLbl}>Kahan se deposit karna chahte hain?</Text>
                {loadingMethods ? (
                  <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} />
                ) : methodsError ? (
                  <View style={ds.errorBox}>
                    <Ionicons name="alert-circle-outline" size={28} color={C.danger} />
                    <Text style={ds.errorTitle}>Payment methods unavailable</Text>
                    <Text style={ds.errorSub}>Admin ne koi manual payment method enable nahi ki. Support se contact karein.</Text>
                  </View>
                ) : (
                  <View style={{ gap: 12 }}>
                    {methods.map(m => (
                      <Pressable key={m.id} onPress={() => selectMethod(m)} style={ds.methodCard}>
                        <View style={ds.methodIcon}>
                          <MethodIcon id={m.id} size={28} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={ds.methodName}>{m.label}</Text>
                          <Text style={ds.methodDesc}>{m.description || `${m.label} se deposit karein`}</Text>
                          {m.manualNumber && <Text style={ds.methodNum}>{m.manualNumber}</Text>}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* ── DETAILS STEP ── */}
            {step === "details" && selectedMethod && (
              <View>
                <Text style={ws.sheetTitle}>{selectedMethod.label} Details</Text>
                <Text style={ds.subLbl}>Neeche diye account par payment karein:</Text>

                <View style={ds.detailBox}>
                  {selectedMethod.manualNumber && (
                    <Pressable onPress={() => copyToClipboard(selectedMethod.manualNumber!)} style={ds.detailRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={ds.detailLbl}>Account Number</Text>
                        <Text style={ds.detailVal}>{selectedMethod.manualNumber}</Text>
                      </View>
                      <Ionicons name="copy-outline" size={18} color={C.primary} />
                    </Pressable>
                  )}
                  {selectedMethod.manualName && (
                    <View style={ds.detailRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={ds.detailLbl}>Account Title</Text>
                        <Text style={ds.detailVal}>{selectedMethod.manualName}</Text>
                      </View>
                    </View>
                  )}
                  {selectedMethod.iban && (
                    <Pressable onPress={() => copyToClipboard(selectedMethod.iban!)} style={ds.detailRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={ds.detailLbl}>IBAN</Text>
                        <Text style={[ds.detailVal, { fontSize: 12 }]}>{selectedMethod.iban}</Text>
                      </View>
                      <Ionicons name="copy-outline" size={18} color={C.primary} />
                    </Pressable>
                  )}
                  {selectedMethod.bankName && (
                    <View style={ds.detailRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={ds.detailLbl}>Bank</Text>
                        <Text style={ds.detailVal}>{selectedMethod.bankName}</Text>
                      </View>
                    </View>
                  )}
                  {selectedMethod.manualInstructions && (
                    <View style={[ds.detailRow, { borderBottomWidth: 0 }]}>
                      <Text style={[ds.detailLbl, { color: C.textSecondary }]}>{selectedMethod.manualInstructions}</Text>
                    </View>
                  )}
                </View>

                <View style={ds.noteBox}>
                  <Ionicons name="information-circle-outline" size={16} color={C.primary} />
                  <Text style={ds.noteTxt}>Payment karne ke baad neeche wale step mein Transaction ID daalen</Text>
                </View>

                <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
                  <Pressable onPress={() => setStep("method")} style={[ws.actionBtn, { flex: 1, backgroundColor: "#F1F5F9" }]}>
                    <Text style={[ws.actionBtnTxt, { color: C.text }]}>Back</Text>
                  </Pressable>
                  <Pressable onPress={goToAmount} style={[ws.actionBtn, { flex: 2, backgroundColor: C.primary }]}>
                    <Text style={ws.actionBtnTxt}>Payment kar liya ✓</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* ── AMOUNT STEP ── */}
            {step === "amount" && selectedMethod && (
              <View>
                <Text style={ws.sheetTitle}>Transaction Details</Text>
                <Text style={ds.subLbl}>Payment ki details enter karein</Text>

                <Text style={ws.sheetLbl}>Amount (PKR) *</Text>
                <View style={ws.amtWrap}>
                  <Text style={ws.rupee}>Rs.</Text>
                  <TextInput
                    style={ws.amtInput}
                    value={amount}
                    onChangeText={t => setAmount(t.replace(/[^0-9]/g, ""))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={C.textMuted}
                  />
                </View>
                <View style={ws.quickRow}>
                  {QUICK_AMOUNTS.map(a => (
                    <Pressable key={a} onPress={() => setAmount(a.toString())} style={[ws.quickBtn, amount === a.toString() && ws.quickBtnActive]}>
                      <Text style={[ws.quickTxt, amount === a.toString() && ws.quickTxtActive]}>Rs. {a.toLocaleString()}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[ws.sheetLbl, { marginTop: 8 }]}>Transaction ID *</Text>
                <View style={[ws.inputWrap, { paddingHorizontal: 14, paddingVertical: 10 }]}>
                  <TextInput
                    value={txId}
                    onChangeText={setTxId}
                    placeholder="e.g. T12345678"
                    placeholderTextColor={C.textMuted}
                    style={[ws.sendInput, { paddingVertical: 0 }]}
                  />
                </View>

                <Text style={ws.sheetLbl}>Aapka Account / Phone (Optional)</Text>
                <View style={[ws.inputWrap, { paddingHorizontal: 14, paddingVertical: 10 }]}>
                  <TextInput
                    value={senderAcNo}
                    onChangeText={setSenderAcNo}
                    placeholder={selectedMethod.id === "bank" ? "Your IBAN" : "03XX-XXXXXXX"}
                    placeholderTextColor={C.textMuted}
                    style={[ws.sendInput, { paddingVertical: 0 }]}
                  />
                </View>

                <Text style={ws.sheetLbl}>Note (Optional)</Text>
                <View style={[ws.inputWrap, { paddingHorizontal: 14, paddingVertical: 10 }]}>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder="Koi aur info..."
                    placeholderTextColor={C.textMuted}
                    style={[ws.sendInput, { paddingVertical: 0 }]}
                  />
                </View>

                {err ? (
                  <View style={ds.errBox}>
                    <Ionicons name="alert-circle-outline" size={14} color={C.danger} />
                    <Text style={ds.errTxt}>{err}</Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
                  <Pressable onPress={() => setStep("details")} style={[ws.actionBtn, { flex: 1, backgroundColor: "#F1F5F9" }]}>
                    <Text style={[ws.actionBtnTxt, { color: C.text }]}>Back</Text>
                  </Pressable>
                  <Pressable onPress={goToConfirm} style={[ws.actionBtn, { flex: 2, backgroundColor: C.primary }]}>
                    <Text style={ws.actionBtnTxt}>Review →</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* ── CONFIRM STEP ── */}
            {step === "confirm" && selectedMethod && (
              <View>
                <Text style={ws.sheetTitle}>Confirm Request</Text>
                <Text style={ds.subLbl}>Submit se pehle details check karein</Text>

                <View style={ds.confirmBox}>
                  <View style={ds.summaryRow}>
                    <Text style={ds.summaryLbl}>Method</Text>
                    <Text style={ds.summaryVal}>{selectedMethod.label}</Text>
                  </View>
                  <View style={ds.summaryRow}>
                    <Text style={ds.summaryLbl}>Transaction ID</Text>
                    <Text style={[ds.summaryVal, { fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] as any }]}>{txId}</Text>
                  </View>
                  {senderAcNo ? (
                    <View style={ds.summaryRow}>
                      <Text style={ds.summaryLbl}>Sender</Text>
                      <Text style={ds.summaryVal}>{senderAcNo}</Text>
                    </View>
                  ) : null}
                  {note ? (
                    <View style={ds.summaryRow}>
                      <Text style={ds.summaryLbl}>Note</Text>
                      <Text style={ds.summaryVal}>{note}</Text>
                    </View>
                  ) : null}
                  <View style={[ds.summaryRow, { borderTopWidth: 1, borderTopColor: "#E2E8F0", paddingTop: 12, marginTop: 4 }]}>
                    <Text style={[ds.summaryLbl, { fontFamily: "Inter_600SemiBold" }]}>Amount</Text>
                    <Text style={[ds.summaryVal, { fontSize: 24, color: C.primary }]}>Rs. {parseFloat(amount).toLocaleString()}</Text>
                  </View>
                </View>

                <View style={ds.noteBox}>
                  <Ionicons name="alert-circle-outline" size={16} color="#D97706" />
                  <Text style={[ds.noteTxt, { color: "#92400E" }]}>Galat TxID se deposit reject ho sakti hai. Real transaction ID daalen.</Text>
                </View>

                {err ? (
                  <View style={ds.errBox}>
                    <Ionicons name="alert-circle-outline" size={14} color={C.danger} />
                    <Text style={ds.errTxt}>{err}</Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
                  <Pressable onPress={() => { setStep("amount"); setErr(""); }} style={[ws.actionBtn, { flex: 1, backgroundColor: "#F1F5F9" }]}>
                    <Text style={[ws.actionBtnTxt, { color: C.text }]}>Edit</Text>
                  </Pressable>
                  <Pressable onPress={handleSubmit} disabled={submitting} style={[ws.actionBtn, { flex: 2, backgroundColor: C.primary, opacity: submitting ? 0.6 : 1 }]}>
                    {submitting ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                        <Text style={ws.actionBtnTxt}>Submit Request</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            )}

          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ═══════════════════════════ MAIN WALLET SCREEN ═══════════════════════════ */
export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { user, updateUser, token } = useAuth();
  const { showToast } = useToast();
  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const TAB_H  = Platform.OS === "web" ? 84 : 49;

  const [showDeposit, setShowDeposit] = useState(false);
  const [showSend,    setShowSend]    = useState(false);
  const [showQR,      setShowQR]      = useState(false);
  const [showP2PTopup, setShowP2PTopup] = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [txFilter,    setTxFilter]    = useState<TxFilter>("all");

  /* Send money state */
  const [sendPhone,   setSendPhone]   = useState("");
  const [sendAmount,  setSendAmount]  = useState("");
  const [sendNote,    setSendNote]    = useState("");
  const [sendLoading, setSendLoading] = useState(false);

  /* P2P topup state */
  const [p2pSenderPhone, setP2pSenderPhone] = useState("");
  const [p2pAmount,      setP2pAmount]      = useState("");
  const [p2pNote,        setP2pNote]        = useState("");
  const [p2pLoading,     setP2pLoading]     = useState(false);
  const [pendingTopups,  setPendingTopups]  = useState<{ count: number; total: number }>({ count: 0, total: 0 });

  const { config: platformConfig } = usePlatformConfig();
  const appName     = platformConfig.platform.appName;
  const minTransfer = platformConfig.customer.minTransfer;
  const p2pEnabled  = platformConfig.customer.p2pEnabled;

  const { data, isLoading, refetch } = useGetWallet(
    { userId: user?.id || "" },
    { query: { enabled: !!user?.id } }
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const res = await refetch();
    if (res.data?.balance !== undefined) updateUser({ walletBalance: res.data.balance });
    setRefreshing(false);
  }, [refetch, updateUser]);

  useEffect(() => {
    if (token) {
      fetch(`${API}/wallet/pending-topups`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => setPendingTopups({ count: d.count || 0, total: d.total || 0 }))
        .catch(() => {});
    }
  }, [token]);

  const handleDepositSuccess = () => {
    qc.invalidateQueries({ queryKey: ["getWallet"] });
    showToast("Deposit request submit ho gayi! 1-2 hours mein approve ho ga.", "success");
  };

  const handleP2PTopup = async () => {
    if (!p2pSenderPhone.trim()) { showToast("Sender ka phone number enter karein", "error"); return; }
    const amt = parseFloat(p2pAmount);
    if (!amt || amt < 100) { showToast("Minimum Rs. 100 topup karein", "error"); return; }
    setP2pLoading(true);
    try {
      const res = await fetch(`${API}/wallet/p2p-topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ senderPhone: p2pSenderPhone.trim(), amount: amt, note: p2pNote || null }),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || "Request fail ho gayi", "error"); setP2pLoading(false); return; }
      qc.invalidateQueries({ queryKey: ["getWallet"] });
      setPendingTopups(prev => ({ count: prev.count + 1, total: prev.total + amt }));
      setShowP2PTopup(false);
      setP2pSenderPhone(""); setP2pAmount(""); setP2pNote("");
      showToast("P2P Topup request submit ho gayi! Admin approval ke baad credit hoga.", "success");
    } catch { showToast("Network error. Dobara try karein.", "error"); }
    setP2pLoading(false);
  };

  const openSendFromQR = (phone: string) => {
    setShowQR(false);
    setSendPhone(phone);
    setShowSend(true);
  };

  const handleSend = async () => {
    if (!sendPhone.trim()) { showToast("Receiver ka phone number enter karein", "error"); return; }
    const num = parseFloat(sendAmount);
    if (!num || num < minTransfer) { showToast(`Minimum Rs. ${minTransfer.toLocaleString()} transfer karein`, "error"); return; }
    if (num > balance)             { showToast("Wallet mein enough balance nahi", "error"); return; }
    setSendLoading(true);
    try {
      const res = await fetch(`${API}/wallet/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ receiverPhone: sendPhone.trim(), amount: num, note: sendNote || null }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || "Transfer fail ho gaya", "error"); setSendLoading(false); return; }
      updateUser({ walletBalance: data.newBalance });
      qc.invalidateQueries({ queryKey: ["getWallet"] });
      setShowSend(false);
      setSendPhone(""); setSendAmount(""); setSendNote("");
      showToast(`Rs. ${num.toLocaleString()} ${data.receiverName || sendPhone} ko bhej diye!`, "success");
    } catch { showToast("Network error. Dobara try karein.", "error"); }
    setSendLoading(false);
  };

  const balance      = data?.balance ?? user?.walletBalance ?? 0;
  const transactions = data?.transactions ?? [];
  const filtered     = txFilter === "all" ? transactions : transactions.filter(t => t.type === txFilter);
  const totalIn      = transactions.filter(t => t.type === "credit").reduce((s, t) => s + Number(t.amount), 0);
  const totalOut     = transactions.filter(t => t.type === "debit").reduce((s, t)  => s + Number(t.amount), 0);

  return (
    <View style={[ws.root, { backgroundColor: C.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {/* Balance Card */}
        <LinearGradient colors={["#0F3BA8", C.primary, "#2563EB"]} start={{ x:0,y:0 }} end={{ x:1,y:1 }} style={[ws.balCard, { paddingTop: topPad + 20 }]}>
          <View style={[ws.blob, { width:220, height:220, top:-70, right:-60 }]} />
          <View style={[ws.blob, { width:100, height:100, bottom:-20, left:30 }]} />

          <Text style={ws.balLbl}>{appName} {T("wallet")}</Text>
          <Text style={ws.balAmt}>
            {isLoading ? "Rs. ···" : `Rs. ${balance.toLocaleString()}`}
          </Text>
          <Text style={ws.balSub}>{T("availableBalance")}</Text>

          {/* Action Buttons */}
          <View style={ws.actionsRow}>
            <Pressable onPress={() => setShowDeposit(true)} style={ws.action}>
              <View style={ws.actionIcon}>
                <Ionicons name="add" size={22} color={C.primary} />
              </View>
              <Text style={ws.actionTxt}>{T("topUp")}</Text>
            </Pressable>
            {p2pEnabled && (
              <Pressable onPress={() => setShowSend(true)} style={ws.action}>
                <View style={ws.actionIcon}>
                  <Ionicons name="send-outline" size={20} color={C.primary} />
                </View>
                <Text style={ws.actionTxt}>{T("send")}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setShowQR(true)} style={ws.action}>
              <View style={ws.actionIcon}>
                <Ionicons name="qr-code-outline" size={20} color={C.primary} />
              </View>
              <Text style={ws.actionTxt}>{T("receive")}</Text>
            </Pressable>
            <Pressable onPress={() => setShowP2PTopup(true)} style={ws.action}>
              <View style={ws.actionIcon}>
                <Ionicons name="people-outline" size={20} color={C.primary} />
              </View>
              <Text style={ws.actionTxt}>P2P Topup</Text>
            </Pressable>
          </View>

          {pendingTopups.count > 0 && (
            <View style={ws.pendingBanner}>
              <Ionicons name="time-outline" size={14} color="#D97706" />
              <Text style={ws.pendingBannerTxt}>
                {pendingTopups.count} pending topup ({`Rs. ${pendingTopups.total.toLocaleString()}`}) — awaiting admin approval
              </Text>
            </View>
          )}
        </LinearGradient>

        {/* Stats */}
        <View style={ws.statsRow}>
          <View style={ws.statCard}>
            <View style={[ws.statIcon, { backgroundColor: "#D1FAE5" }]}>
              <Ionicons name="arrow-down-outline" size={17} color={C.success} />
            </View>
            <Text style={ws.statLbl}>{T("moneyIn")}</Text>
            <Text style={[ws.statAmt, { color: C.success }]}>Rs. {totalIn.toLocaleString()}</Text>
          </View>
          <View style={ws.statCard}>
            <View style={[ws.statIcon, { backgroundColor: "#FEE2E2" }]}>
              <Ionicons name="arrow-up-outline" size={17} color={C.danger} />
            </View>
            <Text style={ws.statLbl}>{T("moneyOut")}</Text>
            <Text style={[ws.statAmt, { color: C.danger }]}>Rs. {totalOut.toLocaleString()}</Text>
          </View>
          <View style={ws.statCard}>
            <View style={[ws.statIcon, { backgroundColor: "#DBEAFE" }]}>
              <Ionicons name="receipt-outline" size={17} color={C.primary} />
            </View>
            <Text style={ws.statLbl}>{T("transactions")}</Text>
            <Text style={[ws.statAmt, { color: C.primary }]}>{transactions.length}</Text>
          </View>
        </View>

        {/* Transaction History */}
        <View style={ws.txSection}>
          <View style={ws.txHeader}>
            <Text style={ws.txTitle}>{T("transactionHistory")}</Text>
            {transactions.length > 0 && (
              <View style={ws.filterRow}>
                {(["all", "credit", "debit"] as TxFilter[]).map(f => (
                  <Pressable key={f} onPress={() => setTxFilter(f)} style={[ws.filterChip, txFilter === f && ws.filterChipActive]}>
                    <Text style={[ws.filterTxt, txFilter === f && ws.filterTxtActive]}>
                      {f === "all" ? T("allFilter") : f === "credit" ? T("inFilter") : T("outFilter")}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {isLoading ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} />
          ) : filtered.length === 0 ? (
            <View style={ws.emptyTx}>
              <Ionicons name="receipt-outline" size={52} color={C.border} />
              <Text style={ws.emptyTitle}>{transactions.length === 0 ? T("noTransactionLabel") : T("filterNoResultsLabel")}</Text>
              <Text style={ws.emptySubtitle}>{transactions.length === 0 ? T("noTransactionSub") : T("changeFilterLabel")}</Text>
            </View>
          ) : (
            <View style={ws.txList}>
              {[...filtered].reverse().map(tx => <TxItem key={tx.id} tx={tx} />)}
            </View>
          )}
        </View>

        <View style={{ height: TAB_H + insets.bottom + 20 }} />
      </ScrollView>

      {/* ─── Deposit Modal (multi-step) ─── */}
      {showDeposit && (
        <DepositModal
          token={token}
          onClose={() => setShowDeposit(false)}
          onSuccess={handleDepositSuccess}
        />
      )}

      {/* ─── Send Money Modal ─── */}
      <Modal visible={showSend} transparent animationType="slide" onRequestClose={() => setShowSend(false)}>
        <Pressable style={ws.overlay} onPress={() => setShowSend(false)}>
          <Pressable style={ws.sheet} onPress={e => e.stopPropagation()}>
            <View style={ws.handle} />
            <Text style={ws.sheetTitle}>📤 Send Money</Text>

            <Text style={ws.sheetLbl}>Receiver's Phone Number</Text>
            <View style={ws.inputWrap}>
              <View style={ws.phonePrefix}>
                <Text style={ws.phonePrefixTxt}>+92</Text>
              </View>
              <TextInput
                value={sendPhone}
                onChangeText={setSendPhone}
                placeholder="3XX XXXXXXX"
                placeholderTextColor={C.textMuted}
                style={ws.sendInput}
                keyboardType="phone-pad"
              />
            </View>

            <Text style={ws.sheetLbl}>Amount (PKR)</Text>
            <View style={ws.amtWrap}>
              <Text style={ws.rupee}>Rs.</Text>
              <TextInput style={ws.amtInput} value={sendAmount} onChangeText={setSendAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={C.textMuted} />
            </View>

            <Text style={ws.sheetLbl}>Note (Optional)</Text>
            <View style={[ws.inputWrap, { paddingHorizontal: 14, paddingVertical: 10 }]}>
              <TextInput value={sendNote} onChangeText={setSendNote} placeholder="e.g. Khana ka bill" placeholderTextColor={C.textMuted} style={[ws.sendInput, { paddingVertical: 0 }]} />
            </View>

            <View style={[ws.sheetNote, { marginTop: 8 }]}>
              <Ionicons name="wallet-outline" size={14} color={C.primary} />
              <Text style={ws.sheetNoteTxt}>Available: Rs. {balance.toLocaleString()} • Min: Rs. {minTransfer.toLocaleString()}</Text>
            </View>

            <Pressable onPress={handleSend} disabled={sendLoading || !sendPhone || !sendAmount} style={[ws.actionBtn, { backgroundColor: "#7C3AED" }, (!sendPhone || !sendAmount || sendLoading) && { opacity: 0.5 }]}>
              {sendLoading ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="send" size={17} color="#fff" />
                  <Text style={ws.actionBtnTxt}>Send Rs. {parseFloat(sendAmount || "0").toLocaleString()}</Text>
                </>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ─── QR Code Modal (Real QR) ─── */}
      <Modal visible={showQR} transparent animationType="fade" onRequestClose={() => setShowQR(false)}>
        <Pressable style={[ws.overlay, { justifyContent: "center", paddingHorizontal: 32 }]} onPress={() => setShowQR(false)}>
          <Pressable style={[ws.sheet, { borderRadius: 24, paddingVertical: 28 }]} onPress={e => e.stopPropagation()}>
            <Text style={[ws.sheetTitle, { textAlign: "center" }]}>Receive Money</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, textAlign: "center", marginBottom: 20 }}>
              Yeh QR code scan karein ya phone number batayein
            </Text>

            <View style={ws.qrBox}>
              <View style={ws.qrInner}>
                <QRCode
                  value={JSON.stringify({ type: "ajkmart_pay", phone: user?.phone, id: user?.id, name: user?.name })}
                  size={120}
                  color={C.primary}
                  backgroundColor="#fff"
                />
              </View>
              <Text style={ws.qrName}>{user?.name || "AJKMart User"}</Text>
              <Text style={ws.qrPhone}>+92 {user?.phone}</Text>
            </View>

            <View style={ws.sheetNote}>
              <Ionicons name="shield-checkmark-outline" size={14} color={C.success} />
              <Text style={ws.sheetNoteTxt}>{appName} users direct wallet mein bhej sakte hain</Text>
            </View>

            <Pressable onPress={() => setShowQR(false)} style={[ws.actionBtn, { backgroundColor: C.primary, marginTop: 8 }]}>
              <Text style={ws.actionBtnTxt}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ─── P2P Topup Modal ─── */}
      <Modal visible={showP2PTopup} transparent animationType="slide" onRequestClose={() => setShowP2PTopup(false)}>
        <Pressable style={ws.overlay} onPress={() => setShowP2PTopup(false)}>
          <Pressable style={ws.sheet} onPress={e => e.stopPropagation()}>
            <View style={ws.handle} />
            <Text style={ws.sheetTitle}>P2P Topup Request</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, marginBottom: 16 }}>
              Kisi se paise receive karke admin se wallet credit karwayein
            </Text>

            <Text style={ws.sheetLbl}>Sender's Phone Number</Text>
            <View style={ws.inputWrap}>
              <View style={ws.phonePrefix}>
                <Text style={ws.phonePrefixTxt}>+92</Text>
              </View>
              <TextInput
                value={p2pSenderPhone}
                onChangeText={setP2pSenderPhone}
                placeholder="3XX XXXXXXX"
                placeholderTextColor={C.textMuted}
                style={ws.sendInput}
                keyboardType="phone-pad"
              />
            </View>

            <Text style={ws.sheetLbl}>Amount (PKR)</Text>
            <View style={ws.amtWrap}>
              <Text style={ws.rupee}>Rs.</Text>
              <TextInput style={ws.amtInput} value={p2pAmount} onChangeText={setP2pAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={C.textMuted} />
            </View>

            <Text style={ws.sheetLbl}>Note (Optional)</Text>
            <View style={[ws.inputWrap, { paddingHorizontal: 14, paddingVertical: 10 }]}>
              <TextInput value={p2pNote} onChangeText={setP2pNote} placeholder="e.g. Payment for goods" placeholderTextColor={C.textMuted} style={[ws.sendInput, { paddingVertical: 0 }]} />
            </View>

            <View style={[ws.sheetNote, { marginTop: 8, backgroundColor: "#FEF3C7", borderRadius: 10, padding: 10 }]}>
              <Ionicons name="alert-circle-outline" size={14} color="#D97706" />
              <Text style={[ws.sheetNoteTxt, { color: "#92400E" }]}>Admin verify karke wallet credit karega. 1-2 hours lag sakte hain.</Text>
            </View>

            <Pressable onPress={handleP2PTopup} disabled={p2pLoading || !p2pSenderPhone || !p2pAmount} style={[ws.actionBtn, { backgroundColor: "#059669" }, (!p2pSenderPhone || !p2pAmount || p2pLoading) && { opacity: 0.5 }]}>
              {p2pLoading ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="checkmark-circle" size={17} color="#fff" />
                  <Text style={ws.actionBtnTxt}>Submit Topup Request</Text>
                </>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const ws = StyleSheet.create({
  root: { flex: 1 },
  blob: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)" },

  balCard: { paddingHorizontal: 20, paddingBottom: 24, overflow: "hidden" },
  balLbl: { fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(255,255,255,0.8)", marginBottom: 6 },
  balAmt: { fontFamily: "Inter_700Bold", fontSize: 42, color: "#fff", marginBottom: 2 },
  balSub: { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.7)", marginBottom: 24 },

  actionsRow: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 18, padding: 14, gap: 4 },
  action: { flex: 1, alignItems: "center", gap: 8 },
  actionIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  actionTxt: { fontFamily: "Inter_500Medium", fontSize: 11, color: "#fff", textAlign: "center" },

  pendingBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(254,243,199,0.2)", borderRadius: 10, marginHorizontal: 20, marginTop: 12, padding: 10 },
  pendingBannerTxt: { fontFamily: "Inter_500Medium", fontSize: 11, color: "#FEF3C7", flex: 1 },

  statsRow: { flexDirection: "row", paddingHorizontal: 16, gap: 10, marginTop: 16 },
  statCard: { flex: 1, backgroundColor: "#fff", borderRadius: 14, padding: 12, alignItems: "center", gap: 5, borderWidth: 1, borderColor: C.border },
  statIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statLbl: { fontFamily: "Inter_400Regular", fontSize: 10, color: C.textMuted },
  statAmt: { fontFamily: "Inter_700Bold", fontSize: 13 },

  txSection: { paddingHorizontal: 16, marginTop: 22 },
  txHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  txTitle: { fontFamily: "Inter_700Bold", fontSize: 17, color: C.text },
  filterRow: { flexDirection: "row", gap: 6 },
  filterChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: "#F1F5F9" },
  filterChipActive: { backgroundColor: C.primary },
  filterTxt: { fontFamily: "Inter_500Medium", fontSize: 11, color: C.textMuted },
  filterTxtActive: { color: "#fff" },

  txList: {},
  txRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  txIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  txDesc: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text },
  txDate: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 2 },
  txAmt: { fontFamily: "Inter_700Bold", fontSize: 14 },

  emptyTx: { alignItems: "center", gap: 10, paddingVertical: 48 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.text },
  emptySubtitle: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingBottom: Platform.OS === "web" ? 40 : 48, paddingTop: 12 },
  handle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text, marginBottom: 20 },
  sheetLbl: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.textSecondary, marginBottom: 8 },

  amtWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 16, marginBottom: 18 },
  rupee: { fontFamily: "Inter_600SemiBold", fontSize: 22, color: C.textSecondary, marginRight: 8 },
  amtInput: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 28, color: C.text, paddingVertical: 14 },

  quickRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  quickBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingVertical: 11, alignItems: "center" },
  quickBtnActive: { borderColor: C.primary, backgroundColor: "#EFF6FF" },
  quickTxt: { fontFamily: "Inter_500Medium", fontSize: 11, color: C.textSecondary },
  quickTxtActive: { color: C.primary, fontFamily: "Inter_700Bold" },

  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: C.border, borderRadius: 14, marginBottom: 14, overflow: "hidden" },
  phonePrefix: { backgroundColor: "#F1F5F9", paddingHorizontal: 14, paddingVertical: 14, borderRightWidth: 1, borderRightColor: C.border },
  phonePrefixTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.text },
  sendInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, paddingHorizontal: 14, paddingVertical: 13 },

  sheetNote: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 },
  sheetNoteTxt: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, flex: 1 },

  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, paddingVertical: 15, marginTop: 4 },
  actionBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },

  qrBox: { backgroundColor: "#EFF6FF", borderRadius: 20, padding: 24, alignItems: "center", marginBottom: 16, gap: 10 },
  qrInner: { width: 140, height: 140, borderRadius: 16, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.border },
  qrName: { fontFamily: "Inter_700Bold", fontSize: 17, color: C.text },
  qrPhone: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted },
});

const ds = StyleSheet.create({
  stepBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "#E2E8F0" },
  stepTxt: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, textAlign: "right", marginTop: 4 },

  subLbl: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary, marginBottom: 16 },

  methodCard: { flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1.5, borderColor: C.border, borderRadius: 16, padding: 16, backgroundColor: "#FAFAFA" },
  methodIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.borderLight },
  methodName: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  methodDesc: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 },
  methodNum:  { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.primary, marginTop: 3 },

  detailBox: { backgroundColor: "#EFF6FF", borderRadius: 16, padding: 4, marginBottom: 12 },
  detailRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#DBEAFE", gap: 8 },
  detailLbl: { fontFamily: "Inter_400Regular", fontSize: 11, color: "#3B82F6" },
  detailVal: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#1E3A5F" },

  noteBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#EFF6FF", borderRadius: 12, padding: 12, marginBottom: 16 },
  noteTxt: { fontFamily: "Inter_400Regular", fontSize: 12, color: "#1E40AF", flex: 1 },

  errBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF2F2", borderRadius: 12, padding: 12, marginBottom: 12 },
  errTxt: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.danger, flex: 1 },

  confirmBox: { backgroundColor: "#F8FAFC", borderRadius: 16, padding: 16, marginBottom: 12, gap: 4 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  summaryLbl: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted },
  summaryVal: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.text },

  doneIcon: { width: 100, height: 100, borderRadius: 50, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  doneTitle: { fontFamily: "Inter_700Bold", fontSize: 24, color: C.text, marginBottom: 8 },
  doneSub:   { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center", marginBottom: 20 },
  doneSummary: { width: "100%", backgroundColor: "#F0FDF4", borderRadius: 16, padding: 16, gap: 4 },

  errorBox: { alignItems: "center", paddingVertical: 32, gap: 10 },
  errorTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  errorSub:   { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, textAlign: "center" },
});
