# Squarespace backup — ldorvadortravel.com

Captured 2026-08-10, before any migration work.

## What's here

| Path | Contents |
|---|---|
| `pages/home.html` | The live homepage, full rendered HTML (355 KB) |
| `assets/` | All 47 CDN assets referenced by the page, pulled at `?format=2500w` (largest available). Content images plus the webfonts. |
| `img-urls.txt` | Source CDN URL for each asset, in download order |
| `asset-urls.txt` | Every Squarespace URL referenced by the page (116) |
| `dns-records.txt` | Full DNS snapshot: NS, A, MX, TXT, CAA, SOA, www |
| `sitemap.xml` | Squarespace-generated sitemap |
| `robots.txt` | Current robots directives |

## Site inventory

The live site is **a single page**. The sitemap lists exactly one URL (`/home`,
served at `/`); the only other route is Squarespace's boilerplate `/cart`.
Redirect planning is therefore trivial: everything folds to `/`.

## DNS facts that matter for the cutover

- **Registrar is Squarespace Domains LLC.** The domain registration is a separate
  product from the site subscription. Cancelling the site does not cancel the
  domain, but do not let the domain lapse or get swept up in a cancellation.
- **Nameservers are Google Cloud DNS** (`ns-cloud-c*.googledomains.com`).
- **Email is Google Workspace**, not Squarespace (MX → `aspmx.l.google.com`).
  Mail survives the move as long as the MX records are carried over verbatim.
- `A` → `198.185.159.145`, `www` → CNAME `ext-sq.squarespace.com` (Squarespace).
  These are the only two records that change at cutover.
- One TXT record: a Google site-verification token. Preserve it.

## NOT captured — needs an account login

This is a public-facing mirror only. Before cancelling the Squarespace
subscription, someone with the login must also export:

1. **Squarespace content export** — Settings → Import/Export → Export (`.wsp`/XML).
   The only portable form of the page structure.
2. **Original image files** at upload resolution, from the Squarespace asset
   manager. The CDN copies here are capped at 2500w and re-encoded.
3. **Form submissions / contact list**, if any form has been collecting.
4. **Billing and domain records**, including the domain auth code if the domain
   is ever transferred off Squarespace.
