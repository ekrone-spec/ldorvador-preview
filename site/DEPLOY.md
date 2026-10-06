# ldorvadortravel.com — Cloudflare Workers + CloudCannon

**LAUNCHED 2026-08-11.** Live at https://www.ldorvadortravel.com
(apex and both .org hostnames 301 to it). This file is now the handover
and maintenance record; the cutover section is kept as history.

## Cost change for the client

| | Before | After |
|---|---|---|
| Squarespace website plan | $220/yr | cancelled |
| Hosting + forms (Cloudflare, Web3Forms) | — | $0 |
| CMS (CloudCannon Lite, partner rate) | — | $120/yr, billed to Hannah |
| Domains .com + .org (Squarespace) | ~$24/yr | ~$24/yr |
| **Total to Hannah** | **~$244/yr** | **~$144/yr** |

The `site/` folder is the full source. `python3 build.py` builds the site into
`site/` itself; `SITE=https://www.ldorvadortravel.com PROD=1 WEB3FORMS_KEY=…`
builds the production version (real canonical/hreflang/OG URLs, no noindex,
robots.txt + sitemap.xml, live form key).

## Accounts (all created)

1. **Cloudflare** (done) — Workers project `ldorvador-preview`, git-connected.
   Root directory `site`, build command `npm ci && pip3 install pillow && python3 build.py`,
   deploy `npx wrangler deploy`. At cutover add build variables
   `SITE=https://www.ldorvadortravel.com` and `PROD=1`.
   **Dashboard change required (2026-09):** the build command must be
   `npm ci && pip3 install pillow && python3 build.py` — wrangler bundles
   `worker.js` from `node_modules`, so `@cloudflare/puppeteer` (see
   "On-demand PDF" below) has to be installed before `wrangler deploy` runs;
   Pillow lets `build.py` pre-crop the print-page images to exact-size JPEGs
   (`assets/img/print/`) so the on-demand PDF below doesn't rasterize
   full-resolution PNGs for every cropped photo. Update this in
   Workers & Pages -> ldorvador-preview -> Settings -> Build configuration.
2. **Web3Forms** (done) — key baked into build.py; recipient includes
   connect@ (verify with a live test at cutover).
3. **D1 database** `ldorvador-interest` (id `5da26daa-db41-405d-8740-3d15509be27a`,
   bound as `DB` in `wrangler.jsonc`) — stores group trip Expression of
   Interest submissions. Migrations in `site/migrations/`.
4. **Worker secrets** `TURNSTILE_SECRET` and `RESEND_API_KEY` — protect the
   `/api/interest` endpoints. Names only here; see the Secrets section below
   for where each value comes from and how to rotate it.
5. **Cloudflare Access** app "LDV interest export" (team
   `tcstudio.cloudflareaccess.com`) — gates `GET /api/interest/*`. Allowed
   emails: connect@ldorvadortravel.com, erik@tcstudio.io. One-time PIN login.
6. **CloudCannon** (done 2026-08-11) — site `ldorvador-preview` connected to
   the repo in headless mode (cloudcannon.config.yml at repo root; CloudCannon
   edits and commits, Cloudflare builds). Hannah uses a Client Sharing
   password link. Apply to the partner program before the trial ends for the
   $10/mo Lite plan. The leftover TINA_TOKEN build variable in Cloudflare can
   be deleted.

## Cutover, as performed (2026-08-11) — kept for reference

1. Verified 2026-08-10/11 on ldorvador-preview.erik-04a.workers.dev:
   all 20 pages x locales, language switcher, RTL, form round trip, video
   Range (via worker.js), redirects, security headers, CloudCannon
   edit-to-live pipeline (~4 min).
2. **Before touching Squarespace**: from the Squarespace account, export site
   content, download original images, download any form submissions.
   (Public mirror already in `backup-squarespace-2026-08-10/`.)
3. Add the domain zone in Erik's Cloudflare account (serving the apex from
   Workers requires the zone on Cloudflare). Cloudflare auto-imports the
   existing records and assigns two nameservers.
4. Diff the imported zone against
   `backup-squarespace-2026-08-10/dns-records.txt` — the Google Workspace MX
   records and the google-site-verification TXT MUST survive intact.
