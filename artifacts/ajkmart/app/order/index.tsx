import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

/**
 * Redirect shim: `/order?orderId=X&type=Y` → `/orders/X?type=Y`
 * Maintains backward compatibility for any old links or cached navigation state.
 */
export default function OrderRedirect() {
  const { orderId, type, action } = useLocalSearchParams<{ orderId?: string; type?: string; action?: string }>();

  useEffect(() => {
    if (orderId) {
      const params: Record<string, string> = {};
      if (type) params["type"] = type;
      if (action) params["action"] = action;
      router.replace({ pathname: "/orders/[id]", params: { id: orderId, ...params } });
    } else {
      router.replace("/(tabs)/orders");
    }
  }, [orderId, type, action]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.background }}>
      <ActivityIndicator color={C.primary} size="large" />
    </View>
  );
}
