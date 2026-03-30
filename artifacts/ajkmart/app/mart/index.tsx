import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { useCart } from "@/context/CartContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { withServiceGuard } from "@/components/ServiceGuard";
import { useGetProducts, useGetCategories } from "@workspace/api-client-react";

const C = Colors.light;
const { width } = Dimensions.get("window");
const FLASH_CARD_W = (width - 16 * 2 - 12) / 2;
const PRODUCT_CARD_W = (width - 16 * 2 - 12) / 2;

function AddToCartButton({ onPress, added }: { onPress: () => void; added: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.85, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4 }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable onPress={handlePress} style={[styles.addBtn, added && styles.addBtnDone]}>
        <Ionicons name={added ? "checkmark" : "add"} size={16} color="#fff" />
      </Pressable>
    </Animated.View>
  );
}

function FlashCard({ product }: { product: any }) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);
  const discount = product.originalPrice
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  const handleAdd = () => {
    addItem({ productId: product.id, name: product.name, price: product.price, quantity: 1, image: product.image, type: "mart" });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <View style={[styles.flashCard, { width: FLASH_CARD_W }]}>
      <LinearGradient colors={["#FFF7ED", "#FFEDD5"]} style={styles.flashImg}>
        <Ionicons name="flash" size={28} color="#F59E0B" />
        {discount > 0 && (
          <View style={styles.flashBadge}>
            <Text style={styles.flashBadgeTxt}>{discount}%</Text>
            <Text style={styles.flashBadgeSub}>OFF</Text>
          </View>
        )}
      </LinearGradient>
      <View style={styles.flashBody}>
        <Text style={styles.flashName} numberOfLines={2}>{product.name}</Text>
        {product.unit && <Text style={styles.flashUnit}>{product.unit}</Text>}
        <View style={styles.flashFooter}>
          <View>
            <Text style={styles.flashOrigPrice}>Rs. {product.originalPrice}</Text>
            <Text style={styles.flashPrice}>Rs. {product.price}</Text>
          </View>
          <AddToCartButton onPress={handleAdd} added={added} />
        </View>
      </View>
    </View>
  );
}

function ProductCard({ product }: { product: any }) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);
  const discount = product.originalPrice
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : 0;

  const handleAdd = () => {
    addItem({ productId: product.id, name: product.name, price: product.price, quantity: 1, image: product.image, type: "mart" });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <View style={[styles.productCard, { width: PRODUCT_CARD_W }]}>
      <View style={styles.productImg}>
        <Ionicons name="leaf-outline" size={32} color={C.textMuted} />
        {discount > 0 && (
          <View style={styles.discountBadge}>
            <Text style={styles.discountTxt}>{discount}% OFF</Text>
          </View>
        )}
      </View>
      <View style={styles.productBody}>
        <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
        {product.unit && <Text style={styles.productUnit}>{product.unit}</Text>}
        <View style={styles.productFooter}>
          <View>
            <Text style={styles.productPrice}>Rs. {product.price}</Text>
            {product.originalPrice && (
              <Text style={styles.productOrigPrice}>Rs. {product.originalPrice}</Text>
            )}
          </View>
          <AddToCartButton onPress={handleAdd} added={added} />
        </View>
      </View>
    </View>
  );
}

