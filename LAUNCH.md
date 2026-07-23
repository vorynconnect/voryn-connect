# Voryn Connect — Production Launch Guide

This is the exact, ordered checklist to take Voryn Connect from the working
dev build to a live, public, secure platform. It also states honestly what a
human must do (create accounts, enter payment/identity, complete phone/ID
verification) versus what the code already handles for you.

> **What I could not do for you, and why.** I cannot create third-party
> accounts, enter your payment card, verify a phone number, or complete the
> CAPTCHAs those signups require — those need your legal identity and payment
> method, and doing them for you would be unsafe and against how I'm allowed to
> operate. Instead I made every integration **plug-and-play**: you create the
> account, paste the key into one `.env` line, and it works. Each account below
> says exactly where its key goes.

---

## 0. What's already done (this session)

Security & correctness hardening already in the code:

- **Fail-fast production guard** (`apps/api/src/config/env.ts`): the API
  *refuses to boot* in `NODE_ENV=production` if any of these is true — JWT
  secrets are dev defaults, DB uses the dev password, `OTP_DEV_MODE=true`,
  `SIMULATE_FULFILLMENT=true`, SMS provider is `dev`, Twilio creds are missing,
  `MEDIA_STORAGE=s3` (not implemented), or `CORS_ORIGINS` still contains
  localhost. It prints every problem at once.
- **Real SMS OTP** (`apps/api/src/lib/sms.ts`): Twilio integration wired in.
  Dev logs codes; production sends real SMS. Just add Twilio creds.
- **Card payments gated off in production** (`payment.service.ts`,
  `wallet.routes.ts`): the auto-approving sandbox is disabled in prod so it can
  never hand out goods or wallet credit without a real charge. Launch runs on
  **Voryn Wallet + Cash**; wire a real gateway to enable cards.
- **Dev seed refuses to run in production** (`prisma/seed.ts`) — it creates
  accounts with known passwords, so it's blocked unless `ALLOW_PROD_SEED=true`.
- **Keyed maps support** (`maps.provider.ts`): geocoder/router now accept an
  optional API key, so you can point at LocationIQ/Geoapify with env only.
- **Object storage** (`lib/uploads.ts`): S3-compatible media storage (AWS S3,
  Cloudflare R2, Backblaze B2, DO Spaces, MinIO) is fully implemented and
  verified end-to-end. Set `MEDIA_STORAGE=s3` + the S3 vars; the API validates
  them at boot. Upload size/type limits now return clean 400s, not 500s.
- **One-click deploy** (`render.yaml`, `apps/api/Dockerfile`): a Render
  Blueprint provisions the API + Postgres + Redis wired together. The Dockerfile
  was built and the container booted end-to-end (migrations + live login) as a
  check. Also fixed a real bug: the production start path was `dist/server.js`
  but `tsc` emits `dist/src/server.js` — corrected in both the Dockerfile and
  the `start` script (production start was broken before, not just Docker).
- **Mobile store readiness** (`apps/mobile/eas.json`, `app.json`): build/submit
  profiles added; app config completed (image-picker photo permission, Android
  Maps key field, build numbers, version 1.0.0, production API URL fallback in
  `config.ts`). Verified with a native prebuild and `expo-doctor` (18/18 pass).
  Also fixed a stray invalid `typescript@6.0.3` install (re-pinned to 5.9.3).
- **CI** (`.github/workflows/ci.yml`): on every push/PR — API typecheck + the
  full test suite against real Postgres 16 + Redis 7 service containers,
  mobile typecheck, and a production Docker image build. The recipe was proven
  locally against a fresh unseeded database (86/86) and the lockfile verified
  `npm ci`-clean. Activates automatically once the repo is pushed to GitHub.
- **Branding**: the Voryn logo asset was trimmed to its artwork bounds and
  enlarged so it sits flush in every header (app, driver mode, website navbar,
  partner dashboard sidebar, footer). Dead "Continue with Google/Apple" buttons
  removed from the app's auth screens.
