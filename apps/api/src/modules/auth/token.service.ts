import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { UserRole } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';

export type AccessPayload = {
  sub: string;
  role: UserRole;
  sessionId: string;
};

export function signAccessToken(payload: AccessPayload, ttl?: string): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: (ttl ?? env.ACCESS_TOKEN_TTL) as jwt.SignOptions['expiresIn'],
    issuer: 'voryn-connect',
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'voryn-connect' });
    return decoded as AccessPayload;
  } catch {
    throw AppError.unauthorized('Your session has expired. Please log in again.', 'TOKEN_EXPIRED');
  }
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Issues a new refresh token for a session, persisting only its hash.
 * Returns the raw token (sent to the client once).
 */
export async function issueRefreshToken(userId: string, sessionId: string, rotatedFromId?: string) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const record = await prisma.refreshToken.create({
    data: { userId, sessionId, tokenHash: hashToken(raw), expiresAt, rotatedFromId },
  });
  return { raw, record };
}

/**
 * Rotates a refresh token: validates, revokes the old one, issues a new pair.
 * Reuse of an already-rotated token revokes the whole session (theft signal).
 */
export async function rotateRefreshToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true, session: true },
  });

  if (!existing) throw AppError.unauthorized('Invalid session. Please log in again.', 'INVALID_REFRESH');

  if (existing.revokedAt) {
    // Token reuse after rotation — revoke every token in the session.
    await prisma.refreshToken.updateMany({
      where: { sessionId: existing.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await prisma.deviceSession.update({
      where: { id: existing.sessionId },
      data: { revokedAt: new Date() },
    });
    throw AppError.unauthorized('Session revoked for your security. Please log in again.', 'REFRESH_REUSED');
  }

  if (existing.expiresAt < new Date() || existing.session.revokedAt) {
    throw AppError.unauthorized('Your session has expired. Please log in again.', 'REFRESH_EXPIRED');
  }

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });

  const { raw } = await issueRefreshToken(existing.userId, existing.sessionId, existing.id);
  const accessToken = signAccessToken({
    sub: existing.userId,
    role: existing.user.role,
    sessionId: existing.sessionId,
  });

  await prisma.deviceSession.update({
    where: { id: existing.sessionId },
    data: { lastActiveAt: new Date() },
  });

  return { accessToken, refreshToken: raw, user: existing.user };
}

export async function revokeSession(sessionId: string) {
  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.deviceSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } }),
  ]);
}
