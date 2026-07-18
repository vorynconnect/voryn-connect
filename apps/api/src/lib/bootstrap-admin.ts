import argon2 from 'argon2';
import { env } from '../config/env';
import { logger } from './logger';
import { prisma } from './prisma';

/**
 * Creates the first team-console (ADMIN) account from env vars, so a fresh
 * production deploy needs no shell access or seed script. Runs once per boot:
 *  - both BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set;
 *  - if a user with that email already exists, nothing changes (the password
 *    is NOT overwritten — rotate via the console/DB instead).
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 8) {
    logger.warn('[bootstrap-admin] BOOTSTRAP_ADMIN_PASSWORD is shorter than 8 chars — skipping.');
    return;
  }

  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    if (existing.role !== 'ADMIN' && existing.role !== 'SUPER_ADMIN') {
      logger.warn(
        `[bootstrap-admin] A non-admin user already owns ${email}; not modifying it. ` +
          'Use a different BOOTSTRAP_ADMIN_EMAIL.',
      );
    }
    return;
  }

  await prisma.user.create({
    data: {
      fullName: 'Voryn Team',
      email,
      passwordHash: await argon2.hash(password),
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  logger.info(`[bootstrap-admin] Created team console admin account for ${email}.`);
}
