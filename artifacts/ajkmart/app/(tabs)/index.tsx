import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  useWindowDimensions,
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

import Colors, { spacing, radii, shadows, typography, getFontFamily } from "@/constants/colors";
import { T as Typ, Font } from "@/constants/typography";
import { SmartRefresh } from "@/components/ui/SmartRefresh";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useLanguage } from "@/context/LanguageContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { tDual } from "@workspace/i18n";
import {
  SERVICE_REGISTRY,
  getActiveServices,
  type ServiceDefinition,
} from "@/constants/serviceRegistry";
import {
  AnimatedPressable,
  SectionHeader,
  SkeletonBlock,
  EmptyState,
  CategoryPill,
  CountdownTimer,
  SearchHeader,
} from "@/components/user-shared";
import { getBanners, getTrending, getFlashDeals, type Banner, type RecommendationProduct, type FlashDealProduct } from "@workspace/api-client-react";
import { Image, FlatList } from "react-native";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

const C = Colors.light;
const W = Dimensions.get("window").width;
const H_PAD = spacing.lg;
const HALF_W = (W - H_PAD * 2 - spacing.md) / 2;

function safeNavigate(route: string) {
  const knownRoutes = new Set<string>([
    ...Object.values(SERVICE_REGISTRY).map(s => String(s.route)),
    "/(tabs)", "/(tabs)/orders", "/(tabs)/wallet", "/cart", "/search",
  ]);
  if (!route || (!knownRoutes.has(route) && !route.startsWith("/(tabs)"))) {
    router.push("/(tabs)" as Href);
    return;
  }
  router.push(route as Href);
}

function ActiveTrackerStrip({ userId, position, tabBarHeight = 0 }: { userId: string; position?: "top" | "bottom"; tabBarHeight?: number }) {
  const { token } = useAuth();
  const { config: pCfg } = usePlatformConfig();
  const authHdrs: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const { data: ordersData, isLoading: ordersLoading, isError: ordersError } = useQuery({
    queryKey: ["home-active-orders", userId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/orders?status=active`, { headers: authHdrs });
      if (!r.ok) throw new Error("orders fetch failed");
      return r.json();
    },
    enabled: !!userId && !!token,
    refetchInterval: 5000,
    staleTime: 4000,
  });

  const { data: ridesData, isLoading: ridesLoading, isError: ridesError } = useQuery({
    queryKey: ["home-active-rides", userId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/rides?status=active`, { headers: authHdrs });
      if (!r.ok) throw new Error("rides fetch failed");
      return r.json();
    },
    enabled: !!userId && !!token,
    refetchInterval: 5000,
    staleTime: 4000,
  });

  if (!pCfg.content.trackerBannerEnabled) return null;

  const isLoading = ordersLoading || ridesLoading;
  const bottomStyle = position === "bottom" ? [styles.trackerWrapBottom, { marginBottom: tabBarHeight + 8 }] : undefined;

  if (isLoading) {
    return (
      <View style={[styles.trackerWrap, bottomStyle]}>
        <View style={styles.trackerSkeleton}>
          <SkeletonBlock w={100} h={12} r={6} />
        </View>
      </View>
    );
  }

  if (ordersError || ridesError) return null;

  const activeOrders = Array.isArray(ordersData) ? ordersData.filter((o: any) => !["delivered", "cancelled"].includes(o.status)) : [];
  const activeRides = Array.isArray(ridesData) ? ridesData.filter((r: any) => !["completed", "cancelled"].includes(r.status)) : [];
  const total = activeOrders.length + activeRides.length;
  if (total === 0) return null;

  const items: { label: string; route: string; c1: string; c2: string }[] = [];
  if (activeOrders.length > 0) {
    items.push({
      label: `${activeOrders.length} active order${activeOrders.length > 1 ? "s" : ""}`,
      route: activeOrders[0]?.id ? `/order?orderId=${activeOrders[0].id}` : "/(tabs)/orders",
      c1: C.amber, c2: C.gold,
    });
  }
  if (activeRides.length > 0) {
    items.push({
      label: `${activeRides.length} active ride${activeRides.length > 1 ? "s" : ""}`,
      route: activeRides[0]?.id ? `/ride?rideId=${activeRides[0].id}` : "/(tabs)/orders",
      c1: C.emerald, c2: C.emeraldDot,
    });
  }

  return (
    <View style={[styles.trackerWrap, bottomStyle]}>
      {items.map((item, i) => (
        <Pressable
          key={i}
          onPress={() => router.push(item.route as Href)}
          accessibilityRole="button"
          accessibilityLabel={`${item.label}. Tap to track`}
        >
          <LinearGradient
            colors={[item.c1, item.c2]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.trackerCard}
          >
            <View style={styles.trackerPulse}>
              <View style={styles.trackerDot} />
            </View>
            <Text style={styles.trackerTxt} numberOfLines={1}>{item.label}</Text>
            <View style={styles.trackerCta}>
              <Text style={styles.trackerCtaTxt}>Track</Text>
              <Ionicons name="arrow-forward" size={12} color={item.c1} />
            </View>
          </LinearGradient>
        </Pressable>
      ))}
    </View>
  );
}

