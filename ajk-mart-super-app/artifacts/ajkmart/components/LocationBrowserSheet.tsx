import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Location from "expo-location";
import Colors, { spacing, radii, shadows } from "@/constants/colors";
import { T as Typ, Font } from "@/constants/typography";
import { type LocationNode } from "@/context/LocationContext";
import { API_BASE } from "@/utils/api";

const C = Colors.light;

export type { LocationNode };

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (node: LocationNode, ancestry: LocationNode[]) => void;
  /** Called during GPS auto-resolve when a node is pre-selected but the sheet
   *  should remain open for the user to optionally refine to a deeper level.
   *  If omitted, onSelect is used and the parent is responsible for keeping
   *  the sheet open if it chooses to. */
  onPreselect?: (node: LocationNode, ancestry: LocationNode[]) => void;
  currentNode?: LocationNode | null;
}

const LEVEL_LABELS: Record<string, string> = {
  city: "City",
  sub_city: "Sub-city",
  area: "Area",
  mohalla: "Mohalla / Main Point",
};

const LEVEL_NEXT_LABEL: Record<string, string> = {
  city: "Select Sub-city",
  sub_city: "Select Area",
  area: "Select Mohalla",
  mohalla: "",
};

type BreadcrumbEntry = { node: LocationNode; children: LocationNode[] };

