import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
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
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { useGetWallet, topUpWallet } from "@workspace/api-client-react";

const C   = Colors.light;
const API = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

type TxFilter = "all" | "credit" | "debit";

/* ─── Transaction Item ─── */
function TxItem({ tx }: { tx: any }) {
  const isCredit = tx.type === "credit";
  const date = new Date(tx.createdAt).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
  const time = new Date(tx.createdAt).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });

  const iconName = isCredit
    ? (tx.description?.includes("top-up") ? "add-circle" : tx.description?.includes("Received") ? "arrow-down" : "arrow-down")
    : (tx.description?.includes("ride") ? "car" : tx.description?.includes("Order") ? "bag" : tx.description?.includes("pharmacy") ? "medkit" : tx.description?.includes("arcel") ? "cube" : "arrow-up");

  return (
    <View style={ws.txRow}>
      <View style={[ws.txIcon, { backgroundColor: isCredit ? "#D1FAE5" : "#FEE2E2" }]}>
        <Ionicons name={iconName as any} size={18} color={isCredit ? C.success : C.danger} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={ws.txDesc} numberOfLines={1}>{tx.description}</Text>
        <Text style={ws.txDate}>{date} • {time}</Text>
      </View>
      <Text style={[ws.txAmt, { color: isCredit ? C.success : C.danger }]}>
        {isCredit ? "+" : "−"}Rs. {Number(tx.amount).toLocaleString()}
      </Text>
    </View>
  );
}

