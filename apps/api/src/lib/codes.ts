import { customAlphabet } from 'nanoid';

const digits = customAlphabet('0123456789');
const orderDigits = customAlphabet('0123456789', 5);

/** Human-facing order/booking codes, e.g. VC-20481, VC-R2048, AC-247892. */
export function orderCode(prefix = 'VC'): string {
  return `${prefix}-${orderDigits()}`;
}

/** 4-digit pickup verification code shown to driver/provider. */
export function pickupCode(): string {
  return digits(4);
}

/** 6-digit OTP. */
export function otpCode(): string {
  return digits(6);
}