function SvcCard({ service, delay, fullWidth, T }: { service: ServiceDefinition; delay: number; fullWidth?: boolean; T: (key: Parameters<typeof tDual>[0]) => string }) {
  const labelMap: Record<string, Parameters<typeof tDual>[0]> = { food: "foodDelivery", rides: "bikeCarRide", pharmacy: "pharmacy", parcel: "parcel" };
  const subMap: Record<string, Parameters<typeof tDual>[0]> = { food: "restaurantsNearYou", rides: "safeBooking", pharmacy: "medicinesDelivered", parcel: "parcelsAnywhere" };
  const title = labelMap[service.key] ? T(labelMap[service.key]) : service.label;
  const sub = subMap[service.key] ? T(subMap[service.key]) : service.description;
  const tag = service.key === "rides" ? T("instantLabel") : service.tag;

  return (
    <AnimatedPressable
      onPress={() => safeNavigate(String(service.route))}
      style={[styles.svcWrap, fullWidth ? { width: "100%" } : { width: HALF_W }]}
      delay={delay}
      accessibilityLabel={`${title}. ${sub}`}
    >
      <LinearGradient colors={service.cardGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.svcCard}>
        <View style={[styles.blob, { width: 110, height: 110, top: -30, right: -30, opacity: 0.1, backgroundColor: C.surface }]} />
        <LinearGradient colors={service.iconGradient} style={styles.svcIcon}>
          <Ionicons name={service.iconFocused} size={24} color={C.textInverse} />
        </LinearGradient>
        <Text style={[styles.svcTitle, { color: service.textColor }]}>{title}</Text>
        <Text style={[styles.svcSub, { color: service.textColor, opacity: 0.7 }]}>{sub}</Text>
        <View style={[styles.svcTag, { backgroundColor: service.tagBg }]}>
          <Ionicons name={service.tagIcon} size={11} color={service.tagColor} />
          <Text style={[styles.svcTagTxt, { color: service.tagColor }]}>{tag}</Text>
        </View>
      </LinearGradient>
    </AnimatedPressable>
  );
}


