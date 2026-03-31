import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useCart } from "@/context/CartContext";
import { usePlatformConfig } from "@/context/PlatformConfigContext";
import { getProducts } from "@workspace/api-client-react";
import type { GetProductsType, Product } from "@workspace/api-client-react";

const C = Colors.light;

type ServiceType = "mart" | "food" | "pharmacy";

interface SearchResult {
  id: string;
  name: string;
  price: number;
  image?: string;
  type: ServiceType;
  category?: string;
  originalPrice?: number;
}

export default function UniversalSearchScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { addItem } = useCart();
  const { config } = usePlatformConfig();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [added, setAdded] = useState<Record<string, boolean>>({});

  const firstEnabledService: ServiceType = config.features.mart
    ? "mart"
    : config.features.food
    ? "food"
    : "pharmacy";
  const [service, setService] = useState<ServiceType>(firstEnabledService);

  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 200);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(() => fetchResults(query, service), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, service]);

  const fetchResults = async (q: string, type: ServiceType) => {
    setLoading(true);
    setSearchError(false);
    try {
      const params: Parameters<typeof getProducts>[0] & { limit?: number } = { type: type as GetProductsType, search: q, limit: 30 };
      const data = await getProducts(params as Parameters<typeof getProducts>[0]);
      const items: SearchResult[] = (data?.products || []).map((p: Product) => ({ id: p.id, name: p.name, price: p.price, image: p.image, category: p.category, originalPrice: p.originalPrice, type }));
      setResults(items);
    } catch {
      setResults([]);
      setSearchError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = (item: SearchResult) => {
    if (item.type === "pharmacy") {
      router.push("/pharmacy");
      return;
    }
    addItem({ productId: item.id, name: item.name, price: item.price, quantity: 1, image: item.image, type: item.type as "mart" | "food" });
    setAdded(prev => ({ ...prev, [item.id]: true }));
    setTimeout(() => setAdded(prev => ({ ...prev, [item.id]: false })), 1500);
  };

  const martEnabled = config.features.mart;
  const foodEnabled = config.features.food;
  const pharmacyEnabled = config.features.pharmacy;

  const tabs: { id: ServiceType; label: string; icon: string }[] = [
    ...(martEnabled ? [{ id: "mart" as ServiceType, label: "Mart", icon: "basket-outline" }] : []),
    ...(foodEnabled ? [{ id: "food" as ServiceType, label: "Food", icon: "restaurant-outline" }] : []),
    ...(pharmacyEnabled ? [{ id: "pharmacy" as ServiceType, label: "Pharmacy", icon: "medical-outline" }] : []),
  ];

  const allServicesText = tabs.map(t => t.label).join(", ");

  return (
    <View style={[s.screen, { paddingTop: topPad }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <View style={s.inputWrap}>
          <Ionicons name="search-outline" size={18} color={C.textMuted} />
          <TextInput
            ref={inputRef}
            style={s.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search across all services…"
            placeholderTextColor={C.textMuted}
            returnKeyType="search"
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={18} color={C.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {tabs.length > 1 && (
        <View style={s.tabs}>
          {tabs.map(tab => (
            <Pressable
              key={tab.id}
              onPress={() => setService(tab.id)}
              style={[s.tab, service === tab.id && s.tabActive]}
            >
              <Ionicons name={tab.icon as any} size={14} color={service === tab.id ? "#fff" : C.primary} />
              <Text style={[s.tabTxt, service === tab.id && s.tabTxtActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {loading && (
        <View style={s.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      )}

      {!loading && query.trim() && results.length === 0 && searchError && (
        <View style={s.center}>
          <Ionicons name="wifi-outline" size={40} color="#EF4444" />
          <Text style={[s.emptyTxt, { color: "#EF4444" }]}>Search failed</Text>
          <Text style={s.emptySub}>Check your connection and try again</Text>
          <Pressable onPress={() => fetchResults(query, service)} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.primary, borderRadius: 10 }}>
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" }}>Retry</Text>
          </Pressable>
        </View>
      )}
      {!loading && query.trim() && results.length === 0 && !searchError && (
        <View style={s.center}>
          <Ionicons name="search-outline" size={40} color={C.textMuted} />
          <Text style={s.emptyTxt}>No results for "{query}"</Text>
          <Text style={s.emptySub}>Try a different keyword or switch service</Text>
        </View>
      )}

      {!loading && !query.trim() && (
        <View style={s.center}>
          <Ionicons name="search" size={40} color={C.border} />
          <Text style={s.emptyTxt}>Start typing to search</Text>
          <Text style={s.emptySub}>
            {tabs.length > 0 ? `Search across ${allServicesText}` : "Search all services"}
          </Text>
        </View>
      )}

      <FlatList
        data={results}
        keyExtractor={item => item.id}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="always"
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.cardInfo}>
              <View style={s.cardMeta}>
                <Text style={s.cardName} numberOfLines={2}>{item.name}</Text>
                {item.type === "pharmacy" && (
                  <View style={s.rxBadge}>
                    <Ionicons name="medical-outline" size={11} color="#7C3AED" />
                    <Text style={s.rxTxt}>Pharmacy</Text>
                  </View>
                )}
              </View>
              {item.originalPrice && item.originalPrice > item.price ? (
                <View style={s.priceRow}>
                  <Text style={s.cardPrice}>Rs. {item.price.toLocaleString()}</Text>
                  <Text style={s.cardOriginal}>Rs. {(item.originalPrice as number).toLocaleString()}</Text>
                </View>
              ) : (
                <Text style={s.cardPrice}>Rs. {item.price.toLocaleString()}</Text>
              )}
            </View>
            {item.type === "pharmacy" ? (
              <Pressable
                onPress={() => router.push("/pharmacy")}
                style={s.viewBtn}
              >
                <Ionicons name="arrow-forward" size={16} color={C.primary} />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => handleAdd(item)}
                style={[s.addBtn, added[item.id] && s.addBtnDone]}
              >
                <Ionicons name={added[item.id] ? "checkmark" : "add"} size={18} color="#fff" />
              </Pressable>
            )}
          </View>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen:    { flex: 1, backgroundColor: C.background },
  header:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 10, gap: 10, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:   { padding: 6 },
  inputWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.surfaceSecondary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  input:     { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: C.text },
  tabs:      { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  tab:       { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1.5, borderColor: C.primary },
  tabActive: { backgroundColor: C.primary, borderColor: C.primary },
  tabTxt:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.primary },
  tabTxtActive: { color: "#fff" },
  list:      { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  card:      { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  cardInfo:  { flex: 1 },
  cardName:  { fontSize: 15, fontFamily: "Inter_500Medium", color: C.text, marginBottom: 4 },
  priceRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  cardPrice: { fontSize: 14, fontFamily: "Inter_700Bold", color: C.primary },
  cardOriginal: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, textDecorationLine: "line-through" },
  addBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  addBtnDone:{ backgroundColor: "#10B981" },
  viewBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center" },
  cardMeta:  { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 },
  rxBadge:   { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#F3E8FF", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  rxTxt:     { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#7C3AED" },
  center:    { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 60, gap: 8 },
  emptyTxt:  { fontSize: 16, fontFamily: "Inter_600SemiBold", color: C.text, marginTop: 8 },
  emptySub:  { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted },
});
