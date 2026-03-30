/**
 * Payment Gateway Routes
 * Supports: JazzCash, EasyPaisa (API + Manual modes), Bank Transfer, Cash on Delivery
 * ─────────────────────────────────────────────────────────────────────────────
 * All gateway credentials are stored in platform_settings table.
 * Changes take effect instantly without server restart.
 */

import { Router, type IRouter } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { ordersTable, usersTable, walletTransactionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getPlatformSettings } from "./admin.js";
import { generateId } from "../lib/id.js";
import { customerAuth } from "../middleware/security.js";

const router: IRouter = Router();

const paymentTracker = new Map<string, { status: string; orderId?: string; gateway: string; createdAt: number }>();
const PAYMENT_TTL_MS = 30 * 60 * 1000;

function trackPayment(txnRef: string, gateway: string, orderId?: string) {
  paymentTracker.set(txnRef, { status: "pending", orderId, gateway, createdAt: Date.now() });
  if (paymentTracker.size > 500) {
    const now = Date.now();
    for (const [k, v] of paymentTracker) {
      if (now - v.createdAt > PAYMENT_TTL_MS) paymentTracker.delete(k);
    }
  }
}

function resolvePayment(txnRef: string, status: "success" | "failed") {
  const entry = paymentTracker.get(txnRef);
  if (entry) entry.status = status;
}

// ─── Crypto Helpers ───────────────────────────────────────────────────────────