5. Only after that diff passes: Hannah (or Erik) sets the two Cloudflare
   nameservers in her Squarespace account (account -> Domains ->
   ldorvadortravel.com -> DNS -> Nameservers -> Use custom nameservers).
   Send her the REAL values only, never placeholders.
6. Wait for the new site to serve on the domain (minutes to a few hours).
   Verify mail still flows (send a test to connect@).
7. Flip the build to production (the two build variables above), verify
   canonicals/robots/sitemap on the live domain, submit the sitemap in
   Google Search Console.
8. Only then cancel the Squarespace *site* subscription. Keep the domain
   registration (Squarespace Domains) — it is a separate product.

## Redirects

The old site was a single page; `_redirects` maps `/home` and `/cart` to `/`.

## Open items

- [ ] Testimonials section was REMOVED at launch (the five were fabricated).
      It returns as soon as Hannah supplies real quotes with permission.
- [ ] Bio text edits from the client Google doc
- [ ] Squarespace: exports (content XML + Contacts CSV), then cancel the
      WEBSITE plan only. Domains bill separately - keep auto-renew ON.
- [ ] Google Search Console: submit sitemap.xml (Hannah owns the property)
- [ ] Real example itinerary, or label the sample as illustrative
- [ ] Native-speaker review of the Hebrew locale
- [ ] Privacy policy body translations (page exists, body English-only)
- [ ] Analytics: enable Cloudflare Web Analytics if wanted (free, cookieless)
- [ ] CloudCannon: 20-day trial started 2026-08-11, so it lapses around
      2026-08-31 (confirm the exact date in the dashboard). Before then:
      Erik applies to the partner program, creates a SEPARATE organization
      for L'Dor Vador, moves the site into it, and Hannah adds her own card
      -> $10/mo Lite billed directly to her. If the trial lapses without
      this, the default rate is $49/mo.
- [x] Founder portraits + Beth Haim photo (2026-08-11)
- [x] Web3Forms recipient includes connect@, tested end to end
- [x] .org redirects to .com (apex, www, deep paths)
- [x] Privacy policy page (all four locales, 2026-08-10)
- [x] TC Studio standards pass: JSON-LD, security headers, clean canonicals,
      sitemap with hreflang (2026-08-10)

## How editing works after launch

Hannah opens the CloudCannon Client Sharing link with its password. Every
text on the site is a field in `site/content/*.json`, grouped by page and
section, each field labeled with a preview of its current text. Saving
commits to the repo; Cloudflare rebuilds; live in ~1 minute.

Caveat: the Spanish, Dutch and Hebrew pages are translated from fixed English
strings. When Hannah edits English copy, that string falls back to showing her
new English on the other three pages — deliberate, since a translation of text
that no longer exists would be worse. It is no longer invisible: CI runs
`site/check_translations.py` on every push and opens a "translation-drift"
issue listing exactly which strings need retranslating in `site/locales.py`,
then closes it once they are done.

## Group trip landing pages & Expression of Interest

**What it is.** Each congregation/synagogue group trip gets its own landing
page built from `site/content/groups/<slug>.json` by `build_groups()` in
`build.py` (template `group.body.html`). Output lands at
`/groups/<slug>/`. English only, `noindex`, and deliberately left out of
`sitemap.xml` — these pages are for sharing a direct link with one
congregation, not for search or general site nav. `content/groups/
sample-congregation.json` is the working example CloudCannon and the build
were developed against; before launch either untick its `published` field
(hides it from the built site but keeps the file for reference) or delete
`site/content/groups/sample-congregation.json` outright.

**Creating a page in CloudCannon.** Hannah opens the "Group Trips"
collection, clicks Add, and fills in the fields below; `slug` becomes the
page URL (`/groups/<slug>/`) so it must be lowercase with hyphens only.
Saving commits and rebuilds — live in ~4 minutes, same pipeline as the rest
of the site.

- `slug` — URL name (lowercase, hyphens; becomes `/groups/<name>/`)
- `title` / `subtitle` — page headline / subtitle
- `congregation`, `leader` — e.g. "Rabbi …"
- `dates`, `duration`, `group_size`, `start_finish`, `pace`, `accommodation`,
  `price_note` — trip-facts row
- `hero_image` — top banner photo
- `intro`, `highlights`, `included`, `not_included` — highlights/included/
  not_included are one item per line
