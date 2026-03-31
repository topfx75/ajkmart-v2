import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { Alert } from "react-native";
import { useAuth } from "@/context/AuthContext";

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  type: "mart" | "food" | "pharmacy";
}

export interface CartValidationResult {
  valid: boolean;
  cartChanged: boolean;
}

interface CartContextType {
  items: CartItem[];
  itemCount: number;
  total: number;
  cartType: "mart" | "food" | "pharmacy" | "mixed" | "none";
  addItem: (item: CartItem) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, qty: number) => void;
  clearCart: () => void;
  restoreCart: (snapshot: CartItem[]) => void;
  validateCart: () => Promise<CartValidationResult>;
  isValidating: boolean;
}

const CartContext = createContext<CartContextType | null>(null);

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const authTokenRef = useRef<string | null | undefined>(token);

  useEffect(() => {
    authTokenRef.current = token;
  }, [token]);

  useEffect(() => {
    AsyncStorage.getItem("@ajkmart_cart").then(stored => {
      if (!stored) { setHasLoaded(true); return; }
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setItems(parsed);
      } catch {
        AsyncStorage.removeItem("@ajkmart_cart");
      }
      setHasLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (hasLoaded && items.length > 0) {
      validateCartItems(items);
    }
  }, [hasLoaded, token]);

  const save = (newItems: CartItem[]) => {
    setItems(newItems);
    AsyncStorage.setItem("@ajkmart_cart", JSON.stringify(newItems));
  };

  const validateCartItems = async (cartItems: CartItem[]): Promise<CartValidationResult> => {
    if (cartItems.length === 0) return { valid: true, cartChanged: false };
    setIsValidating(true);
    try {
      const storedToken = authTokenRef.current ?? await AsyncStorage.getItem("@ajkmart_token");
      const res = await fetch(`${API_BASE}/orders/validate-cart`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
        },
        body: JSON.stringify({ items: cartItems }),
      });
      if (!res.ok) {
        setIsValidating(false);
        return { valid: false, cartChanged: false };
      }
      const data = await res.json();
      if (!data.valid) {
        let cartChanged = false;
        if (Array.isArray(data.items)) {
          save(data.items);
          cartChanged = true;
        }
        const messages: string[] = [];
        if (data.removed?.length > 0) {
          messages.push(`Removed (unavailable): ${data.removed.join(", ")}`);
        }
        if (data.priceChanges?.length > 0) {
          const changes = data.priceChanges.map((c: any) => `${c.name}: Rs.${c.oldPrice} → Rs.${c.newPrice}`).join("\n");
          messages.push(`Prices updated:\n${changes}`);
        }
        if (messages.length > 0) {
          await new Promise<void>(resolve => {
            Alert.alert("Cart Updated", messages.join("\n\n") + "\n\nPlease review your cart before placing the order.", [
              { text: "Review Cart", onPress: resolve },
            ]);
          });
        }
        setIsValidating(false);
        return { valid: false, cartChanged };
      }
      setIsValidating(false);
      return { valid: true, cartChanged: false };
    } catch (err: any) {
      setIsValidating(false);
      Alert.alert(
        "Validation Error",
        "Could not validate your cart. Please check your connection and try again.",
        [{ text: "OK" }]
      );
      return { valid: false, cartChanged: false };
    }
  };

  const validateCart = useCallback(async (): Promise<CartValidationResult> => {
    return validateCartItems(items);
  }, [items]);

  const addItem = (item: CartItem) => {
    const existing = items.find(i => i.productId === item.productId);
    if (existing) {
      save(items.map(i => i.productId === item.productId ? { ...i, quantity: i.quantity + 1 } : i));
      return;
    }

    const types = [...new Set(items.map(i => i.type))];
    const currentType = types.length === 1 ? types[0] : null;

    if (items.length > 0 && currentType === null) {
      Alert.alert("Mixed Cart", "Your cart has mixed items. Please clear your cart before adding new items.", [{ text: "OK" }]);
      return;
    }

    if (currentType && currentType !== item.type && items.length > 0) {
      const nameFor = (t: string) => t === "mart" ? "Mart" : t === "food" ? "Food" : "Pharmacy";
      Alert.alert(
        "Mixed Cart",
        `Your cart has items from ${nameFor(currentType)}. Adding ${nameFor(item.type)} items will clear your cart. Continue?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Yes, Clear & Add",
            style: "destructive",
            onPress: () => { save([item]); },
          },
        ]
      );
      return;
    }

    save([...items, item]);
  };

  const removeItem = (productId: string) => save(items.filter(i => i.productId !== productId));

  const updateQuantity = (productId: string, qty: number) => {
    if (qty <= 0) return removeItem(productId);
    save(items.map(i => i.productId === productId ? { ...i, quantity: qty } : i));
  };

  const clearCart = () => save([]);
  const restoreCart = (snapshot: CartItem[]) => save([...snapshot]);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const types = [...new Set(items.map(i => i.type))];
  const cartType: "mart" | "food" | "pharmacy" | "mixed" | "none" =
    types.length === 0 ? "none" :
    types.length === 1 ? (types[0] as "mart" | "food" | "pharmacy") :
    "mixed";

  return (
    <CartContext.Provider value={{ items, itemCount, total, cartType, addItem, removeItem, updateQuantity, clearCart, restoreCart, validateCart, isValidating }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