function hmacSHA256(key: string, data: string): string {
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function txnDateTime(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function txnExpiry(minutes = 15): string {
  const exp = new Date(Date.now() + minutes * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${exp.getFullYear()}${pad(exp.getMonth()+1)}${pad(exp.getDate())}${pad(exp.getHours())}${pad(exp.getMinutes())}${pad(exp.getSeconds())}`;
}

function buildJazzCashHash(params: Record<string, string>, salt: string): string {
  const sorted = Object.keys(params)
    .filter(k => params[k] !== "" && k !== "pp_SecureHash")
    .sort()
    .map(k => params[k])
    .join("&");
  return hmacSHA256(salt, `${salt}&${sorted}`).toUpperCase();
}

function buildEasyPaisaHash(fields: string[], hashKey: string): string {
  return sha256(`${hashKey}&${fields.join("&")}`);
}

// ─── Internal helper: update order to confirmed ────────────────────────────────
async function confirmOrder(orderId: string): Promise<void> {
  await db.update(ordersTable)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(eq(ordersTable.id, orderId));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/payments/methods
//  Public — returns all ACTIVE payment methods with full details
//  Respects: cod_enabled, bank_enabled, jazzcash_enabled, easypaisa_enabled,
//            feature_wallet, jazzcash_type (api/manual), easypaisa_type
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/methods", async (req, res) => {
  const s = await getPlatformSettings();
  const serviceType = (req.query.serviceType as string | undefined)?.toLowerCase();
  const validServices = ["mart", "food", "pharmacy", "parcel", "rides"];
  const filterService = serviceType && validServices.includes(serviceType) ? serviceType : null;

  const isAllowedForService = (prefix: string): boolean => {
    if (!filterService) return true;
    return (s[`${prefix}_allowed_${filterService}`] ?? "on") === "on";
  };

  const codEnabled    = (s["cod_enabled"]       ?? "on")  === "on";
  const walletEnabled = (s["feature_wallet"]    ?? "on")  === "on";
  const jcEnabled     = (s["jazzcash_enabled"]  ?? "off") === "on";
  const epEnabled     = (s["easypaisa_enabled"] ?? "off") === "on";
  const bankEnabled   = (s["bank_enabled"]      ?? "off") === "on";

  const methods: Array<Record<string, unknown>> = [];

  /* ── Cash on Delivery ── */
  if (codEnabled && isAllowedForService("cod")) {
    methods.push({
      id:          "cash",
      label:       "Cash on Delivery",
      logo:        "cash",
      available:   true,
      mode:        "live",
      description: s["cod_notes"] || "Delivery par cash dein",
      maxAmount:   parseFloat(s["cod_max_amount"] ?? "5000"),
      fee:         parseFloat(s["cod_fee"] ?? "0"),
      freeAbove:   parseFloat(s["cod_free_above"] ?? "2000"),
    });
  }

  /* ── AJK Wallet ── */
  if (walletEnabled && isAllowedForService("wallet")) {
    methods.push({
      id:          "wallet",
      label:       "AJK Wallet",
      logo:        "wallet",
      available:   true,
      mode:        "live",
      description: "Apni wallet se instant payment karein",
      minTopup:    parseFloat(s["wallet_min_topup"]    ?? "100"),
      maxTopup:    parseFloat(s["wallet_max_topup"]    ?? "25000"),
      maxBalance:  parseFloat(s["wallet_max_balance"]  ?? "50000"),
    });
  }

  /* ── JazzCash ── */
  if (jcEnabled && isAllowedForService("jazzcash")) {
    const jcType = s["jazzcash_type"] ?? "manual";
    const entry: Record<string, unknown> = {
      id:           "jazzcash",
      label:        "JazzCash",
      logo:         "jazzcash",
      available:    true,
      mode:         jcType === "api" ? (s["jazzcash_mode"] ?? "sandbox") : "manual",
      type:         jcType,
      description:  "JazzCash mobile wallet",
      proofRequired:(s["jazzcash_proof_required"] ?? "off") === "on",
      minAmount:    parseFloat(s["jazzcash_min_amount"] ?? "10"),
      maxAmount:    parseFloat(s["jazzcash_max_amount"] ?? "100000"),
    };
    if (jcType === "manual") {
      entry["manualName"]         = s["jazzcash_manual_name"]         ?? "";
      entry["manualNumber"]       = s["jazzcash_manual_number"]       ?? "";
      entry["manualInstructions"] = s["jazzcash_manual_instructions"] ?? "Number par payment bhejein aur transaction ID hum se share karein.";
    }
    methods.push(entry);
  }

  /* ── EasyPaisa ── */
  if (epEnabled && isAllowedForService("easypaisa")) {
    const epType = s["easypaisa_type"] ?? "manual";
    const entry: Record<string, unknown> = {
      id:           "easypaisa",
      label:        "EasyPaisa",
      logo:         "easypaisa",
      available:    true,
      mode:         epType === "api" ? (s["easypaisa_mode"] ?? "sandbox") : "manual",
      type:         epType,
      description:  "EasyPaisa mobile wallet",
      proofRequired:(s["easypaisa_proof_required"] ?? "off") === "on",
      minAmount:    parseFloat(s["easypaisa_min_amount"] ?? "10"),
      maxAmount:    parseFloat(s["easypaisa_max_amount"] ?? "100000"),
    };
    if (epType === "manual") {
      entry["manualName"]         = s["easypaisa_manual_name"]         ?? "";
      entry["manualNumber"]       = s["easypaisa_manual_number"]       ?? "";
      entry["manualInstructions"] = s["easypaisa_manual_instructions"] ?? "Number par payment bhejein aur transaction ID share karein.";
    }
    methods.push(entry);
  }

  /* ── Bank Transfer ── */
  if (bankEnabled && isAllowedForService("bank")) {
    methods.push({
      id:              "bank",
      label:           "Bank Transfer",
      logo:            "bank",
      available:       true,
      mode:            "manual",
      type:            "manual",
      description:     "Direct bank account transfer",
      bankName:        s["bank_name"]            ?? "",
      accountTitle:    s["bank_account_title"]   ?? "",
      accountNumber:   s["bank_account_number"]  ?? "",
      iban:            s["bank_iban"]             ?? "",
      branchCode:      s["bank_branch_code"]      ?? "",
      swiftCode:       s["bank_swift_code"]       ?? "",
      instructions:    s["bank_instructions"]     ?? "Bank account mein transfer karein aur receipt hum se share karein.",
      proofRequired:   (s["bank_proof_required"]  ?? "on") === "on",
      minAmount:       parseFloat(s["bank_min_amount"]       ?? "0"),
      processingHours: parseInt(s["bank_processing_hours"]   ?? "24"),
    });
  }

  res.json({
    methods,
    currency:          "PKR",
    minAmount:         parseFloat(s["payment_min_online"]          ?? "50"),
    maxAmount:         parseFloat(s["payment_max_online"]          ?? "100000"),
    timeoutMins:       parseInt(s["payment_timeout_mins"]          ?? "15"),
    receiptRequired:   (s["payment_receipt_required"]              ?? "off") === "on",
    verifyWindowHours: parseInt(s["payment_verify_window_hours"]   ?? "24"),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/payments/test-connection/:gateway
//  Admin only — validates credentials and generates test hash
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/test-connection/:gateway", async (req, res) => {
  const adminSecret = String(req.headers["x-admin-secret"] ?? "");
  const requiredSecret = process.env.ADMIN_SECRET;
  if (!requiredSecret || adminSecret !== requiredSecret) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const s = await getPlatformSettings();
  const gw = req.params["gateway"];

  if (gw === "jazzcash") {
    const jcType = s["jazzcash_type"] ?? "manual";
    if (jcType === "manual") {
      const name   = s["jazzcash_manual_name"]   ?? "";
      const number = s["jazzcash_manual_number"] ?? "";
      if (!name || !number) {
        res.json({ ok: false, message: "Manual mode: account name aur Jazz number add karein." }); return;
      }
      res.json({ ok: true, message: `JazzCash Manual mode — ${number} (${name}) ✅` }); return;
    }
    const merchantId = s["jazzcash_merchant_id"] ?? "";
    const password   = s["jazzcash_password"]    ?? "";
    const salt       = s["jazzcash_salt"]         ?? "";
    if (!merchantId || !password || !salt) {
      res.json({ ok: false, message: "API mode: Merchant ID, Password aur Salt darj karein." }); return;
    }
    const testParams = { pp_MerchantID: merchantId, pp_Password: password, pp_TxnRefNo: `T${Date.now()}`, pp_Amount: "100", pp_TxnCurrency: "PKR", pp_TxnDateTime: txnDateTime() };
    const hash = buildJazzCashHash(testParams, salt);
    const mode = s["jazzcash_mode"] ?? "sandbox";
    res.json({ ok: true, mode, message: `JazzCash API ready — ${mode.toUpperCase()} ✅ Hash: ${hash.slice(0,10)}...` }); return;
  }

  if (gw === "easypaisa") {
    const epType = s["easypaisa_type"] ?? "manual";
    if (epType === "manual") {
      const name   = s["easypaisa_manual_name"]   ?? "";
      const number = s["easypaisa_manual_number"] ?? "";
      if (!name || !number) {
        res.json({ ok: false, message: "Manual mode: account name aur EasyPaisa number add karein." }); return;
      }
      res.json({ ok: true, message: `EasyPaisa Manual mode — ${number} (${name}) ✅` }); return;
    }
    const storeId = s["easypaisa_store_id"] ?? "";
    const hashKey = s["easypaisa_hash_key"] ?? "";
    if (!storeId || !hashKey) {
      res.json({ ok: false, message: "API mode: Store ID aur Hash Key darj karein." }); return;
    }
    const testHash = buildEasyPaisaHash([storeId, "100", "PKR"], hashKey);
    const mode = s["easypaisa_mode"] ?? "sandbox";
    res.json({ ok: true, mode, message: `EasyPaisa API ready — ${mode.toUpperCase()} ✅ Hash: ${testHash.slice(0,10)}...` }); return;
  }

  res.status(400).json({ error: "Unknown gateway. Use: jazzcash, easypaisa" });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/payments/initiate
//  Requires auth. Verifies orderId belongs to the calling user.
//  Body: { gateway, amount, orderId, mobileNumber?, returnUrl? }
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/initiate", customerAuth, async (req, res) => {
  const callerId = req.customerId!;
  const { gateway, amount, orderId, mobileNumber } = req.body;
  if (!gateway || !amount || !orderId) {
    res.status(400).json({ error: "gateway, amount and orderId are required" }); return;
  }

  /* Verify the order belongs to the authenticated user */
  const [order] = await db.select({ userId: ordersTable.userId })
    .from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.userId !== callerId) { res.status(403).json({ error: "Access denied — order does not belong to you" }); return; }

  const s = await getPlatformSettings();
  const amountPaisa = Math.round(parseFloat(amount) * 100);

  /* ── JazzCash ── */
  if (gateway === "jazzcash") {
    if ((s["jazzcash_enabled"] ?? "off") !== "on") {
      res.status(503).json({ error: "JazzCash is currently disabled" }); return;
    }
    const jcMin = parseFloat(s["jazzcash_min_amount"] ?? "10");
    const jcMax = parseFloat(s["jazzcash_max_amount"] ?? "100000");
    if (parseFloat(amount) < jcMin) {
      res.status(400).json({ error: `Minimum JazzCash payment is Rs. ${jcMin}` }); return;
    }
    if (parseFloat(amount) > jcMax) {
      res.status(400).json({ error: `Maximum JazzCash payment is Rs. ${jcMax}` }); return;
    }
    const jcType = s["jazzcash_type"] ?? "manual";

    if (jcType === "manual") {
      res.json({
        gateway:    "jazzcash",
        mode:       "manual",
        type:       "manual",
        name:       s["jazzcash_manual_name"]         ?? "",
        number:     s["jazzcash_manual_number"]       ?? "",
        instructions: s["jazzcash_manual_instructions"] ?? "Number par payment bhejein aur transaction ID share karein.",
        amount:     parseFloat(amount),
        orderId,
      });
      return;
    }

    // API mode
    const merchantId  = s["jazzcash_merchant_id"] ?? "";
    const password    = s["jazzcash_password"]    ?? "";
    const salt        = s["jazzcash_salt"]         ?? "";
    const currency    = s["jazzcash_currency"]     ?? "PKR";
    const mode        = s["jazzcash_mode"]         ?? "sandbox";
    const timeoutMins = parseInt(s["payment_timeout_mins"] ?? "15");

    if (mode !== "sandbox" && (!merchantId || !password || !salt)) {
      res.status(503).json({ error: "JazzCash API credentials incomplete. Admin settings mein configure karein." }); return;
    }

    const txnRef     = `AJKM${Date.now()}`;
    const params: Record<string, string> = {
      pp_Version:           "1.1",
      pp_TxnType:           "MWALLET",
      pp_Language:          "EN",
      pp_MerchantID:        merchantId,
      pp_SubMerchantID:     "",
      pp_Password:          password,
      pp_BankID:            "TBANK",
      pp_ProductID:         "RETL",
      pp_TxnRefNo:          txnRef,
      pp_Amount:            String(amountPaisa),
      pp_TxnCurrency:       currency,
      pp_TxnDateTime:       txnDateTime(),
      pp_BillReference:     orderId,
      pp_Description:       `AJKMart Order ${orderId.slice(-6).toUpperCase()}`,
      pp_TxnExpiryDateTime: txnExpiry(timeoutMins),
      pp_ReturnURL:         s["jazzcash_return_url"] || `${req.protocol}://${req.get("host")}/api/payments/callback/jazzcash`,
      ppmpf_1:              mobileNumber || "",
      ppmpf_2: "", ppmpf_3: "", ppmpf_4: "", ppmpf_5: "",
    };
    params["pp_SecureHash"] = buildJazzCashHash(params, salt || "sandbox_salt");

    const isSandbox = mode === "sandbox";
    trackPayment(txnRef, "jazzcash", orderId);
    res.json({
      gateway: "jazzcash", mode, type: "api", txnRef, orderId,
      gatewayUrl: isSandbox
        ? "https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/"
        : "https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/",
      params,
      instructions: isSandbox
        ? "Sandbox mode — payment simulate hogi."
        : `JazzCash app pe notification aayegi — approve karein.`,
      simulateUrl: isSandbox ? `/api/payments/simulate/jazzcash/${txnRef}/${orderId}` : null,
    });
    return;
  }

  /* ── EasyPaisa ── */
  if (gateway === "easypaisa") {
    if ((s["easypaisa_enabled"] ?? "off") !== "on") {
      res.status(503).json({ error: "EasyPaisa is currently disabled" }); return;
    }
    const epMin = parseFloat(s["easypaisa_min_amount"] ?? "10");
    const epMax = parseFloat(s["easypaisa_max_amount"] ?? "100000");
    if (parseFloat(amount) < epMin) {
      res.status(400).json({ error: `Minimum EasyPaisa payment is Rs. ${epMin}` }); return;
    }
    if (parseFloat(amount) > epMax) {
      res.status(400).json({ error: `Maximum EasyPaisa payment is Rs. ${epMax}` }); return;
    }
    const epType = s["easypaisa_type"] ?? "manual";

    if (epType === "manual") {
      res.json({
        gateway:    "easypaisa",
        mode:       "manual",
        type:       "manual",
        name:       s["easypaisa_manual_name"]         ?? "",
        number:     s["easypaisa_manual_number"]       ?? "",
        instructions: s["easypaisa_manual_instructions"] ?? "Number par payment bhejein aur transaction ID share karein.",
        amount:     parseFloat(amount),
        orderId,
      });
      return;
    }

    // API mode
    const storeId    = s["easypaisa_store_id"]  ?? "";
    const hashKey    = s["easypaisa_hash_key"]  ?? "";
    const username   = s["easypaisa_username"]  ?? "";
    const epPassword = s["easypaisa_password"]  ?? "";
    const mode       = s["easypaisa_mode"]      ?? "sandbox";

    const isSandbox = mode === "sandbox";
    if (!isSandbox && (!storeId || !hashKey)) {
      res.status(503).json({ error: "EasyPaisa API credentials incomplete. Admin settings mein configure karein." }); return;
    }

    const txnRef    = `EP${Date.now()}`;
    const amountStr = parseFloat(amount).toFixed(2);
    const hash      = buildEasyPaisaHash([storeId, txnRef, amountStr, "PKR", mobileNumber || ""], hashKey || "sandbox_key");

    const payload = {
      orderId: txnRef, storeId,
      transactionAmount: amountStr,
      transactionType: "MA",
      mobileAccountNo: mobileNumber || "",
      transactionCurrency: "PKR",
      paymentExpiryDate: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      enabledPaymentMethods: 0,
      postBackURL: `${req.protocol}://${req.get("host")}/api/payments/callback/easypaisa`,
      encryptedHashRequest: hash,
    };

    if (!isSandbox && username && epPassword) {
      try {
        const authHeader = "Basic " + Buffer.from(`${username}:${epPassword}`).toString("base64");
        const epRes = await fetch("https://easypay.easypaisa.com.pk/easypay-service/rest/v4/initTransaction", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": authHeader, "Credentials": authHeader },
          body: JSON.stringify(payload),
        });
        const epData = await epRes.json() as any;
        if (epData?.responseCode === "0000") {
          trackPayment(txnRef, "easypaisa", orderId);
          res.json({ gateway: "easypaisa", mode: "live", type: "api", txnRef, token: epData.token, orderId,
            instructions: `Mobile ${mobileNumber} pe notification aayegi — approve karein.` });
          return;
        }
        res.status(502).json({ error: `EasyPaisa error: ${epData?.responseDesc || "Unknown error"}` }); return;
      } catch (e: any) {
        res.status(502).json({ error: `EasyPaisa API unreachable: ${e.message}` }); return;
      }
    }

    trackPayment(txnRef, "easypaisa", orderId);
    res.json({
      gateway: "easypaisa", mode, type: "api", txnRef, orderId, payload,
      instructions: isSandbox ? "Sandbox mode — payment simulate hogi." : `EasyPaisa notification aayegi — approve karein.`,
      simulateUrl: isSandbox ? `/api/payments/simulate/easypaisa/${txnRef}/${orderId}` : null,
    });
    return;
  }

  res.status(400).json({ error: "Unsupported gateway. Use: jazzcash, easypaisa" });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/payments/verify-manual
//  Manual payment verification — admin confirms a manual transfer
//  Body: { orderId, gateway, transactionId, amount }
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/verify-manual", async (req, res) => {
  const adminSecret = String(req.headers["x-admin-secret"] ?? "");
  const requiredSecretV = process.env.ADMIN_SECRET;
  if (!requiredSecretV || adminSecret !== requiredSecretV) {
    res.status(403).json({ error: "Forbidden — admin secret required" }); return;
  }
  const { orderId, gateway, transactionId } = req.body;
  if (!orderId) { res.status(400).json({ error: "orderId required" }); return; }
  await confirmOrder(orderId);
  res.json({ success: true, orderId, gateway, transactionId, message: "Manual payment verified — order confirmed ✅" });
});