export function LocationBrowserSheet({ visible, onClose, onSelect, onPreselect, currentNode }: Props) {
  const [step, setStep] = useState<"cities" | "children">("cities");
  const [cities, setCities] = useState<LocationNode[]>([]);
  const [children, setChildren] = useState<LocationNode[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoResolving, setAutoResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadCities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/area-locations/cities`);
      const json = await r.json();
      if (!mountedRef.current) return;
      setCities(json.data ?? []);
    } catch {
      if (mountedRef.current) setError("Could not load cities. Please check your connection.");
    }
    if (mountedRef.current) setLoading(false);
  }, []);

  const loadChildren = useCallback(async (parentId: number) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/area-locations/${parentId}/children`);
      const json = await r.json();
      if (!mountedRef.current) return;
      setChildren(json.data ?? []);
    } catch {
      if (mountedRef.current) setError("Could not load sub-locations. Please try again.");
    }
    if (mountedRef.current) setLoading(false);
  }, []);

  /* Auto-resolve on open via geolocation */
  const tryAutoResolve = useCallback(async () => {
    setAutoResolving(true);
    try {
      /* Check existing permission first before prompting to avoid repeated dialogs */
      const { status: existingStatus } = await Location.getForegroundPermissionsAsync();
      let status = existingStatus;
      if (existingStatus !== "granted") {
        const { status: requestedStatus } = await Location.requestForegroundPermissionsAsync();
        status = requestedStatus;
      }
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = pos.coords;

      const r = await fetch(`${API_BASE}/area-locations/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: latitude, lng: longitude }),
      });
      const json = await r.json();
      if (!mountedRef.current) return;

      if (json.data && json.ancestry?.length > 0) {
        const resolved: LocationNode = json.data;
        const ancestry: LocationNode[] = json.ancestry ?? [];

        /* Check whether resolved node has deeper active children.
           If not, auto-select it immediately; otherwise navigate to it
           so the user can refine to the deepest available level. */
        const childrenResp = await fetch(`${API_BASE}/area-locations/${resolved.id}/children`);
        const childrenJson = await childrenResp.json();
        if (!mountedRef.current) return;
        const deeperChildren: LocationNode[] = childrenJson.data ?? [];

        if (deeperChildren.length === 0) {
          /* No deeper children — auto-selection is final; call onSelect which may
             close the sheet. */
          onSelect(resolved, ancestry);
          return;
        }

        /* Has deeper children: use onPreselect (if provided) to persist selection
           without closing the sheet, then navigate to the resolved level so the user
           can optionally refine to a more precise mohalla/area.
           Falls back to onSelect if no onPreselect is provided. */
        (onPreselect ?? onSelect)(resolved, ancestry);

        const crumb: BreadcrumbEntry[] = ancestry.map(n => ({ node: n, children: [] }));
        setChildren(deeperChildren);
        setBreadcrumb(crumb);
        setStep("children");
      }
    } catch {
      /* Silently ignore auto-resolve failures */
    } finally {
      if (mountedRef.current) setAutoResolving(false);
    }
  }, [loadCities, loadChildren, onSelect, onPreselect]);

  useEffect(() => {
    if (!visible) return;
    setStep("cities");
    setBreadcrumb([]);
    setChildren([]);
    setError(null);
    loadCities().then(() => {
      if (mountedRef.current) tryAutoResolve();
    });
  }, [visible]);

  const handleSelectCity = async (city: LocationNode) => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/area-locations/${city.id}/children`);
      const json = await r.json();
      if (!mountedRef.current) return;
      const kids: LocationNode[] = json.data ?? [];
      if (kids.length === 0) {
        /* No active children — city is the deepest available level; select it. */
        onSelect(city, [city]);
      } else {
        setChildren(kids);
        setBreadcrumb([{ node: city, children: [] }]);
        setStep("children");
      }
    } catch {
      if (mountedRef.current) setError("Could not load sub-locations. Please try again.");
    }
    if (mountedRef.current) setLoading(false);
  };

  const handleSelectChild = async (node: LocationNode) => {
    /* mohalla is always a final selection */
    if (node.level === "mohalla") {
      const ancestry = breadcrumb.map(b => b.node);
      ancestry.push(node);
      onSelect(node, ancestry);
      return;
    }

    /* For non-mohalla nodes: attempt to load children first.
       If there are no active children, this is effectively the deepest
       available node — allow the user to select it directly. */
    const newBreadcrumb = [...breadcrumb, { node, children: [] }];
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/area-locations/${node.id}/children`);
      const json = await r.json();
      if (!mountedRef.current) return;
      const kids: LocationNode[] = json.data ?? [];
      if (kids.length === 0) {
        /* No deeper children → select this node as final */
        const ancestry = newBreadcrumb.map(b => b.node);
        onSelect(node, ancestry);
      } else {
        setChildren(kids);
        setBreadcrumb(newBreadcrumb);
      }
    } catch {
      if (mountedRef.current) setError("Could not load sub-locations. Please try again.");
    }
    if (mountedRef.current) setLoading(false);
  };

  const handleBreadcrumbBack = async (index: number) => {
    if (index < 0) {
      setStep("cities");
      setBreadcrumb([]);
      return;
    }
    const sliced = breadcrumb.slice(0, index + 1);
    const last = sliced[sliced.length - 1];
    setBreadcrumb(sliced);
    await loadChildren(last.node.id);
  };

  const currentLevelLabel = breadcrumb.length > 0
    ? LEVEL_NEXT_LABEL[breadcrumb[breadcrumb.length - 1].node.level] ?? "Select"
    : "Select City";

  const items = step === "cities" ? cities : children;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Choose Location</Text>
            <Text style={s.headerSub}>Select your delivery area</Text>
          </View>
          <TouchableOpacity activeOpacity={0.7} onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={C.text} />
          </TouchableOpacity>
        </View>

        {/* Auto-resolve bar */}
        {autoResolving && (
          <View style={s.autoResolveBar}>
            <ActivityIndicator size="small" color={C.primary} />
            <Text style={s.autoResolveTxt}>Detecting your location...</Text>
          </View>
        )}

        {/* Breadcrumb */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.breadcrumbScroll} contentContainerStyle={s.breadcrumbContent}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => handleBreadcrumbBack(-1)}
            style={[s.breadcrumbItem, step === "cities" && s.breadcrumbActive]}
            accessibilityRole="button"
          >
            <Ionicons name="location-outline" size={13} color={step === "cities" ? C.primary : C.textMuted} />
            <Text style={[s.breadcrumbTxt, step === "cities" && s.breadcrumbTxtActive]}>Cities</Text>
          </TouchableOpacity>
          {breadcrumb.map((entry, i) => (
            <React.Fragment key={entry.node.id}>
              <Ionicons name="chevron-forward" size={11} color={C.textMuted} style={{ marginHorizontal: 2 }} />
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => handleBreadcrumbBack(i)}
                style={[s.breadcrumbItem, i === breadcrumb.length - 1 && step === "children" && s.breadcrumbActive]}
                accessibilityRole="button"
              >
                <Text style={[s.breadcrumbTxt, i === breadcrumb.length - 1 && step === "children" && s.breadcrumbTxtActive]} numberOfLines={1}>
                  {entry.node.name}
                </Text>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </ScrollView>

        {/* Level heading */}
        <View style={s.levelHead}>
          <Text style={s.levelLabel}>{currentLevelLabel}</Text>
          {currentNode && (
            <View style={s.currentBadge}>
              <Ionicons name="checkmark-circle" size={12} color={C.success} />
              <Text style={s.currentBadgeTxt} numberOfLines={1}>{currentNode.name}</Text>
            </View>
          )}
        </View>

        {/* Content */}
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={C.primary} size="large" />
          </View>
        ) : error ? (
          <View style={s.center}>
            <Ionicons name="cloud-offline-outline" size={44} color={C.textMuted} />
            <Text style={s.errorTxt}>{error}</Text>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => step === "cities" ? loadCities() : loadChildren(breadcrumb[breadcrumb.length - 1].node.id)}
              style={s.retryBtn}
            >
              <Text style={s.retryTxt}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={s.center}>
            <Ionicons name="location-outline" size={44} color={C.textMuted} />
            <Text style={s.emptyTxt}>No locations available at this level</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
            {/* Cities shown as cards */}
            {step === "cities" ? (
              <View style={s.citiesGrid}>
                {items.map(node => (
                  <TouchableOpacity
                    key={node.id}
                    activeOpacity={0.7}
                    onPress={() => handleSelectCity(node)}
                    style={[s.cityCard, currentNode?.level === "city" && currentNode.id === node.id && s.cityCardActive]}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${node.name}`}
                  >
                    <View style={s.cityIcon}>
                      <Ionicons name="business-outline" size={22} color={C.primary} />
                    </View>
                    <Text style={s.cityName} numberOfLines={2}>{node.name}</Text>
                    <Ionicons name="chevron-forward" size={14} color={C.textMuted} style={{ marginTop: 4 }} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={s.list}>
                {items.map(node => {
                  const isFinal = node.level === "mohalla";
                  const isSelected = currentNode?.id === node.id;
                  return (
                    <TouchableOpacity
                      key={node.id}
                      activeOpacity={0.7}
                      onPress={() => handleSelectChild(node)}
                      style={[s.listItem, isSelected && s.listItemActive]}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${node.name}`}
                    >
                      <View style={[s.listIcon, isSelected && s.listIconActive]}>
                        <Ionicons
                          name={isFinal ? "location" : "navigate-circle-outline"}
                          size={16}
                          color={isSelected ? C.textInverse : C.primary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.listItemName, isSelected && s.listItemNameActive]} numberOfLines={1}>{node.name}</Text>
                        <Text style={s.listItemLevel}>{LEVEL_LABELS[node.level]}</Text>
                      </View>
                      {isSelected ? (
                        <Ionicons name="checkmark-circle" size={18} color={C.success} />
                      ) : (
                        <Ionicons name={isFinal ? "add-circle-outline" : "chevron-forward"} size={16} color={C.textMuted} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <View style={{ height: 32 }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: C.borderLight,
  },
  headerTitle: { ...Typ.h3, color: C.text },
  headerSub: { ...Typ.caption, color: C.textMuted, marginTop: 1 },
  closeBtn: {
    width: 34, height: 34, borderRadius: radii.md,
    backgroundColor: C.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  autoResolveBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.primarySoft, paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  autoResolveTxt: { ...Typ.captionMedium, color: C.primary },
  breadcrumbScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: C.borderLight },
  breadcrumbContent: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: 10 },
  breadcrumbItem: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radii.full, borderWidth: 1, borderColor: "transparent",
  },
  breadcrumbActive: { backgroundColor: C.primarySoft, borderColor: C.blueLightBorder },
  breadcrumbTxt: { ...Typ.captionMedium, color: C.textMuted },
  breadcrumbTxtActive: { color: C.primary },
  levelHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: 10,
  },
  levelLabel: { ...Typ.subtitle, color: C.text },
  currentBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.successSoft, borderRadius: radii.full,
    paddingHorizontal: spacing.md, paddingVertical: 4, maxWidth: 160,
  },
  currentBadgeTxt: { ...Typ.smallMedium, color: C.success, flexShrink: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: spacing.xxxl },
  errorTxt: { ...Typ.body, color: C.danger, textAlign: "center" },
  emptyTxt: { ...Typ.body, color: C.textMuted, textAlign: "center" },
  retryBtn: {
    backgroundColor: C.primary, borderRadius: radii.lg,
    paddingHorizontal: spacing.xl, paddingVertical: 12,
    ...shadows.sm,
  },
  retryTxt: { ...Typ.buttonSmall, color: C.textInverse },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  citiesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  cityCard: {
    width: "47%",
    backgroundColor: C.surface,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: C.borderLight,
    padding: spacing.lg,
    alignItems: "center",
    gap: 6,
    ...shadows.sm,
  },
  cityCardActive: { borderColor: C.primary, backgroundColor: C.primarySoft },
  cityIcon: {
    width: 44, height: 44, borderRadius: radii.xl,
    backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center",
  },
  cityName: { ...Typ.bodySemiBold, color: C.text, textAlign: "center" },
  list: { gap: 6 },
  listItem: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: C.surface, borderRadius: radii.lg,
    borderWidth: 1, borderColor: C.borderLight,
    paddingHorizontal: spacing.lg, paddingVertical: 13,
    ...shadows.sm,
  },
  listItemActive: { borderColor: C.primary, backgroundColor: C.primarySoft },
  listIcon: {
    width: 34, height: 34, borderRadius: radii.md,
    backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center",
  },
  listIconActive: { backgroundColor: C.primary },
  listItemName: { ...Typ.bodySemiBold, color: C.text },
  listItemNameActive: { color: C.primary },
  listItemLevel: { ...Typ.small, color: C.textMuted, marginTop: 1 },
});
