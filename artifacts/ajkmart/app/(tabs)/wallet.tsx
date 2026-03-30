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

function TxItem({ tx }: { tx: any }) {
  const isPending  = tx.type === "deposit" && (!tx.reference || tx.reference === "pending" || tx.reference.startsWith("pending:"));
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
        <Text style={ws.txDate}>{date} · {time}</Text>
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

function MethodIcon({ id, size = 24 }: { id: string; size?: number }) {
  const name = id === "jazzcash" ? "phone-portrait" : id === "easypaisa" ? "phone-portrait" : "business";
  const color = id === "jazzcash" ? "#E53E3E" : id === "easypaisa" ? "#38A169" : "#2B6CB0";
  return <Ionicons name={name as any} size={size} color={color} />;
}

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
    if (!amount || isNaN(amt) || amt <= 0) { setErr("Please enter a valid amount"); return; }
    if (!txId.trim()) { setErr("Transaction ID is required"); return; }
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
      if (!res.ok) { setErr(data.error || "Request failed"); setSubmitting(false); return; }
      setStep("done");
      onSuccess();
    } catch {
      setErr("Network error. Please try again.");
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

          {step !== "done" && stepIdx >= 0 && (
            <View style={{ marginBottom: 18 }}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {STEPS.map((_, i) => (
                  <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= stepIdx ? C.primary : "#E2E8F0" }} />
                ))}
              </View>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, textAlign: "right", marginTop: 6 }}>Step {stepIdx + 1} of {STEPS.length}</Text>
            </View>
          )}

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {step === "done" && (
              <View style={{ alignItems: "center", paddingVertical: 20 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#D1FAE5", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <Ionicons name="checkmark-circle" size={40} color={C.success} />
                </View>
                <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: C.text, marginBottom: 8 }}>Request Submitted!</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center", lineHeight: 20, maxWidth: 280 }}>Your wallet will be credited within 1-2 hours after verification.</Text>
                <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, width: "100%", marginTop: 20, gap: 10, borderWidth: 1, borderColor: C.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>Method</Text>
                    <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.text }}>{selectedMethod?.label}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>Transaction ID</Text>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: C.text }}>{txId}</Text>
                  </View>
                  <View style={{ height: 1, backgroundColor: C.border }} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>Amount</Text>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 22, color: C.success }}>Rs. {parseFloat(amount).toLocaleString()}</Text>
                  </View>
                </View>
                <Pressable onPress={onClose} style={[ws.actionBtn, { backgroundColor: C.primary, marginTop: 16, width: "100%" }]}>
                  <Text style={ws.actionBtnTxt}>Done</Text>
                </Pressable>
              </View>
            )}

            {step === "method" && (
              <View>
                <Text style={ws.sheetTitle}>Add Money</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, marginBottom: 18 }}>Choose your deposit method</Text>
                {loadingMethods ? (
                  <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} />
                ) : methodsError ? (
                  <View style={{ backgroundColor: "#FEF2F2", borderRadius: 16, padding: 24, alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#FEE2E2" }}>
                    <Ionicons name="alert-circle-outline" size={28} color={C.danger} />
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: C.text }}>Methods Unavailable</Text>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, textAlign: "center" }}>No payment methods are enabled. Contact support.</Text>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    {methods.map(m => (
                      <Pressable key={m.id} onPress={() => selectMethod(m)} style={{ flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1.5, borderColor: C.border, borderRadius: 16, padding: 16, backgroundColor: "#fff" }}>
                        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                          <MethodIcon id={m.id} size={26} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: C.text }}>{m.label}</Text>
                          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 }}>{m.description || `Deposit via ${m.label}`}</Text>
                          {m.manualNumber && <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.primary, marginTop: 3 }}>{m.manualNumber}</Text>}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}

            {step === "details" && selectedMethod && (
              <View>
                <Text style={ws.sheetTitle}>{selectedMethod.label}</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, marginBottom: 18 }}>Send payment to the account below</Text>

                <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 4, marginBottom: 14, borderWidth: 1, borderColor: C.border }}>
                  {selectedMethod.manualNumber && (
                    <Pressable onPress={() => copyToClipboard(selectedMethod.manualNumber!)} style={{ flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Account Number</Text>
                        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: C.text, marginTop: 2 }}>{selectedMethod.manualNumber}</Text>
                      </View>
                      <Ionicons name="copy-outline" size={18} color={C.primary} />
                    </Pressable>
                  )}
                  {selectedMethod.manualName && (
                    <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Account Title</Text>
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 14, color: C.text, marginTop: 2 }}>{selectedMethod.manualName}</Text>
                    </View>
                  )}
                  {selectedMethod.iban && (
                    <Pressable onPress={() => copyToClipboard(selectedMethod.iban!)} style={{ flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>IBAN</Text>
                        <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: C.text, marginTop: 2 }}>{selectedMethod.iban}</Text>
                      </View>
                      <Ionicons name="copy-outline" size={18} color={C.primary} />
                    </Pressable>
                  )}
                  {selectedMethod.bankName && (
                    <View style={{ padding: 14, borderBottomWidth: selectedMethod.manualInstructions ? 1 : 0, borderBottomColor: C.border }}>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted }}>Bank</Text>
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 14, color: C.text, marginTop: 2 }}>{selectedMethod.bankName}</Text>
                    </View>
                  )}
                  {selectedMethod.manualInstructions && (
                    <View style={{ padding: 14 }}>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary }}>{selectedMethod.manualInstructions}</Text>
                    </View>
                  )}
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EFF6FF", borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: "#DBEAFE" }}>
                  <Ionicons name="information-circle-outline" size={16} color={C.primary} />
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, flex: 1 }}>After payment, enter the Transaction ID in the next step</Text>
                </View>

                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Pressable onPress={() => setStep("method")} style={[ws.actionBtn, { flex: 1, backgroundColor: C.surfaceSecondary }]}>
                    <Text style={[ws.actionBtnTxt, { color: C.text }]}>Back</Text>
                  </Pressable>
                  <Pressable onPress={goToAmount} style={[ws.actionBtn, { flex: 2, backgroundColor: C.primary }]}>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={ws.actionBtnTxt}>Payment Done</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {step === "amount" && selectedMethod && (
              <View>
                <Text style={ws.sheetTitle}>Transaction Details</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, marginBottom: 18 }}>Enter your payment details</Text>

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

                <Text style={ws.sheetLbl}>Transaction ID *</Text>
                <View style={[ws.inputWrap, { paddingHorizontal: 14, paddingVertical: 10 }]}>
                  <TextInput
                    value={txId}
                    onChangeText={setTxId}
                    placeholder="e.g. T12345678"
                    placeholderTextColor={C.textMuted}
                    style={[ws.sendInput, { paddingVertical: 0 }]}
                  />
                </View>

                <Text style={ws.sheetLbl}>Your Account / Phone (Optional)</Text>
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
                    placeholder="Any additional info..."
                    placeholderTextColor={C.textMuted}
                    style={[ws.sendInput, { paddingVertical: 0 }]}
                  />
                </View>

                {err ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, backgroundColor: "#FEF2F2", padding: 10, borderRadius: 10 }}>
                    <Ionicons name="alert-circle-outline" size={14} color={C.danger} />
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.danger, flex: 1 }}>{err}</Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
                  <Pressable onPress={() => setStep("details")} style={[ws.actionBtn, { flex: 1, backgroundColor: C.surfaceSecondary }]}>
                    <Text style={[ws.actionBtnTxt, { color: C.text }]}>Back</Text>
                  </Pressable>
                  <Pressable onPress={goToConfirm} style={[ws.actionBtn, { flex: 2, backgroundColor: C.primary }]}>
                    <Text style={ws.actionBtnTxt}>Review</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {step === "confirm" && selectedMethod && (
              <View>
                <Text style={ws.sheetTitle}>Confirm Request</Text>
                <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted, marginBottom: 18 }}>Review before submitting</Text>

                <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, gap: 10, marginBottom: 14, borderWidth: 1, borderColor: C.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>Method</Text>
                    <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.text }}>{selectedMethod.label}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>Transaction ID</Text>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 13, color: C.text, fontVariant: ["tabular-nums"] as any }}>{txId}</Text>
                  </View>
                  {senderAcNo ? (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>Sender</Text>
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.text }}>{senderAcNo}</Text>
                    </View>
                  ) : null}
                  {note ? (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>Note</Text>
                      <Text style={{ fontFamily: "Inter_500Medium", fontSize: 13, color: C.text }}>{note}</Text>
                    </View>
                  ) : null}
                  <View style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.textMuted }}>Amount</Text>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 24, color: C.success }}>Rs. {parseFloat(amount).toLocaleString()}</Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF3C7", borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: "#FDE68A" }}>
                  <Ionicons name="alert-circle-outline" size={16} color="#D97706" />
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#92400E", flex: 1 }}>An incorrect TxID may cause rejection. Enter the real transaction ID.</Text>
                </View>

                {err ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, backgroundColor: "#FEF2F2", padding: 10, borderRadius: 10 }}>
                    <Ionicons name="alert-circle-outline" size={14} color={C.danger} />
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.danger, flex: 1 }}>{err}</Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Pressable onPress={() => { setStep("amount"); setErr(""); }} style={[ws.actionBtn, { flex: 1, backgroundColor: C.surfaceSecondary }]}>
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

  const [sendPhone,   setSendPhone]   = useState("");
  const [sendAmount,  setSendAmount]  = useState("");
  const [sendNote,    setSendNote]    = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const [sendStep,    setSendStep]    = useState<"input" | "confirm">("input");
  const [sendPhoneError, setSendPhoneError] = useState("");
  const [sendReceiverName, setSendReceiverName] = useState("");

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
    showToast("Deposit request submitted! It will be approved within 1-2 hours.", "success");
  };

  const handleP2PTopup = async () => {
    if (!p2pSenderPhone.trim()) { showToast("Please enter sender's phone number", "error"); return; }
    const amt = parseFloat(p2pAmount);
    if (!amt || amt < 100) { showToast("Minimum top-up amount is Rs. 100", "error"); return; }
    setP2pLoading(true);
    try {
      const res = await fetch(`${API}/wallet/p2p-topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ senderPhone: p2pSenderPhone.trim(), amount: amt, note: p2pNote || null }),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || "Request failed", "error"); setP2pLoading(false); return; }
      qc.invalidateQueries({ queryKey: ["getWallet"] });
      setPendingTopups(prev => ({ count: prev.count + 1, total: prev.total + amt }));
      setShowP2PTopup(false);
      setP2pSenderPhone(""); setP2pAmount(""); setP2pNote("");
      showToast("P2P Topup request submitted! It will be credited after admin approval.", "success");
    } catch { showToast("Network error. Please try again.", "error"); }
    setP2pLoading(false);
  };

  const openSendFromQR = (phone: string) => {
    setShowQR(false);
    setSendPhone(phone);
    setShowSend(true);
  };

  const resetSendState = () => {
    setSendPhone(""); setSendAmount(""); setSendNote("");
    setSendStep("input"); setSendPhoneError(""); setSendReceiverName(""); setSendLoading(false);
  };

  const closeSendModal = () => {
    setShowSend(false);
    resetSendState();
  };

  const validateSendPhone = (phone: string): boolean => {
    const cleaned = phone.trim().replace(/\s/g, "");
    if (!cleaned) { setSendPhoneError("Phone number is required"); return false; }
    if (!cleaned.startsWith("3")) { setSendPhoneError("Phone number must start with 3"); return false; }
    if (cleaned.length !== 10) { setSendPhoneError("Phone number must be exactly 10 digits"); return false; }
    if (!/^\d+$/.test(cleaned)) { setSendPhoneError("Phone number must contain only digits"); return false; }
    setSendPhoneError("");
    return true;
  };

  const handleSendContinue = async () => {
    if (!validateSendPhone(sendPhone)) return;
    const num = parseFloat(sendAmount);
    if (!num || num < minTransfer) { showToast(`Minimum transfer amount is Rs. ${minTransfer.toLocaleString()}`, "error"); return; }
    if (num > balance) { showToast("Insufficient wallet balance", "error"); return; }
    setSendLoading(true);
    try {
      const res = await fetch(`${API}/wallet/resolve-phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ phone: sendPhone.trim() }),
      });
      const data = await res.json();
      setSendReceiverName(data.name || "");
    } catch {}
    setSendLoading(false);
    setSendStep("confirm");
  };

  const handleSendConfirm = async () => {
    const num = parseFloat(sendAmount);
    setSendLoading(true);
    try {
      const res = await fetch(`${API}/wallet/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ receiverPhone: sendPhone.trim(), amount: num, note: sendNote || null }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || "Transfer failed", "error"); setSendLoading(false); return; }
      updateUser({ walletBalance: data.newBalance });
      qc.invalidateQueries({ queryKey: ["getWallet"] });
      closeSendModal();
      showToast(`Rs. ${num.toLocaleString()} sent to ${data.receiverName || sendPhone}!`, "success");
    } catch { showToast("Network error. Please try again.", "error"); }
    setSendLoading(false);
  };

  const balance      = data?.balance ?? user?.walletBalance ?? 0;
  const transactions = data?.transactions ?? [];
  const filtered     = txFilter === "all" ? transactions : transactions.filter(t => t.type === txFilter);
  const totalIn      = transactions.filter(t => t.type === "credit").reduce((s, t) => s + Number(t.amount), 0);
  const totalOut     = transactions.filter(t => t.type === "debit").reduce((s, t)  => s + Number(t.amount), 0);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      >
        <View style={{ backgroundColor: "#fff", paddingTop: topPad + 20, paddingHorizontal: 20, paddingBottom: 28, borderBottomWidth: 1, borderBottomColor: C.border }}>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, marginBottom: 4 }}>{appName} {T("wallet")}</Text>
          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 40, color: C.text, marginBottom: 4 }}>
            {isLoading ? "Rs. ···" : `Rs. ${balance.toLocaleString()}`}
          </Text>
          <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, marginBottom: 24 }}>{T("availableBalance")}</Text>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable onPress={() => setShowDeposit(true)} style={ws.actionCard}>
              <View style={[ws.actionCardIcon, { backgroundColor: "#D1FAE5" }]}>
                <Ionicons name="add" size={20} color={C.success} />
              </View>
              <Text style={ws.actionCardTxt}>{T("topUp")}</Text>
            </Pressable>
            {p2pEnabled && (
              <Pressable onPress={() => setShowSend(true)} style={ws.actionCard}>
                <View style={[ws.actionCardIcon, { backgroundColor: "#EDE9FE" }]}>
                  <Ionicons name="send-outline" size={18} color="#7C3AED" />
                </View>
                <Text style={ws.actionCardTxt}>{T("send")}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setShowQR(true)} style={ws.actionCard}>
              <View style={[ws.actionCardIcon, { backgroundColor: "#DBEAFE" }]}>
                <Ionicons name="qr-code-outline" size={18} color={C.primary} />
              </View>
              <Text style={ws.actionCardTxt}>{T("receive")}</Text>
            </Pressable>
            <Pressable onPress={() => setShowP2PTopup(true)} style={ws.actionCard}>
              <View style={[ws.actionCardIcon, { backgroundColor: "#FEF3C7" }]}>
                <Ionicons name="people-outline" size={18} color="#D97706" />
              </View>
              <Text style={ws.actionCardTxt}>P2P</Text>
            </Pressable>
          </View>

          {pendingTopups.count > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF3C7", borderRadius: 12, marginTop: 16, padding: 12, borderWidth: 1, borderColor: "#FDE68A" }}>
              <Ionicons name="time-outline" size={14} color="#D97706" />
              <Text style={{ fontFamily: "Inter_500Medium", fontSize: 12, color: "#92400E", flex: 1 }}>
                {pendingTopups.count} pending ({`Rs. ${pendingTopups.total.toLocaleString()}`}) — awaiting approval
              </Text>
            </View>
          )}
        </View>

        <View style={{ flexDirection: "row", paddingHorizontal: 20, gap: 10, marginTop: 16 }}>
          <View style={ws.statCard}>
            <View style={[ws.statIcon, { backgroundColor: "#D1FAE5" }]}>
              <Ionicons name="arrow-down-outline" size={16} color={C.success} />
            </View>
            <Text style={ws.statLbl}>{T("moneyIn")}</Text>
            <Text style={[ws.statAmt, { color: C.success }]}>Rs. {totalIn.toLocaleString()}</Text>
          </View>
          <View style={ws.statCard}>
            <View style={[ws.statIcon, { backgroundColor: "#FEE2E2" }]}>
              <Ionicons name="arrow-up-outline" size={16} color={C.danger} />
            </View>
            <Text style={ws.statLbl}>{T("moneyOut")}</Text>
            <Text style={[ws.statAmt, { color: C.danger }]}>Rs. {totalOut.toLocaleString()}</Text>
          </View>
          <View style={ws.statCard}>
            <View style={[ws.statIcon, { backgroundColor: "#DBEAFE" }]}>
              <Ionicons name="receipt-outline" size={16} color={C.primary} />
            </View>
            <Text style={ws.statLbl}>{T("transactions")}</Text>
            <Text style={[ws.statAmt, { color: C.primary }]}>{transactions.length}</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 17, color: C.text }}>{T("transactionHistory")}</Text>
            {transactions.length > 0 && (
              <View style={{ flexDirection: "row", gap: 6 }}>
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
            <View style={{ alignItems: "center", gap: 10, paddingVertical: 48 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="receipt-outline" size={26} color={C.textMuted} />
              </View>
              <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.text }}>{transactions.length === 0 ? T("noTransactionLabel") : T("filterNoResultsLabel")}</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>{transactions.length === 0 ? T("noTransactionSub") : T("changeFilterLabel")}</Text>
            </View>
          ) : (
            <View>
              {[...filtered].reverse().map(tx => <TxItem key={tx.id} tx={tx} />)}
            </View>
          )}
        </View>

        <View style={{ height: TAB_H + insets.bottom + 20 }} />
      </ScrollView>

      {showDeposit && (
        <DepositModal
          token={token}
          onClose={() => setShowDeposit(false)}
          onSuccess={handleDepositSuccess}
        />
      )}

      <Modal visible={showSend} transparent animationType="slide" onRequestClose={closeSendModal}>
        <Pressable style={ws.overlay} onPress={closeSendModal}>
          <Pressable style={ws.sheet} onPress={e => e.stopPropagation()}>
            <View style={ws.handle} />

            {sendStep === "input" ? (
              <>
                <Text style={ws.sheetTitle}>Send Money</Text>

                <Text style={ws.sheetLbl}>Receiver's Phone Number</Text>
                <View style={[ws.inputWrap, sendPhoneError ? { borderColor: "#EF4444" } : {}]}>
                  <View style={ws.phonePrefix}>
                    <Text style={ws.phonePrefixTxt}>+92</Text>
                  </View>
                  <TextInput
                    value={sendPhone}
                    onChangeText={(t) => { setSendPhone(t); if (sendPhoneError) setSendPhoneError(""); }}
                    placeholder="3XX XXXXXXX"
                    placeholderTextColor={C.textMuted}
                    style={ws.sendInput}
                    keyboardType="phone-pad"
                    maxLength={10}
                  />
                </View>
                {sendPhoneError ? <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#EF4444", marginTop: 2, marginBottom: 6 }}>{sendPhoneError}</Text> : null}

                <Text style={ws.sheetLbl}>Amount (PKR)</Text>
                <View style={ws.amtWrap}>
                  <Text style={ws.rupee}>Rs.</Text>
                  <TextInput style={ws.amtInput} value={sendAmount} onChangeText={t => setSendAmount(t.replace(/[^0-9]/g, ""))} keyboardType="numeric" placeholder="0" placeholderTextColor={C.textMuted} />
                </View>

                <Text style={ws.sheetLbl}>Note (Optional)</Text>
                <View style={[ws.inputWrap, { paddingHorizontal: 14, paddingVertical: 10 }]}>
                  <TextInput value={sendNote} onChangeText={setSendNote} placeholder="e.g. Lunch bill" placeholderTextColor={C.textMuted} style={[ws.sendInput, { paddingVertical: 0 }]} />
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16, marginTop: 4 }}>
                  <Ionicons name="wallet-outline" size={14} color={C.primary} />
                  <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, flex: 1 }}>Available: Rs. {balance.toLocaleString()} · Min: Rs. {minTransfer.toLocaleString()}</Text>
                </View>

                <Pressable onPress={handleSendContinue} disabled={!sendPhone || !sendAmount || sendLoading} style={[ws.actionBtn, { backgroundColor: "#7C3AED" }, (!sendPhone || !sendAmount || sendLoading) && { opacity: 0.5 }]}>
                  {sendLoading ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="arrow-forward" size={17} color="#fff" />
                      <Text style={ws.actionBtnTxt}>Continue</Text>
                    </>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
                  <Pressable onPress={() => setSendStep("input")} style={{ marginRight: 10, padding: 4 }}>
                    <Ionicons name="arrow-back" size={20} color={C.text} />
                  </Pressable>
                  <Text style={[ws.sheetTitle, { marginBottom: 0 }]}>Confirm Transfer</Text>
                </View>

                <View style={{ backgroundColor: C.surface, borderRadius: 12, padding: 16, marginBottom: 16, gap: 12 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>To</Text>
                    <View style={{ alignItems: "flex-end" }}>
                      {sendReceiverName ? <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text }}>{sendReceiverName}</Text> : null}
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: sendReceiverName ? C.textMuted : C.text }}>+92 {sendPhone.trim()}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>Amount</Text>
                    <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#7C3AED" }}>Rs. {parseFloat(sendAmount || "0").toLocaleString()}</Text>
                  </View>
                  {sendNote ? (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted }}>Note</Text>
                      <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.text }}>{sendNote}</Text>
                    </View>
                  ) : null}
                </View>

                <Pressable onPress={() => setSendStep("input")} style={{ alignSelf: "center", marginBottom: 12 }}>
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.primary }}>Edit Details</Text>
                </Pressable>

                <Pressable onPress={handleSendConfirm} disabled={sendLoading} style={[ws.actionBtn, { backgroundColor: "#7C3AED" }, sendLoading && { opacity: 0.5 }]}>
                  {sendLoading ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="send" size={17} color="#fff" />
                      <Text style={ws.actionBtnTxt}>Send Rs. {parseFloat(sendAmount || "0").toLocaleString()}</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showQR} transparent animationType="fade" onRequestClose={() => setShowQR(false)}>
        <Pressable style={[ws.overlay, { justifyContent: "center", paddingHorizontal: 32 }]} onPress={() => setShowQR(false)}>
          <Pressable style={[ws.sheet, { borderRadius: 24, paddingVertical: 28 }]} onPress={e => e.stopPropagation()}>
            <Text style={[ws.sheetTitle, { textAlign: "center" }]}>Receive Money</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, textAlign: "center", marginBottom: 20 }}>
              Scan this QR code or share your phone number
            </Text>

            <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 20, padding: 24, alignItems: "center", marginBottom: 16, gap: 12, borderWidth: 1, borderColor: C.border }}>
              <View style={{ width: 140, height: 140, borderRadius: 16, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border }}>
                <QRCode
                  value={JSON.stringify({ type: "ajkmart_pay", phone: user?.phone, id: user?.id, name: user?.name })}
                  size={120}
                  color={C.primary}
                  backgroundColor="#fff"
                />
              </View>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 17, color: C.text }}>{user?.name || "AJKMart User"}</Text>
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted }}>+92 {user?.phone}</Text>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 }}>
              <Ionicons name="shield-checkmark-outline" size={14} color={C.success} />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: C.textMuted, flex: 1 }}>{appName} users can send directly to your wallet</Text>
            </View>

            <Pressable onPress={() => setShowQR(false)} style={[ws.actionBtn, { backgroundColor: C.primary }]}>
              <Text style={ws.actionBtnTxt}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showP2PTopup} transparent animationType="slide" onRequestClose={() => setShowP2PTopup(false)}>
        <Pressable style={ws.overlay} onPress={() => setShowP2PTopup(false)}>
          <Pressable style={ws.sheet} onPress={e => e.stopPropagation()}>
            <View style={ws.handle} />
            <Text style={ws.sheetTitle}>P2P Topup Request</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, marginBottom: 18 }}>
              Receive money from someone and get your wallet credited
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
              <TextInput style={ws.amtInput} value={p2pAmount} onChangeText={t => setP2pAmount(t.replace(/[^0-9]/g, ""))} keyboardType="numeric" placeholder="0" placeholderTextColor={C.textMuted} />
            </View>

            <Text style={ws.sheetLbl}>Note (Optional)</Text>
            <View style={[ws.inputWrap, { paddingHorizontal: 14, paddingVertical: 10 }]}>
              <TextInput value={p2pNote} onChangeText={setP2pNote} placeholder="e.g. Payment for goods" placeholderTextColor={C.textMuted} style={[ws.sendInput, { paddingVertical: 0 }]} />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF3C7", borderRadius: 12, padding: 12, marginTop: 4, marginBottom: 16, borderWidth: 1, borderColor: "#FDE68A" }}>
              <Ionicons name="alert-circle-outline" size={14} color="#D97706" />
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 12, color: "#92400E", flex: 1 }}>Admin will verify and credit your wallet. This may take 1-2 hours.</Text>
            </View>

            <Pressable onPress={handleP2PTopup} disabled={p2pLoading || !p2pSenderPhone || !p2pAmount} style={[ws.actionBtn, { backgroundColor: C.success }, (!p2pSenderPhone || !p2pAmount || p2pLoading) && { opacity: 0.5 }]}>
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
  actionCard: { flex: 1, alignItems: "center", gap: 8 },
  actionCardIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  actionCardTxt: { fontFamily: "Inter_500Medium", fontSize: 11, color: C.textSecondary, textAlign: "center" },

  statCard: { flex: 1, backgroundColor: "#fff", borderRadius: 16, padding: 14, alignItems: "center", gap: 6, borderWidth: 1, borderColor: C.border },
  statIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statLbl: { fontFamily: "Inter_400Regular", fontSize: 10, color: C.textMuted },
  statAmt: { fontFamily: "Inter_700Bold", fontSize: 13 },

  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: C.surfaceSecondary },
  filterChipActive: { backgroundColor: C.primary },
  filterTxt: { fontFamily: "Inter_500Medium", fontSize: 11, color: C.textMuted },
  filterTxtActive: { color: "#fff" },

  txRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  txIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  txDesc: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text },
  txDate: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginTop: 2 },
  txAmt: { fontFamily: "Inter_700Bold", fontSize: 14 },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingBottom: Platform.OS === "web" ? 40 : 48, paddingTop: 12 },
  handle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text, marginBottom: 4 },
  sheetLbl: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.textSecondary, marginBottom: 8 },

  amtWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 16, marginBottom: 18 },
  rupee: { fontFamily: "Inter_600SemiBold", fontSize: 22, color: C.textSecondary, marginRight: 8 },
  amtInput: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 28, color: C.text, paddingVertical: 14 },

  quickRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  quickBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingVertical: 11, alignItems: "center" },
  quickBtnActive: { borderColor: C.primary, backgroundColor: "#EFF6FF" },
  quickTxt: { fontFamily: "Inter_500Medium", fontSize: 11, color: C.textSecondary },
  quickTxtActive: { color: C.primary, fontFamily: "Inter_700Bold" },

  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: C.border, borderRadius: 14, marginBottom: 14, overflow: "hidden" },
  phonePrefix: { backgroundColor: C.surfaceSecondary, paddingHorizontal: 14, paddingVertical: 14, borderRightWidth: 1, borderRightColor: C.border },
  phonePrefixTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.text },
  sendInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, paddingHorizontal: 14, paddingVertical: 13 },

  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, paddingVertical: 16, marginTop: 4 },
  actionBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
});
