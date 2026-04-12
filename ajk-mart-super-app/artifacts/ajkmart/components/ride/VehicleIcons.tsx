import React from "react";
import Svg, { Path, Circle, Rect, G, Ellipse } from "react-native-svg";

type VehicleIconProps = {
  size?: number;
  color?: string;
};

export function BikeIcon({ size = 24, color = "#FCD34D" }: VehicleIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="5.5" cy="17.5" r="3" stroke={color} strokeWidth="1.8" />
      <Circle cx="18.5" cy="17.5" r="3" stroke={color} strokeWidth="1.8" />
      <Path d="M5.5 17.5L8.5 9.5H13L15 13.5L18.5 17.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M13 9.5L15 6.5H17.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10 13.5H15" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function CarIcon({ size = 24, color = "#FCD34D" }: VehicleIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 14L4.5 8.5C4.8 7.4 5.8 6.5 7 6.5H17C18.2 6.5 19.2 7.4 19.5 8.5L21 14" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Rect x="2" y="14" width="20" height="5" rx="2" stroke={color} strokeWidth="1.8" />
      <Circle cx="7" cy="19" r="1.5" fill={color} />
      <Circle cx="17" cy="19" r="1.5" fill={color} />
      <Path d="M7 14V12.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <Path d="M17 14V12.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <Path d="M5 11.5H19" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.4" />
    </Svg>
  );
}

export function RickshawIcon({ size = 24, color = "#FCD34D" }: VehicleIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 18V11C4 9.9 4.9 9 6 9H14L17 14H20C21.1 14 22 14.9 22 16V18" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="7" cy="18" r="2" stroke={color} strokeWidth="1.8" />
      <Circle cx="19" cy="18" r="2" stroke={color} strokeWidth="1.8" />
      <Path d="M9 18H17" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M6 9V6.5C6 5.9 6.4 5.5 7 5.5H8" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14 9L14 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function DabaIcon({ size = 24, color = "#FCD34D" }: VehicleIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="7" width="16" height="11" rx="2" stroke={color} strokeWidth="1.8" />
      <Path d="M18 10H20.5C21.3 10 22 10.7 22 11.5V16C22 17.1 21.1 18 20 18H18" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="6" cy="18" r="2" stroke={color} strokeWidth="1.8" />
      <Circle cx="16" cy="18" r="2" stroke={color} strokeWidth="1.8" />
      <Path d="M8 18H14" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M5 11H9" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
      <Path d="M5 14H9" stroke={color} strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
    </Svg>
  );
}

export function SchoolBusIcon({ size = 24, color = "#FCD34D" }: VehicleIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="1" y="7" width="22" height="11" rx="2" stroke={color} strokeWidth="1.8" />
      <Path d="M1 12H23" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.3" />
      <Circle cx="5.5" cy="18" r="2" stroke={color} strokeWidth="1.8" />
      <Circle cx="18.5" cy="18" r="2" stroke={color} strokeWidth="1.8" />
      <Path d="M7.5 18H16.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Rect x="4" y="8.5" width="4" height="3" rx="0.5" stroke={color} strokeWidth="1.2" opacity="0.6" />
      <Rect x="10" y="8.5" width="4" height="3" rx="0.5" stroke={color} strokeWidth="1.2" opacity="0.6" />
      <Rect x="16" y="8.5" width="4" height="3" rx="0.5" stroke={color} strokeWidth="1.2" opacity="0.6" />
      <Path d="M9 5H15V7H9V5Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const VEHICLE_ICON_MAP: Record<string, React.FC<VehicleIconProps>> = {
  bike: BikeIcon,
  car: CarIcon,
  rickshaw: RickshawIcon,
  daba: DabaIcon,
  school_shift: SchoolBusIcon,
};

export function VehicleIcon({ type, size = 24, color = "#FCD34D" }: VehicleIconProps & { type: string }) {
  const IconComponent = VEHICLE_ICON_MAP[type] ?? CarIcon;
  return <IconComponent size={size} color={color} />;
}