/* ═══════════════════════════ MAIN WALLET SCREEN ═══════════════════════════ */
export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const TAB_H  = Platform.OS === "web" ? 84 : 49;

  const [showTopUp,  setShowTopUp]  = useState(false);
  const [showSend,   setShowSend]   = useState(false);
  const [showQR,     setShowQR]     = useState(false);
  const [amount,     setAmount]     = useState("");
  const [loading,    setLoading]    = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [txFilter,   setTxFilter]   = useState<TxFilter>("all");

  /* Send money state */
  const [sendPhone,   setSendPhone]   = useState("");
  const [sendAmount,  setSendAmount]  = useState("");
  const [sendNote,    setSendNote]    = useState("");
  const [sendLoading, setSendLoading] = useState(false);

  const { config: platformConfig } = usePlatformConfig();
  const appName     = platformConfig.platform.appName;
  const minTopup    = platformConfig.customer.minTopup;
  const walletMax   = platformConfig.customer.walletMax;
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

  const handleTopUp = async () => {
    const num = parseFloat(amount);
    if (!num || num < minTopup)   { showToast(`Minimum Rs. ${minTopup.toLocaleString()} add karein`, "error"); return; }
    if (num > walletMax)          { showToast(`Maximum Rs. ${walletMax.toLocaleString()} per top-up`, "error"); return; }
    setLoading(true);
    try {
      const result = await topUpWallet({ userId: user!.id, amount: num });
      const newBalance = (result as any)?.balance ?? (user!.walletBalance + num);
      updateUser({ walletBalance: newBalance });
      qc.invalidateQueries({ queryKey: ["getWallet"] });
      setShowTopUp(false);
      setAmount("");
      showToast(`Rs. ${num.toLocaleString()} wallet mein add ho gaya!`, "success");
    } catch { showToast("Top-up fail. Dobara try karein.", "error"); }
    setLoading(false);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderUserId: user!.id, receiverPhone: sendPhone.trim(), amount: num, note: sendNote || null }),
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

          <Text style={ws.balLbl}>{appName} Wallet</Text>
          <Text style={ws.balAmt}>
            {isLoading ? "Rs. ···" : `Rs. ${balance.toLocaleString()}`}
          </Text>
          <Text style={ws.balSub}>Available Balance</Text>

          {/* Action Buttons */}
          <View style={ws.actionsRow}>
            <Pressable onPress={() => setShowTopUp(true)} style={ws.action}>
              <View style={ws.actionIcon}>
                <Ionicons name="add" size={22} color={C.primary} />
              </View>
              <Text style={ws.actionTxt}>Top Up</Text>
            </Pressable>
            {p2pEnabled && (
              <Pressable onPress={() => setShowSend(true)} style={ws.action}>
                <View style={ws.actionIcon}>
                  <Ionicons name="send-outline" size={20} color={C.primary} />
                </View>
                <Text style={ws.actionTxt}>Send</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setShowQR(true)} style={ws.action}>
              <View style={ws.actionIcon}>
                <Ionicons name="qr-code-outline" size={20} color={C.primary} />
              </View>
              <Text style={ws.actionTxt}>Receive</Text>
            </Pressable>
            <Pressable onPress={onRefresh} style={ws.action}>
              <View style={ws.actionIcon}>
                <Ionicons name="refresh-outline" size={20} color={C.primary} />
              </View>
              <Text style={ws.actionTxt}>Refresh</Text>
            </Pressable>
          </View>
        </LinearGradient>

        {/* Stats */}
        <View style={ws.statsRow}>
          <View style={ws.statCard}>
            <View style={[ws.statIcon, { backgroundColor: "#D1FAE5" }]}>
              <Ionicons name="arrow-down-outline" size={17} color={C.success} />
            </View>
            <Text style={ws.statLbl}>Money In</Text>
            <Text style={[ws.statAmt, { color: C.success }]}>Rs. {totalIn.toLocaleString()}</Text>
          </View>
          <View style={ws.statCard}>
            <View style={[ws.statIcon, { backgroundColor: "#FEE2E2" }]}>
              <Ionicons name="arrow-up-outline" size={17} color={C.danger} />
            </View>
            <Text style={ws.statLbl}>Money Out</Text>
            <Text style={[ws.statAmt, { color: C.danger }]}>Rs. {totalOut.toLocaleString()}</Text>
          </View>
          <View style={ws.statCard}>
            <View style={[ws.statIcon, { backgroundColor: "#DBEAFE" }]}>
              <Ionicons name="receipt-outline" size={17} color={C.primary} />
            </View>
            <Text style={ws.statLbl}>Transactions</Text>
            <Text style={[ws.statAmt, { color: C.primary }]}>{transactions.length}</Text>
          </View>
        </View>

        {/* Transaction History */}
        <View style={ws.txSection}>
          <View style={ws.txHeader}>
            <Text style={ws.txTitle}>Transaction History</Text>
            {transactions.length > 0 && (
              <View style={ws.filterRow}>
                {(["all", "credit", "debit"] as TxFilter[]).map(f => (
                  <Pressable key={f} onPress={() => setTxFilter(f)} style={[ws.filterChip, txFilter === f && ws.filterChipActive]}>
                    <Text style={[ws.filterTxt, txFilter === f && ws.filterTxtActive]}>
                      {f === "all" ? "All" : f === "credit" ? "In" : "Out"}
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
              <Text style={ws.emptyTitle}>{transactions.length === 0 ? "Koi transaction nahi" : "Is filter mein kuch nahi"}</Text>
              <Text style={ws.emptySubtitle}>{transactions.length === 0 ? "Wallet top up karo to start karo" : "Filter change karein"}</Text>
            </View>
          ) : (
            <View style={ws.txList}>
              {[...filtered].reverse().map(tx => <TxItem key={tx.id} tx={tx} />)}
            </View>
          )}
        </View>

        <View style={{ height: TAB_H + insets.bottom + 20 }} />
      </ScrollView>

      {/* ─── Top Up Modal ─── */}
      <Modal visible={showTopUp} transparent animationType="slide" onRequestClose={() => setShowTopUp(false)}>
        <Pressable style={ws.overlay} onPress={() => setShowTopUp(false)}>
          <Pressable style={ws.sheet} onPress={e => e.stopPropagation()}>
            <View style={ws.handle} />
            <Text style={ws.sheetTitle}>💳 Wallet Top Up</Text>

            <Text style={ws.sheetLbl}>Amount (PKR)</Text>
            <View style={ws.amtWrap}>
              <Text style={ws.rupee}>Rs.</Text>
              <TextInput style={ws.amtInput} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0" placeholderTextColor={C.textMuted} autoFocus />
            </View>

            <Text style={ws.sheetLbl}>Quick Amount</Text>
            <View style={ws.quickRow}>
              {QUICK_AMOUNTS.map(a => (
                <Pressable key={a} onPress={() => setAmount(a.toString())} style={[ws.quickBtn, amount === a.toString() && ws.quickBtnActive]}>
                  <Text style={[ws.quickTxt, amount === a.toString() && ws.quickTxtActive]}>Rs. {a.toLocaleString()}</Text>
                </Pressable>
              ))}
            </View>

            <View style={ws.sheetNote}>
              <Ionicons name="shield-checkmark-outline" size={14} color={C.success} />
              <Text style={ws.sheetNoteTxt}>Secure payment • Instant credit</Text>
            </View>

            <Pressable onPress={handleTopUp} disabled={loading || !amount} style={[ws.actionBtn, { backgroundColor: C.primary }, (!amount || loading) && { opacity: 0.5 }]}>
              {loading ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="add-circle-outline" size={19} color="#fff" />
                  <Text style={ws.actionBtnTxt}>Add Rs. {parseFloat(amount || "0").toLocaleString()}</Text>
                </>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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

      {/* ─── QR Code Modal ─── */}
      <Modal visible={showQR} transparent animationType="fade" onRequestClose={() => setShowQR(false)}>
        <Pressable style={[ws.overlay, { justifyContent: "center", paddingHorizontal: 32 }]} onPress={() => setShowQR(false)}>
          <Pressable style={[ws.sheet, { borderRadius: 24, paddingVertical: 28 }]} onPress={e => e.stopPropagation()}>
            <Text style={[ws.sheetTitle, { textAlign: "center" }]}>📲 Receive Money</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, textAlign: "center", marginBottom: 20 }}>
              Yeh QR code share karein ya phone number batayein
            </Text>

            {/* QR Placeholder */}
            <View style={ws.qrBox}>
              <View style={ws.qrInner}>
                <Ionicons name="qr-code" size={80} color={C.primary} />
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