- **SEO**: `robots.txt` keeps the partner dashboard and internal admin console
  out of search indexes.

Verified green: API typecheck, mobile typecheck, 61/61 API tests, and a live
walkthrough of the customer app, driver dashboard, and partner dashboard.

---

## 1. Accounts you must create (in priority order)

| # | Service | Why | Cost | Where the key goes |
|---|---------|-----|------|--------------------|
| 1 | **Twilio** (twilio.com) | Send OTP sign-in codes by SMS to Jamaican (+1876) numbers. Without it, nobody can register. | Pay-as-you-go (~US$1/mo number + per-SMS) | `apps/api/.env`: `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_MESSAGING_SERVICE_SID` (recommended) or `TWILIO_FROM` |
| 2 | **Managed PostgreSQL** (Neon, Supabase, Render, or Railway) | The production database. | Free tier → ~US$10–25/mo | `apps/api/.env`: `DATABASE_URL` |
| 3 | **Managed Redis** (Upstash, Render, or Railway) | Rate limiting + realtime coordination. | Free tier → ~US$10/mo | `apps/api/.env`: `REDIS_URL` |
| 4 | **API + site hosting** (Render or Railway recommended; or a DigitalOcean droplet) | Runs the Node API and serves the static site. | ~US$7–25/mo | n/a — deploy target |
| 5 | **Maps provider — LocationIQ** (locationiq.com) *or* Geoapify | Real geocoding + routing (replaces the demo servers, which forbid production use). | Free 5k req/day → paid | `apps/api/.env`: `MAPS_GEOCODER_URL=https://us1.locationiq.com/v1`, `MAPS_ROUTER_URL=https://us1.locationiq.com/v1`, `MAPS_GEOCODER_KEY`, `MAPS_ROUTER_KEY` |
| 6 | **Map tiles — MapTiler** (maptiler.com) or Stadia Maps | The visible map basemap on web/partner dashboards (replaces CARTO free tiles). | Free tier → paid | See §4 (tile URL in the web shim + `partner-dashboard/live-map.html`) |
| 7 | **Object storage — Cloudflare R2** (recommended; zero egress fees) or Backblaze B2 / AWS S3 / DO Spaces | Stores partner logos, product images, avatars durably. **Required** unless your host has a persistent disk volume. | R2 free ≤10GB → cheap | `apps/api/.env`: `MEDIA_STORAGE=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_BASE_URL` |
| 8 | **Domain registrar** — done: `vorynconnect.com` on Cloudflare | Public domains: site at `vorynconnect.com`, API at `api.vorynconnect.com` (see GO-LIVE.md). | ~US$12/yr | DNS → your host; also `CORS_ORIGINS` |
| 9 | **Apple Developer Program** | Publish the iOS app. | US$99/yr | Used by EAS Build (§5) |
| 10 | **Google Play Console** | Publish the Android app. | US$25 once | Used by EAS Build (§5) |
| 11 | **Expo / EAS** (expo.dev) | Cloud-build the mobile app binaries. | Free tier works | `eas.json` (§5) |
| 12 | *(Later)* **Payment gateway — WiPay** (wipayfinancial.com, JM) or Fygaro | Card top-ups / card checkout. Not required for launch (wallet + cash work). | Per-transaction | New gateway client in `payment.service.ts` |

---

## 2. Generate real secrets

```bash
# Run these and paste the output into apps/api/.env
openssl rand -hex 32   # → JWT_ACCESS_SECRET
openssl rand -hex 32   # → JWT_REFRESH_SECRET
```

## 3. Production `apps/api/.env` (template)

