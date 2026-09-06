# L'Dor Vador — Brand Guide

Extracted from the live site (`css.tmpl`, `header.frag.html`, `footer.frag.html`, `home.body.html`, `content/header.json`, `fonts_embedded.css`, `fonts_extra.css`). No invented values — every hex/size below is grep-able in `css.tmpl`.

## Logo lockup

The logo is set in text, never an image. Markup (from `header.frag.html`):

```html
<a class="brand" href="index.html" aria-label="L'Dor Vador, Heritage Travel, home">
  <span class="brand-stack">
    <span class="brand-word">L'Dor</span><span class="brand-word">Vador</span>
  </span>
  <span class="brand-tx">Heritage Travel</span>
</a>
```

**Stacked form** (top of page, hero over photo): `.brand{--logo:85px}` right-aligned column; each `.brand-word` is `font-family:var(--display)` = `'Cormorant Garamond','Fraunces',Georgia,serif`, `font-weight:600`, `line-height:.9`, `letter-spacing:.004em`, size `var(--logo)`. "HERITAGE TRAVEL" (`.brand-tx`) sits below, right-aligned: `font-family:var(--tagline)` = `'Century Gothic','Questrial','Futura','Trebuchet MS','Hanken Grotesk',sans-serif`, `font-weight:400`, `font-size:calc(var(--logo)/8.5)` (~10px at 85px logo), `letter-spacing:.14em`, uppercase, `line-height:1.2`, `margin-top:calc(var(--logo)*.1)`.

**Compact/scrolled form** (`header.logo-min`/`header.header-solid`): single row, `--logo:40px`, `flex-direction:row;align-items:center;gap:14px`. Name stack stays stacked at half height; tagline becomes `font-size:calc(var(--logo)*.5)` (20px), `letter-spacing:.1em`, `padding-left:15px`, `border-left:1px solid currentColor` (the hairline divider between name and tagline), `opacity:.85`.

Responsive steps: 1400px → `--logo:38px`; 1200px → `--logo:32px`, gap 11px; mobile (≤980px, header solid state) → `--logo:28px`, gap 10px, tagline `letter-spacing:.08em`.

