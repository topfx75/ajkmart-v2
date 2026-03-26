import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  ordersTable,
  ridesTable,
  pharmacyOrdersTable,
  parcelBookingsTable,
  productsTable,
  walletTransactionsTable,
  notificationsTable,
  platformSettingsTable,
  flashDealsTable,
  promoCodesTable,
  adminAccountsTable,
} from "@workspace/db/schema";
import { eq, desc, count, sum, and, gte, lte, sql, or, ilike } from "drizzle-orm";
import { generateId } from "../lib/id.js";

/* ── Default Platform Settings ── */
export const DEFAULT_PLATFORM_SETTINGS = [
  /* Delivery */
  { key: "delivery_fee_mart",      value: "80",   label: "Mart Delivery Fee (Rs.)",       category: "delivery" },
  { key: "delivery_fee_food",      value: "60",   label: "Food Delivery Fee (Rs.)",        category: "delivery" },
  { key: "delivery_fee_pharmacy",  value: "50",   label: "Pharmacy Delivery Fee (Rs.)",    category: "delivery" },
  { key: "delivery_fee_parcel",    value: "100",  label: "Parcel Base Delivery Fee (Rs.)", category: "delivery" },
  { key: "free_delivery_above",    value: "1000", label: "Free Delivery Above (Rs.)",      category: "delivery" },
  /* Rides */
  { key: "ride_bike_base_fare",    value: "15",   label: "Bike Base Fare (Rs.)",           category: "rides" },
  { key: "ride_bike_per_km",       value: "8",    label: "Bike Per KM Rate (Rs.)",         category: "rides" },
  { key: "ride_car_base_fare",     value: "25",   label: "Car Base Fare (Rs.)",            category: "rides" },
  { key: "ride_car_per_km",        value: "12",   label: "Car Per KM Rate (Rs.)",          category: "rides" },
  /* Finance */
  { key: "platform_commission_pct",value: "10",   label: "Platform Commission (%)",        category: "finance" },
  /* Orders */
  { key: "min_order_amount",       value: "100",  label: "Minimum Order Amount (Rs.)",     category: "orders" },
  { key: "max_cod_amount",         value: "5000", label: "Max COD Order Amount (Rs.)",     category: "orders" },
  /* General */
  { key: "app_name",               value: "AJKMart", label: "App Name",                   category: "general" },
  { key: "support_phone",          value: "03001234567", label: "Support Phone Number",    category: "general" },
  { key: "app_status",             value: "active", label: "App Status (active/maintenance)", category: "general" },
  /* Customer Role Settings */
  { key: "customer_wallet_max",    value: "50000", label: "Max Wallet Balance (Rs.)",      category: "customer" },
  { key: "customer_min_topup",     value: "100",   label: "Min Wallet Top-Up (Rs.)",       category: "customer" },
  { key: "customer_min_withdrawal",value: "200",   label: "Min Wallet Withdrawal (Rs.)",   category: "customer" },
  { key: "customer_referral_bonus",value: "100",   label: "Referral Bonus (Rs.)",          category: "customer" },
  { key: "customer_loyalty_pts",   value: "5",     label: "Loyalty Points Per Rs.100",     category: "customer" },
  { key: "customer_max_orders_day",value: "10",    label: "Max Orders Per Day",            category: "customer" },
  /* Rider Role Settings */
  { key: "rider_keep_pct",         value: "80",    label: "Rider Earnings % (of fare)",    category: "rider" },
  { key: "rider_acceptance_km",    value: "5",     label: "Acceptance Radius (KM)",        category: "rider" },
  { key: "rider_max_deliveries",   value: "3",     label: "Max Active Deliveries",         category: "rider" },
  { key: "rider_bonus_per_trip",   value: "0",     label: "Bonus Per Trip (Rs.)",          category: "rider" },
  { key: "rider_min_payout",       value: "500",   label: "Minimum Payout (Rs.)",          category: "rider" },
  { key: "rider_cash_allowed",     value: "on",    label: "Allow Cash Payments",           category: "rider" },
  /* Vendor Role Settings */
  { key: "vendor_commission_pct",  value: "15",    label: "Vendor Platform Commission (%)",category: "vendor" },
  { key: "vendor_min_order",       value: "100",   label: "Vendor Minimum Order (Rs.)",    category: "vendor" },
  { key: "vendor_max_items",       value: "100",   label: "Max Menu Items Per Vendor",     category: "vendor" },
  { key: "vendor_settlement_days", value: "7",     label: "Payout Settlement Days",        category: "vendor" },
  { key: "vendor_auto_approve",    value: "off",   label: "Auto-Approve New Vendors",      category: "vendor" },
  /* App Feature Toggles */
  { key: "feature_mart",           value: "on",    label: "Mart (Grocery) Service",        category: "features" },
  { key: "feature_food",           value: "on",    label: "Food Delivery Service",         category: "features" },
  { key: "feature_rides",          value: "on",    label: "Taxi & Bike Booking",           category: "features" },
  { key: "feature_pharmacy",       value: "on",    label: "Pharmacy Service",              category: "features" },
  { key: "feature_parcel",         value: "on",    label: "Parcel Delivery Service",       category: "features" },
  { key: "feature_wallet",         value: "on",    label: "Digital Wallet",                category: "features" },
  { key: "feature_referral",       value: "on",    label: "Referral Program",              category: "features" },
  { key: "feature_new_users",      value: "on",    label: "New User Registration",         category: "features" },
  /* Content & Messaging */
  { key: "content_banner",         value: "Free delivery on your first order! 🎉", label: "App Banner Text",                      category: "content" },
  { key: "content_announcement",   value: "",      label: "Announcement Bar (empty = hidden)",    category: "content" },
  { key: "content_maintenance_msg",value: "We're performing scheduled maintenance. Back soon!", label: "Maintenance Message", category: "content" },
  { key: "content_support_msg",    value: "Need help? Chat with us!",              label: "Support Chat Greeting",                category: "content" },
  { key: "content_tnc_url",        value: "",      label: "Terms & Conditions URL",               category: "content" },
  { key: "content_privacy_url",    value: "",      label: "Privacy Policy URL",                   category: "content" },
  { key: "feature_chat",           value: "off",   label: "In-App Customer Chat Support",         category: "content" },
  { key: "feature_live_tracking",  value: "on",    label: "Live Order GPS Tracking",              category: "content" },
  { key: "feature_reviews",        value: "on",    label: "Customer Reviews & Ratings",           category: "content" },
  /* Security & API Keys */
  { key: "security_otp_bypass",    value: "off",   label: "OTP Bypass Mode (Dev Only — DANGER)",  category: "security" },
  { key: "security_gps_tracking",  value: "on",    label: "GPS Tracking for Riders",              category: "security" },
  { key: "security_rate_limit",    value: "100",   label: "API Rate Limit (req/min per IP)",      category: "security" },
  { key: "security_session_days",  value: "30",    label: "Session Expiry (days)",                category: "security" },
  { key: "api_map_key",            value: "",      label: "Google Maps API Key",                  category: "security" },
  { key: "api_sms_gateway",        value: "console", label: "SMS Gateway (console / msg91 / twilio)", category: "security" },
  { key: "api_firebase_key",       value: "",      label: "Firebase Server Key (Push Notifications)", category: "security" },
  /* Platform Integrations */
  { key: "integration_push_notif", value: "off",   label: "Push Notifications (Firebase FCM)",   category: "integrations" },
  { key: "integration_analytics",  value: "off",   label: "Analytics & Event Tracking",          category: "integrations" },
  { key: "integration_email",      value: "off",   label: "Email Admin Alerts (SMTP)",           category: "integrations" },
  { key: "integration_sentry",     value: "off",   label: "Error Monitoring (Sentry)",           category: "integrations" },
  { key: "integration_whatsapp",   value: "off",   label: "WhatsApp Business Notifications",     category: "integrations" },
  /* ═══════════════════  JazzCash Payment Gateway  ═══════════════════ */
  { key: "jazzcash_enabled",           value: "off",      label: "JazzCash Enable",                      category: "payment" },
  { key: "jazzcash_type",              value: "manual",   label: "JazzCash Mode (api/manual)",           category: "payment" },
  { key: "jazzcash_mode",              value: "sandbox",  label: "API Environment",                      category: "payment" },
  { key: "jazzcash_merchant_id",       value: "",         label: "API Merchant ID",                      category: "payment" },
  { key: "jazzcash_password",          value: "",         label: "API Password",                         category: "payment" },
  { key: "jazzcash_salt",              value: "",         label: "API Integrity Salt",                   category: "payment" },
  { key: "jazzcash_currency",          value: "PKR",      label: "Currency",                             category: "payment" },
  { key: "jazzcash_return_url",        value: "",         label: "API Return URL",                       category: "payment" },
  { key: "jazzcash_manual_name",       value: "",         label: "Manual Transfer - Account Name",       category: "payment" },
  { key: "jazzcash_manual_number",     value: "",         label: "Manual Transfer - Jazz Number",        category: "payment" },
  { key: "jazzcash_manual_instructions", value: "Send payment to the Jazz number above and share the transaction ID with us.", label: "Manual Instructions", category: "payment" },
  /* ═══════════════════  EasyPaisa Payment Gateway  ═══════════════════ */
  { key: "easypaisa_enabled",          value: "off",      label: "EasyPaisa Enable",                     category: "payment" },
  { key: "easypaisa_type",             value: "manual",   label: "EasyPaisa Mode (api/manual)",          category: "payment" },
  { key: "easypaisa_mode",             value: "sandbox",  label: "API Environment",                      category: "payment" },
  { key: "easypaisa_store_id",         value: "",         label: "API Store ID",                         category: "payment" },
  { key: "easypaisa_merchant_id",      value: "",         label: "API Merchant Account",                 category: "payment" },
  { key: "easypaisa_hash_key",         value: "",         label: "API Hash Key",                         category: "payment" },
  { key: "easypaisa_username",         value: "",         label: "API Username",                         category: "payment" },
  { key: "easypaisa_password",         value: "",         label: "API Password",                         category: "payment" },
  { key: "easypaisa_manual_name",      value: "",         label: "Manual Transfer - Account Name",       category: "payment" },
  { key: "easypaisa_manual_number",    value: "",         label: "Manual Transfer - EasyPaisa Number",   category: "payment" },
  { key: "easypaisa_manual_instructions", value: "Send payment to the EasyPaisa number above and share the transaction ID.", label: "Manual Instructions", category: "payment" },
  /* ═══════════════════  Bank Transfer  ═══════════════════ */
  { key: "bank_enabled",               value: "off",      label: "Bank Transfer Enable",                 category: "payment" },
  { key: "bank_name",                  value: "",         label: "Bank Name",                            category: "payment" },
  { key: "bank_account_title",         value: "",         label: "Account Title (Holder Name)",          category: "payment" },
  { key: "bank_account_number",        value: "",         label: "Account Number",                       category: "payment" },
  { key: "bank_iban",                  value: "",         label: "IBAN",                                 category: "payment" },
  { key: "bank_branch_code",           value: "",         label: "Branch Code",                          category: "payment" },
  { key: "bank_instructions",          value: "Transfer to the bank account above and share the receipt/slip.", label: "Transfer Instructions", category: "payment" },
  /* ═══════════════════  Cash on Delivery  ═══════════════════ */
  { key: "cod_enabled",                value: "on",       label: "Cash on Delivery Enable",              category: "payment" },
  { key: "cod_max_amount",             value: "5000",     label: "Max COD Order Amount (Rs.)",           category: "payment" },
  { key: "cod_fee",                    value: "0",        label: "COD Service Fee (Rs.)",                category: "payment" },
  { key: "cod_free_above",             value: "2000",     label: "Free COD Above (Rs.)",                 category: "payment" },
  { key: "cod_restricted_areas",       value: "",         label: "Restricted Areas (comma-separated)",   category: "payment" },
  { key: "cod_notes",                  value: "Please keep exact change ready for the delivery rider.", label: "COD Instructions for Customer", category: "payment" },
  /* ═══════════════════  AJK Wallet  ═══════════════════ */
  { key: "wallet_min_topup",           value: "100",      label: "Minimum Top-Up (Rs.)",                 category: "payment" },
  { key: "wallet_max_topup",           value: "25000",    label: "Maximum Single Top-Up (Rs.)",          category: "payment" },
  { key: "wallet_max_balance",         value: "50000",    label: "Maximum Wallet Balance (Rs.)",         category: "payment" },
  { key: "wallet_min_withdrawal",      value: "200",      label: "Minimum Withdrawal (Rs.)",             category: "payment" },
  { key: "wallet_max_withdrawal",      value: "10000",    label: "Maximum Single Withdrawal (Rs.)",      category: "payment" },
  { key: "wallet_daily_limit",         value: "20000",    label: "Daily Transaction Limit (Rs.)",        category: "payment" },
  { key: "wallet_cashback_pct",        value: "0",        label: "Wallet Cashback (%)",                  category: "payment" },
  { key: "wallet_referral_bonus",      value: "100",      label: "Referral Bonus to Wallet (Rs.)",       category: "payment" },
  { key: "wallet_topup_methods",       value: "jazzcash,easypaisa,bank,rider", label: "Accepted Top-Up Methods",  category: "payment" },
  /* ═══════════════════  Payment General Rules  ═══════════════════ */
  { key: "payment_timeout_mins",       value: "15",       label: "Payment Timeout (minutes)",            category: "payment" },
  { key: "payment_auto_cancel",        value: "on",       label: "Auto-Cancel Unpaid Orders",            category: "payment" },
  { key: "payment_min_online",         value: "50",       label: "Minimum Online Payment (Rs.)",         category: "payment" },
  { key: "payment_max_online",         value: "100000",   label: "Maximum Online Payment (Rs.)",         category: "payment" },
];

