# Voryn Connect — Go-Live Runbook (vorynconnect.com)

Ordered, do-this-then-that steps to take the platform live on your Cloudflare
domain **vorynconnect.com**. Backend first, then the site, so the contact form
and partner login work the moment the domain goes live.

Target architecture:

| Hostname | Serves | Host |
|---|---|---|
| `vorynconnect.com` + `www.vorynconnect.com` | Marketing site + partner dashboard | Cloudflare Pages |
| `api.vorynconnect.com` | The API (Express/Prisma/Socket.IO) | Render |

Detailed env-var reference lives in [LAUNCH.md](LAUNCH.md); this file is the
sequence. Check items off as you go.

---

## 0. Accounts to have open (create these first)

- [ ] **GitHub** — to hold the code Render and Cloudflare build from
- [ ] **Render** (render.com) — runs the API + provisions Postgres + Key Value
- [ ] **Twilio** (twilio.com) — SMS sign-in codes (the API won't boot in prod without it)
- [ ] **Cloudflare R2** (or any S3-compatible: Backblaze B2 / AWS S3) — image storage
- [x] **LocationIQ** — you have the key already (`pk.f033…`)
- [x] **Cloudflare** — you own vorynconnect.com here already

> Want the API up with fewer accounts to start? You can skip R2 for now by
> setting `MEDIA_STORAGE=local` in Render (step 3). Image uploads then live on
> the server disk and are lost on redeploy — fine for a first smoke test, swap
> to R2 before real traffic. Twilio is **not** skippable: prod refuses to boot
> without it because nobody could sign in.

---

## 1. Push the code to GitHub

Two repos. Run each block once (replace `YOUR_USERNAME`):

```bash
# API + mobile monorepo
cd "/Users/raheimpalmer/Desktop/Voryn Connect Project 2/voryn-connect"
git remote add origin https://github.com/YOUR_USERNAME/voryn-connect.git
git push -u origin main

# Website
cd "/Users/raheimpalmer/Desktop/Voryn Connect Project 2/voryn connect website"
git remote add origin https://github.com/YOUR_USERNAME/voryn-connect-website.git
git push -u origin main
```

Create the two empty repos on github.com first (no README/gitignore — the push
brings everything). Your `.env` files are gitignored, so no secrets leave your machine.

---

## 2. Deploy the API (Render Blueprint)

1. Render Dashboard → **New → Blueprint** → pick your `voryn-connect` repo.
2. Render reads [render.yaml](render.yaml) and shows three resources to create:
   `voryn-api`, `voryn-postgres`, `voryn-keyvalue`. **Apply.**
3. `DATABASE_URL`, `REDIS_URL`, and the JWT secrets are wired/generated for you.

## 3. Fill the env prompts Render asks for

Render will prompt for each `sync: false` value. Paste:

| Prompt | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | from your Twilio console |
| `TWILIO_MESSAGING_SERVICE_SID` | your Twilio Messaging Service (or leave blank and set `TWILIO_FROM` to your Twilio number) |
| `CORS_ORIGINS` | `https://vorynconnect.com,https://www.vorynconnect.com` |
| `MAPS_GEOCODER_URL` / `MAPS_ROUTER_URL` | `https://us1.locationiq.com/v1` (both) |
| `MAPS_GEOCODER_KEY` / `MAPS_ROUTER_KEY` | your LocationIQ key (both) |
| `S3_ENDPOINT` | your R2 endpoint, e.g. `https://<accountid>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` for R2 |
| `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | from R2 |
| `MEDIA_PUBLIC_BASE_URL` | your bucket's public URL |
| `BOOTSTRAP_ADMIN_EMAIL` | your team login email (e.g. `vorynconnect@gmail.com`) |
| `BOOTSTRAP_ADMIN_PASSWORD` | a strong password (min 8 chars) — creates your team-console account on first boot |

> Deferring R2: instead of the S3 rows, add `MEDIA_STORAGE=local` in the Render
> env editor and leave the S3 rows blank.

The API runs `prisma migrate deploy` on boot, then starts. A **green deploy**
means the production boot guard accepted every value (it rejects dev defaults).

## 4. Verify the API

Open `https://<your-service>.onrender.com/health` → should return
`{"status":"ok"}`. If the deploy is red, open the logs — the boot guard prints
exactly which env value it rejected.

## 5. Point api.vorynconnect.com at Render

1. Render → `voryn-api` → **Settings → Custom Domains** → add `api.vorynconnect.com`.
   Render shows you a CNAME target (e.g. `voryn-api.onrender.com`).
2. Cloudflare → vorynconnect.com → **DNS** → add:
   - Type `CNAME`, Name `api`, Target = the Render target, **Proxy status: DNS only (grey cloud)** so Render can issue the TLS cert.
3. Wait for Render to show the domain as **Verified / certificate issued**.
4. Re-check `https://api.vorynconnect.com/health`.

---

## 6. Deploy the site (Cloudflare Pages)

1. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pick your `voryn-connect-website` repo. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: **`/`**
3. **Save and Deploy.** You get a `*.pages.dev` preview URL — open it and click around.

## 7. Attach the domain

1. In the Pages project → **Custom domains** → add `vorynconnect.com` **and**
   `www.vorynconnect.com`. Since the domain is already on Cloudflare, DNS is
   configured automatically.

---

## 8. Final end-to-end check (on the live domain)

- [ ] `https://vorynconnect.com` loads
- [ ] **Contact form** (contact.html) → submit → success toast (writes to the DB)
- [ ] **Partner signup** (partner-login.html → "Sign up as a partner") → lands on
      the **verification page** (partner-verification.html): fill business info,
      upload a test document, submit
- [ ] **Team console** (`/admin-login.html`) → sign in with your
      `BOOTSTRAP_ADMIN_*` credentials → the test application appears under
      "Needs review" → open it, view the documents, **Approve** or **Reject**
- [ ] Partner side reflects the decision (approved → "Open your dashboard";
      rejected → your notes shown, resubmit enabled)
- [ ] Browser devtools → Network → the calls go to `https://api.vorynconnect.com` (not localhost)

> **How partner verification works:** every new partner signs up as
> `PENDING_VERIFICATION` and is **invisible in the customer app** (discovery,
> search, and checkout are all gated) until your team approves them in the
> team console. Rejections send your notes back to the partner's verification
> page so they can fix and resubmit.

If the contact form or login fails with a CORS error, double-check step 3's
`CORS_ORIGINS` exactly matches your live origins (https, no trailing slash).

---

## Notes

- **Security:** the LocationIQ key was shared in chat — rotate it in the
  LocationIQ dashboard before real launch and update it in Render.
- **Verification documents** (IDs, registration certificates) are stored in the
  same media bucket as logos/product photos, under unguessable random file
  names. That's acceptable to launch, but plan to move them to a **private**
  bucket with signed URLs as volume grows — they contain personal data.
- **Map tiles** on the dashboard live map are still CARTO's free tier; swap for
  MapTiler before heavy use (LAUNCH.md §4). Geocoding/routing already use your key.
- **Mobile app** (iOS/Android) is a separate track — see LAUNCH.md §5c. Set
  `extra.apiUrl` in `apps/mobile/app.json` to `https://api.vorynconnect.com`
  before building store binaries.
