# Launch runbook — ldorvadortravel.com on Cloudflare Workers + CloudCannon

## Cost change for the client

| | Before | After |
|---|---|---|
| Squarespace website plan | $220/yr | cancelled |
| Hosting + forms (Cloudflare, Web3Forms) | — | $0 |
| CMS (CloudCannon Lite, partner) | — | $120/yr, TC Studio |
| Domain (Squarespace Domains) | $12/yr | $12/yr |
| **Total** | **$232/yr** | **$12/yr to Hannah** |

The `site/` folder is the full source. `python3 build.py` builds the site into
`site/` itself; `SITE=https://www.ldorvadortravel.com PROD=1 WEB3FORMS_KEY=…`
builds the production version (real canonical/hreflang/OG URLs, no noindex,
robots.txt + sitemap.xml, live form key).

## Accounts Erik needs to create (one-time, ~20 min)

1. **Cloudflare** (done) — Workers project `ldorvador-preview`, git-connected.
   Root directory `site`, build command `python3 build.py`, deploy
   `npx wrangler deploy`. At cutover add build variables
   `SITE=https://www.ldorvadortravel.com` and `PROD=1`.
2. **Web3Forms** (done) — key baked into build.py; recipient includes
   connect@ (verify with a live test at cutover).
3. **CloudCannon** (done 2026-08-11) — site `ldorvador-preview` connected to
   the repo in headless mode (cloudcannon.config.yml at repo root; CloudCannon
   edits and commits, Cloudflare builds). Hannah uses a Client Sharing
   password link. Apply to the partner program before the trial ends for the
   $10/mo Lite plan. The leftover TINA_TOKEN build variable in Cloudflare can
   be deleted.

## Cutover order (do not reorder)

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

## Still open before launch

- [ ] Form submissions currently deliver to erik@tcstudio.io (the Web3Forms
      key was created under that address; end-to-end tested 2026-08-10).
      Before cutover: repoint the recipient to connect@ldorvadortravel.com in
      the Web3Forms account, or issue a new key under that address and swap
      the default in site/build.py.

- [ ] GATE - DO NOT LAUNCH PAST THIS: the five testimonials are fabricated
      (invented names incl. a rabbi and congregation). Fine on the noindex
      preview only. At cutover: real quotes in, or the section comes out
      (a ten-minute removal, reversible when real ones arrive).
- [ ] Real example itinerary, or label the sample as illustrative
- [ ] Native-speaker review of the Hebrew locale
- [ ] Privacy policy body translations (page exists, body English-only)
- [ ] Analytics: enable Cloudflare Web Analytics if wanted (free, cookieless)
- [ ] CloudCannon partner program application (for the $10/mo Lite price)
- [x] Photo of Cornelis (live on About, 2026-08-10)
- [x] Privacy policy page (all four locales, 2026-08-10)
- [x] TC Studio standards pass: JSON-LD, security headers, clean canonicals,
      sitemap with hreflang (2026-08-10)

## How editing works after launch

Hannah opens the CloudCannon Client Sharing link with its password. Every
text on the site is a field in `site/content/*.json`, grouped by page and
section, each field labeled with a preview of its current text. Saving
commits to the repo; Cloudflare rebuilds; live in ~1 minute.

Caveat: the Spanish, Dutch and Hebrew pages are translated from fixed English
strings. When Hannah edits English copy, the other languages show her new
English for that string until the translation tables (`site/locales.py`) are
updated — the build does this on purpose rather than showing a stale
translation of text that no longer exists.
