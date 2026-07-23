import argon2 from 'argon2';
import crypto from 'node:crypto';
import { OtpChannel, OtpPurpose, UserStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { otpCode } from '../../lib/codes';
import { sendSms } from '../../lib/sms';
import { env } from '../../config/env';
import { issueRefreshToken, revokeSession, signAccessToken } from './token.service';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
const MAX_OTP_ATTEMPTS = 5;

/**
 * A throwaway argon2 hash verified when a login names an account that does not
 * exist, so the response takes the same time as a wrong password on a real
 * account. Without it, the timing difference leaks whether an account exists.
 */
let dummyHashPromise: Promise<string> | null = null;
function timingEqualizerHash(): Promise<string> {
  return (dummyHashPromise ??= argon2.hash('voryn-login-timing-equalizer'));
}

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

async function sendOtp(identifier: string, channel: OtpChannel, purpose: OtpPurpose, userId?: string) {
  const code = otpCode();
  await prisma.otpCode.create({
    data: {
      userId,
      identifier,
      codeHash: hashOtp(code),
      purpose,
      channel,
      expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000),
    },
  });
  if (env.OTP_DEV_MODE) {
    // Dev mode: log the code instead of dispatching SMS/email.
    logger.info({ identifier, purpose, code }, '[DEV] OTP code');
  } else if (channel === OtpChannel.SMS) {
    await sendSms(identifier, `${code} is your Voryn Connect verification code. It expires in ${env.OTP_TTL_MINUTES} minutes.`);
    logger.info({ identifier, purpose }, 'OTP dispatched via SMS');
  } else {
    // Email OTP delivery is not wired yet; SMS is the primary channel.
    logger.warn({ identifier, purpose }, 'Email OTP requested but no email provider configured');
    throw AppError.serviceUnavailable('Email codes are not available yet. Use your phone number instead.', 'EMAIL_OTP_UNAVAILABLE');
  }
}

async function verifyOtpOrThrow(identifier: string, purpose: OtpPurpose, code: string) {
  const record = await prisma.otpCode.findFirst({
    where: { identifier, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) throw AppError.badRequest('This code has expired. Request a new one.', 'OTP_EXPIRED');
  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    throw AppError.tooMany('Too many incorrect attempts. Request a new code.', 'OTP_LOCKED');
  }
  if (record.codeHash !== hashOtp(code)) {
    await prisma.otpCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw AppError.badRequest('Incorrect code. Please try again.', 'OTP_INCORRECT');
  }
  await prisma.otpCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
  return record;
}

type DeviceInfo = { deviceName?: string; platform?: string; ip?: string };

async function createSessionTokens(userId: string, device: DeviceInfo) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const session = await prisma.deviceSession.create({
    data: {
      userId,
      deviceName: device.deviceName,
      devicePlatform: device.platform,
      ipAddress: device.ip,
    },
  });
  const accessToken = signAccessToken({ sub: userId, role: user.role, sessionId: session.id });
  const { raw: refreshToken } = await issueRefreshToken(userId, session.id);
  return { accessToken, refreshToken, sessionId: session.id };
}

export function sanitizeUser(user: {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string;
  role: string;
  status: string;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
}) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneVerified: Boolean(user.phoneVerifiedAt),
  };
}

