import Svg, { Circle, Rect } from 'react-native-svg';
import { colors } from '@/theme/tokens';

/**
 * Which top-down vehicle sprite the live map shows. Picked from whoever
 * accepted the request: a ride uses the driver's rideCategory, a delivery
 * uses the courier's vehicleType.
 */
export type VehicleKind = 'car' | 'suv' | 'moto' | 'bicycle';

export function vehicleKindForRide(rideCategory?: string | null): VehicleKind {
  switch (rideCategory) {
    case 'XL':
      return 'suv';
    case 'MOTO':
      return 'moto';
    default:
      return 'car'; // ECONOMY, COMFORT
  }
}

export function vehicleKindForCourier(vehicleType?: string | null): VehicleKind {
  switch (vehicleType) {
    case 'car':
      return 'car';
    case 'bicycle':
      return 'bicycle';
    default:
      return 'moto';
  }
}

export function vehicleLabel(kind: VehicleKind): string {
  switch (kind) {
    case 'suv':
      return 'SUV';
    case 'moto':
      return 'Motorbike';
    case 'bicycle':
      return 'Bicycle';
    default:
      return 'Car';
  }
}

const BODY = colors.navy;
const ROOF = '#24437C';
const GLASS = '#7FB2FF';
const TIRE = '#1F2937';
const OUTLINE = '#FFFFFF';

function CarSprite() {
  return (
    <>
      <Rect x={9} y={9} width={5} height={9} rx={2.5} fill={TIRE} />
      <Rect x={34} y={9} width={5} height={9} rx={2.5} fill={TIRE} />
      <Rect x={9} y={31} width={5} height={9} rx={2.5} fill={TIRE} />
      <Rect x={34} y={31} width={5} height={9} rx={2.5} fill={TIRE} />
      <Rect x={13} y={4} width={22} height={40} rx={9} fill={BODY} stroke={OUTLINE} strokeWidth={2.5} />
      <Rect x={16.5} y={13.5} width={15} height={6.5} rx={2.5} fill={GLASS} />
      <Rect x={16.5} y={21.5} width={15} height={10} rx={2} fill={ROOF} />
      <Rect x={16.5} y={33} width={15} height={5} rx={2} fill={GLASS} />
      <Rect x={16} y={6} width={4} height={2.5} rx={1.25} fill="#FFE9A8" />
      <Rect x={28} y={6} width={4} height={2.5} rx={1.25} fill="#FFE9A8" />
    </>
  );
}

function SuvSprite() {
  return (
    <>
      <Rect x={7.5} y={8} width={5.5} height={10} rx={2.75} fill={TIRE} />
      <Rect x={35} y={8} width={5.5} height={10} rx={2.75} fill={TIRE} />
      <Rect x={7.5} y={30} width={5.5} height={10} rx={2.75} fill={TIRE} />
      <Rect x={35} y={30} width={5.5} height={10} rx={2.75} fill={TIRE} />
      <Rect x={11.5} y={3} width={25} height={42} rx={7} fill={BODY} stroke={OUTLINE} strokeWidth={2.5} />
      <Rect x={15} y={12.5} width={18} height={6.5} rx={2.5} fill={GLASS} />
      <Rect x={15} y={21} width={18} height={13} rx={2} fill={ROOF} />
      <Rect x={16.5} y={22} width={2} height={11} rx={1} fill={GLASS} />
      <Rect x={29.5} y={22} width={2} height={11} rx={1} fill={GLASS} />
      <Rect x={15} y={36} width={18} height={5} rx={2} fill={GLASS} />
      <Rect x={14.5} y={5} width={4.5} height={2.5} rx={1.25} fill="#FFE9A8" />
      <Rect x={29} y={5} width={4.5} height={2.5} rx={1.25} fill="#FFE9A8" />
    </>
  );
}

function MotoSprite() {
  return (
    <>
      <Rect x={21.25} y={3} width={5.5} height={11} rx={2.75} fill={TIRE} stroke={OUTLINE} strokeWidth={1.5} />
      <Rect x={21.25} y={34} width={5.5} height={11} rx={2.75} fill={TIRE} stroke={OUTLINE} strokeWidth={1.5} />
      <Rect x={13.5} y={11.5} width={21} height={4} rx={2} fill={BODY} stroke={OUTLINE} strokeWidth={1.5} />
      <Rect x={18.5} y={13} width={11} height={22} rx={5.5} fill={BODY} stroke={OUTLINE} strokeWidth={2} />
      <Circle cx={24} cy={23} r={5.25} fill={colors.blue} stroke={OUTLINE} strokeWidth={2} />
    </>
  );
}

function BicycleSprite() {
  return (
    <>
      <Rect x={22.5} y={2} width={3} height={12} rx={1.5} fill={TIRE} stroke={OUTLINE} strokeWidth={1.25} />
      <Rect x={22.5} y={34} width={3} height={12} rx={1.5} fill={TIRE} stroke={OUTLINE} strokeWidth={1.25} />
      <Rect x={22.75} y={12} width={2.5} height={24} rx={1.25} fill={BODY} />
      <Rect x={15.5} y={10.5} width={17} height={3.5} rx={1.75} fill={BODY} stroke={OUTLINE} strokeWidth={1.25} />
      <Circle cx={24} cy={25} r={5.5} fill={colors.blue} stroke={OUTLINE} strokeWidth={2} />
    </>
  );
}

/** Top-down vehicle sprite, drawn pointing north so map rotation = bearing. */
export function VehicleIcon({ kind, size = 42 }: { kind: VehicleKind; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      {kind === 'suv' ? <SuvSprite /> : kind === 'moto' ? <MotoSprite /> : kind === 'bicycle' ? <BicycleSprite /> : <CarSprite />}
    </Svg>
  );
}
