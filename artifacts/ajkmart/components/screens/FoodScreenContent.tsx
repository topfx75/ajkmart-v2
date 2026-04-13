import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ProgressiveImage } from "@/components/ui/ProgressiveImage";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors, { typography } from "@/constants/colors";
import { T as Typ, Font } from "@/constants/typography";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { useCart } from "@/context/CartContext";
import { useLanguage } from "@/context/LanguageContext";
import { tDual, type TranslationKey } from "@workspace/i18n";
import { withServiceGuard } from "@/components/ServiceGuard";
import { withErrorBoundary } from "@/utils/withErrorBoundary";
import { useGetProducts, useGetCategories } from "@workspace/api-client-react";
import { CartSwitchModal } from "@/components/CartSwitchModal";
import { AuthGateSheet, useAuthGate, useRoleGate, RoleBlockSheet } from "@/components/AuthGateSheet";

const C = Colors.light;

const FoodCard = React.memo(function FoodCard({ item }: { item: any }) {
  const { addItem, cartType, itemCount, clearCartAndAdd, items, updateQuantity, removeItem } = useCart();
  const [added, setAdded] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { requireAuth, sheetProps } = useAuthGate();
  const { requireCustomerRole, roleBlockProps } = useRoleGate();

  const cartItem = items.find(i => i.productId === item.id);
  const qtyInCart = cartItem?.quantity ?? 0;

  useEffect(() => () => { if (addedTimerRef.current) clearTimeout(addedTimerRef.current); }, []);

  const doAdd = () => {
    addItem({ productId: item.id, name: item.name, price: item.price, quantity: 1, image: item.image, type: "food" });
    setAdded(true);
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.9, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4 }),
    ]).start();
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    addedTimerRef.current = setTimeout(() => { setAdded(false); addedTimerRef.current = null; }, 1500);
  };

  const [showSwitchModal, setShowSwitchModal] = useState(false);

  const handleAdd = (e?: any) => {
    e?.stopPropagation?.();
    requireAuth(() => {
      requireCustomerRole(() => {
        if (itemCount > 0 && cartType !== "food" && cartType !== "none") {
          setShowSwitchModal(true);
          return;
        }
        doAdd();
      });
    }, { message: "Sign in to add items to your cart", returnTo: "/food" });
  };

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={() => router.push({ pathname: "/product/[id]", params: { id: item.id } })} style={styles.foodCard}>
      <AuthGateSheet {...sheetProps} />
      <RoleBlockSheet {...roleBlockProps} />
      <CartSwitchModal
        visible={showSwitchModal}
        targetService="Food"
        currentService={cartType === "pharmacy" ? "Pharmacy" : cartType === "mart" ? "Mart" : "Another service"}
        onCancel={() => setShowSwitchModal(false)}
        onConfirm={() => { setShowSwitchModal(false); clearCartAndAdd({ productId: item.id, name: item.name, price: item.price, quantity: 1, image: item.image, type: "food" }); }}
      />
      <View style={styles.foodImageBox}>
        {item.image
          ? <ProgressiveImage source={item.image} style={StyleSheet.absoluteFill} containerStyle={StyleSheet.absoluteFill} borderRadius={0} />
          : <Ionicons name="restaurant-outline" size={32} color={C.amber} />}
        {item.deliveryTime && (
          <View style={styles.timeBadge}>
            <Ionicons name="time-outline" size={10} color={C.textInverse} />
            <Text style={styles.timeText}>{item.deliveryTime}</Text>
          </View>
        )}
      </View>
      <View style={styles.foodInfo}>
        <Text style={styles.foodName} numberOfLines={1}>{item?.name ?? "—"}</Text>
        <Text style={styles.foodVendor} numberOfLines={1}>{item?.vendorName ?? "Restaurant"}</Text>
        {item?.rating != null && (
          <View style={styles.ratingRow}>
            <View style={styles.ratingPill}>
              <Ionicons name="star" size={11} color={C.gold} />
              <Text style={styles.ratingText}>{item.rating}</Text>
            </View>
            {item?.reviewCount != null && (
              <Text style={styles.reviewCount}>({item.reviewCount} reviews)</Text>
            )}
          </View>
        )}
        <View style={styles.foodFooter}>
          <Text style={styles.foodPrice}>Rs. {item?.price ?? 0}</Text>
          {qtyInCart > 0 ? (
            <View style={styles.stepperRow}>
              <TouchableOpacity activeOpacity={0.7} onPress={(e) => { e?.stopPropagation?.(); qtyInCart <= 1 ? removeItem(item.id) : updateQuantity(item.id, qtyInCart - 1); }} style={styles.stepperBtn}>
                <Ionicons name={qtyInCart <= 1 ? "trash-outline" : "remove"} size={14} color={C.red} />
              </TouchableOpacity>
              <Text style={styles.stepperQty}>{qtyInCart}</Text>
              <TouchableOpacity activeOpacity={0.7} onPress={(e) => { e?.stopPropagation?.(); updateQuantity(item.id, qtyInCart + 1); }} style={[styles.stepperBtn, { backgroundColor: C.accentSoft }]}>
                <Ionicons name="add" size={14} color={C.amber} />
              </TouchableOpacity>
            </View>
          ) : (
            <Animated.View style={{ transform: [{ scale }] }}>
              <TouchableOpacity activeOpacity={0.7} onPress={(e) => handleAdd(e)} style={[styles.addBtn, added && styles.addBtnAdded]}>
                <Ionicons name={added ? "checkmark" : "add"} size={16} color={C.textInverse} />
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
});

