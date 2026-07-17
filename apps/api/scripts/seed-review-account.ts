/**
 * Creates a ready-to-review customer account: verified, funded wallet
 * (credited through the ledger so the transactions screen is populated),
 * loyalty points, saved addresses, a vehicle for Auto Care, and a few
 * notifications. Idempotent — safe to re-run. DEV ONLY.
 */
import argon2 from 'argon2';
import { prisma } from '../src/lib/prisma';
import { walletService } from '../src/modules/wallet/wallet.service';

const EMAIL = 'review@voryn.dev';
const PHONE = '+18765559876';
const PASSWORD = 'Review123!';

async function main() {
  // Clean any previous review account (cascades wallet, addresses, etc.).
  await prisma.user.deleteMany({ where: { email: EMAIL } });

  const user = await prisma.user.create({
    data: {
      fullName: 'Raheim Palmer',
      email: EMAIL,
      phone: PHONE,
      passwordHash: await argon2.hash(PASSWORD),
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      customerProfile: { create: { username: 'raheim', memberTier: 'GOLD' } },
      wallet: { create: {} },
      loyaltyAccount: { create: { pointsBalance: 2350 } },
      addresses: {
        create: [
          {
            label: 'HOME',
            name: 'Home',
            line1: '12 Cardiff Cres',
            city: 'Portmore',
            parish: 'St. Catherine',
            latitude: 17.9583,
            longitude: -76.8822,
            isDefault: true,
          },
          {
            label: 'WORK',
            name: 'Work',
            line1: 'Portmore Town Centre',
            city: 'Portmore',
            parish: 'St. Catherine',
            latitude: 17.9411,
            longitude: -76.8581,
          },
        ],
      },
      customerVehicles: {
        create: { make: 'Toyota', model: 'Axio', year: 2016, color: 'Silver', plateNo: '1234 JK' },
      },
    },
  });

  // Fund the wallet through the ledger so it has a real TOP_UP entry.
  await walletService.credit({
    userId: user.id,
    amountMinor: 5_000_000, // JMD 50,000
    description: 'Top up from Visa',
    idempotencyKey: `review-topup-${user.id}`,
  });

  // A couple of notifications so the center isn't empty.
  await prisma.notification.createMany({
    data: [
      {
        userId: user.id,
        type: 'PROMO',
        title: 'Welcome to Voryn Connect',
        body: 'Use 500 pts for JMD 250 off your next order.',
      },
      {
        userId: user.id,
        type: 'WALLET_UPDATE',
        title: 'Wallet topped up',
        body: 'JMD 50,000.00 was added to your Voryn Wallet.',
      },
    ],
  });

  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
  console.log('\n✅ Review account ready');
  console.log('   email   :', EMAIL);
  console.log('   phone   :', PHONE);
  console.log('   password:', PASSWORD);
  console.log('   wallet  : JMD', (wallet.balanceMinor / 100).toLocaleString('en-JM'));
  console.log('   points  : 2,350 pts');
  console.log('   extras  : 2 saved addresses, 1 vehicle (Toyota Axio), 2 notifications\n');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
