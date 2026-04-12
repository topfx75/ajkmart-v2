import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface LocationNode {
  id: number;
  name: string;
  level: "city" | "sub_city" | "area" | "mohalla";
  parentId: number | null;
  lat: string | null;
  lng: string | null;
  radiusKm: string | null;
  isActive: boolean;
  sortOrder: number;
}

const STORAGE_KEY = "ajkmart_selected_location";

interface LocationContextValue {
  selectedNode: LocationNode | null;
  ancestry: LocationNode[];
  displayName: string;
  setLocation: (node: LocationNode, ancestry: LocationNode[]) => void;
  clearLocation: () => void;
}

const defaultValue: LocationContextValue = {
  selectedNode: null,
  ancestry: [],
  displayName: "Select Location",
  setLocation: () => {},
  clearLocation: () => {},
};

const LocationContext = createContext<LocationContextValue>(defaultValue);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [selectedNode, setSelectedNode] = useState<LocationNode | null>(null);
  const [ancestry, setAncestry] = useState<LocationNode[]>([]);

  /* Load persisted selection on mount */
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed?.node) setSelectedNode(parsed.node);
        if (parsed?.ancestry) setAncestry(parsed.ancestry);
      })
      .catch(() => {});
  }, []);

  const setLocation = useCallback((node: LocationNode, anc: LocationNode[]) => {
    setSelectedNode(node);
    setAncestry(anc);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ node, ancestry: anc })).catch(() => {});
  }, []);

  const clearLocation = useCallback(() => {
    setSelectedNode(null);
    setAncestry([]);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, []);

  /* Build a human-friendly display string from ancestry */
  const displayName = selectedNode
    ? ancestry.length > 1
      ? `${selectedNode.name}, ${ancestry[0].name}`
      : selectedNode.name
    : "Select Location";

  return (
    <LocationContext.Provider value={{ selectedNode, ancestry, displayName, setLocation, clearLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  return useContext(LocationContext);
}

export function useLocationEnabled(): boolean {
  const { selectedNode } = useLocation();
  return selectedNode?.isActive !== false;
}