export async function getPlatformSettings(): Promise<Record<string, string>> {
  // Always seed missing keys (onConflictDoNothing skips existing ones)
  await db.insert(platformSettingsTable).values(DEFAULT_PLATFORM_SETTINGS).onConflictDoNothing();
  const rows = await db.select().from(platformSettingsTable);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

const router: IRouter = Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET || "ajkmart-admin-2025";

async function adminAuth(req: Request, res: Response, next: NextFunction) {
  const auth = String(req.headers["x-admin-secret"] || req.query["secret"] || "");
  if (auth === ADMIN_SECRET) { (req as any).adminRole = "super"; next(); return; }
  const [sub] = await db.select().from(adminAccountsTable)
    .where(and(eq(adminAccountsTable.secret, auth), eq(adminAccountsTable.isActive, true)))
    .limit(1);
  if (sub) {
    (req as any).adminRole = sub.role;
    (req as any).adminId   = sub.id;
    await db.update(adminAccountsTable).set({ lastLoginAt: new Date() }).where(eq(adminAccountsTable.id, sub.id));
    next(); return;
  }
  res.status(401).json({ error: "Unauthorized. Invalid admin secret." });
}

/* ── helpers ── */
async function sendUserNotification(userId: string, title: string, body: string, type: string, icon: string) {
  await db.insert(notificationsTable).values({
    id: generateId(),
    userId,
    title,
    body,
    type,
    icon,
  }).catch(() => {});
}

const ORDER_NOTIFICATIONS: Record<string, { title: string; body: string; icon: string }> = {
  confirmed:         { title: "Order Confirmed! ✅", body: "Your order has been confirmed and is being prepared.", icon: "checkmark-circle-outline" },
  preparing:         { title: "Order Being Prepared 🍳", body: "The vendor is now preparing your order.", icon: "restaurant-outline" },
  out_for_delivery:  { title: "On the Way! 🚴", body: "Your order is out for delivery. Track your rider.", icon: "bicycle-outline" },
  delivered:         { title: "Order Delivered! 🎉", body: "Your order has been delivered. Enjoy!", icon: "bag-check-outline" },
  cancelled:         { title: "Order Cancelled ❌", body: "Your order has been cancelled by the store.", icon: "close-circle-outline" },
};

const RIDE_NOTIFICATIONS: Record<string, { title: string; body: string; icon: string }> = {
  accepted:    { title: "Driver Found! 🚗", body: "A driver has accepted your ride. They are on the way.", icon: "car-outline" },
  arrived:     { title: "Driver Arrived! 📍", body: "Your driver has arrived at the pickup location.", icon: "location-outline" },
  in_transit:  { title: "Ride Started 🛣️", body: "Your ride is now in progress. Sit back and relax.", icon: "navigate-outline" },
  completed:   { title: "Ride Completed! ⭐", body: "Your ride has been completed. Thanks for choosing AJKMart!", icon: "star-outline" },
  cancelled:   { title: "Ride Cancelled ❌", body: "Your ride has been cancelled.", icon: "close-circle-outline" },
};

const PHARMACY_NOTIFICATIONS: Record<string, { title: string; body: string; icon: string }> = {
  confirmed:        { title: "Pharmacy Order Confirmed ✅", body: "Your medicine order has been confirmed.", icon: "checkmark-circle-outline" },
  preparing:        { title: "Medicines Being Packed 💊", body: "Your medicines are being prepared for delivery.", icon: "medical-outline" },
  out_for_delivery: { title: "Medicines On the Way! 🚴", body: "Your medicines are out for delivery.", icon: "bicycle-outline" },
  delivered:        { title: "Medicines Delivered! 💊", body: "Your pharmacy order has been delivered.", icon: "bag-check-outline" },
  cancelled:        { title: "Order Cancelled ❌", body: "Your pharmacy order has been cancelled.", icon: "close-circle-outline" },
};

const PARCEL_NOTIFICATIONS: Record<string, { title: string; body: string; icon: string }> = {
  accepted:    { title: "Rider Assigned! 📦", body: "A rider has been assigned to deliver your parcel.", icon: "person-outline" },
  in_transit:  { title: "Parcel In Transit 🚚", body: "Your parcel is on the way to the destination.", icon: "cube-outline" },
  completed:   { title: "Parcel Delivered! ✅", body: "Your parcel has been delivered successfully.", icon: "checkmark-circle-outline" },
  cancelled:   { title: "Booking Cancelled ❌", body: "Your parcel booking has been cancelled.", icon: "close-circle-outline" },
};

/* ── Auth check ── */
router.post("/auth", (req, res) => {
  const { secret } = req.body;
  if (secret === ADMIN_SECRET) {
    res.json({ success: true, token: ADMIN_SECRET });
  } else {
    res.status(401).json({ error: "Invalid admin password" });
  }
});

router.use(adminAuth);

/* ── Dashboard Stats ── */
router.get("/stats", async (_req, res) => {
  const [userCount] = await db.select({ count: count() }).from(usersTable);
  const [orderCount] = await db.select({ count: count() }).from(ordersTable);
  const [rideCount] = await db.select({ count: count() }).from(ridesTable);
  const [pharmCount] = await db.select({ count: count() }).from(pharmacyOrdersTable);
  const [parcelCount] = await db.select({ count: count() }).from(parcelBookingsTable);
  const [productCount] = await db.select({ count: count() }).from(productsTable);

  const [totalRevenue] = await db
    .select({ total: sum(ordersTable.total) })
    .from(ordersTable)
    .where(eq(ordersTable.status, "delivered"));

  const [rideRevenue] = await db
    .select({ total: sum(ridesTable.fare) })
    .from(ridesTable)
    .where(eq(ridesTable.status, "completed"));

  const [pharmRevenue] = await db
    .select({ total: sum(pharmacyOrdersTable.total) })
    .from(pharmacyOrdersTable)
    .where(eq(pharmacyOrdersTable.status, "delivered"));

  const recentOrders = await db
    .select()
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt))
    .limit(5);

  const recentRides = await db
    .select()
    .from(ridesTable)
    .orderBy(desc(ridesTable.createdAt))
    .limit(5);

  res.json({
    users: userCount!.count,
    orders: orderCount!.count,
    rides: rideCount!.count,
    pharmacyOrders: pharmCount!.count,
    parcelBookings: parcelCount!.count,
    products: productCount!.count,
    revenue: {
      orders: parseFloat(totalRevenue!.total ?? "0"),
      rides: parseFloat(rideRevenue!.total ?? "0"),
      pharmacy: parseFloat(pharmRevenue!.total ?? "0"),
      total:
        parseFloat(totalRevenue!.total ?? "0") +
        parseFloat(rideRevenue!.total ?? "0") +
        parseFloat(pharmRevenue!.total ?? "0"),
    },
    recentOrders: recentOrders.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
    recentRides: recentRides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

/* ── Users ── */
router.get("/users", async (_req, res) => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  res.json({
    users: users.map(u => ({
      ...u,
      walletBalance: parseFloat(u.walletBalance ?? "0"),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    })),
    total: users.length,
  });
});

router.patch("/users/:id", async (req, res) => {
  const { role, isActive, walletBalance } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (role !== undefined) updates.role = role;
  if (isActive !== undefined) updates.isActive = isActive;
  if (walletBalance !== undefined) updates.walletBalance = String(walletBalance);

  const [user] = await db
    .update(usersTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();

  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ ...user, walletBalance: parseFloat(user.walletBalance ?? "0") });
});

/* ── Wallet Top-up ── */
router.post("/users/:id/wallet-topup", async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Valid amount is required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const currentBalance = parseFloat(user.walletBalance ?? "0");
  const newBalance = currentBalance + Number(amount);

  const [updatedUser] = await db
    .update(usersTable)
    .set({ walletBalance: String(newBalance), updatedAt: new Date() })
    .where(eq(usersTable.id, req.params["id"]!))
    .returning();

  await db.insert(walletTransactionsTable).values({
    id: generateId(),
    userId: req.params["id"]!,
    type: "credit",
    amount: String(amount),
    description: description || `Admin top-up: Rs. ${amount}`,
    reference: "admin_topup",
  });

  await sendUserNotification(
    req.params["id"]!,
    "Wallet Topped Up! 💰",
    `Rs. ${amount} has been added to your AJKMart wallet.`,
    "system",
    "wallet-outline"
  );

  res.json({
    success: true,
    newBalance,
    user: { ...updatedUser!, walletBalance: newBalance },
  });
});

