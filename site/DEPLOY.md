# Launch runbook — ldorvadortravel.com on Cloudflare Pages + TinaCMS

## Cost change for the client

| | Before | After |
|---|---|---|
| Squarespace website plan | $220/yr | cancelled |
| Hosting + CMS + forms (Cloudflare Pages, TinaCloud, Web3Forms) | — | $0 |
| Domain (Squarespace Domains) | $12/yr | $12/yr |
| **Total** | **$232/yr** | **$12/yr** |

The `site/` folder is the full source. `python3 build.py` builds the site into
`site/` itself; `SITE=https://www.ldorvadortravel.com PROD=1 WEB3FORMS_KEY=…`
builds the production version (real canonical/hreflang/OG URLs, no noindex,
robots.txt + sitemap.xml, live form key).

## Accounts Erik needs to create (one-time, ~20 min)

1. **Cloudflare** (free) — cloudflare.com. Pages project connected to the
   production GitHub repo. Build command:
   `python3 site/build.py` · output directory: `site` · env vars:
   `SITE=https://www.ldorvadortravel.com`, `PROD=1`, `WEB3FORMS_KEY=<key>`.
2. **Web3Forms** (free) — web3forms.com. Enter connect@ldorvadortravel.com,
   they email an access key. That key becomes `WEB3FORMS_KEY`.
3. **TinaCloud** (free tier, 2 users) — app.tina.io. Create a project against
   the repo; copy the Client ID and a read/write token into Cloudflare Pages
   env vars `TINA_CLIENT_ID` / `TINA_TOKEN`. Invite Hannah by email.

## TinaCloud gotcha (cost us an afternoon)

If builds fail with 403 "not authorized to access branch" or "Branch 'main'
is not on TinaCloud": the branch was never indexed. Auto-indexing after
project creation is unreliable. Fix: TinaCloud project -> Configuration ->
Branches -> menu next to main -> Reindex. Test locally with
`TINA_TOKEN=... npx tinacms build` before blaming tokens or client IDs.
Also: the TINA_TOKEN goes in Cloudflare's BUILD variables (Settings ->
Build), not the Worker's runtime variables.

## Cutover order (do not reorder)

1. Deploy to Cloudflare Pages, verify on the temporary `*.pages.dev` URL:
   all 16 pages, the language switcher, the contact form (a real test
   submission arriving at connect@), video playback (Pages serves Range
   requests), mobile menu.
2. **Before touching Squarespace**: from the Squarespace account, export site
   content, download original images, download any form submissions.
   (Public mirror already in `backup-squarespace-2026-08-10/`.)
3. Add the custom domain in Cloudflare Pages (www + apex). Cloudflare will
   say which DNS records it wants.
4. In the DNS (Google Cloud DNS via the Squarespace domain panel), change ONLY:
   - `A @ 198.185.159.145` → what Cloudflare Pages specifies
   - `CNAME www ext-sq.squarespace.com` → what Cloudflare Pages specifies
   **Do not touch** the MX records (Google Workspace mail) or the
   google-site-verification TXT. Full pre-change snapshot:
   `backup-squarespace-2026-08-10/dns-records.txt`.
5. Wait for the new site to serve on the domain (minutes to a few hours).
   Verify mail still flows (send a test to connect@).
6. Only then cancel the Squarespace *site* subscription. Keep the domain
   registration (Squarespace Domains) — it is a separate product.

## Redirects

The old site was a single page; `_redirects` maps `/home` and `/cart` to `/`.

## Still open before launch

- [ ] Form submissions currently deliver to erik@tcstudio.io (the Web3Forms
      key was created under that address; end-to-end tested 2026-08-10).
      Before cutover: repoint the recipient to connect@ldorvadortravel.com in
      the Web3Forms account, or issue a new key under that address and swap
      the default in site/build.py.

- [ ] Real testimonials, or the section comes out (currently fabricated)
- [ ] Real example itinerary, or label the sample as illustrative
- [ ] Photo of Cornelis (About page has an initials placeholder)
- [ ] Native-speaker review of the Hebrew locale
- [ ] Privacy policy page (the form collects personal data)
- [ ] Analytics decision (recommend Cloudflare Web Analytics: free, no cookies,
      no consent banner needed)
- [ ] TC Studio standards pass (SEO/perf/a11y) on the production build
- [ ] Production canonical for the homepage should be `/` not `/index.html`

## How editing works after launch

Hannah signs in at the TinaCloud-hosted admin with email + password. Every
text on the site is a field in `site/content/*.json`, grouped by page and
section, each field labeled with a preview of its current text. Saving
commits to the repo; Cloudflare rebuilds; live in ~1 minute.

Caveat: the Spanish, Dutch and Hebrew pages are translated from fixed English
strings. When Hannah edits English copy, the other languages show her new
English for that string until the translation tables (`site/locales.py`) are
updated — the build does this on purpose rather than showing a stale
translation of text that no longer exists.