- `vignettes` / `itinerary` — repeating editorial blocks and day-by-day plan
- `gallery` — photo gallery
- `form_intro`, `notify_note` — text shown around the inquiry form
- `pdf` — optional trip-details PDF path; blank hides the download button
- `published` — untick to hide the page from the built site without deleting it

**Registration flow.** The page's form posts to `POST /api/interest` in
`worker.js`. On success the Worker: verifies the Turnstile token server-side,
rejects if the hidden `botcheck` honeypot field is filled, writes one row to
the D1 `interest` table (via a migration-managed schema in
`site/migrations/`), then sends two emails through Resend — a confirmation to
the registrant from `connect@ldorvadortravel.com`, and an internal
notification to `NOTIFY_TO` (default `connect@ldorvadortravel.com,
erik@tcstudio.io`). Anti-abuse limits, all enforced in `worker.js`:
5 submissions/hour per IP, a per-email+group dedupe window of 24h (repeat
returns success silently, no duplicate row), a cap of 200 rows/group/day, and
a global cap of 150 emailed submissions/day. Once a cap is hit the row is
still written to D1 (nothing is lost) but no confirmation/notification email
is sent for it — check D1 directly to see submissions that landed silently.

**Exporting registrations.** Go to
`https://www.ldorvadortravel.com/api/interest/<slug>.csv` (or `.json`, or
`/api/interest/` for the per-group summary). Cloudflare Access intercepts the
request and asks for a one-time PIN sent to an allowed email
(connect@ldorvadortravel.com or erik@tcstudio.io); enter the code and the
file downloads/loads. To add or remove allowed emails: Cloudflare Zero Trust
dashboard -> Access -> Applications -> "LDV interest export" -> edit the
policy's email list. To change who gets the internal notification email,
edit the `NOTIFY_TO` value under `vars` in `wrangler.jsonc` (comma-separated
addresses) and redeploy.

**On-demand PDF.** `GET /groups/<slug>/trip-details.pdf` (worker.js) renders
the trip brochure on request via Browser Rendering (`@cloudflare/puppeteer`,
binding `BROWSER`) — no `make_pdf.py` run or commit needed for a CMS-created
trip. Result is cached in KV (`PDF_CACHE`) under `<slug>:<etag>`, where
`<etag>` is print.html's own ETag, so editing a trip invalidates the cache
automatically. Free plan: 10 browser-minutes/day, 3 concurrent, 60s timeout —
if a render fails or the daily limit is hit, the worker serves any older
cached PDF for that slug instead of erroring. A group's `pdf` field (in its
`content/groups/<slug>.json`) still overrides this with a hand-made file path
when set; `make_pdf.py` remains as a documented local fallback for that case.
Because Browser Rendering has no post-process step to dedupe or shrink the
PDF it returns, `print.html`'s images must already be small: `build.py`
pre-crops every print photo to the exact pixel size of its CSS box (see
`print_image()`) and writes JPEGs to `assets/img/print/`, and `print.html`
references those with no `object-fit`/clipping, so Chrome embeds the JPEG
bytes as-is instead of rasterizing a full-resolution PNG per cropped photo.

**Secrets** (names only — never values here):

- `TURNSTILE_SECRET` — from the Cloudflare Turnstile dashboard for the
  widget's site key baked into `build.py` (that site key is public by
  design). Rotate by generating a new secret key in the Turnstile dashboard
  for the same widget, then push it to the Worker.
- `RESEND_API_KEY` — from Resend, under the `ldorvadortravel.com` domain
  verified in erik@tcstudio.io's Resend account. Rotate by creating a new key
  in Resend, then pushing it to the Worker and revoking the old key.
- To push either secret: `npx wrangler versions secret put NAME` if there are
  undeployed Worker versions, otherwise `npx wrangler secret put NAME`.

- `STRIPE_SECRET_KEY` — Stripe **restricted** key (Developers -> API keys ->
  Create restricted key). Permissions: Checkout Sessions **Write**, Payment
  Links **Write**, Prices **Write**, Products **Write**; everything else None.
- `STRIPE_WEBHOOK_SECRET` — the endpoint's signing secret (`whsec_...`) from
  Developers -> Webhooks -> the endpoint below -> Signing secret.
