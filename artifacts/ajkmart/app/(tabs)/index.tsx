import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";

import Colors, { spacing, radii, shadows, typography } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useLanguage } from "@/context/LanguageContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { tDual } from "@workspace/i18n";
import {
  SERVICE_REGISTRY,
  getActiveServices,
  getActiveBanners,
  getActiveQuickActions,
  type ServiceDefinition,
} from "@/constants/serviceRegistry";

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
    refetchInterval: 10000,
    staleTime: 8000,
  });

  const { data: ridesData, isLoading: ridesLoading, isError: ridesError } = useQuery({
    queryKey: ["home-active-rides", userId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/rides?status=active`, { headers: authHdrs });
      if (!r.ok) throw new Error("rides fetch failed");
      return r.json();
    },
    enabled: !!userId && !!token,
    refetchInterval: 10000,
    staleTime: 8000,
  });

  if (!pCfg.content.trackerBannerEnabled) return null;

  const isLoading = ordersLoading || ridesLoading;
  const hasError = ordersError || ridesError;

  const bottomStyle = position === "bottom" ? [styles.trackerWrapBottom, { marginBottom: tabBarHeight + 8 }] : undefined;

  if (isLoading) {
    return (
      <View style={[styles.trackerWrap, bottomStyle]}>
        <View style={[styles.trackerCard, { backgroundColor: "#E2E8F0", opacity: 0.7, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14 }]}>
          <View style={{ width: 100, height: 12, borderRadius: 6, backgroundColor: "#CBD5E1" }} />
        </View>
      </View>
    );
  }

  if (hasError) {
    return (
      <View style={[styles.trackerWrap, bottomStyle]}>
        <View style={[styles.trackerCard, { backgroundColor: "#FEF3C7", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14 }]}>
          <Ionicons name="warning-outline" size={14} color="#D97706" />
          <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#92400E" }}>Could not load active orders</Text>
        </View>
      </View>
    );
  }

  const activeOrders = (ordersData?.orders || []).filter((o: any) =>
    !["delivered", "cancelled"].includes(o.status)
  );
  const activeRides = (ridesData?.rides || []).filter((r: any) =>
    !["completed", "cancelled"].includes(r.status)
  );
  const totalActive = activeOrders.length + activeRides.length;

  if (totalActive === 0) return null;

  const hasRide = activeRides.length > 0;
  const hasOrder = activeOrders.length > 0;

  let label = "";
  let icon: keyof typeof Ionicons.glyphMap = "timer-outline";
  let c1 = C.success;
  let c2 = "#00E6A0";

  if (hasRide && hasOrder) {
    label = `${activeRides.length} active ride \u2022 ${activeOrders.length} active order`;
    icon = "car-outline";
    c1 = C.primary;
    c2 = C.primaryLight;
  } else if (hasRide) {
    const r = activeRides[0];
    const statusMap: Record<string, string> = {
      searching: "Finding your rider...",
      accepted: "Rider is on the way",
      arrived: "Rider has arrived!",
      in_transit: "Trip in progress",
    };
    label = statusMap[r.status] || "Ride is active";
    icon = "car-outline";
  } else {
    const o = activeOrders[0];
    const statusMap: Record<string, string> = {
      pending: "Order received, being confirmed",
      confirmed: "Order confirmed! Being prepared",
      preparing: "Your food is being prepared",
      out_for_delivery: "Order is on its way!",
      ready: "Order ready for pickup",
    };
    label = statusMap[o.status] || `${activeOrders.length} active order`;
    icon =
      o.type === "ride"
        ? "car-outline"
        : o.type === "food"
        ? "restaurant-outline"
        : "storefront-outline";
    c1 = C.primary;
    c2 = C.primaryLight;
  }

  const isBottom = (position || pCfg.content.trackerBannerPosition) === "bottom";

  const handleTrackPress = () => {
    // Rides take priority (more time-sensitive); otherwise pick the first active order.
    if (activeRides.length > 0) {
      router.push(`/ride?rideId=${activeRides[0].id}`);
    } else if (activeOrders.length > 0) {
      router.push(`/order?orderId=${activeOrders[0].id}`);
    } else {
      router.push("/(tabs)/orders");
    }
  };

  return (
    <Pressable
      onPress={handleTrackPress}
      style={[styles.trackerWrap, bottomStyle]}
    >
      <LinearGradient
        colors={[c1, c2]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.trackerCard}
      >
        <View style={styles.trackerPulse}>
          <View style={styles.trackerDot} />
        </View>
        <Ionicons name={icon} size={16} color="#fff" />
        <Text style={styles.trackerTxt} numberOfLines={1}>
          {label}
        </Text>
        <View style={styles.trackerCta}>
          <Text style={styles.trackerCtaTxt}>Track</Text>
          <Ionicons name="arrow-forward" size={12} color={c1} />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

function Tap({
  children,
  onPress,
  style,
  delay = 0,
}: {
  children: React.ReactNode;
  onPress: () => void;
  style?: any;
  delay?: number;
}) {
  const sc = useRef(new Animated.Value(0.94)).current;
  const op = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(sc, {
        toValue: 1,
        useNativeDriver: true,
        delay,
        tension: 50,
        friction: 7,
      }),
      Animated.timing(op, {
        toValue: 1,
        duration: 350,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const onIn = () =>
    Animated.spring(sc, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start();
  const onOut = () => {
    Animated.spring(sc, { toValue: 1, useNativeDriver: true, speed: 35 }).start();
    onPress();
  };

  return (
    <Animated.View style={[{ opacity: op, transform: [{ scale: sc }] }, style]}>
      <Pressable onPressIn={onIn} onPressOut={onOut} style={{ flex: 1 }}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

function ServiceHero({
  service,
  appName = "AJKMart",
}: {
  service: ServiceDefinition;
  appName?: string;
}) {
  const hero = service.heroConfig;
  const displayTitle = service.key === "mart" ? appName : hero.title;
  return (
    <Tap onPress={() => safeNavigate(service.route)} style={styles.heroWrap} delay={80}>
      <LinearGradient
        colors={hero.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
        <View
          style={[
            styles.blob,
            { width: 200, height: 200, top: -60, right: -40, opacity: 0.08 },
          ]}
        />
        <View
          style={[
            styles.blob,
            { width: 80, height: 80, bottom: 10, right: 80, opacity: 0.06 },
          ]}
        />

        <View style={styles.heroL}>
          <View style={styles.heroBadge}>
            <Ionicons name={hero.badgeIcon} size={11} color="#fff" />
            <Text style={styles.heroBadgeTxt}>{hero.badgeLabel}</Text>
          </View>
          <Text style={styles.heroTitle}>{displayTitle}</Text>
          <Text style={styles.heroSub}>{hero.subtitle}</Text>
          <View style={styles.heroStats}>
            {hero.stats.map((st, i) => (
              <View key={i} style={styles.heroStat}>
                <Ionicons name={st.icon} size={11} color="rgba(255,255,255,0.85)" />
                <Text style={styles.heroStatTxt}>{st.label}</Text>
              </View>
            ))}
          </View>
          <View style={styles.heroBtn}>
            <Text style={styles.heroBtnTxt}>{hero.cta}</Text>
            <Ionicons name="arrow-forward" size={13} color={C.primary} />
          </View>
        </View>

        <View style={styles.heroR}>
          <View style={styles.heroRing}>
            <Ionicons name={service.iconFocused} size={44} color="#fff" />
          </View>
        </View>
      </LinearGradient>
    </Tap>
  );
}

function SvcCard({
  service,
  delay,
  fullWidth,
  T,
}: {
  service: ServiceDefinition;
  delay: number;
  fullWidth?: boolean;
  T: (key: Parameters<typeof tDual>[0]) => string;
}) {
  const labelMap: Record<string, Parameters<typeof tDual>[0]> = {
    food: "foodDelivery",
    rides: "bikeCarRide",
    pharmacy: "pharmacy",
    parcel: "parcel",
  };
  const subMap: Record<string, Parameters<typeof tDual>[0]> = {
    food: "restaurantsNearYou",
    rides: "safeBooking",
    pharmacy: "medicinesDelivered",
    parcel: "parcelsAnywhere",
  };

  const title = labelMap[service.key] ? T(labelMap[service.key]) : service.label;
  const sub = subMap[service.key] ? T(subMap[service.key]) : service.description;
  const tag = service.key === "rides" ? T("instantLabel") : service.tag;

  return (
    <Tap
      onPress={() => safeNavigate(service.route)}
      style={[styles.svcWrap, fullWidth ? { width: "100%" } : { width: HALF_W }]}
      delay={delay}
    >
      <LinearGradient
        colors={service.cardGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.svcCard}
      >
        <View
          style={[
            styles.blob,
            {
              width: 110,
              height: 110,
              top: -30,
              right: -30,
              opacity: 0.1,
              backgroundColor: "#fff",
            },
          ]}
        />
        <LinearGradient colors={service.iconGradient} style={styles.svcIcon}>
          <Ionicons name={service.iconFocused} size={24} color="#fff" />
        </LinearGradient>
        <Text style={[styles.svcTitle, { color: service.textColor }]}>{title}</Text>
        <Text style={[styles.svcSub, { color: service.textColor, opacity: 0.7 }]}>{sub}</Text>
        <View style={[styles.svcTag, { backgroundColor: service.tagBg }]}>
          <Ionicons name={service.tagIcon} size={11} color={service.tagColor} />
          <Text style={[styles.svcTagTxt, { color: service.tagColor }]}>{tag}</Text>
        </View>
      </LinearGradient>
    </Tap>
  );
}

function SingleServiceHero({
  service,
  appName,
}: {
  service: ServiceDefinition;
  appName: string;
}) {
  const hero = service.heroConfig;
  const displayTitle = service.key === "mart" ? appName : hero.title;
  return (
    <Tap onPress={() => safeNavigate(service.route)} style={styles.singleHeroWrap} delay={80}>
      <LinearGradient
        colors={hero.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.singleHeroCard}
      >
        <View
          style={[
            styles.blob,
            { width: 280, height: 280, top: -80, right: -60, opacity: 0.08 },
          ]}
        />
        <View
          style={[
            styles.blob,
            { width: 120, height: 120, bottom: 20, left: -30, opacity: 0.06 },
          ]}
        />

        <View style={styles.singleHeroContent}>
          <View style={styles.singleHeroIconWrap}>
            <Ionicons name={service.iconFocused} size={64} color="#fff" />
          </View>
          <View style={styles.heroBadge}>
            <Ionicons name={hero.badgeIcon} size={11} color="#fff" />
            <Text style={styles.heroBadgeTxt}>{hero.badgeLabel}</Text>
          </View>
          <Text style={styles.singleHeroTitle}>{displayTitle}</Text>
          <Text style={styles.singleHeroSub}>{hero.subtitle}</Text>
          <View style={styles.singleHeroStats}>
            {hero.stats.map((st, i) => (
              <View key={i} style={styles.singleHeroStat}>
                <Ionicons name={st.icon} size={14} color="rgba(255,255,255,0.85)" />
                <Text style={styles.singleHeroStatTxt}>{st.label}</Text>
              </View>
            ))}
          </View>
          <View style={styles.singleHeroCta}>
            <Text style={styles.singleHeroCtaTxt}>{hero.cta}</Text>
            <Ionicons name="arrow-forward" size={16} color={C.primary} />
          </View>
        </View>
      </LinearGradient>
    </Tap>
  );
}

function NoServicesState({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Ionicons name="storefront-outline" size={48} color={C.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>No Services Available</Text>
      <Text style={styles.emptySub}>
        No services are currently available.{"\n"}Please check back later!
      </Text>
      {onRefresh && (
        <Pressable onPress={onRefresh} style={styles.refreshBtn}>
          <Ionicons name="refresh-outline" size={16} color={C.primary} />
          <Text style={styles.refreshBtnTxt}>Refresh</Text>
        </Pressable>
      )}
    </View>
  );
}

function WalletStrip({
  balance,
  onPress,
  appName = "AJKMart",
}: {
  balance: number;
  onPress: () => void;
  appName?: string;
}) {
  return (
    <Tap onPress={onPress} style={styles.walletWrap} delay={310}>
      <LinearGradient
        colors={[C.primaryDark, C.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.walletCard}
      >
        <View
          style={[
            styles.blob,
            { width: 140, height: 140, top: -45, right: 50, opacity: 0.08 },
          ]}
        />
        <View style={styles.walletL}>
          <View style={styles.walletIcon}>
            <Ionicons name="wallet" size={20} color="#fff" />
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
    </Tap>
  );
}

function Pill({
  icon,
  label,
  color,
  bg,
  onPress,
  delay,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  bg: string;
  onPress: () => void;
  delay: number;
}) {
  const op = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(16)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(op, {
        toValue: 1,
        duration: 300,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(ty, {
        toValue: 0,
        duration: 300,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);
  return (
    <Animated.View style={{ opacity: op, transform: [{ translateY: ty }] }}>
      <Pressable onPress={onPress} style={styles.pill}>
        <View style={[styles.pillIcon, { backgroundColor: bg }]}>
          <Ionicons name={icon} size={20} color={color} />
        </View>
        <Text style={styles.pillLbl}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

function BannerCarousel({
  features,
}: {
  features: Record<string, boolean>;
}) {
  const banners = getActiveBanners(features);
  const scrollRef = useRef<ScrollView>(null);
  const [active, setActive] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const BANNER_W = windowWidth - H_PAD * 2;

  useEffect(() => {
    if (banners.length <= 1) return;
    const timer = setInterval(() => {
      setActive((prev) => {
        const next = (prev + 1) % banners.length;
        scrollRef.current?.scrollTo({ x: next * BANNER_W, animated: true });
        return next;
      });
    }, 3200);
    return () => clearInterval(timer);
  }, [BANNER_W, banners.length]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const idx = Math.round(e.nativeEvent.contentOffset.x / BANNER_W);
      setActive(idx);
    },
    [BANNER_W]
  );

  if (banners.length === 0) return null;

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled={false}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
        snapToInterval={BANNER_W}
        snapToAlignment="start"
        contentContainerStyle={{ paddingHorizontal: 0 }}
        style={{ width: BANNER_W }}
      >
        {banners.map((b, i) => (
          <Pressable
            key={i}
            onPress={() => router.push(b.route as Href)}
            style={{ width: BANNER_W }}
          >
            <LinearGradient
              colors={[b.c1, b.c2]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.bannerCard}
            >
              <View
                style={[
                  styles.blob,
                  { width: 130, height: 130, top: -30, right: 60, opacity: 0.12 },
                ]}
              />
              <View
                style={[
                  styles.blob,
                  { width: 70, height: 70, bottom: -10, right: 10, opacity: 0.08 },
                ]}
              />

              <View style={{ flex: 1 }}>
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

              <View style={styles.bannerIconWrap}>
                <Ionicons
                  name={b.icon}
                  size={56}
                  color="rgba(255,255,255,0.15)"
                />
              </View>
            </LinearGradient>
          </Pressable>
        ))}
      </ScrollView>

      {banners.length > 1 && (
        <View style={styles.dotsRow}>
          {banners.map((_, i) => (
            <Pressable
              key={i}
              onPress={() => {
                setActive(i);
                scrollRef.current?.scrollTo({
                  x: i * BANNER_W,
                  animated: true,
                });
              }}
              style={[styles.dot, active === i && styles.dotActive]}
            />
          ))}
        </View>
      )}
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
  const [homeRefreshing, setHomeRefreshing] = useState(false);

  const { config: platformConfig, loading: configLoading, refresh: refreshConfig } = usePlatformConfig();

  const handleHomeRefresh = useCallback(async () => {
    setHomeRefreshing(true);
    try { await refreshConfig(); } catch {}
    setHomeRefreshing(false);
  }, [refreshConfig]);
  const features = platformConfig.features;
  const appName = platformConfig.platform.appName;
  const contentBanner = platformConfig.content.banner;
  const announcement = platformConfig.content.announcement;
  const [announceDismissed, setAnnounceDismissed] = useState(false);

  const announceKey = React.useMemo(() => {
    if (!announcement) return "";
    const hash = Array.from(announcement).reduce(
      (h, c) => (((h * 31) | 0) + c.charCodeAt(0)) >>> 0, 0
    ).toString(36);
    return `announce_dismissed_${hash}`;
  }, [announcement]);

  useEffect(() => {
    if (!announcement) {
      setAnnounceDismissed(false);
      return;
    }
    AsyncStorage.getItem(announceKey).then(val => {
      setAnnounceDismissed(val === "1");
    }).catch(() => { setAnnounceDismissed(false); });
  }, [announcement, announceKey]);

  const { language } = useLanguage();
  const T = (key: Parameters<typeof tDual>[0]) => tDual(key, language);

  useEffect(() => {
    Animated.timing(hdOp, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, []);

  const activeServices = getActiveServices(features);
  const quickActions = getActiveQuickActions(features);
  const noServicesActive = activeServices.length === 0;

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      {announcement && !announceDismissed && (
        <View style={styles.announceBar}>
          <View style={styles.announceIcon}>
            <Ionicons name="megaphone" size={12} color="#fff" />
          </View>
          <Text style={styles.announceTxt} numberOfLines={1}>
            {announcement}
          </Text>
          <Pressable
            onPress={() => {
              setAnnounceDismissed(true);
              if (announceKey) {
                AsyncStorage.setItem(announceKey, "1").catch(() => {});
              }
            }}
            style={styles.announceClose}
          >
            <Ionicons name="close" size={16} color="rgba(255,255,255,0.8)" />
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
              <Text style={styles.greeting}>
                {user?.name
                  ? `${T("salam")}, ${user.name.split(" ")[0]}`
                  : `${T("salam")}!`}
              </Text>
              <Text style={styles.hdrTitle}>{T("whatDoYouWant")}</Text>
              <View style={styles.locRow}>
                <Ionicons
                  name="location"
                  size={12}
                  color="rgba(255,255,255,0.7)"
                />
                <Text style={styles.locTxt}>
                  {platformConfig.platform.businessAddress}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => router.push("/cart")}
              style={styles.cartBtn}
            >
              <Ionicons name="bag-outline" size={20} color="#fff" />
              {itemCount > 0 && (
                <View style={styles.cartBadge}>
                  <Text style={styles.cartBadgeTxt}>
                    {itemCount > 9 ? "9+" : itemCount}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>

          <Pressable
            onPress={() => router.push("/search")}
            style={styles.searchBar}
          >
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

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={homeRefreshing} onRefresh={handleHomeRefresh} tintColor={C.primary} />}
      >
        <View style={styles.secRow}>
          <Text style={styles.secTitle}>{T("ourServices")}</Text>
          <Text style={styles.secSub}>{T("allInOne")}</Text>
        </View>

        {contentBanner ? (
          <View style={styles.announceBanner}>
            <Ionicons name="megaphone-outline" size={14} color={C.primary} />
            <Text style={styles.announceBannerTxt} numberOfLines={1}>
              {contentBanner}
            </Text>
          </View>
        ) : null}

        {configLoading ? (
          <View style={{ paddingHorizontal: 16, gap: 12, marginTop: 8 }}>
            {[1, 2, 3].map(i => (
              <View key={i} style={{ height: i === 1 ? 160 : 110, borderRadius: 20, backgroundColor: C.surfaceSecondary, opacity: 0.6 }} />
            ))}
          </View>
        ) : noServicesActive ? (
          <NoServicesState onRefresh={refreshConfig} />
        ) : (
          <>
            {activeServices.length === 1 ? (
              <View style={styles.grid}>
                <SingleServiceHero
                  service={activeServices[0]}
                  appName={appName}
                />
                {features.wallet && (
                  <WalletStrip
                    balance={user?.walletBalance || 0}
                    onPress={() => router.push("/(tabs)/wallet")}
                    appName={appName}
                  />
                )}
              </View>
            ) : activeServices.length === 2 ? (
              <View style={styles.grid}>
                {activeServices.map((svc) => (
                  <ServiceHero key={svc.key} service={svc} appName={appName} />
                ))}
                {features.wallet && (
                  <WalletStrip
                    balance={user?.walletBalance || 0}
                    onPress={() => router.push("/(tabs)/wallet")}
                    appName={appName}
                  />
                )}
              </View>
            ) : (
              <View style={styles.grid}>
                {(() => {
                  const elements: React.ReactNode[] = [];
                  const first = activeServices[0];
                  const rest = activeServices.slice(1);

                  elements.push(
                    <ServiceHero key={first.key} service={first} appName={appName} />
                  );

                  for (let i = 0; i < rest.length; i += 2) {
                    const pair = rest.slice(i, i + 2);
                    if (pair.length === 2) {
                      elements.push(
                        <View key={`row-${i}`} style={styles.halfRow}>
                          <SvcCard service={pair[0]} delay={160 + i * 40} T={T} />
                          <SvcCard service={pair[1]} delay={200 + i * 40} T={T} />
                        </View>
                      );
                    } else {
                      elements.push(
                        <SvcCard
                          key={`single-${i}`}
                          service={pair[0]}
                          delay={160 + i * 40}
                          fullWidth
                          T={T}
                        />
                      );
                    }
                  }

                  return elements;
                })()}

                {features.wallet && (
                  <WalletStrip
                    balance={user?.walletBalance || 0}
                    onPress={() => router.push("/(tabs)/wallet")}
                    appName={appName}
                  />
                )}
              </View>
            )}

            {quickActions.length > 0 && (
              <>
                <View style={styles.secRow}>
                  <Text style={styles.secTitle}>{T("quickAccess")}</Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.pillsRow}
                >
                  {quickActions.map((q, i) => (
                    <Pill
                      key={`${q.label}-${i}`}
                      icon={q.icon}
                      label={q.label}
                      color={q.color}
                      bg={q.bg}
                      onPress={() => router.push(q.route as Href)}
                      delay={70 + i * 50}
                    />
                  ))}
                </ScrollView>
              </>
            )}

            {platformConfig.content.showBanner && (
              <>
                <View style={styles.secRow}>
                  <Text style={styles.secTitle}>{T("todaysDeals")}</Text>
                  <Text style={styles.secSub}>{T("autoSlidesLabel")}</Text>
                </View>
                <View style={styles.carouselWrap}>
                  <BannerCarousel features={features} />
                </View>
              </>
            )}
          </>
        )}

        {user?.id && platformConfig.content.trackerBannerPosition === "bottom" && (
          <ActiveTrackerStrip userId={user.id} position="bottom" tabBarHeight={TAB_H} />
        )}

        <View style={{ height: TAB_H + insets.bottom + 20 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  trackerWrap: { marginHorizontal: H_PAD, marginTop: spacing.sm },
  trackerWrapBottom: { marginTop: spacing.md, marginBottom: spacing.sm },
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
    backgroundColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  trackerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
  trackerTxt: {
    flex: 1,
    ...typography.captionMedium,
    color: "#fff",
  },
  trackerCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.full,
  },
  trackerCtaTxt: {
    ...typography.smallMedium,
    color: C.primary,
  },

  header: { paddingHorizontal: H_PAD, paddingBottom: spacing.lg },
  hdrRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.lg,
  },
  greeting: {
    ...typography.caption,
    color: "rgba(255,255,255,0.8)",
    marginBottom: 2,
  },
  hdrTitle: {
    ...typography.h2,
    color: "#fff",
    marginBottom: Platform.OS === "web" ? 2 : 5,
  },
  locRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  locTxt: {
    ...typography.small,
    color: "rgba(255,255,255,0.7)",
  },
  cartBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
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
    borderColor: "#fff",
  },
  cartBadgeTxt: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    color: "#fff",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    ...shadows.sm,
  },
  searchIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: C.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  searchTxt: {
    flex: 1,
    ...typography.body,
    color: C.textMuted,
  },
  searchFilter: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: C.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },

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
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  announceTxt: {
    flex: 1,
    ...typography.captionMedium,
    color: "#fff",
  },
  announceClose: {
    padding: 4,
  },

  announceBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: H_PAD,
    marginBottom: spacing.md,
    backgroundColor: C.primarySoft,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: "#B3D4FF",
  },
  announceBannerTxt: {
    flex: 1,
    ...typography.captionMedium,
    color: C.primary,
  },

  secRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: H_PAD,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  secTitle: { ...typography.h3, color: C.text },
  secSub: { ...typography.caption, color: C.textMuted },

  scroll: { paddingBottom: 0 },

  grid: { paddingHorizontal: H_PAD, gap: spacing.md },
  halfRow: { flexDirection: "row", gap: spacing.md },

  heroWrap: { borderRadius: radii.xxl, overflow: "hidden" },
  heroCard: {
    borderRadius: radii.xxl,
    padding: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 165,
    overflow: "hidden",
  },
  heroL: { flex: 1, gap: 7 },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.full,
  },
  heroBadgeTxt: { ...typography.smallMedium, color: "#fff" },
  heroTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    color: "#fff",
    lineHeight: 32,
  },
  heroSub: {
    ...typography.caption,
    color: "rgba(255,255,255,0.85)",
    lineHeight: 17,
  },
  heroStats: { flexDirection: "row", gap: 14, marginTop: 2 },
  heroStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  heroStatTxt: {
    ...typography.small,
    color: "rgba(255,255,255,0.85)",
  },
  heroBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff",
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.full,
    marginTop: 4,
  },
  heroBtnTxt: {
    ...typography.buttonSmall,
    color: C.primary,
  },
  heroR: { alignItems: "center", marginLeft: 10 },
  heroRing: {
    width: 78,
    height: 78,
    borderRadius: radii.xxl,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.2)",
  },

  singleHeroWrap: { borderRadius: radii.xxl, overflow: "hidden" },
  singleHeroCard: {
    borderRadius: radii.xxl,
    padding: spacing.xxl,
    alignItems: "center",
    minHeight: 320,
    overflow: "hidden",
    justifyContent: "center",
  },
  singleHeroContent: {
    alignItems: "center",
    gap: 10,
  },
  singleHeroIconWrap: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
    marginBottom: 8,
  },
  singleHeroTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 34,
    color: "#fff",
    textAlign: "center",
  },
  singleHeroSub: {
    ...typography.body,
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    lineHeight: 22,
  },
  singleHeroStats: {
    flexDirection: "row",
    gap: 20,
    marginTop: 4,
  },
  singleHeroStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.full,
  },
  singleHeroStatTxt: {
    ...typography.captionMedium,
    color: "rgba(255,255,255,0.9)",
  },
  singleHeroCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radii.full,
    marginTop: 8,
  },
  singleHeroCtaTxt: {
    ...typography.button,
    color: C.primary,
  },

  svcWrap: { borderRadius: radii.xl, overflow: "hidden", height: 178 },
  svcCard: {
    flex: 1,
    borderRadius: radii.xl,
    padding: spacing.lg,
    overflow: "hidden",
    gap: 5,
  },
  svcIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
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
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  walletLbl: {
    ...typography.caption,
    color: "rgba(255,255,255,0.8)",
    marginBottom: 2,
  },
  walletBal: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: "#fff",
  },
  walletTopUp: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.md,
  },
  walletTopUpTxt: { ...typography.captionMedium, color: C.primary },

  pillsRow: { paddingHorizontal: H_PAD, gap: spacing.md },
  pill: { alignItems: "center", gap: 7, width: 68 },
  pillIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  pillLbl: {
    ...typography.smallMedium,
    color: C.textSecondary,
    textAlign: "center",
  },

  carouselWrap: { paddingHorizontal: H_PAD, overflow: "hidden" },

  bannerCard: {
    borderRadius: radii.xl,
    padding: spacing.xl,
    minHeight: 135,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  bannerTagRow: { marginBottom: 7 },
  bannerTagChip: {
    backgroundColor: "rgba(255,255,255,0.22)",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.full,
  },
  bannerTagTxt: { ...typography.smallMedium, color: "#fff" },
  bannerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 19,
    color: "#fff",
    marginBottom: 5,
  },
  bannerDesc: {
    ...typography.caption,
    color: "rgba(255,255,255,0.9)",
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  bannerCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.full,
  },
  bannerCtaTxt: { ...typography.captionMedium, color: "#fff" },
  bannerIconWrap: { marginLeft: spacing.sm },

  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.md,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.border },
  dotActive: { width: 22, borderRadius: 3, backgroundColor: C.primary },

  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: C.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyTitle: { ...typography.h3, color: C.text, marginBottom: 10, textAlign: "center" },
  emptySub: {
    ...typography.body,
    color: C.textMuted,
    textAlign: "center",
    lineHeight: 21,
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radii.lg,
    backgroundColor: C.primarySoft,
    borderWidth: 1,
    borderColor: C.border,
  },
  refreshBtnTxt: {
    ...typography.captionMedium,
    color: C.primary,
  },

  blob: { position: "absolute", borderRadius: 999, backgroundColor: "#fff" },
});
