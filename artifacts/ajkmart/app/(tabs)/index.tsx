import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";

import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useLanguage } from "@/context/LanguageContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { tDual } from "@workspace/i18n";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

const C      = Colors.light;
const W      = Dimensions.get("window").width;
const H_PAD  = 16;
const HALF_W = (W - H_PAD * 2 - 12) / 2;

/* ─────────────────────────── Active Order/Ride Tracker Strip ─────────────────────────── */
function ActiveTrackerStrip({ userId }: { userId: string }) {
  const { token } = useAuth();
  const authHdrs: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const { data: ordersData } = useQuery({
    queryKey: ["home-active-orders", userId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/orders`, { headers: authHdrs });
      return r.json();
    },
    enabled: !!userId && !!token,
    refetchInterval: 30000,
    staleTime: 20000,
  });

  const { data: ridesData } = useQuery({
    queryKey: ["home-active-rides", userId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/rides`, { headers: authHdrs });
      return r.json();
    },
    enabled: !!userId && !!token,
    refetchInterval: 30000,
    staleTime: 20000,
  });

  const activeOrders = (ordersData?.orders || []).filter((o: any) =>
    !["delivered", "cancelled"].includes(o.status)
  );
  const activeRides = (ridesData?.rides || []).filter((r: any) =>
    !["completed", "cancelled"].includes(r.status)
  );
  const totalActive = activeOrders.length + activeRides.length;

  if (totalActive === 0) return null;

  const hasRide  = activeRides.length > 0;
  const hasOrder = activeOrders.length > 0;

  let label = "";
  let icon: keyof typeof Ionicons.glyphMap = "timer-outline";
  let c1 = "#059669"; let c2 = "#10B981";

  if (hasRide && hasOrder) {
    label = `${activeRides.length} active ride • ${activeOrders.length} active order`;
    icon = "car-outline"; c1 = "#1D4ED8"; c2 = "#2563EB";
  } else if (hasRide) {
    const r = activeRides[0];
    const statusMap: Record<string, string> = { searching: "Rider dhoondh raha hai...", accepted: "Rider aa raha hai", arrived: "Rider pohonch gaya!", in_transit: "Safar jari hai 🚗" };
    label = statusMap[r.status] || "Ride active hai";
    icon = "car-outline"; c1 = "#059669"; c2 = "#10B981";
  } else {
    const o = activeOrders[0];
    const statusMap: Record<string, string> = { pending: "Order mila, confirm ho raha hai", confirmed: "Order confirm! Prepare ho raha hai", preparing: "Aapka khaana tayyar ho raha hai 🍳", out_for_delivery: "Order aa raha hai! 🚴", ready: "Order ready for pickup" };
    label = statusMap[o.status] || `${activeOrders.length} active order`;
    icon = o.type === "ride" ? "car-outline" : o.type === "food" ? "restaurant-outline" : "storefront-outline";
    c1 = "#1D4ED8"; c2 = "#2563EB";
  }

  return (
    <Pressable onPress={() => router.push("/(tabs)/orders")} style={styles.trackerWrap}>
      <LinearGradient colors={[c1, c2]} start={{ x:0,y:0 }} end={{ x:1,y:0 }} style={styles.trackerCard}>
        <View style={styles.trackerDot} />
        <Ionicons name={icon} size={15} color="#fff" />
        <Text style={styles.trackerTxt} numberOfLines={1}>{label}</Text>
        <Text style={styles.trackerCta}>Track →</Text>
      </LinearGradient>
    </Pressable>
  );
}