const _ADMIN_SECRET = process.env["ADMIN_SECRET"] || "";

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/payments/simulate/:gateway/:txnRef/:orderId
//  Sandbox simulation — marks order confirmed (ONLY in sandbox/dev mode)
//  Requires x-admin-secret header to prevent abuse.
// ═══════════════════════════════════════════════════════════════════════════════
// With orderId — confirms the order
router.get("/simulate/:gateway/:txnRef/:orderId", async (req, res) => {
  const secret = req.headers["x-admin-secret"] as string | undefined;
  if (!secret || secret !== _ADMIN_SECRET) {
    res.status(401).json({ error: "Admin secret required to simulate payments" }); return;
  }

  const s = await getPlatformSettings();
  const gw = req.params["gateway"];
  const orderId = req.params["orderId"]!;
  const mode = gw === "jazzcash" ? (s["jazzcash_mode"] ?? "sandbox") : (s["easypaisa_mode"] ?? "sandbox");

  if (mode !== "sandbox") {
    res.status(403).json({ error: "Simulation only available in sandbox mode" }); return;
  }

  await confirmOrder(orderId);
  resolvePayment(req.params["txnRef"]!, "success");
  res.json({ status: "success", txnRef: req.params["txnRef"], orderId, gateway: gw, message: "Sandbox payment simulated ✅ — Order confirmed" });
});

