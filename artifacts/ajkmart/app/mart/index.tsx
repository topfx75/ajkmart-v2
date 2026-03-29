import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
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
const FLASH_CARD_W = (width - 16 * 2 - 10) / 2;

/* ── Flash Deal Card ── */
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
            <Text style={styles.flashBadgeTxt}>{discount}%{"\n"}OFF</Text>
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
          <Pressable onPress={handleAdd} style={[styles.flashAddBtn, added && styles.flashAddBtnDone]}>
            <Ionicons name={added ? "checkmark" : "add"} size={17} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/* ── Regular Product Card ── */
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
    <View style={styles.productCard}>
      <View style={styles.productImg}>
        <Ionicons name="leaf-outline" size={36} color={C.textMuted} />
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
          <Pressable onPress={handleAdd} style={[styles.addBtn, added && styles.addBtnDone]}>
            <Ionicons name={added ? "checkmark" : "add"} size={17} color="#fff" />
          </Pressable>
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

  const { config: platformConfig } = usePlatformConfig();
  const appName = platformConfig.platform.appName;

  const { data: catData } = useGetCategories({ type: "mart" });
  const { data, isLoading, isError, refetch } = useGetProducts({ type: "mart", search: search || undefined, category: selectedCat });

  const categories = catData?.categories || [];
  const products   = data?.products   || [];
  const flashDeals = products.filter(p => p.originalPrice && (p.originalPrice as number) > p.price);
  const allProducts = search || selectedCat ? products : products.filter(p => !(p.originalPrice && (p.originalPrice as number) > p.price));

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      {/* HEADER */}
      <LinearGradient
        colors={["#0F3BA8", C.primary]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: topPad + 10 }]}
      >
        <View style={styles.hdrRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.hdrTitle}>{appName}</Text>
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

        {/* Search bar */}
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={17} color={C.textMuted} />
          <TextInput
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
        {/* CATEGORY CHIPS */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingTop: 14 }} contentContainerStyle={styles.catRow}>
          <Pressable
            onPress={() => setSelectedCat(undefined)}
            style={[styles.catChip, !selectedCat && styles.catChipActive]}
          >
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
            <Ionicons name="cloud-offline-outline" size={56} color={C.textMuted} />
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 17, color: C.text, marginTop: 12 }}>Could not load</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, marginTop: 4 }}>Check your internet and retry</Text>
            <Pressable onPress={() => refetch()} style={{ backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 16 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* FLASH DEALS — only show when no search/filter active */}
            {!search && !selectedCat && flashDeals.length > 0 && (
              <>
                <View style={styles.secRow}>
                  <View style={styles.flashLabel}>
                    <Ionicons name="flash" size={16} color="#F59E0B" />
                    <Text style={styles.secTitle}>Flash Deals</Text>
                  </View>
                  <View style={styles.timerBadge}>
                    <Ionicons name="time-outline" size={12} color="#DC2626" />
                    <Text style={styles.timerTxt}>Today only</Text>
                  </View>
                </View>

                {/* Flash deal cards in 2 columns */}
                <View style={styles.flashGrid}>
                  {flashDeals.map(p => (
                    <FlashCard key={p.id} product={p} />
                  ))}
                </View>
              </>
            )}

            {/* ALL PRODUCTS */}
            <View style={styles.secRow}>
              <Text style={styles.secTitle}>
                {search ? `Results for "${search}"` : selectedCat ? "Category Items" : "All Products"}
              </Text>
              <Text style={styles.secCount}>{products.length} items</Text>
            </View>

            {products.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="storefront-outline" size={56} color={C.border} />
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
  container: { flex: 1 },

  /* header */
  header: { paddingHorizontal: 16, paddingBottom: 14 },
  hdrRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  hdrTitle: { fontFamily: "Inter_700Bold", fontSize: 18, color: "#fff" },
  hdrSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.8)" },
  cartBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  cartBadge: { position: "absolute", top: -4, right: -4, backgroundColor: "#F59E0B", borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3, borderWidth: 1.5, borderColor: "#fff" },
  cartBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 9, color: "#fff" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  searchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text },

  /* categories */
  catRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  catChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#EFF6FF", borderWidth: 1.5, borderColor: "#DBEAFE" },
  catChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  catChipTxt: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.primary },
  catChipTxtActive: { color: "#fff" },

  /* section row */
  secRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginTop: 18, marginBottom: 12 },
  flashLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  secTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  secCount: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted },
  timerBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FEE2E2", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  timerTxt: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: "#DC2626" },

  /* flash grid */
  flashGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  flashCard: { backgroundColor: C.surface, borderRadius: 16, overflow: "hidden", borderWidth: 1.5, borderColor: "#FED7AA", shadowColor: "#F59E0B", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  flashImg: { height: 100, alignItems: "center", justifyContent: "center" },
  flashBadge: { position: "absolute", top: 8, left: 8, backgroundColor: "#DC2626", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, alignItems: "center" },
  flashBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 9, color: "#fff", textAlign: "center" },
  flashBody: { padding: 10 },
  flashName: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 2, minHeight: 36 },
  flashUnit: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginBottom: 8 },
  flashFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  flashOrigPrice: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, textDecorationLine: "line-through" },
  flashPrice: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#DC2626" },
  flashAddBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center" },
  flashAddBtnDone: { backgroundColor: C.success },

  /* regular products */
  productsGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, paddingTop: 4, gap: 10 },
  productCard: { width: "47%", marginHorizontal: "1.5%", backgroundColor: C.surface, borderRadius: 16, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  productImg: { height: 110, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  discountBadge: { position: "absolute", top: 8, left: 8, backgroundColor: C.danger, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  discountTxt: { fontFamily: "Inter_700Bold", fontSize: 10, color: "#fff" },
  productBody: { padding: 12 },
  productName: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 3, minHeight: 34 },
  productUnit: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, marginBottom: 8 },
  productFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  productPrice: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text },
  productOrigPrice: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted, textDecorationLine: "line-through" },
  addBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  addBtnDone: { backgroundColor: C.success },

  /* states */
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  loadingTxt: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textMuted },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 17, color: C.text },
  emptyTxt: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary },
});