- `BOOKING_TOKEN_SECRET` — any long random string (e.g. `openssl rand -base64 48`);
  signs the traveler-details links. Rotating it invalidates links already emailed.
- Push: `npx wrangler versions secret put STRIPE_SECRET_KEY`,
  `npx wrangler versions secret put STRIPE_WEBHOOK_SECRET`,
  `npx wrangler versions secret put BOOKING_TOKEN_SECRET`
  (or `npx wrangler secret put NAME` when there are no undeployed versions).

**Local testing.** `.dev.vars` (gitignored) holds local values for
`WEB3FORMS_KEY`, `TURNSTILE_SECRET`, `RESEND_API_KEY`, `ACCESS_TEAM_DOMAIN`,
`ACCESS_AUD`. `TURNSTILE_SECRET=1x0000000000000000000000000000000AA` is
Cloudflare's always-pass test secret key (paired with the always-pass test
site key), so local form submissions succeed captcha without hitting the
real Turnstile service. `RESEND_API_KEY` must be left as an invalid
placeholder (e.g. `re_test_invalid`) locally — a real key would actually
send email from the dev environment. Apply the D1 schema locally with
`npx wrangler d1 migrations apply ldorvador-interest --local` before testing
form submissions against the local Worker.

**Querying D1 directly.** For a quick look without waiting on the export
endpoint:

```
npx wrangler d1 execute ldorvador-interest --remote --json --command \
  "SELECT created_at, group_slug, full_name, email FROM interest ORDER BY created_at DESC LIMIT 20"
```

## Bookings & payments (Stripe)

Code: `bookings.js` (exported interface documented at its top), `shared.js`
(helpers shared with `worker.js`), routes in `worker.js`. Schema:
`migrations/0004_bookings.sql` (tables `bookings`, `booking_seq`,
`stripe_events`, `rate_events`). Apply in production with either

```
npx wrangler d1 migrations apply ldorvador-interest --remote
# or, one-off:
npx wrangler d1 execute ldorvador-interest --remote --file=migrations/0004_bookings.sql
```

**Endpoints.** `POST /api/book` (reserve form -> D1 row `pending` with
reference `<trip_ref>-0001`, then a Stripe Checkout Session for the deposit);
`GET|POST /api/details` (traveler details, token-protected link from the
confirmation email); `POST /api/stripe/webhook` (Stripe only, signature
verified). `/admin*` and `/api/admin*` require a valid Cloudflare Access JWT
(401 otherwise) and are handled by `admin.js`. Add `/admin*` and
`/api/admin*` to the Access application's paths.

**Stripe dashboard setup (Erik):**
1. Settings -> Payment methods: enable Cards and ACH Direct Debit (US bank account).
2. Create the restricted key above; push as `STRIPE_SECRET_KEY`.
3. Developers -> Webhooks -> Add endpoint
   `https://www.ldorvadortravel.com/api/stripe/webhook`, events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `payment_intent.succeeded`.
   Push its signing secret as `STRIPE_WEBHOOK_SECRET`.
4. Push `BOOKING_TOKEN_SECRET`.
5. Test end to end in test mode first (test key + test webhook secret).

**trip.json** (emitted by the build at `/groups/<slug>/trip.json`) must carry
`trip_ref`, `bookings_open`, `deposit_amount`, `price_package`,
`price_single_supplement`, `optionals`, plus `arrival_date` / `departure_date`
(ISO, for the rooming list) and optionally `extension_price_per_night`.