```dotenv
NODE_ENV=production
PORT=4100

DATABASE_URL=postgresql://USER:PASS@HOST:5432/voryn_connect
REDIS_URL=redis://USER:PASS@HOST:6379

JWT_ACCESS_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32>
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30

OTP_DEV_MODE=false
OTP_TTL_MINUTES=10
SIMULATE_FULFILLMENT=false

SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxx

CORS_ORIGINS=https://vorynconnect.com,https://www.vorynconnect.com

# Recommended: object storage (durable, survives redeploys). See row 7.
MEDIA_STORAGE=s3
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=voryn-media
S3_ACCESS_KEY_ID=xxxxxxxx
S3_SECRET_ACCESS_KEY=xxxxxxxx
S3_FORCE_PATH_STYLE=false
MEDIA_PUBLIC_BASE_URL=https://media.vorynconnect.com
MEDIA_MAX_SIZE_MB=8
# (Alternative: MEDIA_STORAGE=local with MEDIA_UPLOAD_DIR on a persistent volume.)

MAPS_GEOCODER_URL=https://us1.locationiq.com/v1
MAPS_ROUTER_URL=https://us1.locationiq.com/v1
MAPS_GEOCODER_KEY=pk.xxxxxxxx
MAPS_ROUTER_KEY=pk.xxxxxxxx
DELIVERY_MAX_KM=15
```

The API will **refuse to start** if any of these still holds a dev value — that
guard is intentional and is your safety net.

> **Uploads note:** Prefer `MEDIA_STORAGE=s3` (object storage) — images survive
> redeploys and scale across multiple API hosts. The API validates the S3 vars
> at boot and refuses to start if any are missing. `MEDIA_STORAGE=local` still
> works but must sit on a **persistent volume** (the Dockerfile declares one;
> Render/Railway need a mounted disk), or images vanish on redeploy.

## 4. Map tiles (visible basemap)

Two files reference the CARTO demo tiles; swap them for your keyed provider:

- `apps/mobile/web-shims/react-native-maps.web.js` — the tile URL template.
- `voryn connect website/partner-dashboard/live-map.html` — the Leaflet tile layer.

Example (MapTiler): `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY`.
Native iOS/Android use Apple/Google native maps via `react-native-maps` (Android
needs a Google Maps API key in `app.json` → `expo.android.config.googleMaps`).

## 5. Deploy

### 5a. Backend — Render Blueprint (recommended, one click)

`render.yaml` at the repo root provisions the **whole backend wired together**:
the API (from the Dockerfile), managed PostgreSQL, and managed Redis/Key Value.
`DATABASE_URL` and `REDIS_URL` are injected automatically; JWT secrets are
generated for you; everything else is prompted so you paste real values once.

1. Push the `voryn-connect/` folder to a GitHub repo.
2. Render Dashboard → **New → Blueprint** → select the repo. Render reads
   `render.yaml`.
3. Render prompts for each `sync: false` var — paste your Twilio, S3/R2, maps,
   and `CORS_ORIGINS` (your real domains) values.
4. **Apply.** The API container runs `prisma migrate deploy` on boot, then
   starts. The boot guard rejects any leftover dev value, so a green deploy
   means the config is genuinely production-safe.

> Verified locally: the Dockerfile builds, and the container boots end-to-end
> (migrations apply, server serves `/health` and a real DB-backed login).
> `region: virginia` (US East) is the closest Render region to Jamaica —
> change it in `render.yaml` if you prefer another. All three resources
> (API, Postgres, Key Value) must stay in the SAME region so the internal
> `DATABASE_URL`/`REDIS_URL` connections work.

> **If the Blueprint fails with an "EOF" or empty-file error**, the
> `render.yaml` in your GitHub repo is empty or missing — usually from an
> incomplete upload. Confirm on github.com that `render.yaml` at the repo
> root shows this file's contents, and that the repo root is the
> `voryn-connect/` folder itself (not a parent folder containing it).

**Railway alternative:** create a project, add PostgreSQL and Redis plugins,
add a service from this repo pointing at `apps/api/Dockerfile`, then set the
same env vars (Railway exposes `DATABASE_URL`/`REDIS_URL` as reference vars).

