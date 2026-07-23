import { describe, expect, it } from 'vitest';
import {
  additionalPickupFeeMinor,
  cancellationFeeMinor,
  computeDeliveryFee,
  distanceDeliveryFeeMinor,
  roundUpToMinor,
  waitingFeeMinor,
} from './pricing';

/** JMD → minor units. */
const jmd = (n: number) => n * 100;

describe('distanceDeliveryFeeMinor', () => {
  it('matches every row of the published pricing table', () => {
    const table: Array<[number, number]> = [
      [1, 500],
      [2, 500],
      [3, 500],
      [4, 600],
      [5, 700],
      [6, 800],
      [8, 1000],
      [10, 1200],
      [12, 1500],
      [15, 1850],
      [20, 2500],
      [25, 3150],
      [30, 3800],
    ];
    for (const [km, fee] of table) {
      expect(distanceDeliveryFeeMinor(km)).toBe(jmd(fee));
    }
  });

  it('prices the spec §5 worked example (7.4 km → JMD 950)', () => {
    // 500 base + 4.4 km × 100 = 940, rounded up to the nearest 50 = 950.
    expect(distanceDeliveryFeeMinor(7.4)).toBe(jmd(950));
  });

  it('never prices below the JMD 500 minimum', () => {
    expect(distanceDeliveryFeeMinor(0)).toBe(jmd(500));
    expect(distanceDeliveryFeeMinor(0.3)).toBe(jmd(500));
  });
});

describe('roundUpToMinor', () => {
  it('rounds up to the nearest step', () => {
    expect(roundUpToMinor(94_000, 5_000)).toBe(95_000);
    expect(roundUpToMinor(146_000, 5_000)).toBe(150_000);
    expect(roundUpToMinor(50_000, 5_000)).toBe(50_000);
  });
});

describe('computeDeliveryFee stack', () => {
  it('applies vehicle multipliers per the spec §7 (10 km)', () => {
    const moto = computeDeliveryFee({ distanceKm: 10 });
    expect(moto.finalDeliveryFeeMinor).toBe(jmd(1200));

    const car = computeDeliveryFee({ distanceKm: 10, vehicle: 'CAR' });
    // 1,200 × 1.20 = 1,440, rounded up to 1,450.
    expect(car.finalDeliveryFeeMinor).toBe(jmd(1450));

    const van = computeDeliveryFee({ distanceKm: 10, vehicle: 'VAN' });
    // 1,200 × 1.60 = 1,920, rounded up to 1,950.
    expect(van.finalDeliveryFeeMinor).toBe(jmd(1950));
  });

  it('adds flat package and additional-pickup fees', () => {
    const medium = computeDeliveryFee({ distanceKm: 5, packageClass: 'MEDIUM' });
    expect(medium.finalDeliveryFeeMinor).toBe(jmd(700) + jmd(100));

    const twoMerchants = computeDeliveryFee({ distanceKm: 5, merchantCount: 2 });
    expect(twoMerchants.additionalPickupFeeMinor).toBe(jmd(250));
    expect(twoMerchants.finalDeliveryFeeMinor).toBe(jmd(700) + jmd(250));
  });

  it('applies the peak multiplier per the spec §11 and caps it at 1.30×', () => {
    // Distance chosen so the base fee is JMD 1,000 (8 km).
    const high = computeDeliveryFee({ distanceKm: 8, demandLevel: 'HIGH' });
    expect(high.finalDeliveryFeeMinor).toBe(jmd(1200)); // 1,000 × 1.20

    const overCap = computeDeliveryFee({ distanceKm: 8, demandMultiplierBps: 20_000 });
    // Clamped to 1.30×: 1,000 × 1.30 = 1,300.
    expect(overCap.demandMultiplierBps).toBe(13_000);
    expect(overCap.finalDeliveryFeeMinor).toBe(jmd(1300));
  });

  it('adds the waiting fee last, without multiplying it', () => {
    const withWait = computeDeliveryFee({ distanceKm: 5, waitingMinutes: 18 });
    expect(withWait.waitingFeeMinor).toBe(jmd(160));
    expect(withWait.finalDeliveryFeeMinor).toBe(jmd(700) + jmd(160));
  });
});

describe('waitingFeeMinor', () => {
  it('is free for the first 10 minutes, then JMD 20/min, capped at JMD 400', () => {
    expect(waitingFeeMinor(10)).toBe(0);
    expect(waitingFeeMinor(18)).toBe(jmd(160)); // 8 chargeable minutes
    expect(waitingFeeMinor(200)).toBe(jmd(400)); // capped
  });
});

describe('additionalPickupFeeMinor', () => {
  it('charges JMD 250 per merchant beyond the first', () => {
    expect(additionalPickupFeeMinor(1)).toBe(0);
    expect(additionalPickupFeeMinor(2)).toBe(jmd(250));
    expect(additionalPickupFeeMinor(3)).toBe(jmd(500));
  });
});

describe('cancellationFeeMinor', () => {
  it('follows the cancellation table', () => {
    expect(cancellationFeeMinor('BEFORE_COURIER', jmd(900))).toBe(0);
    expect(cancellationFeeMinor('COURIER_EN_ROUTE', jmd(900))).toBe(jmd(150));
    expect(cancellationFeeMinor('COURIER_AT_PICKUP', jmd(900))).toBe(jmd(250));
    expect(cancellationFeeMinor('COLLECTED', jmd(900))).toBe(jmd(900));
  });
});