function WalletStrip({ balance, onPress, appName = "AJKMart" }: { balance: number; onPress: () => void; appName?: string }) {
  return (
    <AnimatedPressable onPress={onPress} style={styles.walletWrap} delay={310} accessibilityLabel={`${appName} Wallet. Balance: Rs. ${balance.toLocaleString()}. Tap to open`}>
      <LinearGradient colors={[C.primaryDark, C.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.walletCard}>
        <View style={[styles.blob, { width: 140, height: 140, top: -45, right: 50, opacity: 0.08 }]} />
        <View style={styles.walletL}>
          <View style={styles.walletIcon}>
            <Ionicons name="wallet" size={20} color={C.textInverse} />
          </View>
          <View>
            <Text style={styles.walletLbl}>{appName} Wallet</Text>
            <Text style={styles.walletBal}>Rs. {balance.toLocaleString()}</Text>
          </View>
        </View>
        <View style={styles.walletTopUp}>
          <Ionicons name="add" size={15} color={C.primary} />
          <Text style={styles.walletTopUpTxt}>Top Up</Text>
        </View>
      </LinearGradient>
    </AnimatedPressable>
  );
}

function CategoryStrip({ services, T }: { services: ServiceDefinition[]; T: (key: Parameters<typeof tDual>[0]) => string }) {
  const labelMap: Record<string, Parameters<typeof tDual>[0]> = { food: "foodDelivery", rides: "bikeCarRide", pharmacy: "pharmacy", parcel: "parcel" };
  const categories = services.map(svc => ({
    key: svc.key,
    icon: svc.iconFocused,
    label: labelMap[svc.key] ? T(labelMap[svc.key]) : svc.label,
    color: svc.color,
    bg: svc.colorLight,
    route: String(svc.route),
  }));

  if (categories.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.catRow}
    >
      {categories.map((cat) => (
        <CategoryPill
          key={cat.key}
          icon={cat.icon}
          label={cat.label}
          color={cat.color}
          bg={cat.bg}
          onPress={() => safeNavigate(cat.route)}
        />
      ))}
    </ScrollView>
  );
}

