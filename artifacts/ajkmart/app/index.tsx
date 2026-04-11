import { Redirect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { Image, View, StyleSheet } from "react-native";
import Colors, { shadows } from "@/constants/colors";

const C = Colors.light;

export default function RootIndex() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.logoWrap}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
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
  },
  logoWrap: {
    backgroundColor: "#fff",
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 20,
    ...shadows.xl,
  },
  logo: {
    width: 240,
    height: 80,
  },
});
