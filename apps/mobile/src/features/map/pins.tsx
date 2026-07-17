import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme/tokens';

/**
 * Voryn map pins — brand-blue teardrop markers used across every map.
 * Drawn tip-down: place them in a Marker with anchor {x: 0.5, y: 1} so the
 * tip sits exactly on the coordinate.
 */

const PIN_PATH = 'M24 2C12.4 2 3 11.4 3 23c0 13.8 21 35 21 35s21-21.2 21-35C45 11.4 35.6 2 24 2z';

function PinBase({ size, fill, children }: { size: number; fill: string; children?: React.ReactNode }) {
  return (
    <Svg width={size * 0.8} height={size} viewBox="0 0 48 60">
      <Path d={PIN_PATH} fill={fill} stroke="#FFFFFF" strokeWidth={3} />
      {children}
    </Svg>
  );
}

/** Blue Voryn pin with a white centre — pickup / current location. */
export function VorynPickupPin({ size = 44 }: { size?: number }) {
  return (
    <PinBase size={size} fill={colors.blue}>
      <Circle cx={24} cy={23} r={8.5} fill="#FFFFFF" />
      <Circle cx={24} cy={23} r={3.5} fill={colors.blue} />
    </PinBase>
  );
}

/** Navy pin with a white destination square. */
export function VorynDestinationPin({ size = 44 }: { size?: number }) {
  return (
    <PinBase size={size} fill={colors.navy}>
      <Rect x={17.5} y={16.5} width={13} height={13} rx={2} fill="#FFFFFF" />
      <Rect x={21.5} y={20.5} width={5} height={5} fill={colors.navy} />
    </PinBase>
  );
}
