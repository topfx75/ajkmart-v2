import { Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { View, StyleSheet, Text } from "react-native";
import { AjkLogo } from "@/components/ui/AjkLogo";

export default function RootIndex() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.container}>
        <AjkLogo variant="white" width={240} height={99} />
        <Text style={styles.tagline}>Your Super App</Text>
      </View>
    );
  }

  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0047B3",
    gap: 16,
  },
  tagline: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    letterSpacing: 1.5,
  },
});