**Colour / on-photo vs on-light**: default `.brand-word{color:#fff}` with `text-shadow:0 1px 10px rgba(0,0,0,.28)` for legibility over the hero photo. Once scrolled or on a solid header, `header.scrolled .brand-word,.header-solid .brand-word{color:var(--green-d);text-shadow:none}` — i.e. on light ground the wordmark is plain ink (`#282819`), no shadow. Footer wordmark (`.foot-brand`): `--logo:60px`, stacked, `.brand-word{color:#fff}`, `.brand-tx{color:#c3c8b0}` (footer's muted body colour) — used because the footer band is always dark.

**Minimum size**: do not run the logo below the mobile `--logo:28px` step (name) / tagline 14px-equivalent — below that the tagline's `.5em` scale and letter-spacing start colliding with the hairline rule.

**Clear space**: treat the tagline's `margin-top:calc(var(--logo)*.1)` (stacked) or `padding-left:15px` (compact) as the minimum clear space unit; keep at least that much air around the lockup on any new placement.

## Colour

| Token | Hex | Role | Where on homepage |
|---|---|---|---|
| `--cream` | `#fff9f3` | Page/paper ground | `--paper`, body background, card fields |
| `--white` | `#fffdfa` | Secondary light ground | aliased as `--stone`... actually `--stone:var(--cream)`; `--white` used for raw white accents |
| `--green-d`/`--ink` | `#282819` | Primary text ink, solid button fill | body copy, `.btn-solid` background, headings on light |
| `--olive`/`--ink-soft` | `#555a45` | Secondary/soft text | lede, paragraph body on light sections, field labels |
| `--sage` | `#7d9065` | Accent, links, eyebrow ink, step numerals | `.tlink`, `.step h3::before`, `--gold-ink` alias |
| `--camel` | `#ba9a76` | Warm accent / yellow button fill | `.btn-yellow` background |
| `--sand` | `#e4c39c` | Light accent on dark grounds | `.eyebrow.light`, `.namesec .eyebrow` variants, tagline-on-dark tints |
| `--slate` | `#8fa49b` | Muted cool accent (legacy alias slot) | reserved accent, low-frequency use |
| `--line` | `#ebe1d1` | Hairline / border colour | `.step` top border, `.field input` border, `.group-card`/`.group-form-card` border |
| `--footer` (`var(--navy)` → same as `--ink` `#282819`) | `#282819` | Footer & name-band background | `footer{background:var(--footer)}`, `.namesec` |

Footer body/link colour on that dark ground: `#c3c8b0` (muted sage-grey), headings `#fff`, hover `#fff`.

**AA contrast pairs (body text size, verified by hex distance to WCAG thresholds):**
- `--ink #282819` on `--cream #fff9f3` — very high contrast (~14:1), passes AA/AAA for body and headings.
- `--ink-soft #555a45` on `--cream #fff9f3` — passes AA for normal text (~7:1).
- `#fff` on `--footer #282819` — passes AA/AAA (~14:1).
- `#c3c8b0` on `--footer #282819` — passes AA for normal text (~7.5:1); this is the footer's link/body colour by design.
- `--sage #7d9065` on `--cream` — borderline for small text (~3.3:1); site only uses it at 700-weight/uppercase eyebrow sizes (12.5px bold) or as a link with underline, not as body paragraph colour. Do not set body-size paragraphs in `--sage` on cream.
- `--camel #ba9a76` as a button fill always pairs with dark `--green-d` text on top (`.btn-yellow{color:var(--green-d)}`), not white — follow that pairing, not white-on-camel.

## Typography

Fonts actually embedded (`fonts_embedded.css` / `fonts_extra.css`), weights present:

- **Cormorant Garamond** (extra) — 500 normal, 600 normal, 500 italic. This is the primary `--display` face (logo, all headings) — `--display:'Cormorant Garamond','Fraunces',Georgia,serif`.
- **Fraunces** (embedded) — 400, 600, 900 normal; 500 italic. Used as the `--display` fallback and as `--serif:'Fraunces',Georgia,'Times New Roman',serif` for italic pull-quotes (`.serif-i`, `.over-quote`, `.say`).
- **Hanken Grotesk** (embedded) — 400, 500, 700. This is `--body:'Hanken Grotesk',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif` — all running copy, buttons, eyebrows, nav, form labels.
- **Century Gothic / Questrial / Futura / Trebuchet MS / Hanken Grotesk** — `--tagline` stack for "HERITAGE TRAVEL" only (system/web-safe cascade, not a custom embed beyond the Hanken Grotesk fallback).
- **Frank Ruhl Libre** (embedded) — 500, 800 normal. `--heb:'Frank Ruhl Libre','Iowan Old Style',serif` for Hebrew display type (intro sequence, Hebrew hero heading).
- **Syne** (embedded, 600/700/800) — present in the font file but not referenced by any current selector in `css.tmpl`; not part of the active brand type system.

Roles and actual homepage sizes (from `css.tmpl`):

| Use | Family | Weight | Size (clamp) | Line-height | Letter-spacing |
|---|---|---|---|---|---|
| Hero H1 | `--display` | 600 | `clamp(40px,5.6vw,82px)` | 1.02 | 0 |
| Section H2 (largest, `.journeys h2`) | `--display` | 600 (h1/h2/h3 default) | `clamp(34px,5vw,66px)` | 1.03 (global h1/h2/h3 rule) | -.005em |
| Section H2 (typical, `.contact h2`/`.bio-copy h2`) | `--display` | 600 | `clamp(28–30px, ~3.8vw, 48–56px)` | 1.03 | -.005em |
| Lede | `--body` (inherits) | 400 | `21px` (`.lede`) | 1.62 | normal |
| Body copy | `--body` (Hanken Grotesk) | 400 | `18px` (site default on `body`) | 1.6 | normal |
| Eyebrow | `--body` | 700 | `12.5px` | default | `.26em`, uppercase |
| Footer h4 (small caps label) | `--body` | 700 (inherits `h4`) | `11.5px` | default | `.18em`, uppercase |
| Button label | `--body` | 700 | `12.5px` | — | `.2em`, uppercase |
| Text link (`.tlink`) | `--body` | 700 | `12.5px` | — | `.2em`, uppercase |
| Italic pull-quote (`.serif-i`, `.say`) | `--serif` (Fraunces) | 400, italic | `clamp(24px,3vw,42px)` (`.say`) | 1.16 | normal |

## Components

- **Eyebrow**: `.eyebrow{font-family:var(--body);text-transform:uppercase;letter-spacing:.26em;font-size:12.5px;font-weight:700;color:var(--gold-ink)}` (`--gold-ink` = `--sage`). On dark grounds use `.eyebrow.light{color:var(--sand)}`.
- **Primary button** (`.btn.btn-solid`): `min-height:56px;padding:0 34px;font-family:var(--body);font-size:12.5px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;border:1.5px solid transparent;border-radius:0;background:var(--blue)` (i.e. `--ink #282819`) `;color:#fff`, hover fill `var(--blue-2)` (`#3d4a30`).
- **Secondary/warm button** (`.btn-yellow`): fill `var(--camel)`, text `var(--green-d)`, subtle drop shadow, hover fill `var(--sand)`.
- **Outline/ghost button** (`.btn-line`): transparent fill, `border-color:currentColor`, `color:inherit`; hover inverts to `background:currentColor`. On-photo variant: `color:#fff;border-color:#fff;background:rgba(255,255,255,.08)`, hover → white fill with ink text.
- **Text link** (`.tlink`): no button chrome — bold uppercase `--sage` text with a `1.5px solid var(--sage)` underline; hover darkens border to `--green-d`. `.light` variant for dark grounds.
- **Hairline dividers**: `--line:#ebe1d1`, 1px (or 1.5px for form borders), used under step numerals, around cards/fields, and as the compact-header logo/tagline divider (`border-left:1px solid currentColor`).
- **Cards** (`.group-card`, `.group-form-card`): `background:var(--cream);border:1px solid var(--line);border-radius:2px`. This `2px` radius is the one non-zero radius in the system — used only on card/tile/photo containers (`.group-card`, `.group-form-card`, `.gtile`, `.gday-body img`), never on buttons or form fields (`border-radius:0`).
- **Form fields** (`.field input/select/textarea`): `background:#fff;border:1.5px solid var(--line);padding:15px;font-size:17px;font-family:var(--body);color:var(--ink);min-height:54px;border-radius:0`; focus state drops the outline and sets `border-color:var(--blue)`. Labels: bold 11.5px uppercase, `.14em` tracking, `--ink-soft`.
- **Footer band**: `footer{background:var(--footer);color:#c3c8b0}`, headings `#fff` uppercase 11.5px/.18em, links `#c3c8b0` → `#fff` on hover, stacked wordmark at `--logo:60px`.

## Layout & rhythm

- Content gutter: `.wrap{padding:0 clamp(24px,5.5vw,110px)}`; narrow variant caps at `max-width:1100px`.
- Section max width driven by the `--wrap:1220px` token where a hard cap is used.
- Vertical section rhythm runs in bands: tight `clamp(56px,8vh,110px)` (`.steps-sec`, `.voices`), medium `clamp(80px,11vh,140px)` (`.journeys`, `.discover-detail`), and a large statement band `clamp(100px,16vh,200px)` (`.stmtline`).
- Image/card radius: `0` everywhere except photo/card containers, which get `border-radius:2px` (see Components).
- Fixed header height token `--hdr:108px` (74px on the ≤820px breakpoint).

## Photography & tone

Homepage imagery is location photography (Curaçao heritage sites, group/family travel moments) full-bleed in hero and split panels — not stock-styled. Every photo panel carries a directional scrim so type stays legible over the image rather than behind a flat box: the hero uses a two-layer gradient (`linear-gradient(105deg, rgba(6,12,26,.6)…)` plus a vertical `linear-gradient(180deg, rgba(6,12,26,.26)…)`); `.imgpanel`, `.jcard .teaser`, `.split-media`, and `.door` each use their own bottom-weighted `rgba(0,0,0,…)`/`rgba(6,14,10,…)` gradient so captions sit on a dark-to-transparent fade rather than a solid bar. Photo containers get the system's one radius, `2px`; buttons and fields stay square.

## Voice

Copy throughout (nav, eyebrows, CTAs — "Inquire about a Trip", "Our origin story", "How we plan your journey") is warm, unhurried, and personal rather than promotional: short declarative labels, first-person framing of heritage and family ("L'Dor Vador" — generation to generation), and calls to action phrased as an invitation to a conversation ("Inquire," "Contact") rather than a transaction ("Book now").

---

## APPLICATION — Email

- **Header**: light, matching the site's compact/scrolled header exactly — cream ground (`#fff9f3`), ink lockup (`#282819`, not white/shadowed), single-row compact form: stacked "L'Dor / Vador" at reduced size + hairline (`1px solid #ebe1d1` or `currentColor`) + "HERITAGE TRAVEL" tagline, uppercase, `.1em` tracking.
- **Body**: cream (`#fff9f3`) or white (`#fffdfa`) background, ink (`#282819`) body text, `--ink-soft` (`#555a45`) for secondary copy.
- **Footer band**: dark, `--footer` (`#282819`), stacked wordmark in cream/white, footer links in `#c3c8b0`, matching the site footer.
- **Button**: primary button styling — solid `#282819` fill, white uppercase bold label, `.2em` tracking, square corners (email clients: use a table/anchor with `border-radius:0`).
- **Email-safe font stacks**:
  - Display/headings: `'Cormorant Garamond','Fraunces',Georgia,serif` (fallback to Georgia in clients without web-font support).
  - Body: `'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`.
  - Tagline/small-caps: same as body stack, uppercase + letter-spacing via CSS since most clients lack Century Gothic/Futura.

## APPLICATION — Print / PDF

- **Page margins**: 0.75in (54pt) top/bottom, 0.6in (43pt) left/right — matches the site's gutter proportion (`clamp(24px,5.5vw,110px)` scaled down for a fixed page).
- **Cover**: cream ground, stacked logo lockup in the full (non-compact) form — "L'Dor / Vador" display serif 600 at ~48–60pt, "HERITAGE TRAVEL" tagline at ~10pt/.14em beneath, ink colour (not white — no photo scrim on a plain cream cover) unless the cover uses a full-bleed photo, in which case use the on-photo cream/white lockup with the site's text-shadow treatment.
- **Running header**: compact single-row lockup at ~14–16pt name size, hairline + 7–8pt tagline, right- or left-aligned per page grid.
- **Type sizes in pt** (96 CSS px ≈ 1in = 72pt, so px→pt ≈ ×0.75): H1 cover ≈ 42–54pt (site 40–82px), H2 section ≈ 21–36pt (site 28–56px), body ≈ 12–13pt (site 18px w/ 1.6 leading → ~11–12pt at print density is acceptable), eyebrow/labels ≈ 9pt bold uppercase (site 12.5px), footer/fine print ≈ 8–9pt.
