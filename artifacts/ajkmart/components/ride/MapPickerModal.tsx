import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { Font } from "@/constants/typography";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = Colors.light;

export type MapPickerResult = {
  lat: number;
  lng: number;
  address: string;
};

type Props = {
  visible: boolean;
  label?: string;
  initialLat?: number;
  initialLng?: number;
  onConfirm: (result: MapPickerResult) => void;
  onClose: () => void;
};

export function MapPickerModal({ visible, label = "Location", onClose }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={C.text} />
          </Pressable>
          <Text style={styles.title}>Select {label}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.placeholder}>
          <Ionicons name="map-outline" size={48} color={C.textMuted} />
          <Text style={styles.placeholderText}>Map picker is only available on the web version of AJKMart.</Text>
          <Text style={styles.placeholderSub}>Please type the address manually in the search field.</Text>
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: "#fff",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontFamily: Font.bold,
    fontSize: 17,
    color: C.text,
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 12,
  },
  placeholderText: {
    fontFamily: Font.medium,
    fontSize: 16,
    color: C.text,
    textAlign: "center",
  },
  placeholderSub: {
    fontFamily: Font.regular,
    fontSize: 13,
    color: C.textMuted,
    textAlign: "center",
  },
  closeBtn: {
    marginTop: 16,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  closeBtnText: {
    fontFamily: Font.bold,
    fontSize: 15,
    color: "#fff",
  },
});
