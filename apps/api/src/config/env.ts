import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  // Per-instance Prisma pool cap. instances × limit must stay below the
  // Postgres plan's max connections (see lib/prisma.ts).
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  OTP_DEV_MODE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  // SMS dispatch: 'dev' logs messages; 'twilio' sends via Twilio REST.
  SMS_PROVIDER: z.enum(['dev', 'twilio']).default('dev'),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional().default(''),
  TWILIO_FROM: z.string().optional().default(''),
  // Dev fulfillment simulator (auto-advances orders/bookings/rides). Turn OFF
  // when driving fulfillment manually from the partner dashboard.
  SIMULATE_FULFILLMENT: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  CORS_ORIGINS: z.string().default('http://localhost:8081'),
  // One-time team-console bootstrap: when both are set and no user exists with
  // that email, an ADMIN account is created on boot (see lib/bootstrap-admin.ts).
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional().default(''),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional().default(''),
  MEDIA_STORAGE: z.enum(['local', 's3']).default('local'),
  MEDIA_UPLOAD_DIR: z.string().default('uploads'),
  MEDIA_MAX_SIZE_MB: z.coerce.number().positive().default(8),
  // Object storage (used when MEDIA_STORAGE=s3). Works with any S3-compatible
  // provider: AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO.
  S3_ENDPOINT: z.string().optional().default(''), // omit for AWS; set for R2/B2/Spaces/MinIO
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Public base URL objects are served from (bucket public URL or a CDN).
  MEDIA_PUBLIC_BASE_URL: z.string().optional().default(''),
  CARD_GATEWAY_API_KEY: z.string().optional().default(''),
  CARD_GATEWAY_WEBHOOK_SECRET: z.string().optional().default(''),
  // Map provider endpoints — OSM-compatible defaults for dev; point at keyed
  // or self-hosted services in production. Keys never ship to clients.
  MAPS_GEOCODER_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  MAPS_ROUTER_URL: z.string().url().default('https://router.project-osrm.org'),
  // Optional API keys for keyed OSM-compatible providers (e.g. LocationIQ,
  // Geoapify). When set, appended as `&key=` on geocoder/router requests.
  MAPS_GEOCODER_KEY: z.string().optional().default(''),
  MAPS_ROUTER_KEY: z.string().optional().default(''),
  MAPS_DAILY_CALL_WARNING: z.coerce.number().int().positive().default(5000),
  // Standard delivery radius (km). Drop-offs beyond it but within the extended
  // radius are still served; beyond the extended radius they are out of zone.
  DELIVERY_MAX_KM: z.coerce.number().positive().default(25),
  DELIVERY_EXTENDED_MAX_KM: z.coerce.number().positive().default(35),
  // Controlled peak-demand multiplier in basis points (10000 = 1.00×, no surge).
  // Clamped to a maximum of 1.30× by the pricing engine. Raised by ops during
  // severe conditions; never uncontrolled surge.
  DELIVERY_PEAK_MULTIPLIER_BPS: z.coerce.number().int().min(10_000).max(13_000).default(10_000),
  // How long a signed delivery quote is honoured before the customer re-quotes.
  DELIVERY_QUOTE_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  // Bumped whenever the delivery pricing model changes, so historical orders
  // keep the fee they were quoted under. Stored on every delivery quote.
  DELIVERY_PRICING_VERSION: z.coerce.number().int().positive().default(1),
  // Ride quotes are honoured for this long before the customer must re-quote.
  RIDE_QUOTE_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  // Driver search: comma-separated expanding radius stages (km), how long each
  // stage lasts, and the total search window before an honest no-driver result.
  RIDE_SEARCH_RADII_KM: z
    .string()
    .default('1.5,3,5,8,12')
    .transform((v) => v.split(',').map((s) => Number(s.trim())))
    .pipe(z.array(z.number().positive()).min(1)),
  RIDE_SEARCH_STAGE_SECONDS: z.coerce.number().int().positive().default(25),
  RIDE_SEARCH_MAX_SECONDS: z.coerce.number().int().positive().default(240),
  // Presence freshness: markers may show slightly older fixes than dispatch trusts.
  DRIVER_PRESENCE_MARKER_FRESH_SECONDS: z.coerce.number().int().positive().default(60),
  DRIVER_PRESENCE_DISPATCH_FRESH_SECONDS: z.coerce.number().int().positive().default(30),
  // Couriers with a fresh GPS fix only see deliveries whose pickup is this close.
  COURIER_DISPATCH_RADIUS_KM: z.coerce.number().positive().default(15),
  // Money model: provider earnings clear from pending to available after this
  // many days; the weekly payout run pays available balances.
  EARNINGS_CLEAR_DAYS: z.coerce.number().int().min(0).default(2),
  // Couriers pay a commission on the delivery fee, like every other provider
  // type. Tips are never commissioned. Delivery + rides = 9.99%.
  COURIER_COMMISSION_BPS: z.coerce.number().int().min(0).max(5000).default(999),
  // Ride drivers pay a percentage commission on the fare (never on tips).
  RIDE_COMMISSION_BPS: z.coerce.number().int().min(0).max(5000).default(999),
  // The rewards fund is a provision, not a gate: it legitimately runs a small
  // deficit early on, because customers redeem before contributions accumulate.
  // Only a deficit past this tolerance tightens the redemption safety cap.
  REWARDS_FUND_DEFICIT_TOLERANCE_MINOR: z.coerce.number().int().min(0).default(5_000_000),
  // Direct costs on a transaction, subtracted from commission before any points
  // discount is allowed (see lib/margin.ts). Card gateway pricing in Jamaica is
  // typically a percentage plus a flat item fee; wallet and cash cost nothing.
  PAYMENT_PROCESSING_BPS: z.coerce.number().int().min(0).max(2000).default(350),
  PAYMENT_PROCESSING_FIXED_MINOR: z.coerce.number().int().min(0).default(3_000),
  // Provision for refunds and chargebacks, as a share of order value.
  REFUND_PROVISION_BPS: z.coerce.number().int().min(0).max(2000).default(100),
  // Voryn must clear at least this much on an order after costs, before points.
  MIN_PROFIT_PER_ORDER_MINOR: z.coerce.number().int().min(0).default(2_000),
  // Flat fee charged to a provider for a bank withdrawal, and the smallest
  // withdrawal allowed. The provider receives the amount they request; the fee
  // is added on top of it when reserving from their available balance.
  PAYOUT_FLAT_FEE_MINOR: z.coerce.number().int().min(0).default(15_000),
  PAYOUT_MINIMUM_MINOR: z.coerce.number().int().min(0).default(200_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast on boot with a readable list of problems.
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

// Production startup safety checks: refuse to boot with dev defaults.
if (env.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (env.JWT_ACCESS_SECRET.includes('change-me')) problems.push('JWT_ACCESS_SECRET uses a dev default');
  if (env.JWT_REFRESH_SECRET.includes('change-me')) problems.push('JWT_REFRESH_SECRET uses a dev default');
  if (env.DATABASE_URL.includes('voryn_dev_password')) problems.push('DATABASE_URL uses the dev password');
  if (env.OTP_DEV_MODE) problems.push('OTP_DEV_MODE must be false in production');
  if (env.SMS_PROVIDER === 'dev') {
    problems.push('SMS_PROVIDER must be a real provider in production (users cannot receive OTP codes otherwise)');
  }
  if (env.SMS_PROVIDER === 'twilio') {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      problems.push('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required when SMS_PROVIDER=twilio');
    }
    if (!env.TWILIO_MESSAGING_SERVICE_SID && !env.TWILIO_FROM) {
      problems.push('Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM when SMS_PROVIDER=twilio');
    }
  }
  if (env.SIMULATE_FULFILLMENT) problems.push('SIMULATE_FULFILLMENT must be false in production');
  const localOrigins = env.CORS_ORIGINS.split(',').filter((o) => o.includes('localhost') || o.includes('127.0.0.1'));
  if (localOrigins.length > 0) {
    problems.push(`CORS_ORIGINS contains local dev origins (${localOrigins.join(', ')}) — replace with real domains`);
  }
  if (env.MEDIA_STORAGE === 'local') {
    // Local disk is lost on redeploy on ephemeral hosts — allowed, but only
    // safe on a host with a persistent volume. Warn rather than block.
    // eslint-disable-next-line no-console
    console.warn(
      '[voryn] MEDIA_STORAGE=local: uploads are stored on the API host disk. ' +
        'Ensure a persistent volume, or set MEDIA_STORAGE=s3 with object-storage credentials.',
    );
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to start in production:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

// Object-storage config is validated in every environment (so a MinIO dev
// setup fails just as clearly as production) whenever MEDIA_STORAGE=s3.
if (env.MEDIA_STORAGE === 's3') {
  const missing: string[] = [];
  if (!env.S3_BUCKET) missing.push('S3_BUCKET');
  if (!env.S3_ACCESS_KEY_ID) missing.push('S3_ACCESS_KEY_ID');
  if (!env.S3_SECRET_ACCESS_KEY) missing.push('S3_SECRET_ACCESS_KEY');
  if (!env.MEDIA_PUBLIC_BASE_URL) missing.push('MEDIA_PUBLIC_BASE_URL');
  if (missing.length > 0) {
    throw new Error(`MEDIA_STORAGE=s3 requires these env vars: ${missing.join(', ')}`);
  }
}

export const corsOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
