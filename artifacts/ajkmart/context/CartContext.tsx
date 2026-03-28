import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Alert } from "react-native";

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  type: "mart" | "food";
}

interface CartContextType {
  items: CartItem[];
  itemCount: number;
  total: number;
  cartType: "mart" | "food" | "mixed";
  addItem: (item: CartItem) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, qty: number) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    AsyncStorage.getItem("@ajkmart_cart").then(stored => {
      if (stored) setItems(JSON.parse(stored));
    });
  }, []);

  const save = (newItems: CartItem[]) => {
    setItems(newItems);
    AsyncStorage.setItem("@ajkmart_cart", JSON.stringify(newItems));
  };

  const addItem = (item: CartItem) => {
    const existing = items.find(i => i.productId === item.productId);
    if (existing) {
      save(items.map(i => i.productId === item.productId ? { ...i, quantity: i.quantity + 1 } : i));
      return;
    }

    const types = [...new Set(items.map(i => i.type))];
    const currentType = types.length === 1 ? types[0] : null;

    if (currentType && currentType !== item.type && items.length > 0) {
      const existingTypeName = currentType === "mart" ? "Mart" : "Food";
      const newTypeName = item.type === "mart" ? "Mart" : "Food";
      Alert.alert(
        "Mixed Cart",
        `Your cart has items from ${existingTypeName}. Adding ${newTypeName} items will clear your cart. Continue?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Yes, Clear & Add",
            style: "destructive",
            onPress: () => {
              save([{ ...item, type: item.type || "mart" }]);
            },
          },
        ]
      );
      return;
    }

    save([...items, { ...item, type: item.type || "mart" }]);
  };

  const removeItem = (productId: string) => save(items.filter(i => i.productId !== productId));

  const updateQuantity = (productId: string, qty: number) => {
    if (qty <= 0) return removeItem(productId);
    save(items.map(i => i.productId === productId ? { ...i, quantity: qty } : i));
  };

  const clearCart = () => save([]);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const types = [...new Set(items.map(i => i.type))];
  const cartType: "mart" | "food" | "mixed" =
    types.length === 0 ? "mart" :
    types.length === 1 ? (types[0] as "mart" | "food") :
    "mixed";

  return (
    <CartContext.Provider value={{ items, itemCount, total, cartType, addItem, removeItem, updateQuantity, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