/* ── All Orders ── */
router.get("/orders", async (req, res) => {
  const { status, type, limit: lim } = req.query;
  const orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(Number(lim) || 200);

  const filtered = orders
    .filter(o => !status || o.status === status)
    .filter(o => !type || o.type === type);

  res.json({
    orders: filtered.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
    total: filtered.length,
  });
});

router.patch("/orders/:id/status", async (req, res) => {
  const { status } = req.body;
  const [order] = await db
    .update(ordersTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(ordersTable.id, req.params["id"]!))
    .returning();
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const notif = ORDER_NOTIFICATIONS[status];
  if (notif) {
    await sendUserNotification(order.userId, notif.title, notif.body, "mart", notif.icon);
  }

  // NOTE: Wallet is already debited when order is PLACED (orders.ts).
  // Do NOT deduct again here. Only credit the rider's share on delivery.
  if (status === "delivered") {
    const total = parseFloat(String(order.total));
    const riderKeepPct = parseFloat((await getPlatformSettings())["rider_keep_pct"] ?? "80") / 100;
    const riderEarning = parseFloat((total * riderKeepPct).toFixed(2));
    // Credit assigned rider's wallet earnings
    if (order.riderId) {
      const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, order.riderId));
      if (rider) {
        const riderNewBal = (parseFloat(rider.walletBalance ?? "0") + riderEarning).toFixed(2);
        await db.update(usersTable).set({ walletBalance: riderNewBal, updatedAt: new Date() }).where(eq(usersTable.id, rider.id));
        await db.insert(walletTransactionsTable).values({
          id: generateId(), userId: rider.id, type: "credit",
          amount: String(riderEarning),
          description: `Delivery earnings — Order #${order.id.slice(-6).toUpperCase()} (${Math.round(riderKeepPct * 100)}%)`,
        });
      }
    }
  }

  res.json({ ...order, total: parseFloat(String(order.total)) });
});

