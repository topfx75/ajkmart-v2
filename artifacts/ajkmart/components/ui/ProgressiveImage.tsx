import React from "react";
import { View, type StyleProp, type ViewStyle, type ImageStyle } from "react-native";
import { Image, type ImageSource } from "expo-image";
import Colors, { radii } from "@/constants/colors";

const C = Colors.light;

const SHIMMER_BLURHASH = "L6PZfSi_.AyE_3t7t7R**0o#DgR4";

interface ProgressiveImageProps {
  source: ImageSource | string | null | undefined;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  blurhash?: string;
  borderRadius?: number;
  contentFit?: "cover" | "contain" | "fill" | "none" | "scale-down";
  fadeDuration?: number;
}

export function ProgressiveImage({
  source,
  style,
  containerStyle,
  blurhash = SHIMMER_BLURHASH,
  borderRadius = radii.md,
  contentFit = "cover",
  fadeDuration = 0,
}: ProgressiveImageProps) {
  const resolvedSource =
    typeof source === "string" ? { uri: source } : (source ?? undefined);

  return (
    <View style={[{ borderRadius, overflow: "hidden", backgroundColor: C.slate }, containerStyle]}>
      <Image
        source={resolvedSource}
        style={[{ width: "100%", height: "100%" }, style]}
        contentFit={contentFit}
        placeholder={{ blurhash }}
        transition={fadeDuration}
        cachePolicy="memory-disk"
      />
    </View>
  );
}