// Without orderId — just simulate success response
router.get("/simulate/:gateway/:txnRef", async (req, res) => {
  const secret = req.headers["x-admin-secret"] as string | undefined;
  if (!secret || secret !== _ADMIN_SECRET) {
    res.status(401).json({ error: "Admin secret required to simulate payments" }); return;
  }

  const s = await getPlatformSettings();
  const gw = req.params["gateway"];
  const mode = gw === "jazzcash" ? (s["jazzcash_mode"] ?? "sandbox") : (s["easypaisa_mode"] ?? "sandbox");

  if (mode !== "sandbox") {
    res.status(403).json({ error: "Simulation only available in sandbox mode" }); return;
  }

  res.json({ status: "success", txnRef: req.params["txnRef"], orderId: null, gateway: gw, message: "Sandbox payment simulated ✅" });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/payments/callback/jazzcash
//  JazzCash posts payment result here (Return URL)
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/callback/jazzcash", async (req, res) => {
  const s      = await getPlatformSettings();
  const salt   = s["jazzcash_salt"] ?? "";
  const mode   = s["jazzcash_mode"] ?? "sandbox";
  const params = req.body as Record<string, string>;

  /* ── Hash verification ──
     Live mode: salt MUST be configured and hash MUST match — no bypass allowed.
     Sandbox mode: skip hash check (sandbox credentials aren't real keys). ── */
  if (mode !== "sandbox") {
    if (!salt) {
      res.status(500).json({ error: "JazzCash salt not configured — cannot verify callback" }); return;
    }
    const receivedHash      = params["pp_SecureHash"];
    const paramsWithoutHash = { ...params };
    delete paramsWithoutHash["pp_SecureHash"];
    const computedHash = buildJazzCashHash(paramsWithoutHash, salt);
    if (receivedHash !== computedHash) {
      res.status(400).json({ error: "Hash mismatch — possible tampering" }); return;
    }
  }

  const responseCode = params["pp_ResponseCode"];
  const txnRef       = params["pp_TxnRefNo"];
  const orderId      = params["pp_BillReference"];

  if (responseCode === "000") {
    if (orderId) await confirmOrder(orderId);
    if (txnRef) resolvePayment(txnRef, "success");
    res.json({ success: true, txnRef, orderId, message: "JazzCash payment confirmed — order updated ✅" });
  } else {
    if (txnRef) resolvePayment(txnRef, "failed");
    res.json({ success: false, txnRef, responseCode, message: "JazzCash payment failed or cancelled" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POST /api/payments/callback/easypaisa
//  EasyPaisa posts transaction result here (postBackURL)
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/callback/easypaisa", async (req, res) => {
  const s        = await getPlatformSettings();
  const hashKey  = s["easypaisa_hash_key"] ?? "";
  const storeId  = s["easypaisa_store_id"] ?? "";
  const mode     = s["easypaisa_mode"] ?? "sandbox";
  const body     = req.body as Record<string, string>;

  const receivedHash = body["encryptedHashRequest"];
  const orderId      = body["orderId"];
  const responseCode = body["responseCode"];
  const txnRefNo     = body["transactionReferenceNumber"];
  const amount       = body["transactionAmount"];

  /* ── Hash verification ──
     Live mode: hashKey MUST be configured and hash MUST match — no bypass allowed.
     Sandbox mode: skip hash check (sandbox credentials aren't real keys). ── */
  if (mode !== "sandbox") {
    if (!hashKey) {
      res.status(500).json({ error: "EasyPaisa hash key not configured — cannot verify callback" }); return;
    }
    const computedHash = buildEasyPaisaHash([storeId, orderId, amount, "PKR", ""], hashKey);
    if (receivedHash !== computedHash) {
      res.status(400).json({ error: "Hash mismatch — verify EasyPaisa credentials" }); return;
    }
  }

  if (responseCode === "0000") {
    if (orderId && orderId.startsWith("EP")) {
      resolvePayment(orderId, "success");
      const tracked = paymentTracker.get(orderId);
      if (tracked?.orderId) await confirmOrder(tracked.orderId);
    }
    res.json({ success: true, txnRefNo, message: "EasyPaisa payment confirmed ✅" });
  } else {
    if (orderId && orderId.startsWith("EP")) resolvePayment(orderId, "failed");
    res.json({ success: false, txnRefNo, responseCode, message: "EasyPaisa payment failed" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GET /api/payments/status/:txnRef
//  Poll payment status (gateway status check)
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/status/:txnRef", async (req, res) => {
  const txnRef = req.params["txnRef"]!;
  const tracked = paymentTracker.get(txnRef);

  if (!tracked) {
    res.json({ txnRef, status: "pending", message: "Awaiting payment confirmation from gateway" });
    return;
  }

  const elapsed = Date.now() - tracked.createdAt;
  if (tracked.status === "pending" && elapsed > PAYMENT_TTL_MS) {
    tracked.status = "expired";
  }

  const messages: Record<string, string> = {
    pending: "Awaiting payment confirmation from gateway",
    success: "Payment confirmed",
    failed: "Payment failed or was cancelled",
    expired: "Payment session expired",
  };

  res.json({ txnRef, status: tracked.status, message: messages[tracked.status] || tracked.status });
});

export default router;