function MartScreenInner() {
  const insets = useSafeAreaInsets();
  const { itemCount } = useCart();
  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState<string | undefined>(undefined);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const searchInputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (focus === "search") {
      setTimeout(() => searchInputRef.current?.focus(), 300);
    }
  }, [focus]);

  const { config: platformConfig } = usePlatformConfig();
  const appName = platformConfig.platform.appName;

  const { data: catData } = useGetCategories({ type: "mart" });
  const { data, isLoading, isError, refetch } = useGetProducts({ type: "mart", search: search || undefined, category: selectedCat });

  const categories = catData?.categories || [];
  const products   = data?.products   || [];
  const flashDeals = products.filter(p => p.originalPrice && (p.originalPrice as number) > p.price);
  const allProducts = search || selectedCat ? products : products.filter(p => !(p.originalPrice && (p.originalPrice as number) > p.price));

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#0D3B93", "#1A56DB", "#3B82F6"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: topPad + 12 }]}
      >
        <View style={styles.hdrRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.hdrTitle}>{appName} Mart</Text>
            <Text style={styles.hdrSub}>Fresh groceries delivered fast</Text>
          </View>
          <Pressable onPress={() => router.push("/cart")} style={styles.cartBtn}>
            <Ionicons name="bag-outline" size={22} color="#fff" />
            {itemCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeTxt}>{itemCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={17} color={C.textMuted} />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search groceries..."
            placeholderTextColor={C.textMuted}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={18} color={C.textMuted} />
            </Pressable>
          )}
        </View>
      </LinearGradient>

      <ScrollView showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingTop: 14 }} contentContainerStyle={styles.catRow}>
          <Pressable
            onPress={() => setSelectedCat(undefined)}
            style={[styles.catChip, !selectedCat && styles.catChipActive]}
          >
            <Ionicons name="grid-outline" size={14} color={!selectedCat ? "#fff" : C.primary} />
            <Text style={[styles.catChipTxt, !selectedCat && styles.catChipTxtActive]}>All</Text>
          </Pressable>
          {categories.map(cat => (
            <Pressable
              key={cat.id}
              onPress={() => setSelectedCat(selectedCat === cat.id ? undefined : cat.id)}
              style={[styles.catChip, selectedCat === cat.id && styles.catChipActive]}
            >
              <Ionicons name={cat.icon as any} size={14} color={selectedCat === cat.id ? "#fff" : C.primary} />
              <Text style={[styles.catChipTxt, selectedCat === cat.id && styles.catChipTxtActive]}>{cat.name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={C.primary} size="large" />
            <Text style={styles.loadingTxt}>Loading products...</Text>
          </View>
        ) : isError ? (
          <View style={styles.center}>
            <View style={styles.errorIcon}>
              <Ionicons name="cloud-offline-outline" size={48} color={C.textMuted} />
            </View>
            <Text style={styles.errorTitle}>Could not load</Text>
            <Text style={styles.errorSub}>Check your internet and retry</Text>
            <Pressable onPress={() => refetch()} style={styles.retryBtn}>
              <Ionicons name="refresh-outline" size={16} color="#fff" />
              <Text style={styles.retryBtnTxt}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {!search && !selectedCat && flashDeals.length > 0 && (
              <>
                <View style={styles.secRow}>
                  <View style={styles.flashLabel}>
                    <View style={styles.flashIconWrap}>
                      <Ionicons name="flash" size={14} color="#F59E0B" />
                    </View>
                    <Text style={styles.secTitle}>Flash Deals</Text>
                  </View>
                  <View style={styles.timerBadge}>
                    <Ionicons name="time-outline" size={11} color="#DC2626" />
                    <Text style={styles.timerTxt}>Today only</Text>
                  </View>
                </View>

                <View style={styles.flashGrid}>
                  {flashDeals.map(p => (
                    <FlashCard key={p.id} product={p} />
                  ))}
                </View>
              </>
            )}

            <View style={styles.secRow}>
              <Text style={styles.secTitle}>
                {search ? `Results for "${search}"` : selectedCat ? "Category Items" : "All Products"}
              </Text>
              <View style={styles.itemCountBadge}>
                <Text style={styles.itemCountTxt}>{products.length}</Text>
              </View>
            </View>

            {products.length === 0 ? (
              <View style={styles.center}>
                <View style={styles.emptyIconWrap}>
                  <Ionicons name="storefront-outline" size={48} color={C.border} />
                </View>
                <Text style={styles.emptyTitle}>No products found</Text>
                <Text style={styles.emptyTxt}>Try a different search or category</Text>
              </View>
            ) : (
              <View style={styles.productsGrid}>
                {allProducts.map(p => <ProductCard key={p.id} product={p} />)}
              </View>
            )}
          </>
        )}

        <View style={{ height: Platform.OS === "web" ? 34 : 20 }} />
      </ScrollView>
    </View>
  );
}

export default withServiceGuard("mart", MartScreenInner);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },

  header: { paddingHorizontal: 16, paddingBottom: 16 },
  hdrRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  backBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  hdrTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: "#fff" },
  hdrSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 2 },
  cartBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  cartBadge: { position: "absolute", top: -4, right: -4, backgroundColor: "#F59E0B", borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 2, borderColor: "#1A56DB" },
  cartBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 10, color: "#fff" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  searchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text, padding: 0 },

  catRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  catChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22, backgroundColor: "#EFF6FF", borderWidth: 1.5, borderColor: "#DBEAFE" },
  catChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  catChipTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.primary },
  catChipTxtActive: { color: "#fff" },

  secRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginTop: 20, marginBottom: 12 },
  flashLabel: { flexDirection: "row", alignItems: "center", gap: 8 },
  flashIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" },
  secTitle: { fontFamily: "Inter_700Bold", fontSize: 17, color: C.text },
  itemCountBadge: { backgroundColor: C.primary, borderRadius: 10, minWidth: 24, height: 24, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  itemCountTxt: { fontFamily: "Inter_700Bold", fontSize: 11, color: "#fff" },
  timerBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FEE2E2", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  timerTxt: { fontFamily: "Inter_700Bold", fontSize: 11, color: "#DC2626" },

  flashGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, gap: 12, marginBottom: 8 },
  flashCard: { backgroundColor: C.surface, borderRadius: 18, overflow: "hidden", borderWidth: 1.5, borderColor: "#FED7AA", shadowColor: "#F59E0B", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 3 },
  flashImg: { height: 100, alignItems: "center", justifyContent: "center" },
  flashBadge: { position: "absolute", top: 8, left: 8, backgroundColor: "#DC2626", paddingHorizontal: 7, paddingVertical: 4, borderRadius: 10, alignItems: "center" },
  flashBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 11, color: "#fff" },
  flashBadgeSub: { fontFamily: "Inter_700Bold", fontSize: 8, color: "#fff", marginTop: -1 },
  flashBody: { padding: 12 },
  flashName: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 2, minHeight: 36 },
  flashUnit: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginBottom: 8 },
  flashFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  flashOrigPrice: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, textDecorationLine: "line-through" },
  flashPrice: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#DC2626" },

  productsGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  productCard: { backgroundColor: C.surface, borderRadius: 18, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  productImg: { height: 110, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  discountBadge: { position: "absolute", top: 8, left: 8, backgroundColor: C.danger, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  discountTxt: { fontFamily: "Inter_700Bold", fontSize: 10, color: "#fff" },
  productBody: { padding: 12 },
  productName: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 3, minHeight: 34 },
  productUnit: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginBottom: 8 },
  productFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  productPrice: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  productOrigPrice: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, textDecorationLine: "line-through" },
  addBtn: { width: 34, height: 34, borderRadius: 11, backgroundColor: C.primary, alignItems: "center", justifyContent: "center", shadowColor: C.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
  addBtnDone: { backgroundColor: C.success },

  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  errorIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  errorTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },
  errorSub: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 4 },
  retryBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" },
  loadingTxt: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 24, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },
  emptyTxt: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary },
});