function FoodScreenInner() {
  const insets = useSafeAreaInsets();
  const { itemCount, total: cartTotal, cartType, clearCart } = useCart();
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const showCartBanner = itemCount > 0 && cartType !== "food" && cartType !== "none";
  const [clearBannerConfirm, setClearBannerConfirm] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { category: routeCategory } = useLocalSearchParams<{ category?: string }>();
  const [selectedCat, setSelectedCat] = useState<string | undefined>(routeCategory || undefined);
  const topPad = Math.max(insets.top, 12);

  useEffect(() => {
    setSelectedCat(routeCategory || undefined);
  }, [routeCategory]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [search]);

  const { data: catData } = useGetCategories({ type: "food" });
  const { data, isLoading, isError, refetch, isRefetching } = useGetProducts({ type: "food", search: debouncedSearch || undefined, category: selectedCat });

  const categories = useMemo(() => catData?.categories || [], [catData]);
  const items = useMemo(() => data?.products || [], [data]);

  const handleSelectCat = useCallback((id: string) => {
    setSelectedCat(prev => prev === id ? undefined : id);
  }, []);

  const handleClearSearch = useCallback(() => setSearch(""), []);
  const handleRefetch = useCallback(() => refetch(), [refetch]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[C.amberDark, C.amber, C.gold]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: topPad + 12 }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={C.textInverse} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{T("foodDelivery")}</Text>
            <Text style={styles.headerSub}>{T("orderFromRestaurants")}</Text>
          </View>
          <TouchableOpacity activeOpacity={0.7} onPress={() => router.push("/cart")} style={styles.cartBtn}>
            <Ionicons name="bag-outline" size={22} color={C.textInverse} />
            {itemCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeTxt}>{itemCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={17} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={T("searchFoodPlaceholder")}
            placeholderTextColor={C.textMuted}
            maxLength={200}
          />
          {search.length > 0 && (
            <TouchableOpacity activeOpacity={0.7} onPress={handleClearSearch}>
              <Ionicons name="close-circle" size={18} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>

      {showCartBanner && (
        <View style={{ backgroundColor: C.indigoSoft, flexDirection: "row", alignItems: "center", padding: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: C.indigoBorder }}>
          <Ionicons name="warning-outline" size={18} color={C.indigoDark} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...Typ.buttonSmall, fontFamily: Font.bold, color: C.indigoDarkest }}>{cartType === "pharmacy" ? `${T("pharmacy")} cart active` : cartType === "mart" ? `${T("mart")} cart active` : "Another cart active"}</Text>
            <Text style={{ ...Typ.caption, color: C.indigoDarkest }}>{T("cartClearWarning").replace("{service}", T("food"))}</Text>
          </View>
          <TouchableOpacity activeOpacity={0.7}
            onPress={() => setClearBannerConfirm(true)}
            style={{ backgroundColor: C.indigoDark, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
          >
            <Text style={{ ...Typ.captionBold, color: C.textInverse }}>{T("clearCart")}</Text>
          </TouchableOpacity>
        </View>
      )}

      <CartSwitchModal
        visible={clearBannerConfirm}
        currentService={cartType === "mart" ? "Mart" : cartType === "pharmacy" ? "Pharmacy" : "Current"}
        targetService="Food"
        onConfirm={() => { clearCart(); setClearBannerConfirm(false); }}
        onCancel={() => setClearBannerConfirm(false)}
      />

      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={C.food} />}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.catContent}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => setSelectedCat(undefined)} style={[styles.catChip, !selectedCat && styles.catChipActive]}>
            <Ionicons name="fast-food-outline" size={14} color={!selectedCat ? C.textInverse : C.food} />
            <Text style={[styles.catChipText, !selectedCat && styles.catChipTextActive]}>All</Text>
          </TouchableOpacity>
          {categories.map(c => (
            <TouchableOpacity activeOpacity={0.7} key={c.id} onPress={() => handleSelectCat(c.id)} style={[styles.catChip, selectedCat === c.id && styles.catChipActive]}>
              <Ionicons name={c.icon as keyof typeof Ionicons.glyphMap} size={14} color={selectedCat === c.id ? C.textInverse : C.food} />
              <Text style={[styles.catChipText, selectedCat === c.id && styles.catChipTextActive]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity activeOpacity={0.7}
            onPress={() => router.push({ pathname: "/categories" as any, params: { type: "food" } })}
            style={[styles.catChip, { borderStyle: "dashed" as any }]}
          >
            <Ionicons name="apps-outline" size={14} color={C.food} />
            <Text style={styles.catChipText}>Browse All</Text>
          </TouchableOpacity>
        </ScrollView>

        {isLoading ? (
          <View style={styles.skeletonList}>
            {[0,1,2,3,4].map(i => (
              <View key={i} style={styles.skeletonCard}>
                <SkeletonBlock w={110} h={110} r={0} />
                <View style={{ flex: 1, padding: 14, gap: 8 }}>
                  <SkeletonBlock w="70%" h={14} r={6} />
                  <SkeletonBlock w="45%" h={10} r={5} />
                  <SkeletonBlock w="35%" h={12} r={6} />
                </View>
              </View>
            ))}
          </View>
        ) : isError ? (
          <View style={styles.center}>
            <View style={styles.errorIcon}>
              <Ionicons name="cloud-offline-outline" size={48} color={C.textMuted} />
            </View>
            <Text style={styles.errorTitle}>{T("couldNotLoad")}</Text>
            <Text style={styles.errorSub}>{T("checkInternetRetry")}</Text>
            <TouchableOpacity activeOpacity={0.7} onPress={handleRefetch} style={styles.retryBtn}>
              <Ionicons name="refresh-outline" size={16} color={C.textInverse} />
              <Text style={styles.retryBtnTxt}>{T("retry")}</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <View style={styles.emptyIcon}>
              <Ionicons name="restaurant-outline" size={48} color={C.border} />
            </View>
            <Text style={styles.emptyTitle}>{T("noFoodItemsYet")}</Text>
            <Text style={styles.emptyText}>{T("vendorsAddingSoon")}</Text>
          </View>
        ) : (
          <>
            <View style={styles.secRow}>
              <Text style={styles.secTitle}>
                {search ? `Results for "${search}"` : selectedCat ? "Category Items" : "Popular Near You"}
              </Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeTxt}>{items.length}</Text>
              </View>
            </View>
            <View style={styles.foodList}>
              {items.map(i => <FoodCard key={i.id} item={i} />)}
            </View>
          </>
        )}
        <View style={{ height: Math.max(insets.bottom, Platform.OS === "web" ? 34 : 20) + (itemCount > 0 ? 72 : 0) }} />
      </ScrollView>

      {itemCount > 0 && (
        <View style={[styles.checkoutBar, { bottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push("/cart")}
            style={styles.checkoutBarInner}
            accessibilityRole="button"
            accessibilityLabel={`View cart — ${itemCount} items`}
          >
            <LinearGradient
              colors={[C.amberDark, C.amber]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.checkoutBarGrad}
            >
              <View style={styles.checkoutBarLeft}>
                <View style={styles.checkoutBarBadge}>
                  <Text style={styles.checkoutBarBadgeTxt}>{itemCount > 99 ? "99+" : itemCount}</Text>
                </View>
                <View>
                  <Text style={styles.checkoutBarItemsTxt}>{itemCount} {itemCount === 1 ? "item" : "items"} in cart</Text>
                  <Text style={styles.checkoutBarPriceTxt}>Rs. {cartTotal.toLocaleString()}</Text>
                </View>
              </View>
              <View style={styles.checkoutBarRight}>
                <Text style={styles.checkoutBarCta}>View Cart</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default withErrorBoundary(withServiceGuard("food", FoodScreenInner));

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { paddingHorizontal: 16, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  backBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.overlayLight20, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.h3, fontSize: 20, color: C.textInverse },
  headerSub: { ...typography.caption, color: C.overlayLight80, marginTop: 2 },
  cartBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.overlayLight20, alignItems: "center", justifyContent: "center" },
  cartBadge: { position: "absolute", top: -4, right: -4, backgroundColor: C.red, borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 2, borderColor: C.amber },
  cartBadgeTxt: { ...typography.small, fontFamily: Font.bold, color: C.textInverse },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, shadowColor: C.text, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  searchInput: { flex: 1, ...typography.body, color: C.text, padding: 0 },

  catScroll: { marginTop: 12 },
  catContent: { paddingHorizontal: 16, gap: 8, flexDirection: "row" },
  catChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22, backgroundColor: C.amberSoft, borderWidth: 1.5, borderColor: C.amberBorder },
  catChipActive: { backgroundColor: C.food, borderColor: C.food },
  catChipText: { ...typography.buttonSmall, color: C.food },
  catChipTextActive: { color: C.textInverse },

  secRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginTop: 18, marginBottom: 12 },
  secTitle: { ...typography.h3, fontSize: 17, color: C.text },
  countBadge: { backgroundColor: C.food, borderRadius: 10, minWidth: 24, height: 24, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  countBadgeTxt: { ...typography.small, fontFamily: Font.bold, color: C.textInverse },

  foodList: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  foodCard: { backgroundColor: C.surface, borderRadius: 18, flexDirection: "row", overflow: "hidden", shadowColor: C.text, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  foodImageBox: { width: 110, backgroundColor: C.amberSoft, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  timeBadge: { position: "absolute", bottom: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: C.overlayDark60, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  timeText: { ...Typ.smallMedium, fontSize: 10, color: C.textInverse },
  foodInfo: { flex: 1, padding: 14, justifyContent: "center" },
  foodName: { ...typography.button, fontFamily: Font.bold, color: C.text, marginBottom: 3 },
  foodVendor: { ...typography.caption, color: C.textSecondary, marginBottom: 8 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  ratingPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: C.amberSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  ratingText: { ...typography.caption, fontFamily: Font.bold, color: C.amberDark },
  reviewCount: { ...typography.small, color: C.textMuted },
  foodFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  foodPrice: { ...typography.h3, fontSize: 17, color: C.text },
  addBtn: { width: 34, height: 34, borderRadius: 11, backgroundColor: C.food, alignItems: "center", justifyContent: "center", shadowColor: C.food, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
  addBtnAdded: { backgroundColor: C.success },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepperBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.dangerSoft, alignItems: "center", justifyContent: "center" },
  stepperQty: { ...typography.body, fontFamily: Font.bold, color: C.text, minWidth: 18, textAlign: "center" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  errorIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  errorTitle: { ...typography.h3, color: C.text },
  errorSub: { ...typography.body, fontSize: 13, color: C.textMuted },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.food, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 4 },
  retryBtnTxt: { ...typography.body, fontFamily: Font.bold, color: C.textInverse },
  loadingText: { ...typography.body, fontSize: 13, color: C.textMuted, marginTop: 10 },
  skeletonList: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  skeletonCard: { flexDirection: "row", backgroundColor: C.surface, borderRadius: 18, overflow: "hidden", height: 110 },
  skeletonImg: { width: 110, backgroundColor: C.orangeBg },
  emptyIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { ...typography.h3, color: C.text },
  emptyText: { ...typography.body, color: C.textSecondary },

  checkoutBar: { position: "absolute", left: 16, right: 16, zIndex: 99 },
  checkoutBarInner: { borderRadius: 16, overflow: "hidden", shadowColor: C.amberDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8 },
  checkoutBarGrad: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  checkoutBarLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  checkoutBarBadge: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.15)", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.35)" },
  checkoutBarBadgeTxt: { fontFamily: Font.bold, fontSize: 15, color: "#fff" },
  checkoutBarItemsTxt: { fontFamily: Font.semiBold, fontSize: 13, color: "rgba(255,255,255,0.9)" },
  checkoutBarPriceTxt: { fontFamily: Font.bold, fontSize: 16, color: "#fff", marginTop: 1 },
  checkoutBarRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  checkoutBarCta: { fontFamily: Font.bold, fontSize: 15, color: "#fff" },
});