/* ─────────────────────────── animated tap wrapper ─────────────────────────── */
function Tap({ children, onPress, style, delay = 0 }: {
  children: React.ReactNode; onPress: () => void; style?: any; delay?: number;
}) {
  const sc  = useRef(new Animated.Value(0.94)).current;
  const op  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(sc, { toValue: 1, useNativeDriver: true, delay, bounciness: 7 }),
      Animated.timing(op, { toValue: 1, duration: 320, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  const onIn  = () => Animated.spring(sc, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start();
  const onOut = () => { Animated.spring(sc, { toValue: 1, useNativeDriver: true, speed: 35 }).start(); onPress(); };

  return (
    <Animated.View style={[{ opacity: op, transform: [{ scale: sc }] }, style]}>
      <Pressable onPressIn={onIn} onPressOut={onOut} style={{ flex: 1 }}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

/* ─────────────────────────── HERO card ─────────────────────────── */
function HeroCard({ onPress, appName = "AJKMart", disabled = false }: { onPress: () => void; appName?: string; disabled?: boolean }) {
  if (disabled) {
    return (
      <View style={styles.heroWrap}>
        <View style={[styles.heroCard, { backgroundColor: "#F3F4F6" }]}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 24 }}>
            <Ionicons name="storefront-outline" size={40} color="#9CA3AF" />
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#9CA3AF" }}>Grocery Mart</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#E5E7EB", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Ionicons name="close-circle-outline" size={12} color="#6B7280" />
              <Text style={{ fontSize: 11, color: "#6B7280", fontWeight: "600" }}>Unavailable</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }
  return (
    <Tap onPress={onPress} style={styles.heroWrap} delay={80}>
      <LinearGradient colors={["#0D47C0","#1A56DB","#2563EB"]} start={{ x:0,y:0 }} end={{ x:1,y:1 }} style={styles.heroCard}>
        <View style={[styles.blob,{ width:200,height:200,top:-60,right:-40,opacity:0.11 }]} />
        <View style={[styles.blob,{ width:80, height:80, bottom:10, right:80,opacity:0.09 }]} />

        <View style={styles.heroL}>
          <View style={styles.heroBadge}>
            <Ionicons name="storefront" size={11} color="#fff" />
            <Text style={styles.heroBadgeTxt}>Grocery Mart</Text>
          </View>
          <Text style={styles.heroTitle}>{appName}</Text>
          <Text style={styles.heroSub}>Fresh groceries & essentials{"\n"}delivered to your door</Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Ionicons name="cube-outline" size={11} color="rgba(255,255,255,0.85)" />
              <Text style={styles.heroStatTxt}>500+ items</Text>
            </View>
            <View style={styles.heroStat}>
              <Ionicons name="time-outline" size={11} color="rgba(255,255,255,0.85)" />
              <Text style={styles.heroStatTxt}>20 min delivery</Text>
            </View>
          </View>
          <View style={styles.heroBtn}>
            <Text style={styles.heroBtnTxt}>Shop Now</Text>
            <Ionicons name="arrow-forward" size={13} color={C.primary} />
          </View>
        </View>

        <View style={styles.heroR}>
          <View style={styles.heroRing}>
            <Ionicons name="storefront" size={46} color="#fff" />
          </View>
        </View>
      </LinearGradient>
    </Tap>
  );
}

/* ─────────────────────────── SERVICE card (Food / Ride) ─────────────────────────── */
function SvcCard({ onPress, delay, g1, g2, ig1, ig2, icon, title, sub, tag, tagIcon, textC, tagC, tagBg, disabled }: any) {
  if (disabled) {
    return (
      <View style={[styles.svcWrap, { width: HALF_W }]}>
        <View style={[styles.svcCard, { backgroundColor: "#F3F4F6", opacity: 0.6 }]}>
          <Ionicons name={icon} size={26} color="#9CA3AF" style={{ marginBottom: 6 }} />
          <Text style={[styles.svcTitle, { color: "#9CA3AF" }]}>{title}</Text>
          <View style={[styles.svcTag, { backgroundColor: "#E5E7EB" }]}>
            <Ionicons name="close-circle-outline" size={11} color="#6B7280" />
            <Text style={[styles.svcTagTxt, { color: "#6B7280" }]}>Unavailable</Text>
          </View>
        </View>
      </View>
    );
  }
  return (
    <Tap onPress={onPress} style={[styles.svcWrap,{ width: HALF_W }]} delay={delay}>
      <LinearGradient colors={[g1,g2]} start={{ x:0,y:0 }} end={{ x:1,y:1 }} style={styles.svcCard}>
        <View style={[styles.blob,{ width:110,height:110,top:-30,right:-30,opacity:0.13,backgroundColor:"#fff" }]} />
        <LinearGradient colors={[ig1,ig2]} style={styles.svcIcon}>
          <Ionicons name={icon} size={26} color="#fff" />
        </LinearGradient>
        <Text style={[styles.svcTitle,{ color: textC }]}>{title}</Text>
        <Text style={[styles.svcSub,{ color: textC, opacity:0.75 }]}>{sub}</Text>
        <View style={[styles.svcTag,{ backgroundColor: tagBg }]}>
          <Ionicons name={tagIcon} size={11} color={tagC} />
          <Text style={[styles.svcTagTxt,{ color: tagC }]}>{tag}</Text>
        </View>
      </LinearGradient>
    </Tap>
  );
}

/* ─────────────────────────── WALLET strip ─────────────────────────── */
function WalletStrip({ balance, onPress, appName = "AJKMart" }: { balance: number; onPress: () => void; appName?: string }) {
  return (
    <Tap onPress={onPress} style={styles.walletWrap} delay={310}>
      <LinearGradient colors={["#0F3BA8","#1A56DB"]} start={{ x:0,y:0 }} end={{ x:1,y:0 }} style={styles.walletCard}>
        <View style={[styles.blob,{ width:140,height:140,top:-45,right:50,opacity:0.1 }]} />
        <View style={styles.walletL}>
          <View style={styles.walletIcon}>
            <Ionicons name="wallet" size={22} color="#fff" />
          </View>
          <View>
            <Text style={styles.walletLbl}>{appName} Wallet</Text>
            <Text style={styles.walletBal}>Rs. {balance.toLocaleString()}</Text>
          </View>
        </View>
        <Pressable onPress={onPress} style={styles.walletTopUp}>
          <Ionicons name="add" size={15} color={C.primary} />
          <Text style={styles.walletTopUpTxt}>Top Up</Text>
        </Pressable>
      </LinearGradient>
    </Tap>
  );
}

/* ─────────────────────────── QUICK PILL ─────────────────────────── */
function Pill({ icon, label, color, bg, onPress, delay }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; color: string; bg: string; onPress: () => void; delay: number;
}) {
  const op = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(16)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(op, { toValue:1, duration:270, delay, useNativeDriver:true }),
      Animated.timing(ty, { toValue:0, duration:270, delay, useNativeDriver:true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={{ opacity:op, transform:[{ translateY:ty }] }}>
      <Pressable onPress={onPress} style={styles.pill}>
        <View style={[styles.pillIcon,{ backgroundColor: bg }]}>
          <Ionicons name={icon} size={19} color={color} />
        </View>
        <Text style={styles.pillLbl}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/* ─────────────────────────── AUTO-SLIDING BANNER CAROUSEL ─────────────────────────── */
const BANNERS = [
  {
    title: "Free Delivery",
    desc:  "Pehle order pe delivery free — ajj hi try karein!",
    tag:   "🎉 Naye Users",
    c1: "#1A56DB", c2: "#2563EB",
    icon: "cart-outline" as const,
    route: "/mart",
    cta: "Shop Karo",
  },
  {
    title: "Bike Ride 10% Off",
    desc:  "Sirf Rs. 45 se bike book karein — AJK mein kahin bhi!",
    tag:   "🏍️ Weekend Deal",
    c1: "#059669", c2: "#10B981",
    icon: "bicycle-outline" as const,
    route: "/ride",
    cta: "Ride Book Karo",
  },
  {
    title: "Desi Khana Deal",
    desc:  "2 food orders karo, agla order 20% off pao!",
    tag:   "🍽️ Food Deal",
    c1: "#D97706", c2: "#F59E0B",
    icon: "restaurant-outline" as const,
    route: "/food",
    cta: "Order Karo",
  },
  {
    title: "⚡ Flash Deals",
    desc:  "Roz nayi deals — fruits, sabziyan, doodh sab pe 20% bachao!",
    tag:   "🛒 Flash Sale",
    c1: "#7C3AED", c2: "#8B5CF6",
    icon: "flash-outline" as const,
    route: "/mart",
    cta: "Deals Dekho",
  },
  {
    title: "💊 Pharmacy",
    desc:  "Ghar baithe medicines mangao — 25-40 min mein delivery!",
    tag:   "🏥 On-Demand",
    c1: "#7C3AED", c2: "#A855F7",
    icon: "medkit-outline" as const,
    route: "/pharmacy",
    cta: "Order Karo",
  },
  {
    title: "📦 Parcel Delivery",
    desc:  "AJK mein kahin bhi parcel bhejein — Rs. 150 se shuru!",
    tag:   "🚀 Fast Delivery",
    c1: "#D97706", c2: "#F59E0B",
    icon: "cube-outline" as const,
    route: "/parcel",
    cta: "Book Karo",
  },
];

function BannerCarousel() {
  const scrollRef = useRef<ScrollView>(null);
  const [active, setActive] = useState(0);
  const BANNER_W = W - H_PAD * 2;

  // Auto-slide every 3.2 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setActive(prev => {
        const next = (prev + 1) % BANNERS.length;
        scrollRef.current?.scrollTo({ x: next * BANNER_W, animated: true });
        return next;
      });
    }, 3200);
    return () => clearInterval(timer);
  }, [BANNER_W]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / BANNER_W);
    setActive(idx);
  }, [BANNER_W]);

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
        snapToInterval={BANNER_W}
        snapToAlignment="start"
        contentContainerStyle={{ paddingHorizontal: 0 }}
        style={{ width: W - H_PAD * 2 }}
      >
        {BANNERS.map((b, i) => (
          <Pressable
            key={i}
            onPress={() => router.push(b.route as any)}
            style={{ width: BANNER_W }}
          >
            <LinearGradient
              colors={[b.c1, b.c2]}
              start={{ x:0,y:0 }} end={{ x:1,y:0 }}
              style={styles.bannerCard}
            >
              <View style={[styles.blob,{ width:130,height:130,top:-30,right:60,opacity:0.15 }]} />
              <View style={[styles.blob,{ width:70, height:70, bottom:-10,right:10,opacity:0.12 }]} />

              <View style={{ flex:1 }}>
                <View style={styles.bannerTagRow}>
                  <View style={styles.bannerTagChip}>
                    <Text style={styles.bannerTagTxt}>{b.tag}</Text>
                  </View>
                </View>
                <Text style={styles.bannerTitle}>{b.title}</Text>
                <Text style={styles.bannerDesc}>{b.desc}</Text>
                <View style={styles.bannerCta}>
                  <Text style={styles.bannerCtaTxt}>{b.cta}</Text>
                  <Ionicons name="arrow-forward" size={13} color="#fff" />
                </View>
              </View>

              <Ionicons name={b.icon} size={64} color="rgba(255,255,255,0.2)" style={{ marginLeft: 8 }} />
            </LinearGradient>
          </Pressable>
        ))}
      </ScrollView>

      {/* Dot indicators */}
      <View style={styles.dotsRow}>
        {BANNERS.map((_, i) => (
          <Pressable
            key={i}
            onPress={() => {
              setActive(i);
              scrollRef.current?.scrollTo({ x: i * BANNER_W, animated: true });
            }}
            style={[styles.dot, active === i && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

/* ══════════════════════════════ MAIN HOME SCREEN ══════════════════════════════ */
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { itemCount } = useCart();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const TAB_H  = Platform.OS === "web" ? 84 : 49;
  const hdOp   = useRef(new Animated.Value(0)).current;

  const { config: platformConfig } = usePlatformConfig();
  const features      = platformConfig.features;
  const appName       = platformConfig.platform.appName;
  const contentBanner = platformConfig.content.banner;
  const announcement  = platformConfig.content.announcement;
  const [announceDismissed, setAnnounceDismissed] = useState(false);

  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);

  useEffect(() => {
    Animated.timing(hdOp, { toValue:1, duration:480, useNativeDriver:true }).start();
  }, []);

  const quickActions = [
    { icon: "leaf-outline"    as const, label: "Fruits",    color: C.mart,    bg: C.martLight,  route: "/mart" },
    { icon: "medkit-outline"  as const, label: "Pharmacy",  color: "#7C3AED", bg: "#F5F3FF",    route: "/pharmacy" },
    { icon: "pizza-outline"   as const, label: "Pizza",     color: C.food,    bg: C.foodLight,  route: "/food" },
    { icon: "bicycle-outline" as const, label: "Bike",      color: "#8B5CF6", bg: "#EDE9FE",    route: "/ride" },
    { icon: "cube-outline"    as const, label: "Parcel",    color: "#D97706", bg: "#FFFBEB",    route: "/parcel" },
    { icon: "flash-outline"   as const, label: "Deals",     color: "#DC2626", bg: "#FEE2E2",    route: "/mart" },
    { icon: "car-outline"     as const, label: "Car",       color: "#059669", bg: "#D1FAE5",    route: "/ride" },
    { icon: "time-outline"    as const, label: "Track",     color: C.primary, bg: C.rideLight,  route: "/(tabs)/orders" },
  ];

  return (
    <View style={[styles.root,{ backgroundColor: C.background }]}>

      {/* ──── ANNOUNCEMENT BAR ──── */}
      {announcement && !announceDismissed && (
        <View style={{ backgroundColor:"#1D4ED8",flexDirection:"row",alignItems:"center",paddingHorizontal:12,paddingVertical:8,gap:8 }}>
          <Text style={{ fontSize:14 }}>📢</Text>
          <Text style={{ flex:1,fontFamily:"Inter_500Medium",fontSize:12,color:"#fff" }} numberOfLines={1}>{announcement}</Text>
          <Pressable onPress={() => setAnnounceDismissed(true)} style={{ padding:2 }}>
            <Text style={{ fontFamily:"Inter_700Bold",fontSize:16,color:"rgba(255,255,255,0.8)",lineHeight:18 }}>×</Text>
          </Pressable>
        </View>
      )}

      {/* ──── ACTIVE ORDER / RIDE TRACKER STRIP ──── */}
      {user?.id && <ActiveTrackerStrip userId={user.id} />}

      {/* ──── HEADER ──── */}
      <Animated.View style={{ opacity: hdOp }}>
        <LinearGradient
          colors={["#0F3BA8", C.primary, "#2563EB"]}
          start={{ x:0,y:0 }} end={{ x:1,y:1 }}
          style={[styles.header,{ paddingTop: topPad + 14 }]}
        >
          <View style={styles.hdrRow}>
            <View style={{ flex:1 }}>
              <Text style={styles.greeting}>{user?.name ? `${T("salam")}, ${user.name.split(" ")[0]} 👋` : `${T("salam")}! 👋`}</Text>
              <Text style={styles.hdrTitle}>{T("whatDoYouWant")}</Text>
              <View style={styles.locRow}>
                <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.75)" />
                <Text style={styles.locTxt}>{platformConfig.platform.businessAddress}</Text>
              </View>
            </View>
            <Pressable onPress={() => router.push("/cart")} style={styles.cartBtn}>
              <Ionicons name="bag-outline" size={22} color="#fff" />
              {itemCount > 0 && (
                <View style={styles.cartBadge}>
                  <Text style={styles.cartBadgeTxt}>{itemCount > 9 ? "9+" : itemCount}</Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* Search bar */}
          <Pressable onPress={() => router.push("/mart")} style={styles.searchBar}>
            <View style={styles.searchIcon}>
              <Ionicons name="search" size={16} color={C.primary} />
            </View>
            <Text style={styles.searchTxt}>{T("search")}</Text>
            <View style={styles.searchFilter}>
              <Ionicons name="options-outline" size={16} color={C.textMuted} />
            </View>
          </Pressable>
        </LinearGradient>
      </Animated.View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ──── SERVICES ──── */}
        <View style={styles.secRow}>
          <Text style={styles.secTitle}>{T("ourServices")}</Text>
          <Text style={styles.secSub}>{T("allInOne")}</Text>
        </View>

        {/* Announcement Banner */}
        {contentBanner ? (
          <View style={styles.announceBanner}>
            <Ionicons name="megaphone-outline" size={14} color="#1D4ED8" />
            <Text style={styles.announceTxt} numberOfLines={1}>{contentBanner}</Text>
          </View>
        ) : null}

        <View style={styles.grid}>
          <HeroCard onPress={() => router.push("/mart")} appName={appName} disabled={!features.mart} />

          <View style={styles.halfRow}>
            <SvcCard
              onPress={() => router.push("/food")}
              disabled={!features.food}
              delay={160}
              g1="#FFFBEB" g2="#FEF3C7"
              ig1="#F59E0B" ig2="#FBBF24"
              icon="restaurant"
              title={T("foodDelivery")}
              sub={T("restaurantsNearYou")}
              tag="30 min"
              tagIcon="time-outline"
              textC="#92400E" tagC="#92400E" tagBg="#FDE68A"
            />
            <SvcCard
              onPress={() => router.push("/ride")}
              disabled={!features.rides}
              delay={240}
              g1="#F0FDF4" g2="#DCFCE7"
              ig1="#10B981" ig2="#34D399"
              icon="car"
              title={T("bikeCarRide")}
              sub={T("safeBooking")}
              tag={T("instantLabel")}
              tagIcon="flash-outline"
              textC="#065F46" tagC="#065F46" tagBg="#A7F3D0"
            />
          </View>

          {/* On-Demand Services Row */}
          <View style={styles.halfRow}>
            <SvcCard
              onPress={() => router.push("/pharmacy")}
              disabled={!features.pharmacy}
              delay={340}
              g1="#F5F3FF" g2="#EDE9FE"
              ig1="#7C3AED" ig2="#A78BFA"
              icon="medkit"
              title={`💊 ${T("pharmacy")}`}
              sub={T("medicinesDelivered")}
              tag="25-40 min"
              tagIcon="medkit-outline"
              textC="#4C1D95" tagC="#4C1D95" tagBg="#DDD6FE"
            />
            <SvcCard
              onPress={() => router.push("/parcel")}
              disabled={!features.parcel}
              delay={420}
              g1="#FFFBEB" g2="#FEF3C7"
              ig1="#D97706" ig2="#F59E0B"
              icon="cube"
              title={`📦 ${T("parcel")}`}
              sub={T("parcelsAnywhere")}
              tag="Rs. 150+"
              tagIcon="cube-outline"
              textC="#78350F" tagC="#78350F" tagBg="#FDE68A"
            />
          </View>

          {features.wallet && <WalletStrip balance={user?.walletBalance || 0} onPress={() => router.push("/(tabs)/wallet")} appName={appName} />}
        </View>

        {/* ──── QUICK PILLS ──── */}
        <View style={styles.secRow}>
          <Text style={styles.secTitle}>{T("quickAccess")}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsRow}>
          {quickActions.map((q, i) => (
            <Pill
              key={q.label}
              icon={q.icon}
              label={q.label}
              color={q.color}
              bg={q.bg}
              onPress={() => router.push(q.route as any)}
              delay={70 + i * 50}
            />
          ))}
        </ScrollView>

        {/* ──── SLIDING BANNERS ──── */}
        <View style={styles.secRow}>
          <Text style={styles.secTitle}>{T("todaysDeals")}</Text>
          <Text style={styles.secSub}>{T("autoSlidesLabel")}</Text>
        </View>

        <View style={styles.carouselWrap}>
          {platformConfig.content.showBanner && <BannerCarousel />}
        </View>

        <View style={{ height: TAB_H + insets.bottom + 20 }} />
      </ScrollView>
    </View>
  );
}

/* ══════════════════════════════ STYLES ══════════════════════════════ */
const styles = StyleSheet.create({
  root: { flex: 1 },

  /* active order/ride tracker strip */
  trackerWrap: { marginHorizontal: H_PAD, marginTop: 8, marginBottom: 0 },
  trackerCard: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  trackerDot:  { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#fff", opacity: 0.9 },
  trackerTxt:  { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" },
  trackerCta:  { fontFamily: "Inter_700Bold", fontSize: 12, color: "rgba(255,255,255,0.85)" },

  /* header */
  header: { paddingHorizontal: H_PAD, paddingBottom: 18 },
  hdrRow: { flexDirection:"row", alignItems:"flex-start", marginBottom: 14 },
  greeting: { fontFamily:"Inter_400Regular", fontSize:13, color:"rgba(255,255,255,0.8)", marginBottom:2 },
  hdrTitle: { fontFamily:"Inter_700Bold", fontSize:22, color:"#fff", marginBottom:5 },
  locRow: { flexDirection:"row", alignItems:"center", gap:4 },
  locTxt: { fontFamily:"Inter_400Regular", fontSize:12, color:"rgba(255,255,255,0.75)" },
  cartBtn: { width:44, height:44, borderRadius:14, backgroundColor:"rgba(255,255,255,0.18)", alignItems:"center", justifyContent:"center" },
  cartBadge: { position:"absolute", top:-5, right:-5, backgroundColor:"#F59E0B", borderRadius:9, minWidth:18, height:18, alignItems:"center", justifyContent:"center", paddingHorizontal:3, borderWidth:1.5, borderColor:"#fff" },
  cartBadgeTxt: { fontFamily:"Inter_700Bold", fontSize:9, color:"#fff" },
  searchBar: { flexDirection:"row", alignItems:"center", gap:10, backgroundColor:"#fff", borderRadius:14, paddingHorizontal:12, paddingVertical:11 },
  searchIcon: { width:30, height:30, borderRadius:8, backgroundColor:"#EFF6FF", alignItems:"center", justifyContent:"center" },
  searchTxt: { flex:1, fontFamily:"Inter_400Regular", fontSize:13, color:C.textMuted },
  searchFilter: { width:30, height:30, borderRadius:8, backgroundColor:"#F8FAFC", alignItems:"center", justifyContent:"center" },

  /* section */
  announceBanner: { flexDirection:"row", alignItems:"center", gap:8, marginHorizontal:H_PAD, marginBottom:12, backgroundColor:"#EFF6FF", borderRadius:10, paddingHorizontal:12, paddingVertical:8, borderWidth:1, borderColor:"#BFDBFE" },
  announceTxt: { flex:1, fontFamily:"Inter_500Medium", fontSize:12, color:"#1D4ED8" },
  secRow: { flexDirection:"row", alignItems:"baseline", justifyContent:"space-between", paddingHorizontal:H_PAD, marginTop:20, marginBottom:12 },
  secTitle: { fontFamily:"Inter_700Bold", fontSize:17, color:C.text },
  secSub: { fontFamily:"Inter_400Regular", fontSize:12, color:C.textMuted },

  scroll: { paddingBottom: 0 },

  /* bento */
  grid: { paddingHorizontal: H_PAD, gap: 12 },
  halfRow: { flexDirection:"row", gap:12 },

  /* hero */
  heroWrap: { borderRadius:22, overflow:"hidden" },
  heroCard: { borderRadius:22, padding:20, flexDirection:"row", alignItems:"center", minHeight:162, overflow:"hidden" },
  heroL: { flex:1, gap:7 },
  heroBadge: { flexDirection:"row", alignItems:"center", gap:5, alignSelf:"flex-start", backgroundColor:"rgba(255,255,255,0.22)", paddingHorizontal:10, paddingVertical:4, borderRadius:20 },
  heroBadgeTxt: { fontFamily:"Inter_600SemiBold", fontSize:11, color:"#fff" },
  heroTitle: { fontFamily:"Inter_700Bold", fontSize:27, color:"#fff", lineHeight:31 },
  heroSub: { fontFamily:"Inter_400Regular", fontSize:12, color:"rgba(255,255,255,0.85)", lineHeight:17 },
  heroStats: { flexDirection:"row", gap:14, marginTop:2 },
  heroStat: { flexDirection:"row", alignItems:"center", gap:4 },
  heroStatTxt: { fontFamily:"Inter_400Regular", fontSize:11, color:"rgba(255,255,255,0.85)" },
  heroBtn: { flexDirection:"row", alignItems:"center", gap:6, backgroundColor:"#fff", alignSelf:"flex-start", paddingHorizontal:14, paddingVertical:8, borderRadius:20, marginTop:4 },
  heroBtnTxt: { fontFamily:"Inter_700Bold", fontSize:12, color:C.primary },
  heroR: { alignItems:"center", marginLeft:10 },
  heroRing: { width:76, height:76, borderRadius:22, backgroundColor:"rgba(255,255,255,0.18)", alignItems:"center", justifyContent:"center", borderWidth:1.5, borderColor:"rgba(255,255,255,0.25)" },

  /* service cards */
  svcWrap: { borderRadius:18, overflow:"hidden", height:178 },
  svcCard: { flex:1, borderRadius:18, padding:16, overflow:"hidden", gap:5 },
  svcIcon: { width:50, height:50, borderRadius:15, alignItems:"center", justifyContent:"center", marginBottom:4 },
  svcTitle: { fontFamily:"Inter_700Bold", fontSize:16, lineHeight:21 },
  svcSub: { fontFamily:"Inter_400Regular", fontSize:11, lineHeight:15, flex:1 },
  svcTag: { flexDirection:"row", alignItems:"center", gap:4, alignSelf:"flex-start", paddingHorizontal:9, paddingVertical:5, borderRadius:20 },
  svcTagTxt: { fontFamily:"Inter_600SemiBold", fontSize:10 },

  /* wallet */
  walletWrap: { borderRadius:16, overflow:"hidden" },
  walletCard: { flexDirection:"row", alignItems:"center", justifyContent:"space-between", borderRadius:16, paddingHorizontal:18, paddingVertical:16, overflow:"hidden" },
  walletL: { flexDirection:"row", alignItems:"center", gap:12 },
  walletIcon: { width:44, height:44, borderRadius:13, backgroundColor:"rgba(255,255,255,0.18)", alignItems:"center", justifyContent:"center" },
  walletLbl: { fontFamily:"Inter_400Regular", fontSize:12, color:"rgba(255,255,255,0.8)", marginBottom:2 },
  walletBal: { fontFamily:"Inter_700Bold", fontSize:20, color:"#fff" },
  walletTopUp: { flexDirection:"row", alignItems:"center", gap:5, backgroundColor:"#fff", paddingHorizontal:14, paddingVertical:9, borderRadius:12 },
  walletTopUpTxt: { fontFamily:"Inter_600SemiBold", fontSize:13, color:C.primary },

  /* quick pills */
  pillsRow: { paddingHorizontal:H_PAD, gap:10 },
  pill: { alignItems:"center", gap:7, width:66 },
  pillIcon: { width:56, height:56, borderRadius:17, alignItems:"center", justifyContent:"center" },
  pillLbl: { fontFamily:"Inter_500Medium", fontSize:11, color:C.textSecondary, textAlign:"center" },

  /* ─── CAROUSEL / BANNERS ─── */
  carouselWrap: { paddingHorizontal: H_PAD, overflow:"hidden" },

  bannerCard: {
    borderRadius: 20,
    padding: 20,
    minHeight: 130,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  bannerTagRow: { marginBottom: 7 },
  bannerTagChip: { backgroundColor:"rgba(255,255,255,0.28)", alignSelf:"flex-start", paddingHorizontal:10, paddingVertical:4, borderRadius:20 },
  bannerTagTxt: { fontFamily:"Inter_600SemiBold", fontSize:11, color:"#fff" },
  bannerTitle: { fontFamily:"Inter_700Bold", fontSize:19, color:"#fff", marginBottom:5 },
  bannerDesc: { fontFamily:"Inter_400Regular", fontSize:12, color:"rgba(255,255,255,0.9)", lineHeight:17, marginBottom:12 },
  bannerCta: { flexDirection:"row", alignItems:"center", gap:6, backgroundColor:"rgba(255,255,255,0.22)", alignSelf:"flex-start", paddingHorizontal:12, paddingVertical:8, borderRadius:20 },
  bannerCtaTxt: { fontFamily:"Inter_600SemiBold", fontSize:12, color:"#fff" },

  /* dot indicators */
  dotsRow: { flexDirection:"row", justifyContent:"center", gap:6, marginTop:12 },
  dot: { width:6, height:6, borderRadius:3, backgroundColor:C.border },
  dotActive: { width:20, borderRadius:3, backgroundColor:C.primary },

  /* shared */
  blob: { position:"absolute", borderRadius:999, backgroundColor:"#fff" },
});