/* ── All Rides ── */
router.get("/rides", async (_req, res) => {
  const rides = await db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(200);
  res.json({
    rides: rides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total: rides.length,
  });
});

router.patch("/rides/:id/status", async (req, res) => {
  const { status, riderName, riderPhone } = req.body;
  const updateData: any = { status, updatedAt: new Date() };
  if (riderName) updateData.riderName = riderName;
  if (riderPhone) updateData.riderPhone = riderPhone;

  const [ride] = await db
    .update(ridesTable)
    .set(updateData)
    .where(eq(ridesTable.id, req.params["id"]!))
    .returning();
  if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }

  const notif = RIDE_NOTIFICATIONS[status];
  if (notif) {
    await sendUserNotification(ride.userId, notif.title, notif.body, "ride", notif.icon);
  }

  // NOTE: Wallet already debited at ride booking (rides.ts).
  // On completion, credit rider's earnings share.
  if (status === "completed") {
    const fare = parseFloat(ride.fare);
    const s = await getPlatformSettings();
    const riderKeepPct = parseFloat(s["rider_keep_pct"] ?? "80") / 100;
    const riderEarning = parseFloat((fare * riderKeepPct).toFixed(2));
    if (ride.riderId) {
      const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, ride.riderId));
      if (rider) {
        const riderNewBal = (parseFloat(rider.walletBalance ?? "0") + riderEarning).toFixed(2);
        await db.update(usersTable).set({ walletBalance: riderNewBal, updatedAt: new Date() }).where(eq(usersTable.id, rider.id));
        await db.insert(walletTransactionsTable).values({
          id: generateId(), userId: rider.id, type: "credit",
          amount: String(riderEarning),
          description: `Ride earnings — #${ride.id.slice(-6).toUpperCase()} (${Math.round(riderKeepPct * 100)}%)`,
        });
        await sendUserNotification(rider.id, "Ride Payment Received 💰", `Rs. ${riderEarning} wallet mein add ho gaya!`, "ride", "wallet-outline");
      }
    }
  }

  res.json({ ...ride, fare: parseFloat(ride.fare), distance: parseFloat(ride.distance) });
});

/* ── Pharmacy Orders ── */
router.get("/pharmacy-orders", async (_req, res) => {
  const orders = await db
    .select()
    .from(pharmacyOrdersTable)
    .orderBy(desc(pharmacyOrdersTable.createdAt))
    .limit(200);
  res.json({
    orders: orders.map(o => ({
      ...o,
      total: parseFloat(o.total),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
    total: orders.length,
  });
});

router.patch("/pharmacy-orders/:id/status", async (req, res) => {
  const { status } = req.body;
  const [order] = await db
    .update(pharmacyOrdersTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(pharmacyOrdersTable.id, req.params["id"]!))
    .returning();
  if (!order) { res.status(404).json({ error: "Not found" }); return; }

  const notif = PHARMACY_NOTIFICATIONS[status];
  if (notif) {
    await sendUserNotification(order.userId, notif.title, notif.body, "pharmacy", notif.icon);
  }

  // Wallet refund on cancellation (atomic)
  if (status === "cancelled" && order.paymentMethod === "wallet") {
    const refundAmt = parseFloat(order.total);
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() }).where(eq(usersTable.id, order.userId));
      await tx.insert(walletTransactionsTable).values({ id: generateId(), userId: order.userId, type: "credit", amount: refundAmt.toFixed(2), description: `Refund — Pharmacy Order #${order.id.slice(-6).toUpperCase()} cancelled` });
    }).catch(() => {});
    await sendUserNotification(order.userId, "Pharmacy Refund 💊💰", `Rs. ${refundAmt} refunded to your wallet.`, "pharmacy", "wallet-outline");
  }

  res.json({ ...order, total: parseFloat(order.total) });
});

/* ── Parcel Bookings ── */
router.get("/parcel-bookings", async (_req, res) => {
  const bookings = await db
    .select()
    .from(parcelBookingsTable)
    .orderBy(desc(parcelBookingsTable.createdAt))
    .limit(200);
  res.json({
    bookings: bookings.map(b => ({
      ...b,
      fare: parseFloat(b.fare),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    })),
    total: bookings.length,
  });
});

router.patch("/parcel-bookings/:id/status", async (req, res) => {
  const { status } = req.body;
  const [booking] = await db
    .update(parcelBookingsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(parcelBookingsTable.id, req.params["id"]!))
    .returning();
  if (!booking) { res.status(404).json({ error: "Not found" }); return; }

  const notif = PARCEL_NOTIFICATIONS[status];
  if (notif) {
    await sendUserNotification(booking.userId, notif.title, notif.body, "parcel", notif.icon);
  }

  // Wallet refund on cancellation (atomic)
  if (status === "cancelled" && booking.paymentMethod === "wallet") {
    const refundAmt = parseFloat(booking.fare);
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ walletBalance: sql`wallet_balance + ${refundAmt}`, updatedAt: new Date() }).where(eq(usersTable.id, booking.userId));
      await tx.insert(walletTransactionsTable).values({ id: generateId(), userId: booking.userId, type: "credit", amount: refundAmt.toFixed(2), description: `Refund — Parcel Booking #${booking.id.slice(-6).toUpperCase()} cancelled` });
    }).catch(() => {});
    await sendUserNotification(booking.userId, "Parcel Refund 📦💰", `Rs. ${refundAmt} refunded to your wallet.`, "parcel", "wallet-outline");
  }

  res.json({ ...booking, fare: parseFloat(booking.fare) });
});

/* ── Products ── */
router.get("/products", async (_req, res) => {
  const products = await db.select().from(productsTable).orderBy(desc(productsTable.createdAt));
  res.json({
    products: products.map(p => ({
      ...p,
      price: parseFloat(p.price),
      originalPrice: p.originalPrice ? parseFloat(p.originalPrice) : null,
      rating: p.rating ? parseFloat(p.rating) : null,
      createdAt: p.createdAt.toISOString(),
    })),
    total: products.length,
  });
});

router.post("/products", async (req, res) => {
  const { name, description, price, originalPrice, category, type, unit, vendorName, inStock, deliveryTime, image } = req.body;
  if (!name || !price || !category) {
    res.status(400).json({ error: "name, price, and category are required" });
    return;
  }
  const [product] = await db.insert(productsTable).values({
    id: generateId(),
    name,
    description: description || null,
    price: String(price),
    originalPrice: originalPrice ? String(originalPrice) : null,
    category,
    type: type || "mart",
    vendorId: "ajkmart_system",
    vendorName: vendorName || "AJKMart Store",
    unit: unit || null,
    inStock: inStock !== false,
    deliveryTime: deliveryTime || "30-45 min",
    rating: "4.5",
    reviewCount: 0,
    image: image || null,
  }).returning();
  res.status(201).json({ ...product!, price: parseFloat(product!.price) });
});