**Plain Docker (a VPS/droplet):**

```bash
docker build -f apps/api/Dockerfile -t voryn-api .
docker run --env-file apps/api/.env -p 4100:4100 -v voryn_uploads:/app/apps/api/uploads voryn-api
```

### 5b. Static site

Deploy the `voryn connect website/` folder to any static host (Cloudflare
Pages, Netlify, Render static). Set `window.VORYN_API_BASE_URL` in `js/config.js`
to your production API URL (e.g. `https://voryn-api.onrender.com` or your custom
domain), and add that site's domain to the API's `CORS_ORIGINS`.

### 5c. Mobile app (iOS + Android via EAS)

`apps/mobile/eas.json` defines the build profiles and `app.json` is store-ready
(icons, bundle IDs `com.voryn.connect`, permission strings, version 1.0.0). The
project passes `expo-doctor` (18/18) and a native prebuild.

**Before your first build, one placeholder remains:**
- `app.json` → `android.config.googleMaps.apiKey` — your Android Google Maps
  key (`REPLACE_WITH_ANDROID_GOOGLE_MAPS_API_KEY`). iOS uses Apple Maps and
  needs no key. Get one in Google Cloud Console → Maps SDK for Android, and
  restrict it to the `com.voryn.connect` package.

(`expo.extra.apiUrl` is already set to `https://api.vorynconnect.com` — store
builds call it; dev still auto-derives the LAN host via `src/lib/config.ts`.)

**Then build and submit:**
```bash
npm i -g eas-cli
cd apps/mobile
eas login                 # your Expo account
eas init                  # links the project, writes extra.eas.projectId
eas build --profile production --platform all
eas submit --profile production --platform all   # needs Apple + Google accounts (§1)
```

Notes:
- The `production` profile in `eas.json` reads the same `app.json`; bump
  `ios.buildNumber` / `android.versionCode` for each store submission.
- Push notifications aren't wired for launch (the app polls for updates), so no
  FCM/APNs setup is required yet.
- The Android build declares `RECORD_AUDIO` because the camera library (used for
  QR-code payment scanning) ships it in its own manifest; the app never records
  audio (`recordAudioAndroid: false` is set). This is a standard, accepted
  camera-library permission — no action needed unless a reviewer asks, in which
  case the honest answer is "camera SDK dependency; audio recording is unused."

## 5d. Scale & reliability posture (verified)

The backend runs as a stateless **modular monolith on 2 always-on instances**
(`render.yaml numInstances: 2`) behind Render's load balancer. What makes that
safe, each piece verified locally:

- **Realtime across instances** — Socket.IO uses a Redis adapter
  (`server.ts`), so an event emitted by one instance reaches clients connected
  to any other. Proven end-to-end: a driver GPS ping into instance A was
  received by a customer socket connected to instance B.
- **Readiness routing** — `/health/ready` checks Postgres + Redis (2s
  timeouts) and returns 503 while degraded, pulling the instance out of
  rotation; `/health/live` reports process liveness. Verified: an instance
  with Redis down serves 503-ready/200-live, **stays alive**, and recovers.
- **Graceful shutdown** — SIGTERM drains in-flight requests, closes sockets,
  releases DB/Redis connections, exits 0 (10s force-exit cap). Deploys and
  scale-downs don't cut off active checkouts.
- **Connection budgeting** — Prisma pool capped per instance
  (`DB_CONNECTION_LIMIT=10`, `pool_timeout=15s`); instances × limit stays
  under the Postgres plan's connection budget.
- **Crash isolation** — Redis outages log-and-degrade instead of killing the
  process (adapter clients use `maxRetriesPerRequest: null` + error handlers;
  a process-level `unhandledRejection` guard logs stray rejections).
