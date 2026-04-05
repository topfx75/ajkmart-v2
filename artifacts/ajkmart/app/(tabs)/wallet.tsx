import { Ionicons } from "@expo/vector-icons";
import { withErrorBoundary } from "@/utils/withErrorBoundary";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  TouchableOpacity,
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
import { T as Typ, Font } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual } from "@workspace/i18n";
import { SmartRefresh } from "@/components/ui/SmartRefresh";
import { useGetWallet } from "@workspace/api-client-react";
import { API_BASE as API, unwrapApiResponse } from "@/utils/api";
import { AuthGateSheet } from "@/components/AuthGateSheet";

const C = Colors.light;

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

const TX_STATUS_PENDING  = "pending";
const TX_STATUS_APPROVED = "approved";
const TX_STATUS_REJECTED = "rejected";

function TxItem({ tx }: { tx: any }) {
  const txStatus: string = tx.status ?? TX_STATUS_PENDING;
  const isManualTx = tx.type === "deposit" || tx.type === "withdrawal";
  const isPending  = isManualTx && txStatus === TX_STATUS_PENDING;
  const isApproved = isManualTx && txStatus === TX_STATUS_APPROVED;
  const isRejected = isManualTx && txStatus === TX_STATUS_REJECTED;
  const isCredit   = tx.type === "credit" || (tx.type === "deposit" && isApproved);
  const date = new Date(tx.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
  const time = new Date(tx.createdAt).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });

  let iconName: string;
  if (tx.type === "deposit") {
    iconName = isPending ? "time-outline" : isApproved ? "checkmark-circle" : "close-circle";
  } else if (tx.type === "credit" || tx.type === "refund" || tx.type === "cashback" || tx.type === "referral" || tx.type === "bonus") {
    iconName = "arrow-down";
  } else if (tx.type === "ride") {
    iconName = "car";
  } else if (tx.type === "order" || tx.type === "mart" || tx.type === "food") {
    iconName = "bag";
  } else if (tx.type === "pharmacy") {
    iconName = "medkit";
  } else if (tx.type === "parcel") {
    iconName = "cube";
  } else if (tx.type === "transfer" || tx.type === "debit") {
    iconName = "arrow-up";
  } else if (tx.type === "withdrawal") {
    iconName = "arrow-up";
  } else {
    iconName = isCredit ? "arrow-down" : "arrow-up";
  }

  const amtColor = isPending ? C.textMuted : isRejected ? C.amber : isCredit ? C.success : C.danger;
  const prefix   = isPending ? "" : isCredit ? "+" : "−";
  const suffix   = isPending ? " (Pending)" : isRejected ? " (Rejected)" : "";
  const bgColor  = isPending ? C.amberSoft : isRejected ? C.amberSoft : isCredit ? C.emeraldSoft : C.redSoft;
  const iconColor = isPending ? C.amber : isRejected ? C.amber : isCredit ? C.success : C.danger;

  return (
    <View style={ws.txRow} accessibilityLabel={`${tx.description}, ${prefix}Rs. ${Number(tx.amount).toLocaleString()}${suffix}, ${date}`}>
      <View style={[ws.txIcon, { backgroundColor: bgColor }]}>
        <Ionicons name={iconName as keyof typeof Ionicons.glyphMap} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={ws.txDesc} numberOfLines={1}>{tx.description}</Text>
        <Text style={ws.txDate}>{date} · {time}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[ws.txAmt, { color: amtColor }]}>
          {prefix}Rs. {Number(tx.amount).toLocaleString()}
        </Text>
        {suffix ? <Text style={{ fontSize: 9, color: amtColor, fontFamily: Font.medium }}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

function MethodIcon({ id, size = 24 }: { id: string; size?: number }) {
  if (id === "jazzcash") {
    return <Ionicons name="phone-portrait" size={size} color={C.crimson} />;
  }
  if (id === "easypaisa") {
    return <Ionicons name="phone-landscape" size={size} color={C.greenVivid} />;
  }
  return <Ionicons name="business" size={size} color={C.blueDeep} />;
}

type WithdrawMethod = "jazzcash" | "easypaisa" | "bank";
type WithdrawStep = "method" | "details" | "confirm" | "done";

function WithdrawModal({ onClose, onSuccess, onFrozen, token, balance, minWithdrawal }: { onClose: () => void; onSuccess: () => void; onFrozen?: () => void; token: string | null; balance: number; minWithdrawal: number }) {
  const [step, setStep]               = useState<WithdrawStep>("method");
  const [selectedMethod, setSelectedMethod] = useState<WithdrawMethod | null>(null);
  const [amount, setAmount]           = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [note, setNote]               = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [err, setErr]                 = useState("");
  const { showToast } = useToast();
  const doneAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (step === "done") {
      doneAnim.setValue(0);
      Animated.timing(doneAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    }
  }, [step]);

  const WITHDRAW_METHODS: { id: WithdrawMethod; label: string; placeholder: string }[] = [
    { id: "jazzcash",  label: "JazzCash",  placeholder: "03XX-XXXXXXX" },
    { id: "easypaisa", label: "EasyPaisa", placeholder: "03XX-XXXXXXX" },
    { id: "bank",      label: "Bank Transfer", placeholder: "PKXX XXXX XXXX XXXX XXXX (IBAN)" },
  ];

  const handleContinue = () => {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) { setErr("Please enter a valid amount"); return; }
    if (amt < minWithdrawal)               { setErr(`Minimum withdrawal amount is Rs. ${minWithdrawal.toLocaleString()}`); return; }
    if (amt > balance)                      { setErr(`Insufficient balance. Available: Rs. ${balance.toLocaleString()}`); return; }
    if (!accountNumber.trim())              { setErr("Account number is required"); return; }
    setErr("");
    setStep("confirm");
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const amt = parseFloat(amount);
    setSubmitting(true); setErr("");
    try {
      const res = await fetch(`${API}/wallet/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ amount: amt, paymentMethod: selectedMethod, accountNumber: accountNumber.trim(), note: note.trim() || undefined }),
      });
      const data = unwrapApiResponse(await res.json());
      if (!res.ok) {
        if (data.error === "wallet_frozen") { onFrozen?.(); onClose(); return; }
        setErr(data.error || data.message || "Request failed");
        setSubmitting(false); return;
      }
      setStep("done");
      onSuccess();
    } catch {
      setErr("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={0.7} style={ws.overlay} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
        <TouchableOpacity activeOpacity={0.7} style={[ws.sheet, { maxHeight: "90%" }]} onPress={e => e.stopPropagation()}>
          <View style={ws.handle} />
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {step === "done" && (
              <Animated.View style={{ alignItems: "center", paddingVertical: 20, opacity: doneAnim, transform: [{ translateY: doneAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.redSoft, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <Ionicons name="arrow-up-circle" size={40} color={C.danger} />
                </View>
                <Text style={{ ...Typ.title, color: C.text, marginBottom: 8 }}>Request Submitted!</Text>
                <Text style={{ ...Typ.body, color: C.textMuted, textAlign: "center", lineHeight: 20, maxWidth: 280 }}>Your withdrawal will be processed within 1-2 business days.</Text>
                <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, width: "100%", marginTop: 20, gap: 10, borderWidth: 1, borderColor: C.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Method</Text>
                    <Text style={{ ...Typ.bodyMedium, fontSize: 13, color: C.text }}>{WITHDRAW_METHODS.find(m => m.id === selectedMethod)?.label}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Account</Text>
                    <Text style={{ ...Typ.bodyMedium, fontSize: 13, color: C.text }}>{accountNumber}</Text>
                  </View>
                  <View style={{ height: 1, backgroundColor: C.border }} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Amount</Text>
                    <Text style={{ ...Typ.h2, color: C.danger }}>Rs. {parseFloat(amount).toLocaleString()}</Text>
                  </View>
                </View>
                <TouchableOpacity activeOpacity={0.7} onPress={onClose} style={[ws.actionBtn, { backgroundColor: C.primary, marginTop: 16, width: "100%" }]} accessibilityRole="button" accessibilityLabel="Done">
                  <Text style={ws.actionBtnTxt}>Done</Text>
                </TouchableOpacity>
              </Animated.View>
            )}

            {step === "method" && (
              <View>
                <Text style={ws.sheetTitle}>Withdraw Money</Text>
                <Text style={{ ...Typ.body, color: C.textMuted, marginBottom: 18 }}>Choose your withdrawal method</Text>
                <View style={{ gap: 10 }}>
                  {WITHDRAW_METHODS.map(m => (
                    <TouchableOpacity activeOpacity={0.7} key={m.id} onPress={() => { setSelectedMethod(m.id); setErr(""); setStep("details"); }} style={{ flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1.5, borderColor: C.border, borderRadius: 16, padding: 16, backgroundColor: C.surface }} accessibilityRole="button" accessibilityLabel={`Withdraw via ${m.label}`}>
                      <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                        <MethodIcon id={m.id} size={26} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...Typ.button, fontFamily: Font.bold, color: C.text }}>{m.label}</Text>
                        <Text style={{ ...Typ.caption, color: C.textMuted, marginTop: 2 }}>Withdraw to your {m.label} account</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {step === "details" && selectedMethod && (
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 18 }}>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => setStep("method")} style={{ marginRight: 10, padding: 4 }} accessibilityRole="button" accessibilityLabel="Go back to method selection">
                    <Ionicons name="arrow-back" size={20} color={C.text} />
                  </TouchableOpacity>
                  <Text style={[ws.sheetTitle, { marginBottom: 0 }]}>{WITHDRAW_METHODS.find(m => m.id === selectedMethod)?.label} Withdrawal</Text>
                </View>

                <Text style={ws.sheetLbl}>Amount (PKR) *</Text>
                <View style={ws.amtWrap}>
                  <Text style={ws.rupee}>Rs.</Text>
                  <TextInput
                    style={ws.amtInput}
                    value={amount}
                    onChangeText={t => { setAmount(t.replace(/[^0-9]/g, "")); setErr(""); }}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={C.textMuted}
                  />
                </View>
                <View style={ws.quickRow}>
                  {QUICK_AMOUNTS.map(a => (
                    <TouchableOpacity activeOpacity={0.7} key={a} onPress={() => setAmount(a.toString())} style={[ws.quickBtn, amount === a.toString() && ws.quickBtnActive]} accessibilityRole="button" accessibilityLabel={`Rs. ${a.toLocaleString()}`} accessibilityState={{ selected: amount === a.toString() }}>
                      <Text style={[ws.quickTxt, amount === a.toString() && ws.quickTxtActive]}>Rs. {a.toLocaleString()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14, backgroundColor: C.amberSoft, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.amberBorder }}>
                  <Ionicons name="wallet-outline" size={14} color={C.amber} />
                  <Text style={{ ...Typ.caption, color: C.amberDark, flex: 1 }}>Available: Rs. {balance.toLocaleString()}</Text>
                </View>

                <Text style={ws.sheetLbl}>Your {WITHDRAW_METHODS.find(m => m.id === selectedMethod)?.label} Account *</Text>
                <View style={[ws.inputWrap, { paddingHorizontal: 14, paddingVertical: 10 }]}>
                  <TextInput
                    value={accountNumber}
                    onChangeText={v => { setAccountNumber(v); setErr(""); }}
                    placeholder={WITHDRAW_METHODS.find(m => m.id === selectedMethod)?.placeholder}
                    placeholderTextColor={C.textMuted}
                    style={[ws.sendInput, { paddingVertical: 0 }]}
                    autoCapitalize="characters"
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
                    maxLength={500}
                  />
                </View>

                {err ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, backgroundColor: C.redBg, padding: 10, borderRadius: 10 }}>
                    <Ionicons name="alert-circle-outline" size={14} color={C.danger} />
                    <Text style={{ ...Typ.caption, color: C.danger, flex: 1 }}>{err}</Text>
                  </View>
                ) : null}

                <TouchableOpacity activeOpacity={0.7} onPress={handleContinue} style={[ws.actionBtn, { backgroundColor: C.danger }]} accessibilityRole="button" accessibilityLabel="Review withdrawal details">
                  <Ionicons name="arrow-forward" size={18} color={C.textInverse} />
                  <Text style={ws.actionBtnTxt}>Review</Text>
                </TouchableOpacity>
              </View>
            )}

            {step === "confirm" && selectedMethod && (
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 18 }}>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => { setStep("details"); setErr(""); }} style={{ marginRight: 10, padding: 4 }} accessibilityRole="button" accessibilityLabel="Go back to edit details">
                    <Ionicons name="arrow-back" size={20} color={C.text} />
                  </TouchableOpacity>
                  <Text style={[ws.sheetTitle, { marginBottom: 0 }]}>Confirm Withdrawal</Text>
                </View>

                <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, gap: 10, marginBottom: 14, borderWidth: 1, borderColor: C.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Method</Text>
                    <Text style={{ ...Typ.bodyMedium, fontSize: 13, color: C.text }}>{WITHDRAW_METHODS.find(m => m.id === selectedMethod)?.label}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Account</Text>
                    <Text style={{ ...Typ.bodyMedium, fontSize: 13, color: C.text }}>{accountNumber.trim()}</Text>
                  </View>
                  {note.trim() ? (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Note</Text>
                      <Text style={{ ...Typ.bodyMedium, fontSize: 13, color: C.text }}>{note.trim()}</Text>
                    </View>
                  ) : null}
                  <View style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ ...Typ.buttonSmall, color: C.textMuted }}>Amount</Text>
                    <Text style={{ ...Typ.h2, fontSize: 24, color: C.danger }}>Rs. {parseFloat(amount).toLocaleString()}</Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.amberSoft, borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: C.amberBorder }}>
                  <Ionicons name="alert-circle-outline" size={16} color={C.amber} />
                  <Text style={{ ...Typ.caption, color: C.amberDark, flex: 1 }}>This amount will be deducted from your wallet immediately and processed within 1-2 business days.</Text>
                </View>

                {err ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, backgroundColor: C.redBg, padding: 10, borderRadius: 10 }}>
                    <Ionicons name="alert-circle-outline" size={14} color={C.danger} />
                    <Text style={{ ...Typ.caption, color: C.danger, flex: 1 }}>{err}</Text>
                  </View>
                ) : null}

                <TouchableOpacity activeOpacity={0.7} onPress={handleSubmit} disabled={submitting} style={[ws.actionBtn, { backgroundColor: C.danger }, submitting && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel="Confirm and submit withdrawal" accessibilityState={{ disabled: submitting }}>
                  {submitting ? <ActivityIndicator color={C.textInverse} /> : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color={C.textInverse} />
                      <Text style={ws.actionBtnTxt}>Confirm & Submit</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </TouchableOpacity>
        </KeyboardAvoidingView>
      </TouchableOpacity>
    </Modal>
  );
}

const SUBMITTED_TX_KEY = "wallet_submitted_tx_ids";

function DepositModal({ onClose, onSuccess, onFrozen, token, minTopup, maxTopup }: { onClose: () => void; onSuccess: () => void; onFrozen?: () => void; token: string | null; minTopup: number; maxTopup: number }) {
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
  const [submittedTxIds, setSubmittedTxIds] = useState<Set<string>>(new Set());
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [err, setErr]                 = useState("");
  const { showToast } = useToast();

  // Load previously submitted TxIDs from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(SUBMITTED_TX_KEY)
      .then(raw => {
        if (raw) {
          const ids: string[] = JSON.parse(raw);
          setSubmittedTxIds(new Set(ids));
        }
      })
      .catch((err) => { if (__DEV__) console.warn("[Wallet] Failed to load submitted tx ids:", err instanceof Error ? err.message : String(err)); });
  }, []);

  useEffect(() => {
    fetch(`${API}/payments/methods`)
      .then(r => r.json())
      .then(unwrapApiResponse)
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

  const goToConfirm = async () => {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) { setErr("Please enter a valid amount"); return; }
    if (amt < minTopup) { setErr(`Minimum deposit amount is Rs. ${minTopup.toLocaleString()}`); return; }
    if (amt > maxTopup) { setErr(`Maximum deposit amount is Rs. ${maxTopup.toLocaleString()}`); return; }
    if (!txId.trim()) { setErr("Transaction ID is required"); return; }
    setErr("");
    const { randomUUID } = await import("expo-crypto");
    setIdempotencyKey(randomUUID());
    setStep("confirm");
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!selectedMethod) { setErr("No payment method selected"); return; }
    const normalizedTxId = txId.trim();
    if (submittedTxIds.has(normalizedTxId)) {
      setErr("This transaction ID has already been submitted. Please check your wallet history.");
      return;
    }
    if (!idempotencyKey) return;
    if (!selectedMethod) {
      setErr("Please select a payment method before submitting.");
      return;
    }
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
          paymentMethod: selectedMethod.id,
          transactionId: normalizedTxId,
          idempotencyKey,
          accountNumber: senderAcNo.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = unwrapApiResponse(await res.json());
      if (!res.ok) {
        if (data.error === "wallet_frozen") { onFrozen?.(); }
        setErr(data.error === "wallet_frozen" ? data.message : (data.error || data.message || "Request failed"));
        setSubmitting(false); return;
      }
      const newSet = new Set(submittedTxIds).add(normalizedTxId);
      setSubmittedTxIds(newSet);
      // Persist to AsyncStorage so dedup survives app restarts
      AsyncStorage.getItem(SUBMITTED_TX_KEY)
        .then(raw => {
          const existing: string[] = raw ? JSON.parse(raw) : [];
          const merged = Array.from(new Set([...existing, normalizedTxId])).slice(-100);
          return AsyncStorage.setItem(SUBMITTED_TX_KEY, JSON.stringify(merged));
        })
        .catch((err) => {
          console.warn("[Wallet] Failed to persist submitted tx id (in-memory dedup still active):", err instanceof Error ? err.message : String(err));
        });
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
      <TouchableOpacity activeOpacity={0.7} style={ws.overlay} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
        <TouchableOpacity activeOpacity={0.7} style={[ws.sheet, { maxHeight: "90%" }]} onPress={e => e.stopPropagation()}>
          <View style={ws.handle} />

          {step !== "done" && stepIdx >= 0 && (
            <View style={{ marginBottom: 18 }}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {STEPS.map((_, i) => (
                  <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= stepIdx ? C.primary : C.border }} />
                ))}
              </View>
              <Text style={{ ...Typ.small, color: C.textMuted, textAlign: "right", marginTop: 6 }}>Step {stepIdx + 1} of {STEPS.length}</Text>
            </View>
          )}

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {step === "done" && (
              <View style={{ alignItems: "center", paddingVertical: 20 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.emeraldSoft, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <Ionicons name="checkmark-circle" size={40} color={C.success} />
                </View>
                <Text style={{ ...Typ.title, color: C.text, marginBottom: 8 }}>Request Submitted!</Text>
                <Text style={{ ...Typ.body, color: C.textMuted, textAlign: "center", lineHeight: 20, maxWidth: 280 }}>Your wallet will be credited within 1-2 hours after verification.</Text>
                <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, width: "100%", marginTop: 20, gap: 10, borderWidth: 1, borderColor: C.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Method</Text>
                    <Text style={{ ...Typ.bodyMedium, fontSize: 13, color: C.text }}>{selectedMethod?.label}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Transaction ID</Text>
                    <Text style={{ ...Typ.buttonSmall, fontFamily: Font.bold, color: C.text }}>{txId}</Text>
                  </View>
                  <View style={{ height: 1, backgroundColor: C.border }} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Amount</Text>
                    <Text style={{ ...Typ.h2, color: C.success }}>Rs. {parseFloat(amount).toLocaleString()}</Text>
                  </View>
                </View>
                <TouchableOpacity activeOpacity={0.7} onPress={onClose} style={[ws.actionBtn, { backgroundColor: C.primary, marginTop: 16, width: "100%" }]} accessibilityRole="button" accessibilityLabel="Done">
                  <Text style={ws.actionBtnTxt}>Done</Text>
                </TouchableOpacity>
              </View>
            )}

            {step === "method" && (
              <View>
                <Text style={ws.sheetTitle}>Add Money</Text>
                <Text style={{ ...Typ.body, color: C.textMuted, marginBottom: 18 }}>Choose your deposit method</Text>
                {loadingMethods ? (
                  <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} />
                ) : methodsError ? (
                  <View style={{ backgroundColor: C.redBg, borderRadius: 16, padding: 24, alignItems: "center", gap: 10, borderWidth: 1, borderColor: C.redSoft }}>
                    <Ionicons name="alert-circle-outline" size={28} color={C.danger} />
                    <Text style={{ ...Typ.button, fontFamily: Font.bold, color: C.text }}>Deposit Not Available</Text>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted, textAlign: "center" }}>JazzCash, EasyPaisa, and Bank Transfer are not yet enabled. Please contact support to add funds.</Text>
                    <TouchableOpacity activeOpacity={0.7} onPress={() => {
                      setMethodsError(false);
                      setLoadingMethods(true);
                      fetch(`${API}/payments/methods`)
                        .then(r => r.json())
                        .then(unwrapApiResponse)
                        .then((data: any) => {
                          const depositable: PayMethod[] = (data.methods || []).filter((m: any) => ["jazzcash", "easypaisa", "bank"].includes(m.id));
                          if (depositable.length === 0) setMethodsError(true);
                          else setMethods(depositable);
                        })
                        .catch(() => setMethodsError(true))
                        .finally(() => setLoadingMethods(false));
                    }} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 }} accessibilityRole="button" accessibilityLabel="Try again to load payment methods">
                      <Ionicons name="refresh-outline" size={15} color={C.textInverse} />
                      <Text style={{ ...Typ.buttonSmall, color: C.textInverse }}>Try Again</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    {methods.map(m => (
                      <TouchableOpacity activeOpacity={0.7} key={m.id} onPress={() => selectMethod(m)} style={{ flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1.5, borderColor: C.border, borderRadius: 16, padding: 16, backgroundColor: C.surface }} accessibilityRole="button" accessibilityLabel={`Deposit via ${m.label}`}>
                        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                          <MethodIcon id={m.id} size={26} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ ...Typ.button, fontFamily: Font.bold, color: C.text }}>{m.label}</Text>
                          <Text style={{ ...Typ.caption, color: C.textMuted, marginTop: 2 }}>{m.description || `Deposit via ${m.label}`}</Text>
                          {m.manualNumber && <Text style={{ ...Typ.captionMedium, fontFamily: Font.semiBold, color: C.primary, marginTop: 3 }}>{m.manualNumber}</Text>}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {step === "details" && selectedMethod && (
              <View>
                <Text style={ws.sheetTitle}>{selectedMethod.label}</Text>
                <Text style={{ ...Typ.body, color: C.textMuted, marginBottom: 18 }}>Send payment to the account below</Text>

                <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 4, marginBottom: 14, borderWidth: 1, borderColor: C.border }}>
                  {selectedMethod.manualNumber && (
                    <TouchableOpacity activeOpacity={0.7} onPress={() => copyToClipboard(selectedMethod.manualNumber!)} style={{ flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: C.border }} accessibilityRole="button" accessibilityLabel={`Copy account number ${selectedMethod.manualNumber}`}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...Typ.small, color: C.textMuted }}>Account Number</Text>
                        <Text style={{ ...Typ.button, fontFamily: Font.bold, color: C.text, marginTop: 2 }}>{selectedMethod.manualNumber}</Text>
                      </View>
                      <Ionicons name="copy-outline" size={18} color={C.primary} />
                    </TouchableOpacity>
                  )}
                  {selectedMethod.manualName && (
                    <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
                      <Text style={{ ...Typ.small, color: C.textMuted }}>Account Title</Text>
                      <Text style={{ ...Typ.bodyMedium, color: C.text, marginTop: 2 }}>{selectedMethod.manualName}</Text>
                    </View>
                  )}
                  {selectedMethod.iban && (
                    <TouchableOpacity activeOpacity={0.7} onPress={() => copyToClipboard(selectedMethod.iban!)} style={{ flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: C.border }} accessibilityRole="button" accessibilityLabel="Copy IBAN">
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...Typ.small, color: C.textMuted }}>IBAN</Text>
                        <Text style={{ ...Typ.captionMedium, color: C.text, marginTop: 2 }}>{selectedMethod.iban}</Text>
                      </View>
                      <Ionicons name="copy-outline" size={18} color={C.primary} />
                    </TouchableOpacity>
                  )}
                  {selectedMethod.bankName && (
                    <View style={{ padding: 14, borderBottomWidth: selectedMethod.manualInstructions ? 1 : 0, borderBottomColor: C.border }}>
                      <Text style={{ ...Typ.small, color: C.textMuted }}>Bank</Text>
                      <Text style={{ ...Typ.bodyMedium, color: C.text, marginTop: 2 }}>{selectedMethod.bankName}</Text>
                    </View>
                  )}
                  {selectedMethod.manualInstructions && (
                    <View style={{ padding: 14 }}>
                      <Text style={{ ...Typ.caption, color: C.textSecondary }}>{selectedMethod.manualInstructions}</Text>
                    </View>
                  )}
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.blueSoft, borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: C.brandBlueSoft }}>
                  <Ionicons name="information-circle-outline" size={16} color={C.primary} />
                  <Text style={{ ...Typ.caption, color: C.textSecondary, flex: 1 }}>After payment, enter the Transaction ID in the next step</Text>
                </View>

                <View style={{ flexDirection: "row", gap: 12 }}>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => setStep("method")} style={[ws.actionBtn, { flex: 1, backgroundColor: C.surfaceSecondary }]} accessibilityRole="button" accessibilityLabel="Back">
                    <Text style={[ws.actionBtnTxt, { color: C.text }]}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.7} onPress={goToAmount} style={[ws.actionBtn, { flex: 2, backgroundColor: C.primary }]} accessibilityRole="button" accessibilityLabel="Payment done, continue">
                    <Ionicons name="checkmark-circle-outline" size={18} color={C.textInverse} />
                    <Text style={ws.actionBtnTxt}>Payment Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {step === "amount" && selectedMethod && (
              <View>
                <Text style={ws.sheetTitle}>Transaction Details</Text>
                <Text style={{ ...Typ.body, color: C.textMuted, marginBottom: 18 }}>Enter your payment details</Text>

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
                    <TouchableOpacity activeOpacity={0.7} key={a} onPress={() => setAmount(a.toString())} style={[ws.quickBtn, amount === a.toString() && ws.quickBtnActive]} accessibilityRole="button" accessibilityLabel={`Rs. ${a.toLocaleString()}`} accessibilityState={{ selected: amount === a.toString() }}>
                      <Text style={[ws.quickTxt, amount === a.toString() && ws.quickTxtActive]}>Rs. {a.toLocaleString()}</Text>
                    </TouchableOpacity>
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
                    maxLength={100}
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
                    maxLength={50}
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
                    maxLength={500}
                  />
                </View>

                {err ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, backgroundColor: C.redBg, padding: 10, borderRadius: 10 }}>
                    <Ionicons name="alert-circle-outline" size={14} color={C.danger} />
                    <Text style={{ ...Typ.caption, color: C.danger, flex: 1 }}>{err}</Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => setStep("details")} style={[ws.actionBtn, { flex: 1, backgroundColor: C.surfaceSecondary }]} accessibilityRole="button" accessibilityLabel="Back">
                    <Text style={[ws.actionBtnTxt, { color: C.text }]}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.7} onPress={goToConfirm} style={[ws.actionBtn, { flex: 2, backgroundColor: C.primary }]} accessibilityRole="button" accessibilityLabel="Review deposit">
                    <Text style={ws.actionBtnTxt}>Review</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {step === "confirm" && selectedMethod && (
              <View>
                <Text style={ws.sheetTitle}>Confirm Request</Text>
                <Text style={{ ...Typ.body, color: C.textMuted, marginBottom: 18 }}>Review before submitting</Text>

                <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 16, padding: 16, gap: 10, marginBottom: 14, borderWidth: 1, borderColor: C.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Method</Text>
                    <Text style={{ ...Typ.bodyMedium, fontSize: 13, color: C.text }}>{selectedMethod.label}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Transaction ID</Text>
                    <Text style={{ ...Typ.buttonSmall, fontFamily: Font.bold, color: C.text, fontVariant: ["tabular-nums"] }}>{txId}</Text>
                  </View>
                  {senderAcNo ? (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Sender</Text>
                      <Text style={{ ...Typ.bodyMedium, fontSize: 13, color: C.text }}>{senderAcNo}</Text>
                    </View>
                  ) : null}
                  {note ? (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Note</Text>
                      <Text style={{ ...Typ.bodyMedium, fontSize: 13, color: C.text }}>{note}</Text>
                    </View>
                  ) : null}
                  <View style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }} />
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ ...Typ.buttonSmall, color: C.textMuted }}>Amount</Text>
                    <Text style={{ ...Typ.h2, fontSize: 24, color: C.success }}>Rs. {parseFloat(amount).toLocaleString()}</Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.amberSoft, borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: C.amberBorder }}>
                  <Ionicons name="alert-circle-outline" size={16} color={C.amber} />
                  <Text style={{ ...Typ.caption, color: C.amberDark, flex: 1 }}>An incorrect TxID may cause rejection. Enter the real transaction ID.</Text>
                </View>

                {err ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, backgroundColor: C.redBg, padding: 10, borderRadius: 10 }}>
                    <Ionicons name="alert-circle-outline" size={14} color={C.danger} />
                    <Text style={{ ...Typ.caption, color: C.danger, flex: 1 }}>{err}</Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: "row", gap: 12 }}>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => { setStep("amount"); setErr(""); }} style={[ws.actionBtn, { flex: 1, backgroundColor: C.surfaceSecondary }]} accessibilityRole="button" accessibilityLabel="Edit deposit details">
                    <Text style={[ws.actionBtnTxt, { color: C.text }]}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.7} onPress={handleSubmit} disabled={submitting} style={[ws.actionBtn, { flex: 2, backgroundColor: C.primary, opacity: submitting ? 0.6 : 1 }]} accessibilityRole="button" accessibilityLabel="Submit deposit request" accessibilityState={{ disabled: submitting }}>
                    {submitting ? (
                      <ActivityIndicator color={C.textInverse} />
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle-outline" size={18} color={C.textInverse} />
                        <Text style={ws.actionBtnTxt}>Submit Request</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

          </ScrollView>
        </TouchableOpacity>
        </KeyboardAvoidingView>
      </TouchableOpacity>
    </Modal>
  );
}

function WalletScreenInner() {
  const insets = useSafeAreaInsets();
  const { user, updateUser, token, socket } = useAuth();
  const { showToast } = useToast();
  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const TAB_H  = Platform.OS === "web" ? 84 : 49;

  const [showDeposit,  setShowDeposit]  = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showSend,     setShowSend]     = useState(false);
  const [showQR,       setShowQR]       = useState(false);
  const [lastRefreshed,  setLastRefreshed]  = useState<Date | null>(null);
  const [txFilter,    setTxFilter]    = useState<TxFilter>("all");

  const [sendPhone,   setSendPhone]   = useState("");
  const [sendAmount,  setSendAmount]  = useState("");
  const [sendNote,    setSendNote]    = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const [sendStep,    setSendStep]    = useState<"input" | "confirm">("input");
  const [sendPhoneError, setSendPhoneError] = useState("");
  const [sendReceiverName, setSendReceiverName] = useState("");
  const [sendPhoneNetErr, setSendPhoneNetErr] = useState(false);
  const [sendIdempotencyKey, setSendIdempotencyKey] = useState("");

  const [pendingTopups,  setPendingTopups]  = useState<{ count: number; total: number }>({ count: 0, total: 0 });

  const { config: platformConfig } = usePlatformConfig();
  const appName     = platformConfig.platform.appName;
  const minTransfer = platformConfig.customer.minTransfer;
  const p2pEnabled  = platformConfig.customer.p2pEnabled;

  const [walletFrozen, setWalletFrozen] = useState(false);
  const [socketBalance, setSocketBalance] = useState<number | null>(null);
  const prevUserBalanceRef = useRef<number | undefined>(user?.walletBalance);

  const { data, isLoading, isError: walletError, error: walletErrorObj, refetch } = useGetWallet(
    { userId: user?.id || "" },
    { query: { enabled: !!user?.id, retry: 2, retryDelay: (attempt: number) => Math.floor(1500 * Math.pow(1.5, attempt - 1)) } }
  );

  useEffect(() => {
    const current = user?.walletBalance;
    if (current !== undefined && current !== prevUserBalanceRef.current) {
      prevUserBalanceRef.current = current;
      if (data?.balance !== undefined && current !== data.balance) {
        setSocketBalance(current);
      }
    }
  }, [user?.walletBalance, data?.balance]);

  useEffect(() => {
    if (walletErrorObj) {
      const status =
        (walletErrorObj instanceof Error && "status" in walletErrorObj && typeof (walletErrorObj as Error & { status?: unknown }).status === "number")
          ? (walletErrorObj as Error & { status: number }).status
          : undefined;
      if (status === 403) {
        setWalletFrozen(true);
      }
    } else if (data) {
      setWalletFrozen(false);
    }
  }, [walletErrorObj, data]);

  useEffect(() => {
    if (token) {
      fetch(`${API}/wallet`, { headers: { Authorization: `Bearer ${token}` } })
        .then(async r => {
          if (r.status === 403) {
            const d = unwrapApiResponse(await r.json().catch(() => ({})));
            if (d.error === "wallet_frozen") setWalletFrozen(true);
          } else {
            setWalletFrozen(false);
          }
        })
        .catch((err) => { if (__DEV__) console.warn("[Wallet] Frozen-status check failed:", err instanceof Error ? err.message : String(err)); });
    }
  }, [token]);

  useEffect(() => {
    if (!socket) return;
    const handleFrozen   = () => setWalletFrozen(true);
    const handleUnfrozen = () => setWalletFrozen(false);
    socket.on("wallet:frozen", handleFrozen);
    socket.on("wallet:unfrozen", handleUnfrozen);
    return () => {
      socket.off("wallet:frozen", handleFrozen);
      socket.off("wallet:unfrozen", handleUnfrozen);
    };
  }, [socket]);

  const onRefresh = useCallback(async () => {
    setSocketBalance(null);
    if (token) {
      try {
        const r = await fetch(`${API}/wallet`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 403) {
          const d = unwrapApiResponse(await r.json().catch(() => ({})));
          if (d.error === "wallet_frozen") { setWalletFrozen(true); return; }
        } else { setWalletFrozen(false); }
      } catch (err) {
        if (__DEV__) console.warn("[Wallet] Status check failed:", err instanceof Error ? err.message : String(err));
      }
    }
    const res = await refetch();
    if (res.data?.balance !== undefined) {
      updateUser({ walletBalance: res.data.balance });
    }
    setLastRefreshed(new Date());
  }, [refetch, updateUser, token, socket]);

  useEffect(() => {
    if (token) {
      fetch(`${API}/wallet/pending-topups`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(unwrapApiResponse)
        .then(d => setPendingTopups({ count: d.count || 0, total: d.total || 0 }))
        .catch((err) => { if (__DEV__) console.warn("[Wallet] Pending topups fetch failed:", err instanceof Error ? err.message : String(err)); });
    }
  }, [token]);

  const handleDepositSuccess = () => {
    qc.invalidateQueries({ queryKey: ["getWallet"] });
    showToast("Deposit request submitted! It will be approved within 1-2 hours.", "success");
  };

  const openSendFromQR = (phone: string) => {
    setShowQR(false);
    setSendPhone(phone);
    setShowSend(true);
  };

  const resetSendState = () => {
    setSendPhone(""); setSendAmount(""); setSendNote("");
    setSendStep("input"); setSendPhoneError(""); setSendReceiverName(""); setSendLoading(false); setSendPhoneNetErr(false); setSendIdempotencyKey("");
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
    setSendPhoneNetErr(false);
    if (!validateSendPhone(sendPhone)) return;
    const num = parseFloat(sendAmount);
    if (!sendAmount || isNaN(num) || num <= 0) { showToast("Please enter a valid amount", "error"); return; }
    const minXfer = typeof minTransfer === "number" && isFinite(minTransfer) ? minTransfer : 100;
    if (num < minXfer) { showToast(`Minimum transfer amount is Rs. ${minXfer.toLocaleString()}`, "error"); return; }
    if (num > balance) { showToast("Insufficient wallet balance", "error"); return; }
    setSendLoading(true);
    try {
      const res = await fetch(`${API}/wallet/resolve-phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ phone: sendPhone.trim() }),
      });
      const data = unwrapApiResponse(await res.json());
      if (!res.ok || !data.found) {
        showToast("No AJKMart account found with this phone number.", "error");
        setSendLoading(false);
        return;
      }
      setSendReceiverName(data.name || "");
    } catch (err) {
      if (__DEV__) console.warn("[Wallet] Receiver lookup failed:", err instanceof Error ? err.message : String(err));
      setSendPhoneNetErr(true);
      setSendLoading(false);
      return;
    }
    setSendLoading(false);
    setSendIdempotencyKey(`${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    setSendStep("confirm");
  };

  const handleSendConfirm = async () => {
    if (sendLoading) return;
    const num = parseFloat(sendAmount);
    setSendLoading(true);
    try {
      const res = await fetch(`${API}/wallet/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ receiverPhone: sendPhone.trim(), amount: num, note: sendNote || null, idempotencyKey: sendIdempotencyKey || undefined }),
      });
      const data = unwrapApiResponse(await res.json());
      if (!res.ok) {
        if (data.error === "wallet_frozen") { setWalletFrozen(true); setShowSend(false); setSendLoading(false); return; }
        showToast(data.error || "Transfer failed", "error");
        setSendLoading(false); return;
      }
      updateUser({ walletBalance: data.newBalance });
      qc.invalidateQueries({ queryKey: ["getWallet"] });
      closeSendModal();
      showToast(`Rs. ${num.toLocaleString()} sent to ${data.receiverName || sendPhone}!`, "success");
    } catch {
      showToast("Network error. Please try again.", "error");
      setSendLoading(false);
    }
  };

  const balance      = socketBalance ?? data?.balance ?? user?.walletBalance ?? 0;
  const transactions = data?.transactions ?? [];
  const DEBIT_TYPES  = new Set(["debit", "withdrawal", "transfer", "ride", "order", "mart", "food", "pharmacy", "parcel", "insurance"]);
  const CREDIT_TYPES = new Set(["credit", "refund", "cashback", "referral", "bonus", "simulated_topup"]);
  const isDebitType  = (t: any) => DEBIT_TYPES.has(t.type);
  const isCreditType = (t: any) => {
    if (t.type === "deposit") return t.status === "approved";
    return CREDIT_TYPES.has(t.type);
  };
  const filtered     = txFilter === "all" ? transactions : txFilter === "debit" ? transactions.filter(isDebitType) : transactions.filter(isCreditType);
  const totalIn      = transactions.filter(isCreditType).reduce((s, t) => s + Number(t.amount), 0);
  const totalOut     = transactions.filter(isDebitType).reduce((s, t) => s + Number(t.amount), 0);

  if (!user?.id) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingTop: topPad }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.blueSoft, alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
          <Ionicons name="lock-closed-outline" size={32} color={C.primary} />
        </View>
        <Text style={{ fontFamily: Font.bold, fontSize: 20, color: C.text, textAlign: "center", marginBottom: 8 }}>Sign in to continue</Text>
        <Text style={{ fontFamily: Font.regular, fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 22, marginBottom: 28 }}>
          Sign in to access your wallet, top up, send money, and manage transactions.
        </Text>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={async () => {
            await AsyncStorage.setItem("@ajkmart_auth_return_to", "/(tabs)/wallet");
            router.push("/auth");
          }}
          style={{ backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Sign In or Register"
        >
          <Ionicons name="person-circle-outline" size={18} color="#fff" />
          <Text style={{ fontFamily: Font.bold, fontSize: 15, color: "#fff" }}>Sign In / Register</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.7} onPress={() => router.back()} style={{ paddingVertical: 12 }} accessibilityRole="button">
          <Text style={{ fontFamily: Font.semiBold, fontSize: 14, color: C.textMuted }}>Continue Browsing</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (user.role !== "customer") {
    return (
      <View style={{ flex: 1, backgroundColor: C.background, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.amberSoft, alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
          <Ionicons name="alert-circle-outline" size={36} color={C.amber} />
        </View>
        <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: C.text, textAlign: "center", marginBottom: 8 }}>Customer Account Required</Text>
        <Text style={{ fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 22 }}>
          {`You're signed in as a ${user.role} account. The wallet is only available for customer accounts.`}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SmartRefresh
        onRefresh={onRefresh}
        lastUpdated={lastRefreshed}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient colors={[C.primaryDark, C.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingTop: topPad + 20, paddingHorizontal: 20, paddingBottom: 28 }}>
          {walletError && !data && !walletFrozen && (
            <TouchableOpacity activeOpacity={0.7} onPress={() => refetch()} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.redSoft, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: C.redMist }} accessibilityRole="button" accessibilityLabel="No network connection, tap to retry">
              <Ionicons name="cloud-offline-outline" size={20} color={C.red} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...Typ.body, fontFamily: Font.bold, color: C.redDeep }}>No network connection</Text>
                <Text style={{ ...Typ.caption, color: C.redDeepest, marginTop: 2 }}>Showing last known balance. Tap to retry.</Text>
              </View>
              <Ionicons name="refresh-outline" size={16} color={C.red} />
            </TouchableOpacity>
          )}

          {walletFrozen ? (
            <View style={{ alignItems: "center", paddingVertical: 24, gap: 14 }}>
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.amberSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="lock-closed" size={36} color={C.amber} />
              </View>
              <Text style={{ ...Typ.title, color: C.amberDark }}>Wallet Frozen</Text>
              <Text style={{ ...Typ.body, color: C.amberDark, textAlign: "center", lineHeight: 20, maxWidth: 280 }}>
                Your wallet has been temporarily frozen. Please contact support to resolve this issue.
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.amberSoft, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.amberBorder, width: "100%", marginTop: 4 }}>
                <Ionicons name="headset-outline" size={16} color={C.amber} />
                <Text style={{ ...Typ.captionMedium, color: C.amberDark, flex: 1 }}>Contact support to unfreeze your wallet</Text>
              </View>
            </View>
          ) : (
            <>
              <Text style={{ ...Typ.body, fontSize: 13, color: "rgba(255,255,255,0.75)", marginBottom: 4 }}>{appName} {T("wallet")}</Text>
              {isLoading && !data ? (
                <View style={{ marginBottom: 4 }}>
                  <View style={{ height: 44, width: 180, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.2)", opacity: 0.7 }} />
                </View>
              ) : (
                <Text style={{ fontFamily: Font.bold, fontSize: 40, color: "#FFFFFF", marginBottom: 4 }}>
                  {`Rs. ${balance.toLocaleString()}`}
                </Text>
              )}
              <Text style={{ ...Typ.body, fontSize: 13, color: "rgba(255,255,255,0.75)", marginBottom: 24 }}>{T("availableBalance")}</Text>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity activeOpacity={0.7} onPress={() => setShowDeposit(true)} style={ws.actionCard} accessibilityRole="button" accessibilityLabel={T("topUp")}>
                  <View style={[ws.actionCardIcon, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                    <Ionicons name="add" size={20} color="#FFFFFF" />
                  </View>
                  <Text style={[ws.actionCardTxt, { color: "rgba(255,255,255,0.9)" }]}>{T("topUp")}</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.7} onPress={() => setShowWithdraw(true)} style={ws.actionCard} accessibilityRole="button" accessibilityLabel="Withdraw money">
                  <View style={[ws.actionCardIcon, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                    <Ionicons name="arrow-up-outline" size={18} color="#FFFFFF" />
                  </View>
                  <Text style={[ws.actionCardTxt, { color: "rgba(255,255,255,0.9)" }]}>Withdraw</Text>
                </TouchableOpacity>
                {p2pEnabled && (
                  <TouchableOpacity activeOpacity={0.7} onPress={() => setShowSend(true)} style={ws.actionCard} accessibilityRole="button" accessibilityLabel={T("send")}>
                    <View style={[ws.actionCardIcon, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                      <Ionicons name="send-outline" size={18} color="#FFFFFF" />
                    </View>
                    <Text style={[ws.actionCardTxt, { color: "rgba(255,255,255,0.9)" }]}>{T("send")}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity activeOpacity={0.7} onPress={() => setShowQR(true)} style={ws.actionCard} accessibilityRole="button" accessibilityLabel={T("receive")}>
                  <View style={[ws.actionCardIcon, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                    <Ionicons name="qr-code-outline" size={18} color="#FFFFFF" />
                  </View>
                  <Text style={[ws.actionCardTxt, { color: "rgba(255,255,255,0.9)" }]}>{T("receive")}</Text>
                </TouchableOpacity>
              </View>

              {pendingTopups.count > 0 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.amberSoft, borderRadius: 12, marginTop: 16, padding: 12, borderWidth: 1, borderColor: C.amberBorder }}>
                  <Ionicons name="time-outline" size={14} color={C.amber} />
                  <Text style={{ ...Typ.captionMedium, color: C.amberDark, flex: 1 }}>
                    {pendingTopups.count} pending ({`Rs. ${pendingTopups.total.toLocaleString()}`}) — awaiting approval
                  </Text>
                </View>
              )}
            </>
          )}
        </LinearGradient>

        <View style={{ flexDirection: "row", paddingHorizontal: 20, gap: 10, marginTop: 16 }}>
          <View style={ws.statCard}>
            <View style={[ws.statIcon, { backgroundColor: C.emeraldSoft }]}>
              <Ionicons name="arrow-down-outline" size={16} color={C.success} />
            </View>
            <Text style={ws.statLbl}>{T("moneyIn")}</Text>
            <Text style={[ws.statAmt, { color: C.success }]}>Rs. {totalIn.toLocaleString()}</Text>
          </View>
          <View style={ws.statCard}>
            <View style={[ws.statIcon, { backgroundColor: C.redSoft }]}>
              <Ionicons name="arrow-up-outline" size={16} color={C.danger} />
            </View>
            <Text style={ws.statLbl}>{T("moneyOut")}</Text>
            <Text style={[ws.statAmt, { color: C.danger }]}>Rs. {totalOut.toLocaleString()}</Text>
          </View>
          <View style={ws.statCard}>
            <View style={[ws.statIcon, { backgroundColor: C.brandBlueSoft }]}>
              <Ionicons name="receipt-outline" size={16} color={C.primary} />
            </View>
            <Text style={ws.statLbl}>{T("transactions")}</Text>
            <Text style={[ws.statAmt, { color: C.primary }]}>{transactions.length}</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <Text style={{ ...Typ.price, color: C.text }}>{T("transactionHistory")}</Text>
            {transactions.length > 0 && (
              <View style={{ flexDirection: "row", gap: 6 }}>
                {(["all", "credit", "debit"] as TxFilter[]).map(f => (
                  <TouchableOpacity activeOpacity={0.7} key={f} onPress={() => setTxFilter(f)} style={[ws.filterChip, txFilter === f && ws.filterChipActive]} accessibilityRole="tab" accessibilityLabel={f === "all" ? T("allFilter") : f === "credit" ? T("inFilter") : T("outFilter")} accessibilityState={{ selected: txFilter === f }}>
                    <Text style={[ws.filterTxt, txFilter === f && ws.filterTxtActive]}>
                      {f === "all" ? T("allFilter") : f === "credit" ? T("inFilter") : T("outFilter")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {isLoading && !data ? (
            <View style={{ gap: 12, marginTop: 8 }}>
              {[1,2,3,4].map(i => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: C.border }} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={{ height: 13, width: "70%", borderRadius: 6, backgroundColor: C.border }} />
                    <View style={{ height: 11, width: "45%", borderRadius: 5, backgroundColor: C.slateGray }} />
                  </View>
                  <View style={{ height: 14, width: 64, borderRadius: 6, backgroundColor: C.border }} />
                </View>
              ))}
            </View>
          ) : filtered.length === 0 ? (
            <View style={{ alignItems: "center", gap: 10, paddingVertical: 48 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="receipt-outline" size={26} color={C.textMuted} />
              </View>
              <Text style={{ ...Typ.button, color: C.text }}>{transactions.length === 0 ? T("noTransactionLabel") : T("filterNoResultsLabel")}</Text>
              <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>{transactions.length === 0 ? T("noTransactionSub") : T("changeFilterLabel")}</Text>
              {transactions.length === 0 && (
                <TouchableOpacity activeOpacity={0.7}
                  onPress={() => router.replace("/(tabs)")}
                  style={{ marginTop: 8, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 11 }}
                  accessibilityRole="button"
                  accessibilityLabel="Explore services"
                >
                  <Text style={{ color: C.textInverse, ...Typ.bodySemiBold }}>Explore Services</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View>
              {filtered.map(tx => <TxItem key={tx.id} tx={tx} />)}
            </View>
          )}
        </View>

        <View style={{ height: TAB_H + insets.bottom + 20 }} />
      </SmartRefresh>

      {showDeposit && (
        <DepositModal
          token={token}
          onClose={() => setShowDeposit(false)}
          onSuccess={handleDepositSuccess}
          onFrozen={() => setWalletFrozen(true)}
          minTopup={platformConfig.customer.minTopup}
          maxTopup={platformConfig.customer.maxTopup}
        />
      )}

      {showWithdraw && (
        <WithdrawModal
          token={token}
          balance={balance}
          minWithdrawal={platformConfig.customer.minWithdrawal}
          onClose={() => setShowWithdraw(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["getWallet"] });
            showToast("Withdrawal request submitted! It will be processed within 1-2 business days.", "success");
          }}
          onFrozen={() => setWalletFrozen(true)}
        />
      )}

      <Modal visible={showSend} transparent animationType="slide" onRequestClose={closeSendModal}>
        <TouchableOpacity activeOpacity={0.7} style={ws.overlay} onPress={closeSendModal}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ width: "100%" }}>
          <TouchableOpacity activeOpacity={0.7} style={ws.sheet} onPress={e => e.stopPropagation()}>
            <View style={ws.handle} />

            {sendStep === "input" ? (
              <>
                <Text style={ws.sheetTitle}>Send Money</Text>

                <Text style={ws.sheetLbl}>Receiver's Phone Number</Text>
                <View style={[ws.inputWrap, sendPhoneError ? { borderColor: C.redBright } : {}]}>
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
                {sendPhoneError ? <Text style={{ ...Typ.caption, color: C.redBright, marginTop: 2, marginBottom: 6 }}>{sendPhoneError}</Text> : null}

                <Text style={ws.sheetLbl}>Amount (PKR)</Text>
                <View style={ws.amtWrap}>
                  <Text style={ws.rupee}>Rs.</Text>
                  <TextInput style={ws.amtInput} value={sendAmount} onChangeText={t => setSendAmount(t.replace(/[^0-9]/g, ""))} keyboardType="numeric" placeholder="0" placeholderTextColor={C.textMuted} />
                </View>

                <Text style={ws.sheetLbl}>Note (Optional)</Text>
                <View style={[ws.inputWrap, { paddingHorizontal: 14, paddingVertical: 10 }]}>
                  <TextInput value={sendNote} onChangeText={setSendNote} placeholder="e.g. Lunch bill" placeholderTextColor={C.textMuted} style={[ws.sendInput, { paddingVertical: 0 }]} maxLength={500} />
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: sendPhoneNetErr ? 10 : 16, marginTop: 4 }}>
                  <Ionicons name="wallet-outline" size={14} color={C.primary} />
                  <Text style={{ ...Typ.caption, color: C.textMuted, flex: 1 }}>Available: Rs. {balance.toLocaleString()} · Min: Rs. {(typeof minTransfer === "number" && isFinite(minTransfer) ? minTransfer : 100).toLocaleString()}</Text>
                </View>

                {sendPhoneNetErr && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.amberSoft, borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: C.amberBorder }}>
                    <Ionicons name="cloud-offline-outline" size={16} color={C.amber} />
                    <Text style={{ ...Typ.caption, color: C.amberDark, flex: 1 }}>Network error verifying receiver.</Text>
                    <TouchableOpacity activeOpacity={0.7} onPress={handleSendContinue} accessibilityRole="button" accessibilityLabel="Retry phone verification">
                      <Text style={{ ...Typ.captionMedium, color: C.primary, fontFamily: Font.bold }}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity activeOpacity={0.7} onPress={handleSendContinue} disabled={!sendPhone || !sendAmount || sendLoading} style={[ws.actionBtn, { backgroundColor: C.purple }, (!sendPhone || !sendAmount || sendLoading) && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Continue to confirm send" accessibilityState={{ disabled: !sendPhone || !sendAmount || sendLoading }}>
                  {sendLoading ? <ActivityIndicator color={C.textInverse} /> : (
                    <>
                      <Ionicons name="arrow-forward" size={17} color={C.textInverse} />
                      <Text style={ws.actionBtnTxt}>Continue</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => setSendStep("input")} style={{ marginRight: 10, padding: 4 }} accessibilityRole="button" accessibilityLabel="Go back">
                    <Ionicons name="arrow-back" size={20} color={C.text} />
                  </TouchableOpacity>
                  <Text style={[ws.sheetTitle, { marginBottom: 0 }]}>Confirm Transfer</Text>
                </View>

                <View style={{ backgroundColor: C.surface, borderRadius: 12, padding: 16, marginBottom: 16, gap: 12 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>To</Text>
                    <View style={{ alignItems: "flex-end" }}>
                      {sendReceiverName ? <Text style={{ ...Typ.bodySemiBold, color: C.text }}>{sendReceiverName}</Text> : null}
                      <Text style={{ ...Typ.body, fontSize: 13, color: sendReceiverName ? C.textMuted : C.text }}>+92 {sendPhone.trim()}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Amount</Text>
                    <Text style={{ ...Typ.h3, fontSize: 16, color: C.purple }}>Rs. {parseFloat(sendAmount || "0").toLocaleString()}</Text>
                  </View>
                  {sendNote ? (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted }}>Note</Text>
                      <Text style={{ ...Typ.body, fontSize: 13, color: C.text }}>{sendNote}</Text>
                    </View>
                  ) : null}
                </View>

                <TouchableOpacity activeOpacity={0.7} onPress={() => setSendStep("input")} style={{ alignSelf: "center", marginBottom: 12 }} accessibilityRole="button" accessibilityLabel="Edit transfer details">
                  <Text style={{ ...Typ.buttonSmall, color: C.primary }}>Edit Details</Text>
                </TouchableOpacity>

                <TouchableOpacity activeOpacity={0.7} onPress={handleSendConfirm} disabled={sendLoading} style={[ws.actionBtn, { backgroundColor: C.purple }, sendLoading && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`Send Rs. ${parseFloat(sendAmount || "0").toLocaleString()}`} accessibilityState={{ disabled: sendLoading }}>
                  {sendLoading ? <ActivityIndicator color={C.textInverse} /> : (
                    <>
                      <Ionicons name="send" size={17} color={C.textInverse} />
                      <Text style={ws.actionBtnTxt}>Send Rs. {parseFloat(sendAmount || "0").toLocaleString()}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showQR} transparent animationType="fade" onRequestClose={() => setShowQR(false)}>
        <TouchableOpacity activeOpacity={0.7} style={[ws.overlay, { justifyContent: "center", paddingHorizontal: 32 }]} onPress={() => setShowQR(false)}>
          <TouchableOpacity activeOpacity={0.7} style={[ws.sheet, { borderRadius: 24, paddingVertical: 28 }]} onPress={e => e.stopPropagation()}>
            <Text style={[ws.sheetTitle, { textAlign: "center" }]}>Receive Money</Text>
            <Text style={{ ...Typ.body, fontSize: 13, color: C.textMuted, textAlign: "center", marginBottom: 20 }}>
              Scan this QR code or share your phone number
            </Text>

            <View style={{ backgroundColor: C.surfaceSecondary, borderRadius: 20, padding: 24, alignItems: "center", marginBottom: 16, gap: 12, borderWidth: 1, borderColor: C.border }}>
              <View style={{ width: 140, height: 140, borderRadius: 16, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border }}>
                <QRCode
                  value={JSON.stringify({ type: "ajkmart_pay", phone: user?.phone, id: user?.id, name: (user?.name || "").slice(0, 32) })}
                  size={120}
                  color={C.primary}
                  backgroundColor={C.surface}
                />
              </View>
              <Text style={{ ...Typ.price, color: C.text }}>{user?.name || "AJKMart User"}</Text>
              <Text style={{ ...Typ.body, color: C.textMuted }}>+92 {user?.phone}</Text>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 }}>
              <Ionicons name="shield-checkmark-outline" size={14} color={C.success} />
              <Text style={{ ...Typ.caption, color: C.textMuted, flex: 1 }}>{appName} users can send directly to your wallet</Text>
            </View>

            <TouchableOpacity activeOpacity={0.7} onPress={() => setShowQR(false)} style={[ws.actionBtn, { backgroundColor: C.primary }]} accessibilityRole="button" accessibilityLabel="Close QR code">
              <Text style={ws.actionBtnTxt}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

    </View>
  );
}

export default withErrorBoundary(WalletScreenInner);

const ws = StyleSheet.create({
  actionCard: { flex: 1, alignItems: "center", gap: 8 },
  actionCardIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  actionCardTxt: { ...Typ.smallMedium, color: C.textSecondary, textAlign: "center" },

  statCard: { flex: 1, backgroundColor: C.surface, borderRadius: 16, padding: 14, alignItems: "center", gap: 6, borderWidth: 1, borderColor: C.border },
  statIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statLbl: { ...Typ.small, fontSize: 10, color: C.textMuted },
  statAmt: { ...Typ.buttonSmall, fontFamily: Font.bold },

  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: C.surfaceSecondary },
  filterChipActive: { backgroundColor: C.primary },
  filterTxt: { ...Typ.smallMedium, color: C.textMuted },
  filterTxtActive: { color: C.textInverse },

  txRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  txIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  txDesc: { ...Typ.bodyMedium, fontSize: 13, color: C.text },
  txDate: { ...Typ.small, color: C.textMuted, marginTop: 2 },
  txAmt: { ...Typ.body, fontFamily: Font.bold },

  overlay: { flex: 1, backgroundColor: C.overlayDark50, justifyContent: "flex-end" },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingBottom: Platform.OS === "web" ? 40 : 48, paddingTop: 12 },
  handle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  sheetTitle: { ...Typ.h2, color: C.text, marginBottom: 4 },
  sheetLbl: { ...Typ.bodyMedium, fontSize: 13, color: C.textSecondary, marginBottom: 8 },

  amtWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 16, marginBottom: 18 },
  rupee: { ...Typ.h2, fontFamily: Font.semiBold, color: C.textSecondary, marginRight: 8 },
  amtInput: { flex: 1, ...Typ.h1, color: C.text, paddingVertical: 14 },

  quickRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  quickBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingVertical: 11, alignItems: "center" },
  quickBtnActive: { borderColor: C.primary, backgroundColor: C.blueSoft },
  quickTxt: { ...Typ.smallMedium, color: C.textSecondary },
  quickTxtActive: { color: C.primary, fontFamily: Font.bold },

  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: C.border, borderRadius: 14, marginBottom: 14, overflow: "hidden" },
  phonePrefix: { backgroundColor: C.surfaceSecondary, paddingHorizontal: 14, paddingVertical: 14, borderRightWidth: 1, borderRightColor: C.border },
  phonePrefixTxt: { ...Typ.button, color: C.text },
  sendInput: { flex: 1, ...Typ.body, fontSize: 15, color: C.text, paddingHorizontal: 14, paddingVertical: 13 },

  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, paddingVertical: 16, marginTop: 4 },
  actionBtnTxt: { ...Typ.h3, fontSize: 16, color: C.textInverse },
});

