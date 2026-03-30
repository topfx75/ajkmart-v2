export type ServiceKey = "mart" | "food" | "rides" | "pharmacy" | "parcel";

export const SERVICE_KEYS: ServiceKey[] = ["mart", "food", "rides", "pharmacy", "parcel"];

export interface ServiceMetadata {
  key: ServiceKey;
  featureFlag: string;
  label: string;
  description: string;
  adminIcon: string;
  color: string;
  colorLight: string;
}

export const SERVICE_METADATA: Record<ServiceKey, ServiceMetadata> = {
  mart: {
    key: "mart",
    featureFlag: "feature_mart",
    label: "Grocery Mart",
    description: "Grocery & essentials marketplace with 500+ products",
    adminIcon: "🛒",
    color: "#00C48C",
    colorLight: "#E5F9F2",
  },
  food: {
    key: "food",
    featureFlag: "feature_food",
    label: "Food Delivery",
    description: "Restaurant food ordering & delivery service",
    adminIcon: "🍔",
    color: "#FF9500",
    colorLight: "#FFF4E5",
  },
  rides: {
    key: "rides",
    featureFlag: "feature_rides",
    label: "Rides",
    description: "Bike & car ride booking with live tracking",
    adminIcon: "🚗",
    color: "#00C48C",
    colorLight: "#E5F9F2",
  },
  pharmacy: {
    key: "pharmacy",
    featureFlag: "feature_pharmacy",
    label: "Pharmacy",
    description: "On-demand medicine delivery with prescriptions",
    adminIcon: "💊",
    color: "#AF52DE",
    colorLight: "#F5E6FF",
  },
  parcel: {
    key: "parcel",
    featureFlag: "feature_parcel",
    label: "Parcel Delivery",
    description: "Same-day parcel & package delivery across AJK",
    adminIcon: "📦",
    color: "#FF6B35",
    colorLight: "#FFF0EB",
  },
};

export const ADMIN_SERVICE_LIST = SERVICE_KEYS.map((k) => ({
  key: k,
  label: SERVICE_METADATA[k].label,
  description: SERVICE_METADATA[k].description,
  icon: SERVICE_METADATA[k].adminIcon,
  setting: SERVICE_METADATA[k].featureFlag,
  color: SERVICE_METADATA[k].color,
  colorLight: SERVICE_METADATA[k].colorLight,
}));
