/**
 * Money helpers. All amounts are integer minor units (JMD cents).
 * Never use floating point arithmetic for money.
 */

export const CURRENCY = 'JMD';

/** 5,000.00 JMD -> 500000 minor units */
export function toMinor(major: number): number {
  return Math.round(major * 100);
}

/** 500000 -> "JMD 5,000.00" */
export function formatMinor(minor: number, currency = CURRENCY): string {
  const major = minor / 100;
  return `${currency} ${major.toLocaleString('en-JM', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Integer percentage of a minor amount, rounded to nearest cent. */
export function percentOfMinor(minor: number, percent: number): number {
  return Math.round((minor * percent) / 100);
}
