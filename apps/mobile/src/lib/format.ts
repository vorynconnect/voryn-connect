/** Currency and formatting helpers. Amounts arrive as integer minor units. */

export function formatJmd(minor: number): string {
  const major = minor / 100;
  return `JMD ${major.toLocaleString('en-JM', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact style used on ride option rows: "JMD 850" (no decimals). */
export function formatJmdCompact(minor: number): string {
  const major = Math.round(minor / 100);
  return `JMD ${major.toLocaleString('en-JM')}`;
}

export function formatPoints(points: number): string {
  return `${points.toLocaleString('en-JM')} pts`;
}
