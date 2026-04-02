import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { T as Typ, Font } from "@/constants/typography";
import { useCart } from "@/context/CartContext";
import { CartSwitchModal } from "@/components/CartSwitchModal";
import { SkeletonBlock } from "@/components/ui/SkeletonBlock";
import { useGetProduct, useGetProducts, type Product } from "@workspace/api-client-react";

const C = Colors.light;
const { width: SCREEN_W } = Dimensions.get("window");
const IMAGE_H = SCREEN_W * 0.85;

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(rating)) {
      stars.push(<Ionicons key={i} name="star" size={size} color={C.gold} />);
    } else if (i - 0.5 <= rating) {
      stars.push(<Ionicons key={i} name="star-half" size={size} color={C.gold} />);
    } else {
      stars.push(<Ionicons key={i} name="star-outline" size={size} color={C.silverBg} />);
    }
  }
  return <View style={{ flexDirection: "row", gap: 1 }}>{stars}</View>;
}

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 20 : insets.top;
  const bottomPad = Math.max(insets.bottom, Platform.OS === "web" ? 20 : 16);

  const { addItem, cartType, itemCount, clearCart } = useCart();
  const [added, setAdded] = useState(false);
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scale = useRef(new Animated.Value(1)).current;
  const scrollY = useRef(new Animated.Value(0)).current;

  const { data: product, isLoading, isError, refetch } = useGetProduct(id || "");

  const productType = product?.type || "mart";
  const { data: relatedData } = useGetProducts(
    { type: productType, category: product?.category },
    { query: { enabled: !!product } }
  );
  const relatedProducts = (relatedData?.products || [])
    .filter((p: Product) => p.id !== id)
    .sort((a: Product, b: Product) => {
      const popA = (a.reviewCount ?? 0) + (a.rating ?? 0) * 10;
      const popB = (b.reviewCount ?? 0) + (b.rating ?? 0) * 10;
      return popB - popA;
    })
    .slice(0, 4);

  useEffect(() => {
    return () => {
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    };
  }, []);

  const origPrice = Number(product?.originalPrice) || 0;
  const price = product?.price || 0;
  const discount = origPrice > 0 && origPrice > price
    ? Math.round(((origPrice - price) / origPrice) * 100)
    : 0;

  const images = product?.image ? [product.image] : [];

  const doAdd = useCallback(() => {
    if (!product) return;
    const type = productType === "food" ? "food" : productType === "pharmacy" ? "pharmacy" : "mart";
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: 1,
      image: product.image,
      type,
    });
    setAdded(true);
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.9, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4 }),
    ]).start();
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    addedTimerRef.current = setTimeout(() => {
      setAdded(false);
      addedTimerRef.current = null;
    }, 2000);
  }, [product, productType, addItem, scale]);

  const handleAdd = useCallback(() => {
    if (!product) return;
    const type = productType === "food" ? "food" : productType === "pharmacy" ? "pharmacy" : "mart";
    if (itemCount > 0 && cartType !== type && cartType !== "none") {
      setShowSwitchModal(true);
      return;
    }
    doAdd();
  }, [product, productType, itemCount, cartType, doAdd]);

  const headerOpacity = scrollY.interpolate({
    inputRange: [0, IMAGE_H - 100],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={[styles.floatingHeader, { paddingTop: topPad + 8 }]}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={22} color={C.text} />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <SkeletonBlock w={SCREEN_W} h={IMAGE_H} r={0} />
          <View style={{ padding: 16, gap: 12 }}>
            <SkeletonBlock w="70%" h={22} />
            <SkeletonBlock w="40%" h={16} />
            <SkeletonBlock w="50%" h={28} />
            <SkeletonBlock w="100%" h={80} r={12} />
            <SkeletonBlock w="100%" h={60} r={12} />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (isError || !product) {
    return (
      <View style={styles.container}>
        <View style={[styles.floatingHeader, { paddingTop: topPad + 8 }]}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={22} color={C.text} />
          </Pressable>
        </View>
        <View style={styles.errorCenter}>
          <View style={styles.errorIconWrap}>
            <Ionicons name="cloud-offline-outline" size={48} color={C.textMuted} />
          </View>
          <Text style={styles.errorTitle}>Could not load product</Text>
          <Text style={styles.errorSub}>Check your connection and try again</Text>
          <Pressable onPress={() => refetch()} style={styles.retryBtn}>
            <Ionicons name="refresh-outline" size={16} color={C.textInverse} />
            <Text style={styles.retryBtnTxt}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const serviceLabel = productType === "food" ? "Food" : productType === "pharmacy" ? "Pharmacy" : "Mart";
  const currentServiceLabel = cartType === "pharmacy" ? "Pharmacy" : cartType === "food" ? "Food" : cartType === "mart" ? "Mart" : "Another service";

  return (
    <View style={styles.container}>
      <CartSwitchModal
        visible={showSwitchModal}
        targetService={serviceLabel}
        currentService={currentServiceLabel}
        onCancel={() => setShowSwitchModal(false)}
        onConfirm={() => { setShowSwitchModal(false); clearCart(); doAdd(); }}
      />

      <Animated.View style={[styles.stickyHeader, { paddingTop: topPad + 8, opacity: headerOpacity }]}>
        <View style={styles.stickyHeaderInner}>
          <Pressable onPress={() => router.back()} style={styles.headerBtnSolid}>
            <Ionicons name="arrow-back" size={20} color={C.text} />
          </Pressable>
          <Text style={styles.stickyTitle} numberOfLines={1}>{product.name}</Text>
          <Pressable onPress={() => router.push("/cart")} style={styles.headerBtnSolid}>
            <Ionicons name="bag-outline" size={20} color={C.text} />
            {itemCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeTxt}>{itemCount}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </Animated.View>

      <View style={[styles.floatingHeader, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={22} color={C.textInverse} />
        </Pressable>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable onPress={() => router.push("/cart")} style={styles.headerBtn}>
            <Ionicons name="bag-outline" size={22} color={C.textInverse} />
            {itemCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeTxt}>{itemCount}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
      >
        <View style={styles.imageContainer}>
          {images.length > 0 ? (
            <FlatList
              data={images}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
                setActiveImageIndex(idx);
              }}
              renderItem={({ item }) => (
                <Image source={{ uri: item }} style={{ width: SCREEN_W, height: IMAGE_H }} resizeMode="cover" />
              )}
              keyExtractor={(_, i) => String(i)}
            />
          ) : (
            <LinearGradient colors={[C.background, C.border]} style={[styles.placeholderImage, { height: IMAGE_H }]}>
              <Ionicons
                name={productType === "food" ? "restaurant-outline" : productType === "pharmacy" ? "medical-outline" : "basket-outline"}
                size={64}
                color={C.textMuted}
              />
            </LinearGradient>
          )}

          {images.length > 1 && (
            <View style={styles.dotRow}>
              {images.map((_, i) => (
                <View key={i} style={[styles.dot, i === activeImageIndex && styles.dotActive]} />
              ))}
            </View>
          )}

          {discount > 0 && (
            <View style={styles.discountBadge}>
              <Text style={styles.discountTxt}>{discount}% OFF</Text>
            </View>
          )}
        </View>

        <View style={styles.contentContainer}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>{product.name}</Text>
              {product.unit && <Text style={styles.unit}>{product.unit}</Text>}
            </View>
            {product.inStock ? (
              <View style={styles.stockBadge}>
                <View style={styles.stockDot} />
                <Text style={styles.stockTxt}>In Stock</Text>
              </View>
            ) : (
              <View style={[styles.stockBadge, { backgroundColor: C.dangerSoft }]}>
                <Text style={[styles.stockTxt, { color: C.danger }]}>Out of Stock</Text>
              </View>
            )}
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.price}>Rs. {price.toLocaleString()}</Text>
            {origPrice > price && (
              <Text style={styles.origPrice}>Rs. {origPrice.toLocaleString()}</Text>
            )}
          </View>

          {(product.rating != null || product.reviewCount != null) && (
            <View style={styles.ratingSection}>
              <StarRating rating={product.rating || 0} />
              <Text style={styles.ratingNum}>{(product.rating || 0).toFixed(1)}</Text>
              {product.reviewCount != null && (
                <Text style={styles.reviewCount}>({product.reviewCount} reviews)</Text>
              )}
            </View>
          )}

          <View style={styles.divider} />

          {product.vendorName && (
            <View style={styles.vendorSection}>
              <View style={styles.vendorIcon}>
                <Ionicons name="storefront-outline" size={18} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.vendorLabel}>Sold by</Text>
                <Text style={styles.vendorName}>{product.vendorName}</Text>
              </View>
              {product.deliveryTime && (
                <View style={styles.deliveryBadge}>
                  <Ionicons name="time-outline" size={12} color={C.emerald} />
                  <Text style={styles.deliveryTime}>{product.deliveryTime}</Text>
                </View>
              )}
            </View>
          )}

          {product.description && (
            <>
              <View style={styles.divider} />
              <View style={styles.descSection}>
                <Text style={styles.sectionTitle}>Description</Text>
                <Text style={styles.descText}>{product.description}</Text>
              </View>
            </>
          )}

          <View style={styles.divider} />

          <View style={styles.specsSection}>
            <Text style={styles.sectionTitle}>Product Details</Text>
            <View style={styles.specGrid}>
              <View style={styles.specItem}>
                <Ionicons name="pricetag-outline" size={16} color={C.primary} />
                <View>
                  <Text style={styles.specLabel}>Category</Text>
                  <Text style={styles.specValue}>{product.category}</Text>
                </View>
              </View>
              <View style={styles.specItem}>
                <Ionicons name="cube-outline" size={16} color={C.primary} />
                <View>
                  <Text style={styles.specLabel}>Type</Text>
                  <Text style={styles.specValue}>{serviceLabel}</Text>
                </View>
              </View>
              {product.unit && (
                <View style={styles.specItem}>
                  <Ionicons name="scale-outline" size={16} color={C.primary} />
                  <View>
                    <Text style={styles.specLabel}>Unit</Text>
                    <Text style={styles.specValue}>{product.unit}</Text>
                  </View>
                </View>
              )}
              <View style={styles.specItem}>
                <Ionicons name={product.inStock ? "checkmark-circle-outline" : "close-circle-outline"} size={16} color={product.inStock ? C.emerald : C.danger} />
                <View>
                  <Text style={styles.specLabel}>Availability</Text>
                  <Text style={styles.specValue}>{product.inStock ? "Available" : "Unavailable"}</Text>
                </View>
              </View>
            </View>
          </View>

          {(product.rating != null) && (
            <>
              <View style={styles.divider} />
              <View style={styles.reviewsSection}>
                <Text style={styles.sectionTitle}>Ratings & Reviews</Text>
                <View style={styles.ratingOverview}>
                  <View style={styles.ratingBig}>
                    <Text style={styles.ratingBigNum}>{(product.rating || 0).toFixed(1)}</Text>
                    <StarRating rating={product.rating || 0} size={18} />
                    <Text style={styles.ratingBigSub}>
                      {product.reviewCount || 0} review{(product.reviewCount || 0) !== 1 ? "s" : ""}
                    </Text>
                  </View>
                  <View style={styles.ratingBars}>
                    {[5, 4, 3, 2, 1].map(star => {
                      const pct = star === 5 ? 60 : star === 4 ? 25 : star === 3 ? 10 : star === 2 ? 3 : 2;
                      return (
                        <View key={star} style={styles.ratingBarRow}>
                          <Text style={styles.ratingBarLabel}>{star}</Text>
                          <Ionicons name="star" size={10} color={C.gold} />
                          <View style={styles.ratingBarTrack}>
                            <View style={[styles.ratingBarFill, { width: `${pct}%` }]} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </View>
            </>
          )}

          {relatedProducts.length > 0 && (
            <>
              <View style={styles.divider} />
              <View style={styles.relatedSection}>
                <Text style={styles.sectionTitle}>You May Also Like</Text>
                <View style={styles.relatedGrid}>
                  {relatedProducts.map(rp => {
                    const rpOrig = Number(rp.originalPrice) || 0;
                    const rpDiscount = rpOrig > rp.price ? Math.round(((rpOrig - rp.price) / rpOrig) * 100) : 0;
                    return (
                      <Pressable
                        key={rp.id}
                        onPress={() => router.push({ pathname: "/product/[id]", params: { id: rp.id } })}
                        style={styles.relatedCard}
                      >
                        <View style={styles.relatedImg}>
                          {rp.image ? (
                            <Image source={{ uri: rp.image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                          ) : (
                            <Ionicons name="basket-outline" size={24} color={C.textMuted} />
                          )}
                          {rpDiscount > 0 && (
                            <View style={styles.relatedDiscBadge}>
                              <Text style={styles.relatedDiscTxt}>{rpDiscount}%</Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.relatedBody}>
                          <Text style={styles.relatedName} numberOfLines={2}>{rp.name}</Text>
                          <Text style={styles.relatedPrice}>Rs. {rp.price}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </>
          )}

          <View style={{ height: 100 + bottomPad }} />
        </View>
      </Animated.ScrollView>

      <View style={[styles.stickyFooter, { paddingBottom: bottomPad + 8 }]}>
        <View style={styles.footerPriceCol}>
          <Text style={styles.footerPriceLabel}>Total Price</Text>
          <Text style={styles.footerPrice}>Rs. {price.toLocaleString()}</Text>
        </View>
        <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
          <Pressable
            onPress={handleAdd}
            disabled={!product.inStock}
            style={[styles.addToCartBtn, added && styles.addToCartBtnDone, !product.inStock && styles.addToCartBtnDisabled]}
          >
            <Ionicons name={added ? "checkmark-circle" : "bag-add-outline"} size={20} color={C.textInverse} />
            <Text style={styles.addToCartTxt}>
              {!product.inStock ? "Out of Stock" : added ? "Added to Cart!" : "Add to Cart"}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },

  floatingHeader: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 8,
  },
  headerBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.overlayDark35,
    alignItems: "center", justifyContent: "center",
  },
  stickyHeader: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 20,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
    paddingBottom: 10,
  },
  stickyHeaderInner: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12,
  },
  headerBtnSolid: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: C.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  stickyTitle: { flex: 1, ...Typ.h3, fontSize: 16, color: C.text },
  cartBadge: {
    position: "absolute", top: -4, right: -4, backgroundColor: C.danger,
    borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4,
  },
  cartBadgeTxt: { ...Typ.tiny, color: C.textInverse },

  imageContainer: { position: "relative" },
  placeholderImage: { width: SCREEN_W, alignItems: "center", justifyContent: "center" },
  dotRow: { position: "absolute", bottom: 16, alignSelf: "center", flexDirection: "row", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.overlayLight50 },
  dotActive: { backgroundColor: C.surface, width: 20 },
  discountBadge: {
    position: "absolute", top: 16, left: 16, backgroundColor: C.danger,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
  },
  discountTxt: { ...Typ.buttonSmall, fontFamily: Font.bold, color: C.textInverse },

  contentContainer: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -24, paddingTop: 24, paddingHorizontal: 16 },

  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 8 },
  productName: { ...Typ.h2, color: C.text, lineHeight: 28 },
  unit: { ...Typ.body, fontSize: 13, color: C.textSecondary, marginTop: 4 },
  stockBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.successSoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  stockDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  stockTxt: { ...Typ.smallMedium, fontFamily: Font.semiBold, color: C.emerald },

  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 10, marginBottom: 12 },
  price: { ...Typ.h1, fontSize: 26, color: C.primary },
  origPrice: { ...Typ.body, fontSize: 16, color: C.textMuted, textDecorationLine: "line-through" },

  ratingSection: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  ratingNum: { ...Typ.body, fontFamily: Font.bold, color: C.amberDark },
  reviewCount: { ...Typ.body, fontSize: 13, color: C.textMuted },

  divider: { height: 1, backgroundColor: C.border, marginVertical: 16 },

  vendorSection: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  vendorIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" },
  vendorLabel: { ...Typ.caption, color: C.textMuted },
  vendorName: { ...Typ.button, color: C.text, marginTop: 1 },
  deliveryBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.successSoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  deliveryTime: { ...Typ.smallMedium, fontFamily: Font.semiBold, color: C.emerald },

  descSection: {},
  sectionTitle: { ...Typ.price, color: C.text, marginBottom: 12 },
  descText: { ...Typ.body, color: C.textSecondary, lineHeight: 22 },

  specsSection: {},
  specGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  specItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    width: "47%", backgroundColor: C.surfaceSecondary, borderRadius: 12,
    padding: 12,
  },
  specLabel: { ...Typ.small, color: C.textMuted },
  specValue: { ...Typ.buttonSmall, color: C.text, marginTop: 1 },

  reviewsSection: {},
  ratingOverview: { flexDirection: "row", gap: 20, alignItems: "center" },
  ratingBig: { alignItems: "center", gap: 6 },
  ratingBigNum: { ...Typ.h1, fontSize: 40, color: C.text },
  ratingBigSub: { ...Typ.caption, color: C.textMuted },
  ratingBars: { flex: 1, gap: 4 },
  ratingBarRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingBarLabel: { ...Typ.captionMedium, color: C.textSecondary, width: 12, textAlign: "right" },
  ratingBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: C.surfaceSecondary },
  ratingBarFill: { height: 6, borderRadius: 3, backgroundColor: C.gold },

  relatedSection: { marginBottom: 8 },
  relatedGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  relatedCard: {
    width: (SCREEN_W - 32 - 10) / 2, backgroundColor: C.surface, borderRadius: 16,
    overflow: "hidden", borderWidth: 1, borderColor: C.border,
  },
  relatedImg: { height: 100, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  relatedDiscBadge: { position: "absolute", top: 6, left: 6, backgroundColor: C.danger, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  relatedDiscTxt: { ...Typ.tiny, color: C.textInverse },
  relatedBody: { padding: 10 },
  relatedName: { ...Typ.captionMedium, color: C.text, marginBottom: 4, minHeight: 30 },
  relatedPrice: { ...Typ.body, fontFamily: Font.bold, color: C.primary },

  stickyFooter: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", gap: 16,
    backgroundColor: C.surface, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: C.border,
    shadowColor: C.text, shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 10,
  },
  footerPriceCol: {},
  footerPriceLabel: { ...Typ.small, color: C.textMuted },
  footerPrice: { ...Typ.title, color: C.text },
  addToCartBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.primary, borderRadius: 16, paddingVertical: 16,
    shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  addToCartBtnDone: { backgroundColor: C.success },
  addToCartBtnDisabled: { backgroundColor: C.textMuted, shadowOpacity: 0 },
  addToCartTxt: { ...Typ.h3, fontSize: 16, color: C.textInverse },

  errorCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorIconWrap: { width: 80, height: 80, borderRadius: 24, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  errorTitle: { ...Typ.h3, color: C.text },
  errorSub: { ...Typ.body, fontSize: 13, color: C.textMuted },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 4 },
  retryBtnTxt: { ...Typ.body, fontFamily: Font.bold, color: C.textInverse },
});