export const authService = {
  async signUp(input: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
    acceptedTerms: boolean;
  }) {
    if (!input.acceptedTerms) {
      throw AppError.badRequest('You must accept the Terms & Privacy Policy.', 'TERMS_REQUIRED');
    }
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { phone: input.phone }] },
    });
    if (existing) {
      throw AppError.conflict('An account with this email or phone already exists.', 'ACCOUNT_EXISTS');
    }

    const passwordHash = await argon2.hash(input.password);
    const user = await prisma.user.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        status: UserStatus.PENDING_VERIFICATION,
        customerProfile: { create: {} },
        wallet: { create: {} },
        loyaltyAccount: { create: {} },
      },
    });

    await sendOtp(input.phone, OtpChannel.SMS, OtpPurpose.SIGNUP, user.id);
    return { user: sanitizeUser(user), otpSentTo: maskPhone(input.phone) };
  },

  async verifySignupOtp(input: { identifier: string; code: string }, device: DeviceInfo) {
    const otp = await verifyOtpOrThrow(input.identifier, OtpPurpose.SIGNUP, input.code);
    if (!otp.userId) throw AppError.badRequest('Invalid verification request.', 'OTP_INVALID');

    const user = await prisma.user.update({
      where: { id: otp.userId },
      data: {
        status: UserStatus.ACTIVE,
        phoneVerifiedAt: otp.channel === OtpChannel.SMS ? new Date() : undefined,
        emailVerifiedAt: otp.channel === OtpChannel.EMAIL ? new Date() : undefined,
      },
    });

    const tokens = await createSessionTokens(user.id, device);
    return { user: sanitizeUser(user), ...tokens };
  },

  async resendOtp(input: { identifier: string; purpose: OtpPurpose; channel: OtpChannel }) {
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: input.identifier }, { phone: input.identifier }] },
    });
    await sendOtp(input.identifier, input.channel, input.purpose, user?.id);
    return { otpSentTo: input.channel === OtpChannel.SMS ? maskPhone(input.identifier) : maskEmail(input.identifier) };
  },

  async login(input: { identifier: string; password: string }, device: DeviceInfo) {
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: input.identifier }, { phone: input.identifier }], deletedAt: null },
    });
    // Same error for unknown account and wrong password — no account enumeration.
    const invalidCreds = AppError.unauthorized('Incorrect email/phone or password.', 'INVALID_CREDENTIALS');
    if (!user) {
      // Burn the same time a real password check would, so response latency
      // cannot be used to tell whether the account exists.
      await argon2.verify(await timingEqualizerHash(), input.password).catch(() => undefined);
      throw invalidCreds;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw AppError.tooMany(
        'Account temporarily locked after too many failed attempts. Try again later.',
        'ACCOUNT_LOCKED',
      );
    }

    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok) {
      const failedLoginCount = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount,
          lockedUntil:
            failedLoginCount >= MAX_FAILED_LOGINS
              ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
              : null,
        },
      });
      throw invalidCreds;
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw AppError.forbidden('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    const tokens = await createSessionTokens(user.id, device);
    return { user: sanitizeUser(user), ...tokens };
  },

  async requestPasswordReset(input: { identifier: string }) {
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: input.identifier }, { phone: input.identifier }], deletedAt: null },
    });
    // Always respond success — no account enumeration. Only send if the account exists.
    if (user) {
      const channel = input.identifier.includes('@') ? OtpChannel.EMAIL : OtpChannel.SMS;
      await sendOtp(input.identifier, channel, OtpPurpose.PASSWORD_RESET, user.id);
    }
    return { message: 'If an account exists, a reset code has been sent.' };
  },

  async resetPassword(input: { identifier: string; code: string; newPassword: string }) {
    const otp = await verifyOtpOrThrow(input.identifier, OtpPurpose.PASSWORD_RESET, input.code);
    if (!otp.userId) throw AppError.badRequest('Invalid reset request.', 'RESET_INVALID');

    const passwordHash = await argon2.hash(input.newPassword);
    await prisma.user.update({
      where: { id: otp.userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });
    // Revoke all sessions — password change logs out every device.
    const sessions = await prisma.deviceSession.findMany({
      where: { userId: otp.userId, revokedAt: null },
    });
    await Promise.all(sessions.map((s) => revokeSession(s.id)));
    return { message: 'Password updated. Please log in with your new password.' };
  },

  async logout(sessionId: string) {
    await revokeSession(sessionId);
    return { message: 'Logged out.' };
  },
};

function maskPhone(phone: string): string {
  return phone.replace(/(\+?\d{1,4}\s?\(?\d{3}\)?)\s?\d{3}\s?(\d{4})/, '$1 *** $2');
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}
