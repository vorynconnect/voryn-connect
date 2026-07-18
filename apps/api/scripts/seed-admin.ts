/**
 * Dev-only: creates (or resets the password of) a local team-console admin.
 *
 *   npm run seed:admin --workspace apps/api            → admin@voryn.dev / AdminDev1!
 *   npm run seed:admin --workspace apps/api -- me@x.com Passw0rd!
 *
 * Production uses BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD instead
 * (lib/bootstrap-admin.ts) — this script refuses to run there.
 */
import argon2 from 'argon2';
import { prisma } from '../src/lib/prisma';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-admin is dev-only; use BOOTSTRAP_ADMIN_* env vars in production.');
  }
  const email = (process.argv[2] ?? 'admin@voryn.dev').toLowerCase();
  const password = process.argv[3] ?? 'AdminDev1!';
  const passwordHash = await argon2.hash(password);

  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
    });
    console.log(`Updated existing user ${email} → ADMIN with the given password.`);
  } else {
    await prisma.user.create({
      data: {
        fullName: 'Voryn Team',
        email,
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    console.log(`Created team console admin ${email}.`);
  }
  console.log(`Login at /admin-login.html with ${email} / ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