router.patch("/products/:id", async (req, res) => {
  const { name, description, price, originalPrice, category, unit, inStock, vendorName, deliveryTime, image } = req.body;
  const updates: Partial<typeof productsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (price !== undefined) updates.price = String(price);
  if (originalPrice !== undefined) updates.originalPrice = originalPrice ? String(originalPrice) : null;
  if (category !== undefined) updates.category = category;
  if (unit !== undefined) updates.unit = unit;
  if (inStock !== undefined) updates.inStock = inStock;
  if (vendorName !== undefined) updates.vendorName = vendorName;
  if (deliveryTime !== undefined) updates.deliveryTime = deliveryTime;
  if (image !== undefined) updates.image = image;

  const [product] = await db
    .update(productsTable)
    .set(updates)
    .where(eq(productsTable.id, req.params["id"]!))
    .returning();
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  res.json({ ...product, price: parseFloat(product.price) });
});

router.delete("/products/:id", async (req, res) => {
  await db.delete(productsTable).where(eq(productsTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ── Broadcast Notification ── */
router.post("/broadcast", async (req, res) => {
  const { title, body, type = "system", icon = "notifications-outline" } = req.body;
  if (!title || !body) { res.status(400).json({ error: "title and body required" }); return; }

  const users = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.isActive, true));
  let sent = 0;
  for (const user of users) {
    await db.insert(notificationsTable).values({
      id: generateId(),
      userId: user.id,
      title,
      body,
      type,
      icon,
    }).catch(() => {});
    sent++;
  }
  res.json({ success: true, sent });
});

/* ── Wallet Transactions ── */
router.get("/transactions", async (_req, res) => {
  const transactions = await db
    .select()
    .from(walletTransactionsTable)
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(200);

  const totalCredit = transactions.filter(t => t.type === "credit").reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalDebit = transactions.filter(t => t.type === "debit").reduce((s, t) => s + parseFloat(t.amount), 0);

  res.json({
    transactions: transactions.map(t => ({
      ...t,
      amount: parseFloat(t.amount),
      createdAt: t.createdAt.toISOString(),
    })),
    total: transactions.length,
    totalCredit,
    totalDebit,
  });
});

/* ── Platform Settings ── */
router.get("/platform-settings", async (_req, res) => {
  let rows = await db.select().from(platformSettingsTable);
  if (rows.length === 0) {
    await db.insert(platformSettingsTable).values(DEFAULT_PLATFORM_SETTINGS).onConflictDoNothing();
    rows = await db.select().from(platformSettingsTable);
  }
  const grouped: Record<string, any[]> = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category]!.push({ key: row.key, value: row.value, label: row.label, updatedAt: row.updatedAt.toISOString() });
  }
  res.json({ settings: rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() })), grouped });
});

router.put("/platform-settings", async (req, res) => {
  const { settings } = req.body as { settings: Array<{ key: string; value: string }> };
  if (!Array.isArray(settings)) { res.status(400).json({ error: "settings array required" }); return; }
  for (const { key, value } of settings) {
    await db
      .update(platformSettingsTable)
      .set({ value: String(value), updatedAt: new Date() })
      .where(eq(platformSettingsTable.key, key));
  }
  const rows = await db.select().from(platformSettingsTable);
  res.json({ success: true, settings: rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() })) });
});

router.patch("/platform-settings/:key", async (req, res) => {
  const { value } = req.body;
  const [row] = await db
    .update(platformSettingsTable)
    .set({ value: String(value), updatedAt: new Date() })
    .where(eq(platformSettingsTable.key, req.params["key"]!))
    .returning();
  if (!row) { res.status(404).json({ error: "Setting not found" }); return; }
  res.json({ ...row, updatedAt: row.updatedAt.toISOString() });
});

/* ── Pharmacy Orders Enriched ── */
router.get("/pharmacy-enriched", async (_req, res) => {
  const orders = await db.select().from(pharmacyOrdersTable).orderBy(desc(pharmacyOrdersTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    orders: orders.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      userName: userMap[o.userId]?.name || null,
      userPhone: userMap[o.userId]?.phone || null,
    })),
    total: orders.length,
  });
});

/* ── Parcel Bookings Enriched ── */
router.get("/parcel-enriched", async (_req, res) => {
  const bookings = await db.select().from(parcelBookingsTable).orderBy(desc(parcelBookingsTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    bookings: bookings.map(b => ({
      ...b,
      fare: parseFloat(b.fare),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
      userName: userMap[b.userId]?.name || null,
      userPhone: userMap[b.userId]?.phone || null,
    })),
    total: bookings.length,
  });
});

/* ── Transactions Enriched ── */
router.get("/transactions-enriched", async (_req, res) => {
  const transactions = await db.select().from(walletTransactionsTable).orderBy(desc(walletTransactionsTable.createdAt)).limit(300);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  const enriched = transactions.map(t => ({
    ...t,
    amount: parseFloat(t.amount),
    createdAt: t.createdAt.toISOString(),
    userName: userMap[t.userId]?.name || null,
    userPhone: userMap[t.userId]?.phone || null,
  }));

  const totalCredit = enriched.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  const totalDebit = enriched.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);

  res.json({ transactions: enriched, total: transactions.length, totalCredit, totalDebit });
});

/* ── Delete User ── */
router.delete("/users/:id", async (req, res) => {
  await db.delete(usersTable).where(eq(usersTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ── User Activity (orders + rides summary) ── */
router.get("/users/:id/activity", async (req, res) => {
  const uid = req.params["id"]!;
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.userId, uid)).orderBy(desc(ordersTable.createdAt)).limit(10);
  const rides = await db.select().from(ridesTable).where(eq(ridesTable.userId, uid)).orderBy(desc(ridesTable.createdAt)).limit(10);
  const pharmacy = await db.select().from(pharmacyOrdersTable).where(eq(pharmacyOrdersTable.userId, uid)).orderBy(desc(pharmacyOrdersTable.createdAt)).limit(5);
  const parcels = await db.select().from(parcelBookingsTable).where(eq(parcelBookingsTable.userId, uid)).orderBy(desc(parcelBookingsTable.createdAt)).limit(5);
  const txns = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.userId, uid)).orderBy(desc(walletTransactionsTable.createdAt)).limit(10);
  res.json({
    orders: orders.map(o => ({ ...o, total: parseFloat(String(o.total)), createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString() })),
    rides: rides.map(r => ({ ...r, fare: parseFloat(r.fare), distance: parseFloat(r.distance), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
    pharmacy: pharmacy.map(p => ({ ...p, total: parseFloat(String(p.total)), createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() })),
    parcels: parcels.map(p => ({ ...p, fare: parseFloat(p.fare), createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() })),
    transactions: txns.map(t => ({ ...t, amount: parseFloat(t.amount), createdAt: t.createdAt.toISOString() })),
  });
});

/* ── Overview with user enrichment (orders + user info) ── */
router.get("/orders-enriched", async (_req, res) => {
  const orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    orders: orders.map(o => ({
      ...o,
      total: parseFloat(String(o.total)),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      userName: userMap[o.userId]?.name || null,
      userPhone: userMap[o.userId]?.phone || null,
    })),
    total: orders.length,
  });
});

router.get("/rides-enriched", async (_req, res) => {
  const rides = await db.select().from(ridesTable).orderBy(desc(ridesTable.createdAt)).limit(200);
  const users = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone }).from(usersTable);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  res.json({
    rides: rides.map(r => ({
      ...r,
      fare: parseFloat(r.fare),
      distance: parseFloat(r.distance),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      userName: userMap[r.userId]?.name || null,
      userPhone: userMap[r.userId]?.phone || null,
    })),
    total: rides.length,
  });
});

