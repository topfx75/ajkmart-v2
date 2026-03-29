import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
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
import { withServiceGuard } from "@/components/ServiceGuard";
import { useGetProducts, useGetCategories } from "@workspace/api-client-react";

const C = Colors.light;

function FoodCard({ item }: { item: any }) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);

  const handleAdd = () => {
    addItem({ productId: item.id, name: item.name, price: item.price, quantity: 1, image: item.image, type: "food" });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <View style={styles.foodCard}>
      <View style={styles.foodImageBox}>
        <Ionicons name="restaurant-outline" size={36} color={C.textMuted} />
        {item.deliveryTime && (
          <View style={styles.timeBadge}>
            <Ionicons name="time-outline" size={10} color="#fff" />
            <Text style={styles.timeText}>{item.deliveryTime}</Text>
          </View>
        )}
      </View>
      <View style={styles.foodInfo}>
        <Text style={styles.foodName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.foodVendor} numberOfLines={1}>{item.vendorName || "Restaurant"}</Text>
        <View style={styles.ratingRow}>
          <Ionicons name="star" size={12} color="#F59E0B" />
          <Text style={styles.ratingText}>{item.rating || "4.5"}</Text>
          <Text style={styles.reviewCount}>({item.reviewCount || 50})</Text>
        </View>
        <View style={styles.foodFooter}>
          <Text style={styles.foodPrice}>Rs. {item.price}</Text>
          <Pressable onPress={handleAdd} style={[styles.addBtn, added && styles.addBtnAdded]}>
            <Ionicons name={added ? "checkmark" : "add"} size={18} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function FoodScreenInner() {
  const insets = useSafeAreaInsets();
  const { itemCount } = useCart();
  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState<string | undefined>(undefined);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: catData } = useGetCategories({ type: "food" });
  const { data, isLoading, isError, refetch } = useGetProducts({ type: "food", search: search || undefined, category: selectedCat });

  const categories = catData?.categories || [];
  const items = data?.products || [];

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={C.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Food Delivery</Text>
          <Pressable onPress={() => router.push("/cart")} style={styles.cartBtn}>
            <Ionicons name="bag-outline" size={22} color={C.food} />
            {itemCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeTxt}>{itemCount}</Text>
              </View>
            )}
          </Pressable>
        </View>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search food, restaurants..."
            placeholderTextColor={C.textMuted}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={18} color={C.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.catContent}>
          <Pressable onPress={() => setSelectedCat(undefined)} style={[styles.catChip, !selectedCat && styles.catChipActive]}>
            <Text style={[styles.catChipText, !selectedCat && styles.catChipTextActive]}>All</Text>
          </Pressable>
          {categories.map(c => (
            <Pressable key={c.id} onPress={() => setSelectedCat(selectedCat === c.id ? undefined : c.id)} style={[styles.catChip, selectedCat === c.id && styles.catChipActive]}>
              <Ionicons name={c.icon as any} size={14} color={selectedCat === c.id ? "#fff" : C.food} />
              <Text style={[styles.catChipText, selectedCat === c.id && styles.catChipTextActive]}>{c.name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={C.food} size="large" />
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, marginTop: 10 }}>Loading food items...</Text>
          </View>
        ) : isError ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={56} color={C.textMuted} />
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 17, color: C.text, marginTop: 12 }}>Could not load</Text>
            <Text style={{ fontFamily: "Inter_400Regular", fontSize: 13, color: C.textMuted, marginTop: 4 }}>Check your internet and retry</Text>
            <Pressable onPress={() => refetch()} style={{ backgroundColor: C.food, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 16 }}>
              <Text style={{ fontFamily: "Inter_700Bold", fontSize: 14, color: "#fff" }}>Retry</Text>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="restaurant-outline" size={56} color={C.border} />
            <Text style={styles.emptyTitle}>No food items yet</Text>
            <Text style={styles.emptyText}>Vendors are adding menu items soon</Text>
          </View>
        ) : (
          <View style={styles.foodList}>
            {items.map(i => <FoodCard key={i.id} item={i} />)}
          </View>
        )}
        <View style={{ height: Platform.OS === "web" ? 34 : 20 }} />
      </ScrollView>
    </View>
  );
}

export default withServiceGuard("food", FoodScreenInner);

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: C.surface, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  backBtn: { padding: 6, marginRight: 10 },
  headerTitle: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  cartBtn: { padding: 6 },
  cartBadge: { position: "absolute", top: -4, right: -4, backgroundColor: C.food, borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 3, borderWidth: 1.5, borderColor: "#fff" },
  cartBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 9, color: "#fff" },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.background, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  searchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text },
  catScroll: { marginTop: 12 },
  catContent: { paddingHorizontal: 16, gap: 8, flexDirection: "row" },
  catChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#FEF3C7", borderWidth: 1.5, borderColor: "#FDE68A" },
  catChipActive: { backgroundColor: C.food, borderColor: C.food },
  catChipText: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.food },
  catChipTextActive: { color: "#fff" },
  foodList: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  foodCard: { backgroundColor: C.surface, borderRadius: 16, flexDirection: "row", overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  foodImageBox: { width: 100, backgroundColor: "#FEF3C7", alignItems: "center", justifyContent: "center" },
  timeBadge: { position: "absolute", bottom: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  timeText: { fontFamily: "Inter_500Medium", fontSize: 9, color: "#fff" },
  foodInfo: { flex: 1, padding: 14 },
  foodName: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text, marginBottom: 3 },
  foodVendor: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, marginBottom: 6 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 10 },
  ratingText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.text },
  reviewCount: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textMuted },
  foodFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  foodPrice: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  addBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.food, alignItems: "center", justifyContent: "center" },
  addBtnAdded: { backgroundColor: C.success },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 10 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 17, color: C.text },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary },
});