**Local testing of bookings.** Add to `.dev.vars` DUMMY values for
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BOOKING_TOKEN_SECRET`, and
`TURNSTILE_SKIP=1`. `TURNSTILE_SKIP` is honoured only when it equals `1` AND
the request host is localhost/127.0.0.1 — never set it in production. Because
the assets directory is `.`, keep the local D1 state outside it or wrangler
reloads in a loop:
`npx wrangler d1 migrations apply ldorvador-interest --local --persist-to /tmp/ldv-state`
then `npx wrangler dev --local --persist-to /tmp/ldv-state`.

<!-- build settings last updated 2026-09-05: build command "cd site 2>/dev/null || true; npm ci && pip3 install pillow && python3 build.py" (root-agnostic), root directory "site" -->

## Booking system

**Files.** `build.py` (emits `/groups/<slug>/trip.json`; `reserve/`, `reserved/`, `details/` only while `bookings_open` is true and `trip_ref` is set, and removes them when closed; builds `terms.html`), templates `reserve.body.html`, `reserved.body.html`, `details.body.html`, `terms.body.html`, `css.tmpl`, `js.tmpl`; content `content/terms.json` and the trip booking fields; `gen_cloudcannon.py` (CloudCannon fields); Worker `worker.js` (routing), `shared.js` (helpers), `bookings.js` (API, Stripe, emails), `admin.js` (admin pages and exports); `migrations/0004_bookings.sql`.

**Routes.** Public: `POST /api/book`, `GET|POST /api/details`, `POST /api/stripe/webhook`. Behind Cloudflare Access (401 otherwise): `/admin/`, `/admin/<slug>[/<ref>[/balance]]`, `/api/admin/...` incl. `/api/admin/<slug>/export.csv` and `rooming.csv`.

**Tables.** `bookings`, `booking_seq`, `stripe_events` (webhook idempotency), `rate_events` (details rate limit). `/api/book` rate limit is 5 per hour per IP hash, counted from `bookings`.

**Env.** Secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BOOKING_TOKEN_SECRET` (plus existing `RESEND_API_KEY`, `TURNSTILE_SECRET`); local-only `TURNSTILE_SKIP=1`. Operator docs: `BOOKINGS-HANNAH.md`, `BOOKINGS-STRIPE-SETUP.md`.

**Regression commands** (run with `bookings_open` true on a trip, then false):

```
python3 build.py && python3 smoke_test.py && python3 full_test.py
grep -rl '__[A-Z_]*__' groups terms.html     # must print nothing
npx wrangler d1 migrations apply ldorvador-interest --local --persist-to /tmp/ldv-state
npx wrangler dev --local --persist-to /tmp/ldv-state   # then curl /api/book, signed /api/stripe/webhook, /api/details, /admin/ (401)
```


## Staging (staging.ldorvadortravel.com)

A separate Worker (`ldorvador-staging`) with its own D1 and Access app, built
from the same content with every trip's bookings forced open and robots
noindex. Stripe stays in TEST mode on staging.

One-time setup (Erik):
1. `npx wrangler d1 create ldorvador-staging` → paste the id into
   wrangler.jsonc `env.staging.d1_databases[0].database_id`.
2. `npx wrangler d1 execute ldorvador-staging --remote --file=migrations/0001_interest.sql`
   (whichever files exist in migrations/, in order, including 0004_bookings.sql).
3. Cloudflare Zero Trust → Access → Applications → add a self-hosted app for
   `staging.ldorvadortravel.com` paths `/admin`, `/api/admin`, `/api/interest`
   with the same one-time-PIN policy (connect@, erik@, plus Hannah/Cornelis
   if they review admin). Copy its Application Audience tag into
   `env.staging.vars.ACCESS_AUD`.
4. Turnstile → the site's widget → add hostname `staging.ldorvadortravel.com`.
5. Stripe TEST mode: restricted key + a webhook on
   `https://staging.ldorvadortravel.com/api/stripe/webhook` (same four events).
6. Secrets for staging: `npx wrangler secret put NAME --env staging` for
   TURNSTILE_SECRET, RESEND_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
   BOOKING_TOKEN_SECRET.

Scripts: `CLOUDFLARE_API_TOKEN=... ./staging-setup.sh` automates steps 1-4 plus
the first staging deploy (creates D1 and applies migrations, creates the Access
app with a "Reviewers" one-time-PIN policy from `STAGING_REVIEWERS`, adds the
staging hostname to the Turnstile widget, writes the D1 id and Access aud into
wrangler.jsonc, deploys, then rebuilds production assets). It is idempotent.
`./staging-secrets.sh` (run in your own terminal) prompts silently for the
secrets in step 6 and generates BOOKING_TOKEN_SECRET; `--prod` targets
production after a confirmation. Neither script stores any secret.

Deploy staging (from site/):
    PROD=0 SITE=https://staging.ldorvadortravel.com LDV_BOOKINGS_FORCE_OPEN=1 python3 build.py && npx wrangler deploy --env staging
Then rebuild production normally before any production deploy
(`python3 build.py`), or let the Cloudflare git build do it on push.