/* ── User Security Management ── */
router.patch("/users/:id/security", async (req, res) => {
  const { id } = req.params;
  const body = req.body as any;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.isActive     !== undefined) updates.isActive     = body.isActive;
  if (body.isBanned     !== undefined) updates.isBanned     = body.isBanned;
  if (body.banReason    !== undefined) updates.banReason    = body.banReason || null;
  if (body.roles        !== undefined) updates.roles        = body.roles;
  if (body.role         !== undefined) updates.role         = body.role;
  if (body.blockedServices !== undefined) updates.blockedServices = body.blockedServices;
  if (body.securityNote !== undefined) updates.securityNote = body.securityNote || null;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id!)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (body.isBanned && body.notify) {
    await sendUserNotification(id!, "Account Suspended ⚠️", body.banReason || "Your account has been suspended. Contact support.", "warning", "warning-outline");
  }
  res.json({ ...user, walletBalance: parseFloat(String(user.walletBalance)) });
});

router.post("/users/:id/reset-otp", async (req, res) => {
  await db.update(usersTable).set({ otpCode: null, otpExpiry: null, updatedAt: new Date() }).where(eq(usersTable.id, req.params["id"]!));
  res.json({ success: true, message: "OTP cleared — user must re-authenticate" });
});

/* ── Admin Accounts (Sub-Admins) ── */
router.get("/admin-accounts", async (_req, res) => {
  const accounts = await db.select({
    id: adminAccountsTable.id,
    name: adminAccountsTable.name,
    role: adminAccountsTable.role,
    permissions: adminAccountsTable.permissions,
    isActive: adminAccountsTable.isActive,
    lastLoginAt: adminAccountsTable.lastLoginAt,
    createdAt: adminAccountsTable.createdAt,
  }).from(adminAccountsTable).orderBy(desc(adminAccountsTable.createdAt));
  res.json({
    accounts: accounts.map(a => ({
      ...a,
      lastLoginAt: a.lastLoginAt ? a.lastLoginAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

router.post("/admin-accounts", async (req, res) => {
  const body = req.body as any;
  if (!body.name || !body.secret) { res.status(400).json({ error: "name and secret required" }); return; }
  if (body.secret === ADMIN_SECRET) { res.status(400).json({ error: "Cannot use the master secret" }); return; }
  try {
    const [account] = await db.insert(adminAccountsTable).values({
      id:          generateId(),
      name:        body.name,
      secret:      body.secret,
      role:        body.role        || "manager",
      permissions: body.permissions || "",
      isActive:    body.isActive !== false,
    }).returning();
    res.status(201).json({ ...account, secret: "••••••", createdAt: account.createdAt.toISOString() });
  } catch (e: any) {
    if (e.code === "23505") { res.status(409).json({ error: "Secret already in use" }); return; }
    throw e;
  }
});

router.patch("/admin-accounts/:id", async (req, res) => {
  const body = req.body as any;
  const updates: Record<string, any> = {};
  if (body.name        !== undefined) updates.name        = body.name;
  if (body.role        !== undefined) updates.role        = body.role;
  if (body.permissions !== undefined) updates.permissions = body.permissions;
  if (body.isActive    !== undefined) updates.isActive    = body.isActive;
  if (body.secret      !== undefined) {
    if (body.secret === ADMIN_SECRET) { res.status(400).json({ error: "Cannot use the master secret" }); return; }
    updates.secret = body.secret;
  }
  const [account] = await db.update(adminAccountsTable).set(updates).where(eq(adminAccountsTable.id, req.params["id"]!)).returning();
  if (!account) { res.status(404).json({ error: "Admin account not found" }); return; }
  res.json({ ...account, secret: "••••••", createdAt: account.createdAt.toISOString() });
});

router.delete("/admin-accounts/:id", async (req, res) => {
  await db.delete(adminAccountsTable).where(eq(adminAccountsTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ── App Management ── */
router.get("/app-overview", async (_req, res) => {
  const [
    totalUsers, activeUsers, bannedUsers,
    totalOrders, pendingOrders,
    totalRides, activeRides,
    totalPharmacy, totalParcel,
    settings, adminAccounts,
  ] = await Promise.all([
    db.select({ c: count() }).from(usersTable),
    db.select({ c: count() }).from(usersTable).where(eq(usersTable.isActive, true)),
    db.select({ c: count() }).from(usersTable).where(eq(usersTable.isBanned, true)),
    db.select({ c: count() }).from(ordersTable),
    db.select({ c: count() }).from(ordersTable).where(eq(ordersTable.status, "pending")),
    db.select({ c: count() }).from(ridesTable),
    db.select({ c: count() }).from(ridesTable).where(eq(ridesTable.status, "ongoing")),
    db.select({ c: count() }).from(pharmacyOrdersTable),
    db.select({ c: count() }).from(parcelBookingsTable),
    db.select().from(platformSettingsTable),
    db.select({ c: count() }).from(adminAccountsTable).where(eq(adminAccountsTable.isActive, true)),
  ]);
  const settingsMap = Object.fromEntries(settings.map(s => [s.key, s.value]));
  res.json({
    users:    { total: totalUsers[0]?.c ?? 0, active: activeUsers[0]?.c ?? 0, banned: bannedUsers[0]?.c ?? 0 },
    orders:   { total: totalOrders[0]?.c ?? 0, pending: pendingOrders[0]?.c ?? 0 },
    rides:    { total: totalRides[0]?.c ?? 0, active: activeRides[0]?.c ?? 0 },
    pharmacy: { total: totalPharmacy[0]?.c ?? 0 },
    parcel:   { total: totalParcel[0]?.c ?? 0 },
    adminAccounts: adminAccounts[0]?.c ?? 0,
    appStatus:    settingsMap["app_status"]    || "active",
    appName:      settingsMap["app_name"]      || "AJKMart",
    features: {
      mart:     settingsMap["feature_mart"]     || "on",
      food:     settingsMap["feature_food"]     || "on",
      rides:    settingsMap["feature_rides"]    || "on",
      pharmacy: settingsMap["feature_pharmacy"] || "on",
      parcel:   settingsMap["feature_parcel"]   || "on",
      wallet:   settingsMap["feature_wallet"]   || "on",
    },
  });
});

/* ── Flash Deals ── */
router.get("/flash-deals", async (_req, res) => {
  const deals = await db.select().from(flashDealsTable).orderBy(desc(flashDealsTable.createdAt));
  const products = await db.select({ id: productsTable.id, name: productsTable.name, price: productsTable.price, image: productsTable.image, category: productsTable.category }).from(productsTable);
  const productMap = Object.fromEntries(products.map(p => [p.id, p]));
  const now = new Date();
  res.json({
    deals: deals.map(d => ({
      ...d,
      discountPct:  d.discountPct  ? parseFloat(String(d.discountPct))  : null,
      discountFlat: d.discountFlat ? parseFloat(String(d.discountFlat)) : null,
      startTime: d.startTime.toISOString(),
      endTime:   d.endTime.toISOString(),
      createdAt: d.createdAt.toISOString(),
      product:   productMap[d.productId] ?? null,
      status: !d.isActive ? "inactive"
            : now < d.startTime ? "scheduled"
            : now > d.endTime   ? "expired"
            : d.dealStock !== null && d.soldCount >= d.dealStock ? "sold_out"
            : "live",
    })),
  });
});

router.post("/flash-deals", async (req, res) => {
  const body = req.body as any;
  if (!body.productId || !body.startTime || !body.endTime) {
    res.status(400).json({ error: "productId, startTime, endTime required" }); return;
  }
  const [deal] = await db.insert(flashDealsTable).values({
    id:           generateId(),
    productId:    body.productId,
    title:        body.title    || null,
    badge:        body.badge    || "FLASH",
    discountPct:  body.discountPct  ? String(body.discountPct)  : null,
    discountFlat: body.discountFlat ? String(body.discountFlat) : null,
    startTime:    new Date(body.startTime),
    endTime:      new Date(body.endTime),
    dealStock:    body.dealStock  ? Number(body.dealStock)  : null,
    isActive:     body.isActive !== false,
  }).returning();
  res.status(201).json(deal);
});

router.patch("/flash-deals/:id", async (req, res) => {
  const body = req.body as any;
  const updates: Record<string, any> = {};
  if (body.title        !== undefined) updates.title        = body.title;
  if (body.badge        !== undefined) updates.badge        = body.badge;
  if (body.discountPct  !== undefined) updates.discountPct  = body.discountPct  ? String(body.discountPct)  : null;
  if (body.discountFlat !== undefined) updates.discountFlat = body.discountFlat ? String(body.discountFlat) : null;
  if (body.startTime    !== undefined) updates.startTime    = new Date(body.startTime);
  if (body.endTime      !== undefined) updates.endTime      = new Date(body.endTime);
  if (body.dealStock    !== undefined) updates.dealStock    = body.dealStock ? Number(body.dealStock) : null;
  if (body.isActive     !== undefined) updates.isActive     = body.isActive;
  const [deal] = await db.update(flashDealsTable).set(updates).where(eq(flashDealsTable.id, req.params["id"]!)).returning();
  if (!deal) { res.status(404).json({ error: "Deal not found" }); return; }
  res.json(deal);
});

router.delete("/flash-deals/:id", async (req, res) => {
  await db.delete(flashDealsTable).where(eq(flashDealsTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ── Promo Codes ── */
router.get("/promo-codes", async (_req, res) => {
  const codes = await db.select().from(promoCodesTable).orderBy(desc(promoCodesTable.createdAt));
  const now = new Date();
  res.json({
    codes: codes.map(c => ({
      ...c,
      discountPct:    c.discountPct    ? parseFloat(String(c.discountPct))    : null,
      discountFlat:   c.discountFlat   ? parseFloat(String(c.discountFlat))   : null,
      minOrderAmount: c.minOrderAmount ? parseFloat(String(c.minOrderAmount)) : 0,
      maxDiscount:    c.maxDiscount    ? parseFloat(String(c.maxDiscount))    : null,
      expiresAt:  c.expiresAt  ? c.expiresAt.toISOString()  : null,
      createdAt:  c.createdAt.toISOString(),
      status: !c.isActive ? "inactive"
            : c.expiresAt && now > c.expiresAt ? "expired"
            : c.usageLimit !== null && c.usedCount >= c.usageLimit ? "exhausted"
            : "active",
    })),
  });
});

router.post("/promo-codes", async (req, res) => {
  const body = req.body as any;
  if (!body.code) { res.status(400).json({ error: "code required" }); return; }
  try {
    const [code] = await db.insert(promoCodesTable).values({
      id:             generateId(),
      code:           String(body.code).toUpperCase().trim(),
      description:    body.description    || null,
      discountPct:    body.discountPct    ? String(body.discountPct)    : null,
      discountFlat:   body.discountFlat   ? String(body.discountFlat)   : null,
      minOrderAmount: body.minOrderAmount ? String(body.minOrderAmount) : "0",
      maxDiscount:    body.maxDiscount    ? String(body.maxDiscount)    : null,
      usageLimit:     body.usageLimit     ? Number(body.usageLimit)     : null,
      appliesTo:      body.appliesTo      || "all",
      expiresAt:      body.expiresAt      ? new Date(body.expiresAt)    : null,
      isActive:       body.isActive !== false,
    }).returning();
    res.status(201).json(code);
  } catch (e: any) {
    if (e.code === "23505") { res.status(409).json({ error: "Promo code already exists" }); return; }
    throw e;
  }
});

router.patch("/promo-codes/:id", async (req, res) => {
  const body = req.body as any;
  const updates: Record<string, any> = {};
  if (body.code           !== undefined) updates.code           = String(body.code).toUpperCase().trim();
  if (body.description    !== undefined) updates.description    = body.description;
  if (body.discountPct    !== undefined) updates.discountPct    = body.discountPct    ? String(body.discountPct)    : null;
  if (body.discountFlat   !== undefined) updates.discountFlat   = body.discountFlat   ? String(body.discountFlat)   : null;
  if (body.minOrderAmount !== undefined) updates.minOrderAmount = String(body.minOrderAmount);
  if (body.maxDiscount    !== undefined) updates.maxDiscount    = body.maxDiscount    ? String(body.maxDiscount)    : null;
  if (body.usageLimit     !== undefined) updates.usageLimit     = body.usageLimit     ? Number(body.usageLimit)     : null;
  if (body.appliesTo      !== undefined) updates.appliesTo      = body.appliesTo;
  if (body.expiresAt      !== undefined) updates.expiresAt      = body.expiresAt      ? new Date(body.expiresAt)    : null;
  if (body.isActive       !== undefined) updates.isActive       = body.isActive;
  const [code] = await db.update(promoCodesTable).set(updates).where(eq(promoCodesTable.id, req.params["id"]!)).returning();
  if (!code) { res.status(404).json({ error: "Promo code not found" }); return; }
  res.json(code);
});

router.delete("/promo-codes/:id", async (req, res) => {
  await db.delete(promoCodesTable).where(eq(promoCodesTable.id, req.params["id"]!));
  res.json({ success: true });
});

/* ══════════════════════════════════════
   VENDOR MANAGEMENT
══════════════════════════════════════ */
router.get("/vendors", async (_req, res) => {
  const vendors = await db.select().from(usersTable).where(
    or(ilike(usersTable.roles, "%vendor%"), eq(usersTable.role, "vendor"))
  ).orderBy(desc(usersTable.createdAt));

  const vendorIds = vendors.map(v => v.id);
  let orderStats: any[] = [];
  if (vendorIds.length > 0) {
    orderStats = await db.select({
      vendorId: ordersTable.vendorId,
      totalOrders: count(),
      totalRevenue: sum(ordersTable.total),
      pendingOrders: sql<number>`COUNT(*) FILTER (WHERE ${ordersTable.status} = 'pending')`,
    }).from(ordersTable).where(sql`${ordersTable.vendorId} = ANY(${sql.raw(`ARRAY[${vendorIds.map(id => `'${id}'`).join(",")}]`)})`).groupBy(ordersTable.vendorId).catch(() => []);
  }

  const statsMap = Object.fromEntries(orderStats.map(s => [s.vendorId, s]));

  res.json({
    vendors: vendors.map(v => {
      const stats = statsMap[v.id] || {};
      return {
        id: v.id, phone: v.phone, name: v.name, email: v.email,
        storeName: v.storeName, storeCategory: v.storeCategory,
        storeIsOpen: v.storeIsOpen, storeDescription: v.storeDescription,
        walletBalance: parseFloat(v.walletBalance ?? "0"),
        isActive: v.isActive, isBanned: v.isBanned,
        roles: v.roles, role: v.role,
        createdAt: v.createdAt.toISOString(),
        lastLoginAt: v.lastLoginAt ? v.lastLoginAt.toISOString() : null,
        totalOrders: Number(stats.totalOrders ?? 0),
        totalRevenue: parseFloat(String(stats.totalRevenue ?? "0")),
        pendingOrders: Number(stats.pendingOrders ?? 0),
      };
    }),
    total: vendors.length,
  });
});

router.patch("/vendors/:id/status", async (req, res) => {
  const { isActive, isBanned, banReason, securityNote } = req.body;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (isActive    !== undefined) updates.isActive    = isActive;
  if (isBanned    !== undefined) updates.isBanned    = isBanned;
  if (banReason   !== undefined) updates.banReason   = banReason || null;
  if (securityNote !== undefined) updates.securityNote = securityNote || null;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.params["id"]!)).returning();
  if (!user) { res.status(404).json({ error: "Vendor not found" }); return; }
  if (isBanned) {
    await sendUserNotification(req.params["id"]!, "Store Account Suspended ⚠️", banReason || "Your vendor account has been suspended. Contact support.", "warning", "warning-outline");
  }
  res.json({ ...user, walletBalance: parseFloat(String(user.walletBalance ?? "0")) });
});

router.post("/vendors/:id/payout", async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Valid amount required" }); return;
  }
  const [vendor] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
  const amt = Number(amount);
  const currentBal = parseFloat(vendor.walletBalance ?? "0");
  if (currentBal < amt) {
    res.status(400).json({ error: `Insufficient wallet balance (Rs. ${currentBal.toFixed(0)})` }); return;
  }
  const newBal = currentBal - amt;
  const [updated] = await db.update(usersTable).set({ walletBalance: String(newBal), updatedAt: new Date() }).where(eq(usersTable.id, vendor.id)).returning();
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: vendor.id, type: "debit", amount: String(amt),
    description: description || `Admin payout processed: Rs. ${amt}`, reference: "admin_payout",
  });
  await sendUserNotification(vendor.id, "Payout Processed 💰", `Rs. ${amt} has been paid out from your vendor wallet.`, "system", "cash-outline");
  res.json({ success: true, amount: amt, newBalance: newBal, vendor: { ...updated, walletBalance: newBal } });
});

router.post("/vendors/:id/credit", async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Valid amount required" }); return;
  }
  const [vendor] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
  const amt = Number(amount);
  const newBal = parseFloat(vendor.walletBalance ?? "0") + amt;
  const [updated] = await db.update(usersTable).set({ walletBalance: String(newBal), updatedAt: new Date() }).where(eq(usersTable.id, vendor.id)).returning();
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: vendor.id, type: "credit", amount: String(amt),
    description: description || `Admin credit: Rs. ${amt}`, reference: "admin_credit",
  });
  await sendUserNotification(vendor.id, "Wallet Credited 💰", `Rs. ${amt} has been credited to your vendor wallet.`, "system", "wallet-outline");
  res.json({ success: true, amount: amt, newBalance: newBal, vendor: { ...updated, walletBalance: newBal } });
});

/* ══════════════════════════════════════
   RIDER MANAGEMENT
══════════════════════════════════════ */
router.get("/riders", async (_req, res) => {
  const riders = await db.select().from(usersTable).where(
    or(ilike(usersTable.roles, "%rider%"), eq(usersTable.role, "rider"))
  ).orderBy(desc(usersTable.createdAt));

  res.json({
    riders: riders.map(r => ({
      id: r.id, phone: r.phone, name: r.name, email: r.email,
      avatar: r.avatar,
      walletBalance: parseFloat(r.walletBalance ?? "0"),
      isActive: r.isActive, isBanned: r.isBanned,
      roles: r.roles, role: r.role,
      isOnline: (r as any).isOnline ?? false,
      createdAt: r.createdAt.toISOString(),
      lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
    })),
    total: riders.length,
  });
});

router.patch("/riders/:id/status", async (req, res) => {
  const { isActive, isBanned, banReason } = req.body;
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (isActive  !== undefined) updates.isActive  = isActive;
  if (isBanned  !== undefined) updates.isBanned  = isBanned;
  if (banReason !== undefined) updates.banReason = banReason || null;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.params["id"]!)).returning();
  if (!user) { res.status(404).json({ error: "Rider not found" }); return; }
  if (isBanned) {
    await sendUserNotification(req.params["id"]!, "Rider Account Suspended ⚠️", banReason || "Your rider account has been suspended. Contact support.", "warning", "warning-outline");
  }
  res.json({ ...user, walletBalance: parseFloat(String(user.walletBalance ?? "0")) });
});

router.post("/riders/:id/payout", async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Valid amount required" }); return;
  }
  const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!rider) { res.status(404).json({ error: "Rider not found" }); return; }
  const amt = Number(amount);
  const currentBal = parseFloat(rider.walletBalance ?? "0");
  if (currentBal < amt) {
    res.status(400).json({ error: `Insufficient wallet balance (Rs. ${currentBal.toFixed(0)})` }); return;
  }
  const newBal = currentBal - amt;
  const [updated] = await db.update(usersTable).set({ walletBalance: String(newBal), updatedAt: new Date() }).where(eq(usersTable.id, rider.id)).returning();
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: rider.id, type: "debit", amount: String(amt),
    description: description || `Rider payout: Rs. ${amt}`, reference: "rider_payout",
  });
  await sendUserNotification(rider.id, "Earnings Paid Out 💵", `Rs. ${amt} has been paid out to your account.`, "system", "cash-outline");
  res.json({ success: true, amount: amt, newBalance: newBal, rider: { ...updated, walletBalance: newBal } });
});

