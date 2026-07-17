import { env } from '../config/env';
import { AppError } from './errors';
import { logger } from './logger';

/**
 * SMS dispatch. Two providers:
 *  - 'dev'    — logs the message (OTP codes appear in server logs). Never
 *               allowed in production; env.ts refuses to boot.
 *  - 'twilio' — Twilio Programmable Messaging via REST (no SDK dependency).
 *               Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either
 *               TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM.
 *
 * Numbers must be E.164 (+1876...); Jamaican local numbers are normalized
 * with the +1876 country/area code.
 */

export function normalizeToE164(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  // Jamaican numbers: 7 local digits → +1876XXXXXXX; 10 digits with 876/658 → +1...
  if (/^\d{7}$/.test(digits)) return `+1876${digits}`;
  if (/^(876|658)\d{7}$/.test(digits)) return `+1${digits}`;
  if (/^1(876|658)\d{7}$/.test(digits)) return `+${digits}`;
  return `+${digits}`;
}

export async function sendSms(to: string, body: string): Promise<void> {
  if (env.SMS_PROVIDER === 'dev') {
    logger.info({ to, body }, '[DEV] SMS (not dispatched)');
    return;
  }

  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const params = new URLSearchParams({ To: normalizeToE164(to), Body: body });
  if (env.TWILIO_MESSAGING_SERVICE_SID) {
    params.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID);
  } else {
    params.set('From', env.TWILIO_FROM);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.error({ status: res.status, detail }, 'SMS dispatch failed');
      throw AppError.badGateway('We could not send the code right now. Please try again.', 'SMS_SEND_FAILED');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ err }, 'SMS dispatch error');
    throw AppError.badGateway('We could not send the code right now. Please try again.', 'SMS_SEND_FAILED');
  } finally {
    clearTimeout(timer);
  }
}
