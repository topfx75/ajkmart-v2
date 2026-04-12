import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Alert } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { API_BASE, unwrapApiResponse } from "../utils/api";

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

export interface AckSuccessData {
  id: string;
  time: string;
  payMethod?: string;
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
  clearCartAndAdd: (item: CartItem) => void;
  clearCartOnAck: () => void;
  restoreCart: (snapshot: CartItem[]) => void;
  validateCart: () => Promise<CartValidationResult>;
  isValidating: boolean;
  pendingAck: boolean;
  setPendingAck: (v: boolean) => void;
  ackStuck: boolean;
  orderSuccess: AckSuccessData | null;
  clearOrderSuccess: () => void;
  setPendingOrderId: (id: string | null, data?: AckSuccessData | null) => void;
  startAckStuckTimer: (delayMs: number) => void;
  cancelAckStuckTimer: () => void;
  dismissAck: () => void;
  setPharmacyPendingOrderId: (id: string | null) => void;
}

const CartContext = createContext<CartContextType | null>(null);

const CartCountContext = createContext<number>(0);

export function useCartCount(): number {
  return useContext(CartCountContext);
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { token, socket } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [pendingAck, setPendingAck] = useState(false);
  const [ackStuck, setAckStuck] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<AckSuccessData | null>(null);
  const authTokenRef = useRef<string | null | undefined>(token);
  const pharmacyPendingOrderIdRef = useRef<string | null>(null);
  const pendingOrderIdRef = useRef<string | null>(null);
  const pendingOrderDataRef = useRef<AckSuccessData | null>(null);
  const ackStuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ackFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ackFallbackIvRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ackResolvedRef = useRef(false);

  useEffect(() => {
    authTokenRef.current = token;
  }, [token]);

  const save = (updater: CartItem[] | ((prev: CartItem[]) => CartItem[])) => {
    if (typeof updater === "function") {
      setItems(prev => {
        const newItems = updater(prev);
        AsyncStorage.setItem("@ajkmart_cart", JSON.stringify(newItems));
        return newItems;
      });
    } else {
      setItems(updater);
      AsyncStorage.setItem("@ajkmart_cart", JSON.stringify(updater));
    }
  };

  const resetAckState = useCallback(() => {
    if (ackStuckTimerRef.current) { clearTimeout(ackStuckTimerRef.current); ackStuckTimerRef.current = null; }
    if (ackFallbackTimerRef.current) { clearTimeout(ackFallbackTimerRef.current); ackFallbackTimerRef.current = null; }
    if (ackFallbackIvRef.current) { clearInterval(ackFallbackIvRef.current); ackFallbackIvRef.current = null; }
    pendingOrderIdRef.current = null;
    pendingOrderDataRef.current = null;
    setPendingAck(false);
    setAckStuck(false);
  }, []);

  const clearCartOnAck = useCallback(() => {
    setPendingAck(false);
    setItems([]);
    AsyncStorage.removeItem("@ajkmart_cart");
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handleAck = (payload: { orderId?: string; id?: string }) => {
      const ackId = payload?.orderId ?? payload?.id;
      const pending = pendingOrderIdRef.current;
      if (!pending) return;
      if (!ackId) return;
      if (ackId !== pending) return;
      if (ackStuckTimerRef.current) { clearTimeout(ackStuckTimerRef.current); ackStuckTimerRef.current = null; }
      const data = pendingOrderDataRef.current;
      pendingOrderIdRef.current = null;
      pendingOrderDataRef.current = null;
      setAckStuck(false);
      clearCartOnAck();
      if (data) setOrderSuccess(data);
    };
    socket.on("order:ack", handleAck);
    socket.on("order:confirmed", handleAck);
    return () => {
      socket.off("order:ack", handleAck);
      socket.off("order:confirmed", handleAck);
    };
  }, [socket, clearCartOnAck]);

  useEffect(() => {
    if (!socket) return;
    const handlePharmacyAck = (payload: { orderId?: string; id?: string }) => {
      const ackId = payload?.orderId ?? payload?.id;
      const pending = pharmacyPendingOrderIdRef.current;
      if (!pending) return;
      if (!ackId) return;
      if (ackId !== pending) return;
      pharmacyPendingOrderIdRef.current = null;
      setItems(current => {
        const remaining = current.filter(i => i.type !== "pharmacy");
        AsyncStorage.setItem("@ajkmart_cart", JSON.stringify(remaining));
        return remaining;
      });
    };
    socket.on("order:ack", handlePharmacyAck);
    socket.on("order:confirmed", handlePharmacyAck);
    return () => {
      socket.off("order:ack", handlePharmacyAck);
      socket.off("order:confirmed", handlePharmacyAck);
    };
  }, [socket]);

  useEffect(() => {
    AsyncStorage.getItem("@ajkmart_cart").then(stored => {
      if (!stored) { setHasLoaded(true); return; }
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setItems(parsed);
      } catch (parseErr) {
        if (__DEV__) console.warn("[Cart] Failed to parse stored cart — clearing:", parseErr instanceof Error ? parseErr.message : String(parseErr));
        AsyncStorage.removeItem("@ajkmart_cart");
      }
      setHasLoaded(true);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (ackStuckTimerRef.current) { clearTimeout(ackStuckTimerRef.current); ackStuckTimerRef.current = null; }
      if (ackFallbackTimerRef.current) { clearTimeout(ackFallbackTimerRef.current); ackFallbackTimerRef.current = null; }
      if (ackFallbackIvRef.current) { clearInterval(ackFallbackIvRef.current); ackFallbackIvRef.current = null; }
    };
  }, []);

  const prevTokenRef = useRef<string | null | undefined>(token);
  useEffect(() => {
    if (prevTokenRef.current && !token) {
      resetAckState();
      setItems([]);
      AsyncStorage.removeItem("@ajkmart_cart");
    }
    prevTokenRef.current = token;
  }, [token]);

  useEffect(() => {
    if (hasLoaded && items.length > 0) {
      validateCartItems(items);
    }
  }, [hasLoaded, token]);

  const validateCartItems = async (cartItems: CartItem[]): Promise<CartValidationResult> => {
    if (cartItems.length === 0) return { valid: true, cartChanged: false };
    setIsValidating(true);
    try {
      let storedToken = authTokenRef.current;
      if (!storedToken) {
        try {
          const SS = await import("expo-secure-store");
          storedToken = await SS.getItemAsync("ajkmart_token");
        } catch (ssErr) {
          if (__DEV__) console.warn("[CartContext] SecureStore read failed:", ssErr instanceof Error ? ssErr.message : String(ssErr));
        }
      }
      if (!storedToken) storedToken = await AsyncStorage.getItem("@ajkmart_token");
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
      const data = unwrapApiResponse(await res.json());
      if (!data.valid) {
        let cartChanged = false;
        if (Array.isArray(data.items)) {
          const oldMap = new Map(cartItems.map((item) => [item.productId, item]));
          const hasRealChange = data.items.length !== cartItems.length || data.items.some((newItem: any) => {
            const old = oldMap.get(newItem.productId);
            if (!old) return true;
            return old.price !== newItem.price
              || old.quantity !== newItem.quantity
              || old.available !== newItem.available;
          });
          if (hasRealChange) {
            save(data.items);
            cartChanged = true;
          }
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
              { text: "Review Cart", onPress: () => resolve() },
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

  const MAX_ITEM_QTY = 99;

  const addItem = useCallback((item: CartItem) => {
    save(prev => {
      const existing = prev.find(i => i.productId === item.productId);
      if (existing) {
        if (existing.quantity >= MAX_ITEM_QTY) {
          setTimeout(() => Alert.alert("Limit Reached", `Maximum quantity per item is ${MAX_ITEM_QTY}.`), 0);
          return prev;
        }
        return prev.map(i => i.productId === item.productId ? { ...i, quantity: Math.min(i.quantity + 1, MAX_ITEM_QTY) } : i);
      }

      const types = [...new Set(prev.map(i => i.type))];
      const currentType = types.length === 1 ? types[0] : null;

      if (prev.length > 0 && currentType === null) {
        setTimeout(() => Alert.alert("Mixed Cart", "Your cart has mixed items. Please clear your cart before adding new items.", [{ text: "OK" }]), 0);
        return prev;
      }

      if (currentType && currentType !== item.type && prev.length > 0) {
        const nameFor = (t: string) => t === "mart" ? "Mart" : t === "food" ? "Food" : "Pharmacy";
        setTimeout(() => Alert.alert(
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
        ), 0);
        return prev;
      }

      return [...prev, item];
    });
  }, []);

  const removeItem = useCallback((productId: string) => save(prev => prev.filter(i => i.productId !== productId)), []);

  const updateQuantity = useCallback((productId: string, qty: number) => {
    if (qty <= 0) { save(prev => prev.filter(i => i.productId !== productId)); return; }
    if (qty > MAX_ITEM_QTY) {
      Alert.alert("Limit Reached", `Maximum quantity per item is ${MAX_ITEM_QTY}.`);
      return;
    }
    save(prev => prev.map(i => i.productId === productId ? { ...i, quantity: qty } : i));
  }, []);

  const clearCart = useCallback(() => {
    resetAckState();
    save([]);
  }, [resetAckState]);

  const clearCartAndAdd = useCallback((item: CartItem) => {
    resetAckState();
    save([item]);
  }, [resetAckState]);

  const restoreCart = useCallback((snapshot: CartItem[]) => {
    resetAckState();
    save([...snapshot]);
  }, [resetAckState]);

  const dismissAck = useCallback(() => {
    resetAckState();
  }, [resetAckState]);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const types = [...new Set(items.map(i => i.type))];
  const cartType: "mart" | "food" | "pharmacy" | "mixed" | "none" =
    types.length === 0 ? "none" :
    types.length === 1 ? (types[0] as "mart" | "food" | "pharmacy") :
    "mixed";

  const setPharmacyPendingOrderId = useCallback((id: string | null) => {
    pharmacyPendingOrderIdRef.current = id;
  }, []);

  const setPendingOrderId = useCallback((id: string | null, data?: AckSuccessData | null) => {
    pendingOrderIdRef.current = id;
    pendingOrderDataRef.current = data ?? null;
    if (id) ackResolvedRef.current = false;
  }, []);

  const resolveOrderAck = useCallback((oid: string) => {
    if (ackResolvedRef.current) return;
    ackResolvedRef.current = true;
    const data = pendingOrderDataRef.current;
    if (ackStuckTimerRef.current) { clearTimeout(ackStuckTimerRef.current); ackStuckTimerRef.current = null; }
    if (ackFallbackTimerRef.current) { clearTimeout(ackFallbackTimerRef.current); ackFallbackTimerRef.current = null; }
    if (ackFallbackIvRef.current) { clearInterval(ackFallbackIvRef.current); ackFallbackIvRef.current = null; }
    pendingOrderIdRef.current = null;
    pendingOrderDataRef.current = null;
    setAckStuck(false);
    clearCartOnAck();
    if (data) setOrderSuccess(data);
  }, [clearCartOnAck]);

  const tryHttpFallback = useCallback(async (): Promise<boolean> => {
    const oid = pendingOrderIdRef.current;
    if (!oid) return false;
    try {
      const tkn = authTokenRef.current;
      const res = await fetch(`${API_BASE}/orders/${oid}`, {
        headers: tkn ? { Authorization: `Bearer ${tkn}` } : {},
      });
      if (res.ok) {
        const d = unwrapApiResponse(await res.json());
        const order = d.order || d;
        /* Only resolve if the order has moved past "pending" — prevents prematurely
           clearing the cart while the backend is still processing payment. */
        const ACKNOWLEDGED_STATUSES = [
          "confirmed", "preparing", "ready", "on_the_way", "picked_up",
          "out_for_delivery", "delivered", "completed",
        ];
        if (order && order.id && ACKNOWLEDGED_STATUSES.includes(order.status)) {
          resolveOrderAck(oid);
          return true;
        }
      }
    } catch (fallbackErr) {
      if (__DEV__) console.warn("[CartContext] HTTP fallback order check failed:", fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
    }
    return false;
  }, [resolveOrderAck]);

  const startAckStuckTimer = useCallback((delayMs: number) => {
    if (ackStuckTimerRef.current) clearTimeout(ackStuckTimerRef.current);
    if (ackFallbackTimerRef.current) clearTimeout(ackFallbackTimerRef.current);
    if (ackFallbackIvRef.current) clearInterval(ackFallbackIvRef.current);

    ackFallbackTimerRef.current = setTimeout(() => {
      let attempts = 0;
      ackFallbackIvRef.current = setInterval(async () => {
        attempts++;
        const resolved = await tryHttpFallback();
        if (resolved || attempts >= 6) {
          if (ackFallbackIvRef.current) { clearInterval(ackFallbackIvRef.current); ackFallbackIvRef.current = null; }
        }
      }, 5000);
      tryHttpFallback();
    }, 10000);

    ackStuckTimerRef.current = setTimeout(async () => {
      if (!pendingOrderIdRef.current) return;
      const resolved = await tryHttpFallback();
      if (!resolved && pendingOrderIdRef.current) setAckStuck(true);
    }, delayMs);
  }, [tryHttpFallback]);

  const cancelAckStuckTimer = useCallback(() => {
    if (ackStuckTimerRef.current) { clearTimeout(ackStuckTimerRef.current); ackStuckTimerRef.current = null; }
    if (ackFallbackTimerRef.current) { clearTimeout(ackFallbackTimerRef.current); ackFallbackTimerRef.current = null; }
    if (ackFallbackIvRef.current) { clearInterval(ackFallbackIvRef.current); ackFallbackIvRef.current = null; }
  }, []);

  const clearOrderSuccess = useCallback(() => setOrderSuccess(null), []);

  const ctxValue = useMemo(() => ({
    items, itemCount, total, cartType,
    addItem, removeItem, updateQuantity,
    clearCart, clearCartAndAdd, clearCartOnAck, restoreCart, validateCart, isValidating,
    pendingAck, setPendingAck,
    ackStuck,
    orderSuccess, clearOrderSuccess,
    setPendingOrderId, startAckStuckTimer, cancelAckStuckTimer,
    dismissAck,
    setPharmacyPendingOrderId,
  }), [
    items, itemCount, total, cartType,
    addItem, removeItem, updateQuantity,
    clearCart, clearCartAndAdd, clearCartOnAck, restoreCart, validateCart, isValidating,
    pendingAck, setPendingAck,
    ackStuck,
    orderSuccess, clearOrderSuccess,
    setPendingOrderId, startAckStuckTimer, cancelAckStuckTimer,
    dismissAck,
    setPharmacyPendingOrderId,
  ]);

  return (
    <CartCountContext.Provider value={itemCount}>
      <CartContext.Provider value={ctxValue}>
        {children}
      </CartContext.Provider>
    </CartCountContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