router.post("/riders/:id/bonus", async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "Valid amount required" }); return;
  }
  const [rider] = await db.select().from(usersTable).where(eq(usersTable.id, req.params["id"]!)).limit(1);
  if (!rider) { res.status(404).json({ error: "Rider not found" }); return; }
  const amt = Number(amount);
  const newBal = parseFloat(rider.walletBalance ?? "0") + amt;
  const [updated] = await db.update(usersTable).set({ walletBalance: String(newBal), updatedAt: new Date() }).where(eq(usersTable.id, rider.id)).returning();
  await db.insert(walletTransactionsTable).values({
    id: generateId(), userId: rider.id, type: "credit", amount: String(amt),
    description: description || `Admin bonus: Rs. ${amt}`, reference: "rider_bonus",
  });
  await sendUserNotification(rider.id, "Bonus Received! 🎉", `Rs. ${amt} bonus has been added to your wallet.`, "system", "gift-outline");
  res.json({ success: true, amount: amt, newBalance: newBal, rider: { ...updated, walletBalance: newBal } });
});

/* ── GET /admin/withdrawal-requests ─────────── */
router.get("/withdrawal-requests", async (_req, res) => {
  const txns = await db.select().from(walletTransactionsTable)
    .where(sql`description LIKE 'Withdrawal —%' AND type = 'debit'`)
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(200);
  const enriched = await Promise.all(txns.map(async t => {
    const [user] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, t.userId)).limit(1);
    return { ...t, amount: parseFloat(String(t.amount)), user: user || null };
  }));
  res.json({ withdrawals: enriched });
});

/* ── GET /admin/all-notifications ─────────── */
router.get("/all-notifications", async (req, res) => {
  const role = req.query["role"] as string | undefined;
  const limit = Math.min(parseInt(String(req.query["limit"] || "100")), 300);
  let userIds: string[] = [];
  if (role) {
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role as any, role));
    userIds = users.map(u => u.id);
    if (userIds.length === 0) { res.json({ notifications: [] }); return; }
  }
  const notifs = await db.select().from(notificationsTable)
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);
  const filtered = role ? notifs.filter(n => userIds.includes(n.userId)) : notifs;
  const enriched = await Promise.all(filtered.slice(0, 200).map(async n => {
    const [user] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, n.userId)).limit(1);
    return { ...n, user: user || null };
  }));
  res.json({ notifications: enriched });
});

export default router;
