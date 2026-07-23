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

## 7. Pre-launch verification

- [ ] `NODE_ENV=production` API boots (no guard errors).
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