function FlashDealsSection({ T }: { T: (key: Parameters<typeof tDual>[0]) => string }) {
  const { data: deals, isLoading } = useQuery({
    queryKey: ["flash-deals"],
    queryFn: () => getFlashDeals({ limit: 10 }),
    staleTime: 3 * 60 * 1000,
  });

  const items = deals ?? [];
  const earliestExpiry = useMemo(() => {
    if (items.length === 0) return null;
    const times = items.map(d => new Date(d.dealExpiresAt).getTime()).filter(t => !isNaN(t));
    if (times.length === 0) return null;
    return new Date(Math.min(...times));
  }, [items]);

  if (isLoading) {
    return (
      <View style={styles.flashSection}>
        <View style={styles.flashHeader}>
          <View style={styles.flashHeaderLeft}>
            <Ionicons name="flash" size={18} color={C.danger} />
            <Text style={styles.flashTitle}>{T("todaysDeals")}</Text>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.flashRow}>
          {[0,1,2,3].map(i => (
            <View key={i} style={styles.flashCard}>
              <SkeletonBlock w={52} h={52} r={26} />
              <SkeletonBlock w={60} h={12} r={6} />
              <SkeletonBlock w={50} h={18} r={10} />
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (items.length === 0) return null;

  return (
    <View style={styles.flashSection}>
      <View style={styles.flashHeader}>
        <View style={styles.flashHeaderLeft}>
          <Ionicons name="flash" size={18} color={C.danger} />
          <Text style={styles.flashTitle}>{T("todaysDeals")}</Text>
        </View>
        {earliestExpiry && <CountdownTimer targetTime={earliestExpiry} />}
      </View>
      <FlatList
        horizontal
        data={items}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.flashRow}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: "/product/[id]", params: { id: item.id } })}
            style={styles.flashCard}
            accessibilityLabel={`${item.name} ${item.discountPercent}% OFF`}
          >
            <View style={[styles.flashIconWrap, { backgroundColor: C.dangerSoft }]}>
              {item.image ? (
                <Image source={{ uri: item.image }} style={{ width: 44, height: 44, borderRadius: 22 }} />
              ) : (
                <Ionicons name="flash" size={26} color={C.danger} />
              )}
            </View>
            <Text style={styles.flashName} numberOfLines={1}>{item.name}</Text>
            <View style={[styles.flashBadge, { backgroundColor: C.dangerSoft }]}>
              <Text style={[styles.flashDiscount, { color: C.danger }]}>{item.discountPercent}% OFF</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

function DynamicBannerCarousel() {
  const { data: banners } = useQuery({
    queryKey: ["dynamic-banners", "home"],
    queryFn: () => getBanners({ placement: "home" }),
    staleTime: 5 * 60 * 1000,
  });
  const scrollRef = useRef<ScrollView>(null);
  const [active, setActive] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const BANNER_W = windowWidth - H_PAD * 2;

  const items = banners ?? [];
  if (items.length === 0) return null;

  return (
    <View style={{ marginTop: spacing.md }}>
      <SectionHeader title="Featured" subtitle="Promotions & offers" />
      <View style={styles.carouselWrap}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled={false}
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={BANNER_W}
          snapToAlignment="start"
          style={{ width: BANNER_W }}
          onScroll={(e) => setActive(Math.round(e.nativeEvent.contentOffset.x / BANNER_W))}
          scrollEventThrottle={16}
        >
          {items.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => b.linkUrl && router.push(b.linkUrl as Href)}
              style={{ width: BANNER_W }}
            >
              <LinearGradient
                colors={[b.gradient1 || C.primary, b.gradient2 || C.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.bannerCard}
              >
                <View style={[styles.blob, { width: 130, height: 130, top: -30, right: 60, opacity: 0.12 }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bannerTitle}>{b.title}</Text>
                  {b.subtitle ? <Text style={styles.bannerDesc}>{b.subtitle}</Text> : null}
                  <View style={styles.bannerCta}>
                    <Text style={styles.bannerCtaTxt}>Shop Now</Text>
                    <Ionicons name="arrow-forward" size={13} color={C.textInverse} />
                  </View>
                </View>
                <View style={styles.bannerIconWrap}>
                  <Ionicons name={(b.icon as any) || "pricetag"} size={56} color={C.overlayLight15} />
                </View>
              </LinearGradient>
            </Pressable>
          ))}
        </ScrollView>
        {items.length > 1 && (
          <View style={styles.dotsRow}>
            {items.map((_, i) => (
              <View key={i} style={[styles.dot, { width: active === i ? 24 : 6, backgroundColor: active === i ? C.primary : C.border }]} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function TrendingSection() {
  const { data: trending } = useQuery({
    queryKey: ["trending-products"],
    queryFn: () => getTrending({ limit: 8 }),
    staleTime: 5 * 60 * 1000,
  });

  const items = trending ?? [];
  if (items.length === 0) return null;

  return (
    <View style={{ marginTop: spacing.lg }}>
      <SectionHeader title="Trending Now" subtitle="Popular in Muzaffarabad" />
      <FlatList
        horizontal
        data={items}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: H_PAD, gap: spacing.md }}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/product/${item.id}` as Href)}
            style={trendS.card}
          >
            {item.image ? (
              <Image source={{ uri: item.image }} style={trendS.img} />
            ) : (
              <View style={[trendS.img, { backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" }]}>
                <Ionicons name="cube-outline" size={28} color={C.textMuted} />
              </View>
            )}
            <Text style={trendS.name} numberOfLines={2}>{item.name}</Text>
            <Text style={trendS.price}>Rs. {Number(item.price).toLocaleString()}</Text>
            {item.rating ? (
              <View style={trendS.ratingRow}>
                <Ionicons name="star" size={11} color={C.gold} />
                <Text style={trendS.ratingTxt}>{Number(item.rating).toFixed(1)}</Text>
              </View>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const trendS = StyleSheet.create({
  card: { width: 140, backgroundColor: C.surface, borderRadius: radii.lg, ...shadows.sm, overflow: "hidden" },
  img: { width: 140, height: 120, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
  name: { ...Typ.caption, color: C.text, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, height: 36 },
  price: { ...Typ.captionBold, color: C.primary, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  ratingTxt: { ...Typ.tiny, color: C.textSecondary },
});

function HomeSkeleton() {
  return (
    <View style={{ paddingHorizontal: H_PAD, gap: spacing.md, marginTop: spacing.md }}>
      <SkeletonBlock w="100%" h={150} r={radii.xxl} />
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        {Array.from({ length: 5 }, (_, i) => (
          <View key={i} style={{ alignItems: "center", gap: 6 }}>
            <SkeletonBlock w={56} h={56} r={28} />
            <SkeletonBlock w={40} h={10} r={4} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <SkeletonBlock w={HALF_W} h={178} r={radii.xl} />
        <SkeletonBlock w={HALF_W} h={178} r={radii.xl} />
      </View>
      <SkeletonBlock w="100%" h={60} r={radii.xl} />
      <SkeletonBlock w="100%" h={100} r={radii.xl} />
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { itemCount } = useCart();
  const topPad = Math.max(insets.top, 12);
  const TAB_H = Platform.OS === "web" ? 72 : 49;
  const hdOp = useRef(new Animated.Value(0)).current;
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const { config: platformConfig, loading: configLoading, refresh: refreshConfig } = usePlatformConfig();

  const handleHomeRefresh = useCallback(async () => {
    try { await refreshConfig(); } catch (err) { console.warn("[Home] Config refresh failed:", err instanceof Error ? err.message : String(err)); }
    setLastRefreshed(new Date());
  }, [refreshConfig]);

  const features = platformConfig.features;
  const appName = platformConfig.platform.appName;
  const contentBanner = platformConfig.content.banner;
  const announcement = platformConfig.content.announcement;
  const [announceDismissed, setAnnounceDismissed] = useState(false);

  const announceKey = React.useMemo(() => {
    if (!announcement) return "";
    const hash = Array.from(announcement).reduce((h, c) => (((h * 31) | 0) + c.charCodeAt(0)) >>> 0, 0).toString(36);
    return `announce_dismissed_${hash}`;
  }, [announcement]);

  useEffect(() => {
    if (!announcement) { setAnnounceDismissed(false); return; }
    AsyncStorage.getItem(announceKey).then(val => { setAnnounceDismissed(val === "1"); }).catch(() => { setAnnounceDismissed(false); });
  }, [announcement, announceKey]);

  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);
  const ff = getFontFamily(language);
  const urduText = (base: object) => ff.isUrdu ? { ...base, fontFamily: ff.regular, lineHeight: 30 } : base;
  const urduBold = (base: object) => ff.isUrdu ? { ...base, fontFamily: ff.bold, lineHeight: 44 } : base;

  useEffect(() => {
    Animated.timing(hdOp, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const activeServices = getActiveServices(features);
  const noServicesActive = activeServices.length === 0;

  return (
    <View style={styles.root}>
      {announcement && !announceDismissed && (
        <View style={styles.announceBar} accessibilityRole="alert">
          <View style={styles.announceIcon}>
            <Ionicons name="megaphone" size={12} color={C.textInverse} />
          </View>
          <Text style={styles.announceTxt} numberOfLines={1}>{announcement}</Text>
          <Pressable
            onPress={() => {
              setAnnounceDismissed(true);
              if (announceKey) AsyncStorage.setItem(announceKey, "1").catch(() => {});
            }}
            style={styles.announceClose}
            accessibilityRole="button"
            accessibilityLabel="Dismiss announcement"
          >
            <Ionicons name="close" size={16} color={C.overlayLight80} />
          </Pressable>
        </View>
      )}

      {user?.id && platformConfig.content.trackerBannerPosition === "top" && (
        <ActiveTrackerStrip userId={user.id} position="top" />
      )}

      <Animated.View style={{ opacity: hdOp }}>
        <LinearGradient
          colors={[C.primaryDark, C.primary, C.primaryLight]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.header, { paddingTop: topPad + 8 }]}
        >
          <View style={styles.hdrRow}>
            <View style={{ flex: 1 }}>
              <Text style={urduText(styles.greeting)}>
                {user?.name ? `${T("salam")}, ${user.name.split(" ")[0]}` : `${T("salam")}!`}
              </Text>
              <Text style={urduBold(styles.hdrTitle)} accessibilityRole="header">{T("whatDoYouWant")}</Text>
              <View style={styles.locRow}>
                <Ionicons name="location" size={12} color={C.overlayLight70} />
                <Text style={styles.locTxt}>{platformConfig.platform.businessAddress}</Text>
              </View>
            </View>
            <View style={styles.hdrActions}>
              <Pressable onPress={() => router.push("/cart")} style={styles.cartBtn} accessibilityRole="button" accessibilityLabel={`Shopping cart${itemCount > 0 ? `, ${itemCount} items` : ""}`}>
                <Ionicons name="bag-outline" size={20} color={C.textInverse} />
                {itemCount > 0 && (
                  <View style={styles.cartBadge}>
                    <Text style={styles.cartBadgeTxt}>{itemCount > 9 ? "9+" : itemCount}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>

          <SearchHeader
            placeholder={T("search")}
            onPress={() => router.push("/search")}
            onFilterPress={() => router.push("/search")}
          />
        </LinearGradient>
      </Animated.View>

      <SmartRefresh
        onRefresh={handleHomeRefresh}
        lastUpdated={lastRefreshed}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {contentBanner ? (
          <View style={styles.announceBanner}>
            <Ionicons name="megaphone-outline" size={14} color={C.primary} />
            <Text style={styles.announceBannerTxt} numberOfLines={1}>{contentBanner}</Text>
          </View>
        ) : null}

        {configLoading ? (
          <HomeSkeleton />
        ) : noServicesActive ? (
          <EmptyState
            icon="storefront-outline"
            title="No Services Available"
            subtitle={"No services are currently available.\nPlease check back later!"}
            actionLabel="Refresh"
            onAction={refreshConfig}
          />
        ) : (
          <>
            {activeServices.length > 0 && (
              <View style={styles.catSection}>
                <CategoryStrip services={activeServices} T={T} />
              </View>
            )}

            {platformConfig.content.showBanner && <DynamicBannerCarousel />}

            <FlashDealsSection T={T} />
            <TrendingSection />

            <SectionHeader title={T("ourServices")} subtitle={T("allInOne")} />

            <View style={styles.grid}>
              {(() => {
                const elements: React.ReactNode[] = [];
                for (let i = 0; i < activeServices.length; i += 2) {
                  const pair = activeServices.slice(i, i + 2);
                  if (pair.length === 2) {
                    elements.push(
                      <View key={`row-${i}`} style={styles.halfRow}>
                        <SvcCard service={pair[0]} delay={100 + i * 40} T={T} />
                        <SvcCard service={pair[1]} delay={140 + i * 40} T={T} />
                      </View>
                    );
                  } else {
                    elements.push(<SvcCard key={`single-${i}`} service={pair[0]} delay={100 + i * 40} fullWidth T={T} />);
                  }
                }
                return elements;
              })()}

            </View>
          </>
        )}

        {user?.id && platformConfig.content.trackerBannerPosition === "bottom" && (
          <ActiveTrackerStrip userId={user.id} position="bottom" tabBarHeight={TAB_H} />
        )}

        <View style={{ height: TAB_H + insets.bottom + 20 }} />
      </SmartRefresh>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },

  trackerWrap: { marginHorizontal: H_PAD, marginTop: spacing.sm, gap: spacing.sm },
  trackerWrapBottom: { marginTop: spacing.md, marginBottom: spacing.sm },
  trackerSkeleton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: C.border,
    opacity: 0.7,
  },
  trackerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
  },
  trackerPulse: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.overlayLight30,
    alignItems: "center",
    justifyContent: "center",
  },
  trackerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.surface },
  trackerTxt: { flex: 1, ...typography.captionMedium, color: C.textInverse },
  trackerCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.surface,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
  },
  trackerCtaTxt: { ...typography.smallMedium, color: C.primary },

  header: { paddingHorizontal: H_PAD, paddingBottom: spacing.lg },
  hdrRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.lg },
  hdrActions: { flexDirection: "row", gap: spacing.sm },
  greeting: { ...typography.caption, color: C.overlayLight80, marginBottom: 2 },
  hdrTitle: { ...typography.h2, color: C.textInverse, marginBottom: Platform.OS === "web" ? 2 : 5 },
  locRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  locTxt: { ...typography.small, color: C.overlayLight70 },
  cartBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
    backgroundColor: C.overlayLight15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.overlayLight10,
  },
  cartBadge: {
    position: "absolute",
    top: -5,
    right: -5,
    backgroundColor: C.accent,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: C.surface,
  },
  cartBadgeTxt: { ...Typ.tiny, fontSize: 9, color: C.textInverse },

  announceBar: {
    backgroundColor: C.primary,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  announceIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.overlayLight20,
    alignItems: "center",
    justifyContent: "center",
  },
  announceTxt: { flex: 1, ...typography.captionMedium, color: C.textInverse },
  announceClose: { padding: 4 },

  announceBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: H_PAD,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    backgroundColor: C.primarySoft,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: C.blueLightBorder,
  },
  announceBannerTxt: { flex: 1, ...typography.captionMedium, color: C.primary },

  scroll: { paddingBottom: 0 },
  catSection: { marginTop: spacing.lg },
  catRow: { paddingHorizontal: H_PAD, gap: spacing.sm },

  grid: { paddingHorizontal: H_PAD, gap: spacing.md },
  halfRow: { flexDirection: "row", gap: spacing.md },

  svcWrap: { borderRadius: radii.xl, overflow: "hidden", height: 178 },
  svcCard: { flex: 1, borderRadius: radii.xl, padding: spacing.lg, overflow: "hidden", gap: 5 },
  svcIcon: { width: 48, height: 48, borderRadius: radii.lg, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  svcTitle: { ...typography.subtitle, lineHeight: 21 },
  svcSub: { ...typography.small, lineHeight: 15, flex: 1 },
  svcTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radii.full,
  },
  svcTagTxt: { ...typography.smallMedium },

  walletWrap: { borderRadius: radii.xl, overflow: "hidden" },
  walletCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    overflow: "hidden",
  },
  walletL: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  walletIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
    backgroundColor: C.overlayLight15,
    alignItems: "center",
    justifyContent: "center",
  },
  walletLbl: { ...typography.caption, color: C.overlayLight80, marginBottom: 2 },
  walletBal: { ...Typ.title, color: C.textInverse },
  walletTopUp: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.md,
  },
  walletTopUpTxt: { ...typography.captionMedium, color: C.primary },

  carouselWrap: { paddingHorizontal: H_PAD, overflow: "hidden" },

  bannerCard: {
    borderRadius: radii.xl,
    padding: spacing.xl,
    minHeight: 150,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  bannerTagRow: { marginBottom: 7 },
  bannerTagChip: {
    backgroundColor: C.overlayLight22,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.full,
  },
  bannerTagTxt: { ...typography.smallMedium, color: C.textInverse },
  bannerTitle: { ...Typ.title, color: C.textInverse, marginBottom: 5 },
  bannerDesc: { ...typography.caption, color: C.overlayLight90, lineHeight: 17, marginBottom: spacing.md },
  bannerCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.overlayLight20,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.full,
  },
  bannerCtaTxt: { ...typography.captionMedium, color: C.textInverse },
  bannerIconWrap: { marginLeft: spacing.sm },

  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: spacing.md },
  dot: { height: 6, borderRadius: 3 },

  flashSection: {
    marginHorizontal: H_PAD,
    marginTop: spacing.xl,
    backgroundColor: C.surface,
    borderRadius: radii.xl,
    padding: spacing.lg,
    ...shadows.sm,
  },
  flashHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  flashHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  flashTitle: {
    ...typography.h3,
    color: C.text,
  },
  flashRow: {
    gap: spacing.md,
  },
  flashCard: {
    width: 100,
    alignItems: "center",
    backgroundColor: C.surfaceSecondary,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 6,
  },
  flashIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  flashName: {
    ...typography.captionMedium,
    color: C.text,
    textAlign: "center",
  },
  flashBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.full,
  },
  flashDiscount: {
    ...typography.smallMedium,
  },

  blob: { position: "absolute", borderRadius: 999, backgroundColor: C.surface },
});