- **Traceability** — every request gets an `X-Request-Id` (honouring the load
  balancer's), echoed inside every error payload, so a user-reported error
  maps to its exact log line.
- **Measured baseline** (local hardware, real DB queries): `/health/ready`
  14,260 req/s at P99 10ms under 100 connections; `/v1/discovery/home` P95
  6ms; a single-IP flood of 94k requests was shed by the rate limiter (299
  served, rest 429) without the API degrading.

Already in the codebase from earlier work: strict backend state machines,
idempotency keys on every financial/ordering mutation, double-entry wallet
ledger with serializable transactions, atomic one-winner driver claims,
per-endpoint rate limits, GPS anomaly rejection, and TTL caches on map calls.

**Deliberately deferred** (revisit as traffic grows, per the phased plan):
background job queues (BullMQ) — current request paths are fast and the only
slow external call, OTP SMS, must block signup anyway; Redis GEO for driver
search (Haversine over indexed presence columns is fine at Portmore launch
density); read replicas; microservice extraction. The modular-monolith layout
means each of these is an additive change, not a redesign.

## 6. First-run data

The dev seed is **blocked in production**. Onboard real providers through the
partner sign-up flow (`partner-login.html` → "New to Voryn Connect"). To bring
up an empty prod DB:

```bash
npm run prisma:deploy --workspace apps/api   # apply migrations only, no seed data
```

## 6b. Money model (commission, payouts, points)

Voryn is **provider-funded**: customers pay for the goods or service, delivery
or fare, tax and any tip, and nothing else. There is no customer-facing Voryn
fee anywhere in the app. Platform revenue is the commission Voryn charges each
provider (couriers and drivers included).

**Commission rates** are per provider category, defined in
`apps/api/src/lib/commission.ts`. Rides and deliveries are charged 9.99%; every
other provider type is charged 11.99%:

| Provider category                     | Rate |
| ------------------------------------- | ---: |
| Ride drivers (`RIDE_COMMISSION_BPS`)  | 9.99% |
| Delivery couriers (`COURIER_COMMISSION_BPS`) | 9.99% |
| Restaurants                           | 11.99% |
| Grocery, pharmacy, convenience, drinks | 11.99% |
| Home services, technicians, auto care | 11.99% |
| Vehicle rental                        | 11.99% |
| Suppliers (B2B)                       | 11.99% |

A negotiated rate for an individual provider goes in `Provider.commissionBps`
(basis points, e.g. `850` = 8.5%); it overrides the category default. Whatever
you agree must match the signed provider agreement, since the commission basis
is a contractual term.

Commission is charged on the commissionable provider amount only. Tips, taxes,
refundable deposits, withdrawal fees and Voryn-funded points discounts are all
excluded, so a customer redeeming points never reduces what the provider earns.

**Provider earnings** land in the `ProviderEarning` ledger as `PENDING`, clear
to `AVAILABLE` after `EARNINGS_CLEAR_DAYS`, move to `RESERVED` when committed to
a payout, and end as `PAID`. The partner wallet reports those states separately.

**Bank payouts.** The provider enters the amount they want to receive; a flat
`PAYOUT_FLAT_FEE_MINOR` (JMD 150) is added on top, with a `PAYOUT_MINIMUM_MINOR`
(JMD 2,000) floor. Both leave the available balance the moment the request is
made, so the same earnings can never fund two payouts. A successful payout books
the fee as revenue; a failed one returns the amount and the fee together. Voryn
does not operate the transfer rail — settle through a bank or an authorised
payment service provider.

**Delivery pricing** (`src/lib/pricing.ts`, `modules/orders/delivery-quote.ts`)
is distance-based on the **actual road route** (merchant branch → drop-off, via
the maps service, never straight-line). The tiered fee:

| Road distance | Fee |
| ------------- | --- |
| 0–3 km        | JMD 500 flat |
| 3–10 km       | JMD 500 + JMD 100 per additional km |
| over 10 km    | JMD 1,200 + JMD 130 per additional km |

Fees round **up** to the nearest JMD 50. On top of the distance fee the engine
applies, in order: a vehicle multiplier (motorcycle 1.00×, car 1.20×, SUV 1.35×,
van 1.60×), flat package and additional-pickup (JMD 250/extra merchant)
adjustments, a controlled peak multiplier (`DELIVERY_PEAK_MULTIPLIER_BPS`, capped
at 1.30×), then any waiting-time fee (first 10 min free, JMD 20/min after, max
JMD 400). The courier is paid the whole fee less the 9.99% commission, plus 100%
of tips. Standard radius is `DELIVERY_MAX_KM` (25 km), extended to
`DELIVERY_EXTENDED_MAX_KM` (35 km); beyond that a drop-off is out of zone.

At checkout the backend **signs and persists** the fee as a `DeliveryQuote`
(`DELIVERY_QUOTE_TTL_MINUTES`, 10 min; `DELIVERY_PRICING_VERSION` frozen on each
quote and order). `GET /v1/orders/quote` returns a `deliveryQuoteId`; the app
passes it back to `POST /v1/orders/checkout`, which locks the fee to the quote so
the mobile app never computes the final fee itself. A destination change
(`POST /v1/orders/:id/change-destination`) reprices the leg and adds at least
JMD 200; cancellation fees follow the stage table (free before a courier commits,
JMD 150 once accepted, JMD 250 at pickup, full fee once collected).

**Voryn Points**: customers earn 5 points per JMD 100 of eligible items, and
10 points are worth JMD 1. That reads as a generous "5 points per JMD 100" while
costing about **0.5%** of spend. Redemption moves in 100-point steps with a
500-point (JMD 50) minimum. Points are **not convertible to cash** — deliberate,
because freely convertible points start to resemble stored monetary value, which
BOJ treats as a regulated payment activity. Do not enable a points-to-cash path
without your payment partner and legal adviser.

**The rewards engine** (`src/lib/loyalty.ts`, `src/lib/margin.ts` and
`modules/rewards`) decides how much any single order may absorb. Every limit is
evaluated and the tightest wins:

| Limit | Rule |
| ----- | ---- |
| Customer balance | Points actually held |
| Order share | 5% of items + delivery |
| **Commission safety** | **25% of the commission Voryn expects on that order** |
| **Margin safety** | **What survives after card fees, refund provision and Voryn's minimum profit** |
| Delivery coverage | Never enough to make delivery free |
| Minimum order | No redemption below JMD 1,500 |

The last two are what keep every order profitable. On a JMD 5,000 retail sale at
8%, five percent of the order would be JMD 250 against only JMD 400 of
commission; the engine allows JMD 100 and Voryn still clears JMD 300. The margin
guard matters most on card payments, where gateway fees consume commission
before any discount applies. Checkout tells the customer which limit applied
rather than silently offering less than they expected.

Points are issued `PENDING` at checkout and only become spendable when the order
completes, so nobody can earn, spend and then cancel. They expire 12 months
after release, oldest spent first, with a 30-day warning. A refund reverses
everything proportionally: the provider's earning and Voryn's commission shrink
by the same share, points earned on the refunded portion are clawed back, and
the matching share of spent points is returned.

Membership tiers (Bronze to Platinum, from trailing-12-month spend) and
time-boxed campaigns raise the **earn rate only**. Nothing ever raises what a
point is worth, which is what keeps the liability calculable.

**The rewards fund** is a provision, not a gate. Each settled transaction sets
aside `REWARDS_FUND_CONTRIBUTION_BPS` (5%) of commission, redemptions draw it
down, and expired points credit it back. It starts empty and will legitimately
run a deficit early on, because customers redeem before contributions
accumulate — that is why only a deficit beyond
`REWARDS_FUND_DEFICIT_TOLERANCE_MINOR` (JMD 50,000) tightens the safety cap. A
persistent deficit past that point is the signal to raise the contribution rate
or lower the caps deliberately, not a bug.

`GET /v1/admin/revenue` reports commission by category, withdrawal-fee income,
the points accounts (issued, pending, redeemed, expired) and the outstanding
points liability.

Two things to take to your accountant before launch:

- **Loyalty liability.** Outstanding points are a future obligation. Under
  IFRS 15 a material right like this is generally a performance obligation, so
  part of each sale may need to be deferred until points are redeemed or
  expire. The data to compute it is in `LoyaltyTransaction` and the
  `POINTS_EARNED` / `POINTS_REDEEMED` rows of `SettlementRecord`.
- **Reward cost vs commission.** Voryn funds points by default
  (`Order.rewardFunding = VORYN_FUNDED`). The commission safety cap keeps every
  individual order profitable, but watch the ratio of `VORYN_FUNDED_DISCOUNT` to
  `VORYN_COMMISSION` + `VORYN_DELIVERY_MARGIN` across the book once real volume
  arrives, along with the rewards fund balance. Move promotions to
  merchant-funded or shared where a provider has agreed to it in writing; a
  merchant-funded reward lifts the commission cap because the merchant, not
  Voryn, is paying for it. Never charge a merchant for a reward they did not
  approve.

Every completed transaction writes a full `SettlementRecord` breakdown, so
refunds, provider statements and revenue reporting all recompute from the
ledger rather than from a single stored total.

## 7. Pre-launch verification

- [ ] `NODE_ENV=production` API boots (no guard errors).
- [ ] Commission rates in `lib/commission.ts` match your signed provider
      agreements; per-provider overrides set where negotiated.
- [ ] Accountant has confirmed the points liability treatment (§6b).
- [ ] `PAYMENT_PROCESSING_BPS` and `PAYMENT_PROCESSING_FIXED_MINOR` match what
      your gateway actually charges, so the margin guard uses real costs.
- [ ] `PAYOUT_FLAT_FEE_MINOR` covers what your bank charges per transfer.
- [ ] A test provider can request a withdrawal and see the fee before
      confirming; a failed payout returns both the amount and the fee.
- [ ] Register a real phone number → receive the SMS code.
- [ ] Place a wallet-funded order end-to-end; confirm cash order too.
- [ ] Partner dashboard: accept an order, drive it to delivered.
- [ ] Driver mode: accept a ride, complete it, confirm payout.
- [ ] Map search returns real Jamaican places; a route draws.
- [ ] HTTPS on every domain; `CORS_ORIGINS` lists only your real domains.
- [ ] Legal pages reviewed: `terms.html`, `privacy.html` (have a lawyer confirm).

## 8. Known limitations to decide on before/after launch

1. **Card payments** are off in production (wallet + cash only) until a real
   gateway (WiPay/Fygaro) replaces the sandbox in `payment.service.ts`.
2. ~~S3 media storage is declared but not implemented~~ — **done.** Object
   storage (S3/R2/B2/Spaces/MinIO) is fully wired and verified; set
   `MEDIA_STORAGE=s3` with the S3 vars. Local disk on a volume also works.
3. **Free map tiers** (public Nominatim/OSRM/CARTO) violate production terms —
   §1 rows 5–6 replace them.
4. **Admin console** (`admin-*.html`) targets a separate, deprecated backend
   (port 8080) and is not part of the customer launch. It's excluded from
   search via `robots.txt`; treat it as an internal tool to be rebuilt on the
   shared API if you need it.
5. **Dispatch** is pull-feed + atomic-claim (no push offers/timeouts) and uses
   Haversine radius (no PostGIS/Redis GEO) — fine for launch scale in Portmore.
6. **Support inbox is database-only.** Customer tickets (`SupportTicket`, from
   the app's Support screen and the partner dashboard) and website contact
   messages (`ContactMessage`, from the site's `/v1/support/contact` form)
   are stored in Postgres, but there is no staff UI to read them yet — answer
   them via SQL/Prisma Studio (`npx prisma studio`) until an ops console is
   built. Reply to customers by phone/email for now.
