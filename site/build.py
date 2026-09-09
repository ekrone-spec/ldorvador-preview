#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the site in English (root) plus /es/, /nl/ and /he/.

Hand-built localisation: one set of source templates, translated at build time
from locales/<code>.json. Each locale gets its own folder of real HTML pages,
its own <html lang>/dir, hreflang tags, and a language switcher wired to the
matching page in every other locale.
"""
import os, re, json, base64, mimetypes, logging
import i18n

D = os.path.dirname(os.path.abspath(__file__))
def R(p): return open(os.path.join(D, p), encoding='utf-8').read()

_print_display_face_cache = None
def _print_display_face():
    """The site's display serif (Fraunces, weight 600), inlined for print.html
    so headless Chrome embeds the real face in the PDF instead of falling
    back to a generic serif. Just one weight/style is pulled out of
    fonts_embedded.css to keep the PDF small."""
    global _print_display_face_cache
    if _print_display_face_cache is None:
        css = R('fonts_embedded.css')
        blocks = re.findall(r"@font-face\{[^}]*\}", css)
        match = next((b for b in blocks if "font-family:'Fraunces'" in b
                      and 'font-weight:600' in b and 'font-style:normal' in b), None)
        if not match:
            match = next((b for b in blocks if "font-family:'Fraunces'" in b), '')
        _print_display_face_cache = match or ''
    return _print_display_face_cache
def W(p, s):
    # LDV_OUT_DIR: full_test.py builds into a temp dir; unset = normal build
    full = os.path.join(os.environ.get('LDV_OUT_DIR') or D, p)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, 'w', encoding='utf-8').write(s)

# Production by default. For a preview build: PROD=0 SITE=<url> python3 build.py
SITE = os.environ.get('SITE', 'https://www.ldorvadortravel.com').rstrip('/')
PROD = os.environ.get('PROD', '1') == '1'
# Cloudflare Turnstile site key for the group interest form. Default is
# Cloudflare's documented always-pass test key; override with the real
# site key in production.
TURNSTILE_SITEKEY = os.environ.get('LDV_TURNSTILE_SITEKEY', '0x4AAAAAAEobauMj4oBBez0V')

# ---- fonts: committed once, sourced deterministically (never re-read from
# the build's own output, which could mutate across builds) ----
fonts = R('fonts_embedded.css') + R('fonts_extra.css')

# ---- image token map ----
imgmap = {}
for fn in os.listdir(os.path.join(D, 'assets', 'img')):
    if not os.path.isfile(os.path.join(D, 'assets', 'img', fn)):
        continue  # skip subdirs, e.g. assets/img/print/ (print-page derivatives)
    imgmap['__IMG_%s__' % os.path.splitext(fn)[0]] = 'assets/img/%s' % fn

# deterministic build stamp: changing css/js changes the URL, so no browser
# can ever run a stale cached copy of either after a deploy
import hashlib as _h
VER = _h.md5((R('css.tmpl') + R('js.tmpl')).encode()).hexdigest()[:10]

css_raw = R('css.tmpl').replace('/*__FONTS__*/', fonts)   # keeps __IMG_ tokens
css = css_raw
for k, v in imgmap.items():                                # app.css sits in /assets/
    css = css.replace(k, v.replace('assets/', ''))
W('assets/app.css', css)

def jsesc(s): return ''.join(c if ord(c) < 128 else '\\u%04x' % ord(c) for c in s)
def entesc(s): return ''.join(c if ord(c) < 128 else '&#%d;' % ord(c) for c in s)
W('assets/app.js', jsesc(R('js.tmpl')))

header   = R('header.frag.html')
footer   = R('footer.frag.html')
discover = R('discover.frag.html')

# ---- editable copy: content/*.json holds every text run, keyed by the
# __C_page.group.field__ tokens the templates now carry. The CMS edits the
# JSON; the build folds it back in before translation. ----
import html as _html
def _cesc(s):
    # CloudCannon writes null when an editor clears a field; treat it as empty
    if s is None:
        return ''
    s = s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
    # editors type paragraph breaks in textareas; honour them
    s = re.sub(r'\r?\n(\s*\r?\n)+', '<br><br>', s)
    s = re.sub(r'\r?\n', '<br>', s)
    return s

CONTENT = {}
cdir = os.path.join(D, 'content')
for fn in sorted(os.listdir(cdir)):
    if not fn.endswith('.json'):
        continue
    page = fn[:-5]
    data = json.load(open(os.path.join(cdir, fn), encoding='utf-8'))
    for group, fields in data.items():
        for field, text in fields.items():
            CONTENT['__C_%s.%s.%s__' % (page, group, field)] = _cesc(text)

def _drop_empties(body):
    """Cleared fields leave hollow markup behind. Strip empty inline wrappers
    first, then any block element left with nothing in it, so deleting a
    paragraph in the CMS actually removes the paragraph."""
    # ONLY block-level text elements are ever removed, and never ones carrying
    # id/data-/aria hooks. Inline elements are NEVER removed: in this design
    # empty spans are decorative infrastructure (door-tile photos, the
    # hamburger bars, the scroll cue) and an empty <b></b> from a cleared
    # field renders as nothing anyway. Lesson learned twice.
    def safe(m):
        attrs = m.group(2) or ''
        return m.group(0) if re.search(r'\b(id|role|data-[\w-]+|aria-[\w-]+)\s*=', attrs) else ''
    for _ in range(3):
        before = body
        body = re.sub(r'<(p|h2|h3|h4|blockquote|figcaption|li)(\s[^>]*)?>\s*</\1>\s*', safe, body)
        if body == before:
            break
    return body

# LDV_PLACEBO: full_test.py replaces all copy with a constant so page
# structure depends only on templates + build code, never on CMS content.
if os.environ.get('LDV_PLACEBO'):
    CONTENT = {k: 'Placeholder text for structural testing' for k in CONTENT}

def fill_content(body):
    for tok, val in CONTENT.items():
        body = body.replace(tok, val)
    # An editor's content must never break the build: unknown tokens render
    # empty and shout in the log rather than aborting the deploy.
    leftover = sorted(set(re.findall(r'__C_[a-z0-9_.]+__', body)))
    if leftover:
        print('WARNING: %d content token(s) with no value: %s'
              % (len(leftover), ', '.join(leftover[:5])))
        for tok in leftover:
            body = body.replace(tok, '')
    return _drop_empties(body)

PAGES = ['index.html', 'history.html', 'story.html', 'itinerary.html', 'privacy.html']
BODY  = {'index.html': 'home.body.html', 'history.html': 'history.body.html',
         'story.html': 'story.body.html', 'itinerary.html': 'itinerary.body.html',
         'privacy.html': 'privacy.body.html'}

LOCALES = ['en', 'es', 'nl', 'he']
LABEL   = {'en': 'EN', 'es': 'ES', 'nl': 'NL', 'he': 'עב'}
HTMLLANG= {'en': 'en', 'es': 'es', 'nl': 'nl', 'he': 'he'}
RTL     = {'he'}

TRANS = {}
for code in LOCALES:
    p = os.path.join(D, 'locales', '%s.json' % code)
    raw = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}
    # keys AND values entity-decoded: the walker looks up decoded keys, and
    # inserted values are re-escaped on the way in, so a value holding
    # "&rsquo;" would otherwise double-escape to a visible "&rsquo;"
    _u = __import__('html').unescape
    TRANS[code] = {_u(k): _u(v) for k, v in raw.items()}

# title + meta description per page per locale. The description keeps
# "Jewish Heritage Travel" because that is the search snippet.
META = {
'en': {
 'index.html':     ("L'Dor Vador | Jewish Heritage Travel to Curaçao",
   "L'Dor Vador is a Jewish Heritage Travel company in Curaçao. We curate journeys through 375 years of Jewish Atlantic history, connecting travelers with local academics, cultural experts, and community members."),
 'history.html':   ("A History Lesson | L'Dor Vador Jewish Heritage Travel",
   "How Jewish life took root and flourished in Curaçao: 375 years from Samuel Cohen and Congregation Mikvé Israel to the Snoa, Beth Haim, and the Jewish Museum Curaçao."),
 'story.html':     ("About Us | L'Dor Vador Jewish Heritage Travel",
   "Our origin story. L'Dor Vador was founded by Hannah Berkeley Cohen, former New York Times stringer in Havana, and Cornelis Greiwe, founder of CULTURESCAPE in Curaçao."),
 'itinerary.html': ("Example Itinerary | L'Dor Vador Jewish Heritage Travel",
   "A sample week in Jewish Curaçao: the sand-floor synagogue, Beth Haim, the Jewish Museum, people-to-people encounters, and Shabbat with the community."),
 'privacy.html': ("Privacy Policy | L'Dor Vador",
   "How L'Dor Vador Travel handles the little personal information it collects: contact form details only, no tracking cookies, no data sales."),
},
'es': {
 'index.html':     ("L'Dor Vador | Viajes de patrimonio judío a Curaçao",
   "L'Dor Vador es una empresa de viajes de patrimonio judío en Curaçao. Creamos viajes por 375 años de historia judía atlántica, conectando a los viajeros con académicos locales, expertos culturales y miembros de la comunidad."),
 'history.html':   ("Una lección de historia | L'Dor Vador",
   "Cómo la vida judía echó raíces y floreció en Curaçao: 375 años desde Samuel Cohen y la Congregación Mikvé Israel hasta la Snoa, Beth Haim y el Museo Judío de Curaçao."),
 'story.html':     ("Sobre nosotros | L'Dor Vador",
   "Nuestra historia. L'Dor Vador fue fundada por Hannah Berkeley Cohen, ex corresponsal del New York Times en La Habana, y Cornelis Greiwe, fundador de CULTURESCAPE en Curaçao."),
 'itinerary.html': ("Itinerario de ejemplo | L'Dor Vador",
   "Una semana de muestra en la Curaçao judía: la sinagoga de suelo de arena, Beth Haim, el Museo Judío, encuentros de persona a persona y Shabat con la comunidad."),
 'privacy.html': ("Pol\u00edtica de privacidad | L'Dor Vador",
   "C\u00f3mo trata L'Dor Vador Travel la poca informaci\u00f3n personal que recoge: solo los datos del formulario de contacto, sin cookies de rastreo y sin venta de datos."),
},
'nl': {
 'index.html':     ("L'Dor Vador | Joodse erfgoedreizen naar Curaçao",
   "L'Dor Vador verzorgt Joodse erfgoedreizen op Curaçao. Wij maken reizen door 375 jaar Joodse Atlantische geschiedenis en brengen reizigers in contact met lokale academici, cultuurkenners en gemeenschapsleden."),
 'history.html':   ("Een geschiedenisles | L'Dor Vador",
   "Hoe het Joodse leven wortel schoot en tot bloei kwam op Curaçao: 375 jaar van Samuel Cohen en de gemeente Mikvé Israel tot de Snoa, Beth Haim en het Joods Museum Curaçao."),
 'story.html':     ("Over ons | L'Dor Vador",
   "Ons ontstaan. L'Dor Vador werd opgericht door Hannah Berkeley Cohen, voormalig correspondent van The New York Times in Havana, en Cornelis Greiwe, oprichter van CULTURESCAPE op Curaçao."),
 'itinerary.html': ("Voorbeeldreis | L'Dor Vador",
   "Een voorbeeldweek in Joods Curaçao: de synagoge met zandvloer, Beth Haim, het Joods Museum, ontmoetingen van mens tot mens en Sjabbat met de gemeente."),
 'privacy.html': ("Privacybeleid | L'Dor Vador",
   "Hoe L'Dor Vador Travel omgaat met de weinige persoonsgegevens die worden verzameld: alleen het contactformulier, geen tracking cookies, geen verkoop van gegevens."),
},
'he': {
 'index.html':     ("לדור ודור | טיולי מורשת יהודית לקוראסאו",
   "לדור ודור היא חברת טיולי מורשת יהודית בקוראסאו. אנו יוצרים מסעות בני 375 שנות היסטוריה יהודית אטלנטית."),
 'history.html':   ("שיעור היסטוריה | לדור ודור",
   "כיצד הכו החיים היהודיים שורש ופרחו בקוראסאו: 375 שנה משמואל כהן וקהילת מקווה ישראל ועד הסנואה ובית חיים."),
 'story.html':     ("אודותינו | לדור ודור",
   "הסיפור שלנו. לדור ודור נוסדה על ידי חנה ברקלי כהן וקורנליס חריווה."),
 'itinerary.html': ("מסלול לדוגמה | לדור ודור",
   "שבוע לדוגמה בקוראסאו היהודית: בית הכנסת עם רצפת החול, בית חיים, המוזיאון היהודי ושבת עם הקהילה."),
 'privacy.html': ("\u05de\u05d3\u05d9\u05e0\u05d9\u05d5\u05ea \u05e4\u05e8\u05d8\u05d9\u05d5\u05ea | \u05dc\u05d3\u05d5\u05e8 \u05d5\u05d3\u05d5\u05e8",
   "\u05d0\u05d9\u05da \u05dc\u05d3\u05d5\u05e8 \u05d5\u05d3\u05d5\u05e8 \u05de\u05d8\u05e4\u05dc\u05ea \u05d1\u05de\u05e2\u05d8 \u05d4\u05de\u05d9\u05d3\u05e2 \u05d4\u05d0\u05d9\u05e9\u05d9 \u05e9\u05e0\u05d0\u05e1\u05e3: \u05e4\u05e8\u05d8\u05d9 \u05d8\u05d5\u05e4\u05e1 \u05d9\u05e6\u05d9\u05e8\u05ea \u05d4\u05e7\u05e9\u05e8 \u05d1\u05dc\u05d1\u05d3, \u05dc\u05dc\u05d0 \u05e2\u05d5\u05d2\u05d9\u05d5\u05ea \u05de\u05e2\u05e7\u05d1."),
},
}

def rel_prefix(code):
    return '' if code == 'en' else '../'

def page_url(code, page):
    if PROD:
        # the production host serves clean URLs (auto-trailing-slash), so
        # canonicals, hreflang and the sitemap must use that form
        page = '' if page == 'index.html' else page[:-len('.html')]
        base = SITE if code == 'en' else '%s/%s' % (SITE, code)
        return '%s/%s' % (base, page) if page else base + '/'
    return ('%s/%s' % (SITE, page)) if code == 'en' else ('%s/%s/%s' % (SITE, code, page))

def langnav(code, page, tr):
    """Switcher linking to the same page in every locale."""
    label = tr.get('Choose language', 'Choose language')
    out = ['<div class="lang" role="group" aria-label="%s">' % label]
    for c in LOCALES:
        if c == code:
            href = page
        elif c == 'en':
            href = rel_prefix(code) + page
        else:
            href = rel_prefix(code) + '%s/%s' % (c, page)
        cur = ' aria-current="true"' if c == code else ''
        out.append('<a href="%s" hreflang="%s" lang="%s"%s>%s</a>' % (href, HTMLLANG[c], HTMLLANG[c], cur, LABEL[c]))
    out.append('</div>')
    return ''.join(out)

def hreflangs(page):
    tags = ['<link rel="alternate" hreflang="%s" href="%s">' % (HTMLLANG[c], page_url(c, page)) for c in LOCALES]
    tags.append('<link rel="alternate" hreflang="x-default" href="%s">' % page_url('en', page))
    return ''.join(tags)

def jsonld(code, desc):
    """schema.org TravelAgency card; json.dumps keeps it pure ASCII so the
    later entity-escaping pass cannot corrupt it."""
    data = {
        '@context': 'https://schema.org',
        '@type': 'TravelAgency',
        'name': "L'Dor Vador Travel",
        'description': desc,
        'url': (SITE + '/') if PROD else SITE,
        'email': 'connect@ldorvadortravel.com',
        'areaServed': {'@type': 'Country', 'name': 'Curaçao'},
        'knowsLanguage': ['en', 'es', 'nl', 'he'],
        'founder': [
            {'@type': 'Person', 'name': 'Hannah Berkeley Cohen'},
            {'@type': 'Person', 'name': 'Cornelis Greiwe'},
        ],
        'logo': '%s/assets/img/favicon-180.png' % SITE,
        'image': '%s/assets/img/og-home.jpg' % SITE,
        'inLanguage': HTMLLANG[code],
    }
    return '<script type="application/ld+json">%s</script>' % json.dumps(data)

HEAD = ('<!doctype html>\n<html lang="%s"%s><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + ('' if PROD else '<meta name="robots" content="noindex, nofollow">') +
        '<meta name="description" content="%s">'
        '<meta property="og:title" content="%s"><meta property="og:description" content="%s">'
        '<meta property="og:type" content="website"><meta property="og:locale" content="%s">'
        '<meta property="og:site_name" content="L\u2019Dor Vador">'
        '<meta property="og:image" content="%s/assets/img/og-home.jpg">'
        '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
        '<meta property="og:image:alt" content="%s">'
        '<meta name="twitter:card" content="summary_large_image">'
        '<link rel="icon" href="%sassets/img/favicon.ico?v=2" sizes="any">'
        '<link rel="icon" type="image/png" sizes="32x32" href="%sassets/img/favicon-32.png?v=2">'
        '<link rel="icon" type="image/png" sizes="16x16" href="%sassets/img/favicon-16.png?v=2">'
        '<link rel="apple-touch-icon" sizes="180x180" href="%sassets/img/favicon-180.png?v=2">'
        '<meta name="theme-color" content="#282819">'
        '%s<link rel="canonical" href="%s">'
        '<title>%s</title><link rel="stylesheet" href="%sassets/app.css?v=' + VER + '">%s</head><body>\n')
TAIL = '\n<script src="%sassets/app.js?v=' + VER + '" defer></script></body></html>'

built = 0
for code in LOCALES:
    tr = TRANS[code]
    pre = rel_prefix(code)
    for page in PAGES:
        body = R(BODY[page])
        body = (body.replace('__HEADER__', header)
                    .replace('__FOOTER__', footer)
                    .replace('__DISCOVER__', discover))
        body = fill_content(body)
        body = body.replace('__WEB3FORMS_KEY__',
                            os.environ.get('WEB3FORMS_KEY', 'b650cfb7-2868-422a-8d34-553c7674e073'))
        if code != 'en':
            body = i18n.translate(body, tr)
        body = body.replace('__LANGNAV__', langnav(code, page, tr))
        if code == 'he' and page == 'index.html':
            # In Hebrew the translated headline and the wordmark are the same
            # phrase, so the hero would say it twice. Show the wordmark alone,
            # centred, and let it be the h1.
            body = re.sub(
                r'<div class="hero-title">.*?</div>',
                '<div class="hero-title hero-title-he">'
                '<h1 class="heb-hero" lang="he" dir="rtl">\u05dc\u05b0\u05d3\u05d5\u05b9\u05e8 '
                '\u05d5\u05b8\u05d3\u05d5\u05b9\u05e8</h1></div>',
                body, count=1, flags=re.S)
        for k, v in imgmap.items():
            body = body.replace(k, pre + v)
        title, desc = META[code][page]
        head = HEAD % (HTMLLANG[code],
                       ' dir="rtl"' if code in RTL else '',
                       desc, title, desc, HTMLLANG[code],
                       SITE, title,
                       pre, pre, pre, pre,
                       hreflangs(page), page_url(code, page),
                       title, pre, jsonld(code, desc))
        out = page if code == 'en' else '%s/%s' % (code, page)
        W(out, entesc(head + body + TAIL % pre))
        built += 1

# ---- group trip landing pages: content/groups/<slug>.json -> /groups/<slug>/ ----
# English-only, noindex, not in nav, not in sitemap. See group.body.html for
# the __G_FIELD__ token convention.
def render_day_text(text):
    """Render an itinerary/vignette `text` field into HTML using the shared
    heading/bullet convention: a line that does NOT start with "- " is a bold
    sub-heading (<h4>); one or more following lines starting with "- " become
    a <ul><li> group beneath it; a blank line just separates groups. Used by
    both the web group page and the print PDF so the itinerary always renders
    identically in both places."""
    lines = str(text or '').split('\n')
    out = []
    bullets = []

    def flush():
        if bullets:
            out.append('<ul>%s</ul>' % ''.join('<li>%s</li>' % _cesc(b) for b in bullets))
            bullets.clear()

    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        if s.startswith('- '):
            bullets.append(s[2:].strip())
        else:
            flush()
            out.append('<h4>%s</h4>' % _cesc(s))
    flush()
    return ''.join(out)


def build_groups():
    gdir = os.path.join(D, 'content', 'groups')
    if not os.path.isdir(gdir):
        return 0
    tmpl = re.sub(r'^\s*<!--.*?-->\s*', '', R('group.body.html'), count=1, flags=re.S)
    n = 0
    listed_trips = []  # for the /groups/ index page + sitemap
    for fn in sorted(os.listdir(gdir)):
        if fn.startswith('.') or not fn.endswith('.json'):
            continue
        g = json.load(open(os.path.join(gdir, fn), encoding='utf-8'))
        if g.get('published') is False:
            continue
        slug = g.get('slug') or fn[:-5]
        # LDV_PLACEBO forces every trip unlisted, so the golden structural
        # manifest never depends on live CMS content (see GROUPS_ANY_LISTED).
        listed = False if os.environ.get('LDV_PLACEBO') else bool(g.get('listed'))
        if listed:
            listed_trips.append(dict(g, slug=slug))

        def gv(key):
            v = g.get(key)
            if os.environ.get('LDV_PLACEBO') and v not in (None, ''):
                return 'Placeholder text for structural testing'
            return _cesc(v)

        def bullets(key):
            raw = g.get(key)
            if not raw:
                return ''
            items = [ln.strip() for ln in str(raw).split('\n') if ln.strip()]
            if not items:
                return ''
            return '<ul>%s</ul>' % ''.join('<li>%s</li>' % _cesc(it) for it in items)

        def gimg(path):
            return ('../../' + path) if path else ''

        def itinerary_rows():
            days = g.get('itinerary') or []
            out = []
            for i, d in enumerate(days):
                day = _cesc(d.get('day'))
                title = _cesc(d.get('title'))
                subtitle = _cesc(d.get('subtitle'))
                subtitle_html = ('<p class="gday-sub">%s</p>' % subtitle) if subtitle else ''
                body_html = render_day_text(d.get('text'))
                img = d.get('image')
                img_html = ('<img src="%s" alt="" loading="lazy">' % gimg(img)) if img else ''
                overnight = _cesc(d.get('overnight'))
                meals = _cesc(d.get('meals'))
                if overnight:
                    on_line = 'Overnight: %s' % overnight + (' &middot; (%s)' % meals if meals else '')
                elif meals:
                    on_line = 'End of Program &middot; (%s)' % meals
                else:
                    on_line = ''
                on_html = ('<p class="gday-overnight">%s</p>' % on_line) if on_line else ''
                out.append(
                    '<div class="group-day" id="day-%d"><div class="gday-head"><span class="gday-n">%s</span>'
                    '<span class="gday-t">%s</span>%s</div>'
                    '<div class="gday-body">%s%s%s</div></div>'
                    % (i + 1, day, title, subtitle_html, img_html, body_html, on_html))
            return ''.join(out)

        def itin_glance():
            days = g.get('itinerary') or []
            out = []
            for i, d in enumerate(days):
                day = _cesc(d.get('day'))
                title = _cesc(d.get('title'))
                out.append('<a class="glance-row" href="#day-%d">Day %s — %s</a>'
                            % (i + 1, day.replace('Day ', '').replace('Day', '') or str(i + 1), title))
            if not out:
                return ''
            return '<div class="glance-list">%s</div>' % ''.join(out)

        def vignettes():
            items = g.get('vignettes') or []
            out = []
            for i, v in enumerate(items):
                title = _cesc(v.get('title'))
                paras = ''.join('<p>%s</p>' % _cesc(ln) for ln in
                                 str(v.get('text') or '').split('\n') if ln.strip())
                img = v.get('image')
                if not img:
                    continue
                rev = ' reverse' if i % 2 else ''
                out.append(
                    '<section class="bio gv%s"><div class="bio-portrait">'
                    '<img src="%s" alt="" loading="lazy"></div>'
                    '<div class="bio-copy"><h2>%s</h2>%s</div></section>'
                    % (rev, gimg(img), title, paras))
            return ''.join(out)

        def gallery():
            imgs = [p for p in (g.get('gallery') or []) if p]
            if not imgs:
                return ''
            tiles = ''.join(
                '<div class="jcard gtile" tabindex="0" data-full="%s">'
                '<div class="img" style="background-image:url(\'%s\')"></div></div>'
                % (gimg(p), gimg(p)) for p in imgs)
            return ('<section class="group-gallery"><div class="sec-head" data-origin="left">'
                    '<p class="eyebrow">In Pictures</p></div>'
                    '<div class="gallery-grid">%s</div></section>' % tiles)

        def partner_logos():
            items = [p for p in (g.get('partner_logos') or []) if p.get('image')]
            if not items:
                return ''
            tiles = ''.join(
                '<div class="partner-logo"><img src="%s" alt="%s" loading="lazy"></div>'
                % (gimg(p['image']), _cesc(p.get('name') or 'Partner logo'))
                for p in items)
            return ('<div class="partner-logos"><p class="partner-logos-label">In partnership with</p>'
                    '<div class="partner-logos-row">%s</div></div>' % tiles)

        def closing_image():
            img = g.get('closing_image')
            if not img:
                return ''
            return ('<div class="group-closing-photo"><img src="%s" alt="PLACEHOLDER photo" loading="lazy"></div>'
                    % gimg(img))

        def facts_line():
            bits = [gv(k) for k in ('dates', 'duration', 'group_size') if g.get(k)]
            return ' · '.join(bits)

        def facts_list():
            rows = [('Dates', 'dates'), ('Duration', 'duration'), ('Group size', 'group_size'),
                    ('Start / finish', 'start_finish'), ('Pace', 'pace'),
                    ('Accommodation', 'accommodation')]
            return ''.join('<li><span>%s</span><b>%s</b></li>' % (label, gv(key))
                            for label, key in rows if g.get(key))

        def notes_block():
            raw = g.get('notes')
            if not raw:
                return ''
            items = [ln.strip() for ln in str(raw).split('\n') if ln.strip()]
            if not items:
                return ''
            lis = ''.join('<li>%s</li>' % _cesc(it) for it in items)
            return ('<section class="group-notes"><h3>Program Notes</h3><ul>%s</ul></section>'
                    % lis)

        def pdf_href():
            # An explicit `pdf` path in content JSON wins (hand-made file);
            # otherwise fall back to the Worker's on-demand, cached PDF route.
            pdf = g.get('pdf')
            if pdf:
                return gimg(pdf)
            return '/groups/%s/trip-details.pdf' % slug

        def pdf_link():
            return '<a class="btn btn-line" href="%s" download>Download trip details (PDF)</a>' % pdf_href()

        def pdf_link_hero():
            return ('<a class="btn btn-line on-photo grouphero-pdf" href="%s" download>'
                    'Download trip details (PDF)</a>' % pdf_href())

        body = (tmpl.replace('__HEADER__', header)
                    .replace('__FOOTER__', footer))
        body = fill_content(body)
        body = body.replace('__LANGNAV__', '')
        # header/footer links are root-relative ("index.html", "story.html#x");
        # this page sits two levels down at /groups/<slug>/, so rewrite them.
        body = re.sub(r'href="(?!https?:|mailto:|#|\.\./)([a-z][\w.-]*\.html)',
                      r'href="../../\1', body)
        subs = {
            '__G_SLUG__':        _cesc(slug),
            '__G_TITLE__':       gv('title'),
            '__G_SUBTITLE__':    gv('subtitle'),
            '__G_CONGREGATION__':gv('congregation'),
            '__G_GUIDES_WITH__': (_cesc('with %s' % ' & '.join(gd['name'] for gd in _group_guides(g)))
                                   if _group_guides(g) else ''),
            '__G_DATES__':       gv('dates'),
            '__G_DURATION__':    gv('duration'),
            '__G_GROUP_SIZE__':  gv('group_size'),
            '__G_PRICE_NOTE__':  gv('price_note'),
            '__G_HERO_IMAGE__':  '../../' + (g.get('hero_image') or ''),
            '__G_INTRO__':       gv('intro'),
            '__G_START_FINISH__': gv('start_finish'),
            '__G_PACE__':        gv('pace'),
            '__G_ACCOMMODATION__': gv('accommodation'),
            '__G_CONTACT_PHONE__': gv('contact_phone'),
            '__G_FORM_INTRO__':  gv('form_intro'),
            '__G_NOTIFY_NOTE__': gv('notify_note'),
            '__G_INCLUDED_LIST__':     bullets('included'),
            '__G_NOT_INCLUDED_LIST__': bullets('not_included'),
            '__G_NOTES_BLOCK__':       notes_block(),
            '__G_FACTS_LINE__':        facts_line(),
            '__G_FACTS_LIST__':        facts_list(),
            '__G_HIGHLIGHTS_LIST__':   bullets('highlights'),
            '__G_ITIN_GLANCE__':       itin_glance(),
            '__G_ITINERARY_ROWS__':    itinerary_rows(),
            '__G_VIGNETTES__':         vignettes(),
            '__G_GALLERY__':           gallery(),
            '__G_PDF_LINK__':          pdf_link(),
            '__G_PDF_LINK_HERO__':     pdf_link_hero(),
            '__G_PARTNER_LOGOS__':     partner_logos(),
            '__G_CLOSING_IMAGE__':     closing_image(),
            '__TURNSTILE_SITEKEY__':   _cesc(TURNSTILE_SITEKEY),
        }
        for tok, val in subs.items():
            body = body.replace(tok, val)
        body = _drop_empties(body)
        for k, v in imgmap.items():
            body = body.replace(k, '../../' + v)

        title = '%s | L’Dor Vador Travel' % (g.get('title') or slug)
        canonical = '%s/groups/%s/' % (SITE, slug)
        desc = g.get('subtitle') or g.get('title') or "L'Dor Vador Travel group journey"
        # unlisted trips stay private (noindex, out of the sitemap); a trip
        # the client opts into listing publicly becomes indexable too
        robots_meta = '' if (listed and PROD) else '<meta name="robots" content="noindex,nofollow">'
        head = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width, initial-scale=1">'
                + robots_meta +
                '<meta name="description" content="%s">'
                '<link rel="canonical" href="%s">'
                '<title>%s</title>'
                '<link rel="stylesheet" href="../../assets/app.css?v=' + VER + '">'
                '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
                '</head><body>\n') % (_cesc(desc), canonical, _cesc(title))
        tail = '\n<script src="../../assets/app.js?v=' + VER + '" defer></script></body></html>'
        W('groups/%s/index.html' % slug, entesc(head + body + tail))
        W('groups/%s/print.html' % slug, entesc(print_page(g, slug)))
        n += 1
    build_groups_index(listed_trips)
    return n


# ---- /groups/ index: "Group Journeys" — English-only, indexable, in the
# sitemap. Always built (even with nothing listed) so the URL is stable. ----
def build_groups_index(listed_trips):
    def card(t):
        slug = t['slug']
        hero = t.get('hero_image')
        img_html = ('<div class="gi-photo"><img src="../%s" alt="" loading="lazy"></div>' % hero) if hero else ''
        facts = ' · '.join(x for x in [t.get('dates'), t.get('duration')] if x)
        return (
            '<a class="gi-card" href="%s/">' % _cesc(slug)
            + img_html +
            '<div class="gi-body">'
            + ('<p class="gi-eyebrow">%s</p>' % _cesc(t.get('congregation')) if t.get('congregation') else '')
            + '<h3>%s</h3>' % _cesc(t.get('title') or slug)
            + ('<p class="gi-facts">%s</p>' % _cesc(facts) if facts else '')
            + ('<p class="gi-sub">%s</p>' % _cesc(t.get('subtitle')) if t.get('subtitle') else '')
            + '<span class="gi-link">View the journey</span>'
            '</div></a>'
        )

    if listed_trips:
        grid = '<div class="group-index-grid">%s</div>' % ''.join(card(t) for t in listed_trips)
    else:
        grid = '<p class="group-index-empty">New group journeys will be announced here.</p>'

    body = R('groups.body.html').replace('__HEADER__', header).replace('__FOOTER__', footer)
    body = fill_content(body)
    body = body.replace('__LANGNAV__', '').replace('__GROUPS_GRID__', grid)
    # header/footer links are root-relative ("index.html", "story.html#x");
    # this page sits one level down at /groups/, so rewrite them.
    body = re.sub(r'href="(?!https?:|mailto:|#|\.\./)([a-z][\w.-]*\.html)',
                  r'href="../\1', body)
    body = _drop_empties(body)
    for k, v in imgmap.items():
        body = body.replace(k, '../' + v)

    title = 'Group Journeys | L’Dor Vador Travel'
    desc = 'Bespoke Jewish heritage journeys for congregations and private groups, curated by L’Dor Vador Travel.'
    canonical = '%s/groups/' % SITE
    robots_meta = '' if PROD else '<meta name="robots" content="noindex, nofollow">'
    head = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            + robots_meta +
            '<meta name="description" content="%s">'
            '<link rel="canonical" href="%s">'
            '<title>%s</title>'
            '<link rel="stylesheet" href="../assets/app.css?v=' + VER + '">'
            '</head><body>\n') % (_cesc(desc), canonical, _cesc(title))
    tail = '\n<script src="../assets/app.js?v=' + VER + '" defer></script></body></html>'
    W('groups/index.html', entesc(head + body + tail))

# ---- printable trip-details page: content/groups/<slug>.json -> /groups/<slug>/print.html ----
# Self-contained (inline CSS), noindex, not in the sitemap or golden manifest.
# Rendered to PDF locally by make_pdf.py — the Cloudflare build has no Chrome.
_story_bios_cache = None
def _story_bios():
    """Hannah's host content for the trip-details PDF, pulled from
    content/story.json so the hosts page is identical across every group's
    brochure. Her bio is a run of discrete p_2.. paragraphs (one, p_3,
    continues an inline link that splits p_2 — rejoined here)."""
    global _story_bios_cache
    if _story_bios_cache is None:
        try:
            story = json.load(open(os.path.join(D, 'content', 'story.json'), encoding='utf-8'))
            bio = story.get('bio') or {}
        except Exception:
            bio = {}
        hannah_p1 = ' '.join(x for x in [bio.get('p_2'), bio.get('a_1'), bio.get('p_3')] if x)
        # p_7 continues p_6 inline (starts with a comma), so it is appended
        # with no separating space; p_5 -> p_6 gets a normal word space
        hannah_p3 = ' '.join(x for x in [bio.get('p_5'), bio.get('p_6')] if x) + (bio.get('p_7') or '')
        hannah_full = [p for p in [hannah_p1, bio.get('p_4'), hannah_p3, bio.get('p_8')] if p]
        hannah = {
            'name': bio.get('h2_1') or 'Hannah Berkeley Cohen',
            'role': bio.get('p_1') or 'Co-founder',
            'paras': hannah_full[:2],
            'full_paras': hannah_full,
        }
        _story_bios_cache = hannah
    return _story_bios_cache


def _cap_words(text, limit=110):
    """Truncate at the sentence end nearest to (but not over) `limit` words,
    so a bio never runs long on the printed page but never cuts mid-thought."""
    words = text.split()
    if len(words) <= limit:
        return text
    head = ' '.join(words[:limit])
    cut = max(head.rfind('. '), head.rfind('.” '), head.rfind('? '), head.rfind('! '))
    if cut > 0:
        return head[:cut + 1]
    return head.rstrip('.,;: ') + '.'


def _group_guides(g):
    """Guides/leaders for a trip: the current `guides` array, or (for older
    content) a single `leader`/`leader_image` pair treated as one guide with
    no photo unless an image was set."""
    guides = g.get('guides')
    if guides:
        return [{'name': gd.get('name') or '', 'role': gd.get('role') or '',
                  'hosts_role': gd.get('hosts_role') or '',
                  'image': gd.get('image') or '', 'bio': gd.get('bio') or ''}
                 for gd in guides if gd.get('name')]
    leader = g.get('leader')
    if leader:
        return [{'name': leader, 'role': 'Guide', 'hosts_role': '',
                  'image': g.get('leader_image') or '', 'bio': ''}]
    return []


_PRINT_DPI = 150  # px-per-inch used to size print derivatives to their CSS boxes

def print_image(src, w, h, top=False, focus=None):
    """Center-crop (or, for portraits, top-weighted crop) assets/<src> to an
    exact w x h JPEG at assets/img/print/<basename>-<w>x<h>.jpg, so the print
    stylesheet can reference it with no CSS cropping (object-fit/overflow) and
    Chrome's PDF renderer embeds the JPEG bytes verbatim instead of rasterizing
    a full-resolution PNG for every cropped box. Cached: skipped if the
    derivative already exists and is newer than the source. Never fails the
    build: missing Pillow or a missing/broken source just logs a warning and
    falls back to the original path."""
    if not src:
        return src
    src_path = os.path.join(D, src)
    if not os.path.isfile(src_path):
        return src
    base = os.path.splitext(os.path.basename(src))[0]
    tag = ('-' + str(focus).lower()) if focus else ''
    out_rel = 'assets/img/print/%s-%dx%d%s.jpg' % (base, w, h, tag)
    out_path = os.path.join(D, out_rel)
    try:
        if os.path.isfile(out_path) and os.path.getmtime(out_path) >= os.path.getmtime(src_path):
            return out_rel
        from PIL import Image, ImageOps
    except ImportError:
        logging.warning('print_image: Pillow not installed, using uncropped source for %s', src)
        return src
    try:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        im = ImageOps.exif_transpose(Image.open(src_path)).convert('RGB')
        sw, sh = im.size
        target_ratio = w / float(h)
        src_ratio = sw / float(sh)
        if src_ratio > target_ratio:
            new_w = int(round(sh * target_ratio))
            x0 = (sw - new_w) // 2
            box = (x0, 0, x0 + new_w, sh)
        else:
            new_h = int(round(sw / target_ratio))
            frac = {'top': 0.0, 'center': 0.5, 'bottom': 1.0}.get(str(focus or '').lower(), 0.2 if top else 0.5)
            y0 = int(round((sh - new_h) * frac))
            box = (0, y0, sw, y0 + new_h)
        im.crop(box).resize((w, h), Image.LANCZOS).save(
            out_path, 'JPEG', quality=74, progressive=True, optimize=True)
    except Exception as e:
        logging.warning('print_image failed for %s: %s', src, e)
        return src
    return out_rel


def print_page(g, slug):
    def pv(key):
        return _cesc(g.get(key) or '')

    def pimg(path):
        return ('../../' + path) if path else ''

    def bullets(key):
        raw = g.get(key)
        if not raw:
            return ''
        items = [ln.strip() for ln in str(raw).split('\n') if ln.strip()]
        if not items:
            return ''
        return '<ul>%s</ul>' % ''.join('<li>%s</li>' % _cesc(it) for it in items)

    def bullet_items(key):
        raw = g.get(key)
        if not raw:
            return ''
        items = [ln.strip() for ln in str(raw).split('\n') if ln.strip()]
        return ''.join('<li>%s</li>' % _cesc(it) for it in items)

    title = pv('title')
    congregation = pv('congregation')
    dates = pv('dates')
    duration = pv('duration')
    group_size = pv('group_size')
    guides = _group_guides(g)
    hero = pimg(print_image(g.get('hero_image'), 1275, 1650))
    # full copy: every intro paragraph runs on page 2, not just the first two
    intro_paras = [ln for ln in str(g.get('intro') or '').split('\n') if ln.strip()]
    intro = ''.join('<p>%s</p>' % _cesc(ln) for ln in intro_paras)
    page_url = '%s/groups/%s/' % (SITE, slug)
    contact_email = pv('contact_email') or 'connect@ldorvadortravel.com'
    contact_phone = pv('contact_phone')
    price_note = pv('price_note')

    glance_items = ''.join(
        '<div class="glance-item"><span class="gl-label">%s</span><span class="gl-value">%s</span></div>'
        % (label, val) for label, val in [
            ('Dates', dates), ('Duration', duration), ('Group size', group_size),
            ('Start / finish', pv('start_finish')), ('Pace', pv('pace')),
            ('Accommodation', pv('accommodation')),
        ] if val)

    itinerary = g.get('itinerary') or []

    def itin_glance_items():
        out = []
        for i, d in enumerate(itinerary):
            day = _cesc(d.get('day')) or ('Day %d' % (i + 1))
            dtitle = _cesc(d.get('title'))
            out.append('<li><b>%s</b> &mdash; %s</li>' % (day, dtitle))
        return ''.join(out)

    def day_meta(d):
        overnight = _cesc(d.get('overnight'))
        meals = _cesc(d.get('meals'))
        bits = []
        if overnight:
            bits.append('Overnight: %s' % overnight)
            if meals:
                bits.append('(%s)' % meals)
        elif meals:
            bits.append('End of Program')
            bits.append('(%s)' % meals)
        return ' &middot; '.join(bits)

    # ---- day-by-day: full copy, day 1 as a feature (full-width photo),
    # days 2+ as two-column cards (photo sized to the narrower card) ----
    # Every day (feature or card) now renders its photo at the full flow
    # content width (8.5in page - 0.7in margins each side = 7.1in) and the
    # shared .p-day-photo height override of 2.2in — see
    # `.day1-feature .p-day-photo,.day-card .p-day-photo,.day-card-solo
    # .p-day-photo{height:2.2in}` in the print stylesheet below. Both day
    # types share one crop box so the derivative's aspect always matches
    # the box it's drawn into (previously cards were pre-cropped at a
    # half-column width that no longer exists, stretching every photo).
    DAY_IMG_W_PX = int(round(7.1 * _PRINT_DPI))
    DAY_IMG_H_PX = int(round(2.2 * _PRINT_DPI))
    CARD_IMG_W_PX = DAY_IMG_W_PX
    CARD_IMG_H_PX = DAY_IMG_H_PX

    def day_groups_html(d):
        """Render a day's `text` as heading+bullets groups, each wrapped so
        it never breaks across a printed page (see render_day_text's
        heading/`- bullet` convention)."""
        lines = str(d.get('text') or '').split('\n')
        out = []
        heading, cur_bullets = None, []

        def flush():
            if heading is None:
                return
            html = '<h4>%s</h4>' % _cesc(heading)
            if cur_bullets:
                html += '<ul>%s</ul>' % ''.join('<li>%s</li>' % _cesc(b) for b in cur_bullets)
            out.append('<div class="p-day-group">%s</div>' % html)

        for raw in lines:
            s = raw.strip()
            if not s:
                continue
            if s.startswith('- '):
                cur_bullets.append(s[2:].strip())
            else:
                flush()
                heading, cur_bullets = s, []
        flush()
        return ''.join(out)

    def day_header(d, card=False):
        """The non-splittable top of a day: eyebrow, title, subtitle, photo."""
        day = _cesc(d.get('day'))
        date = _cesc(d.get('date'))
        dtitle = _cesc(d.get('title'))
        subtitle = _cesc(d.get('subtitle'))
        subtitle_html = ('<p class="p-day-sub">%s</p>' % subtitle) if subtitle else ''
        eyebrow = '%s%s' % (day, ' &middot; %s' % date if date else '')
        img = d.get('image')
        img_html = ''
        if img:
            w, h = (CARD_IMG_W_PX, CARD_IMG_H_PX) if card else (DAY_IMG_W_PX, DAY_IMG_H_PX)
            img_src = pimg(print_image(img, w, h, focus=d.get('image_focus')))
            img_html = '<div class="p-day-photo"><img src="%s" alt=""></div>' % img_src
        html = ('<div class="p-day-header"><p class="p-eyebrow-sm p-day-eyebrow">%s</p><h3>%s</h3>%s%s</div>'
                % (eyebrow, dtitle, subtitle_html, img_html))
        return html

    # ---- day 1: the page-2 feature block, full copy (not a summary) ----
    def day_block(d, css_class='day', last=False):
        card = 'day-card' in css_class and 'day-card-solo' not in css_class
        classes = css_class
        if d.get('page_break'):
            classes += ' day-break'
        if last:
            classes += ' day-last'
        parts = ['<div class="%s">' % classes, day_header(d, card=card), day_groups_html(d)]
        meta = day_meta(d)
        if meta:
            parts.append('<p class="p-day-meta">%s</p>' % meta)
        parts.append('</div>')
        return ''.join(parts)

    last_day_idx = len(itinerary) - 1
    day1_html = day_block(itinerary[0], 'day day1-feature', last=(last_day_idx == 0)) if itinerary else ''

    # ---- days 2+: a two-column card grid (the 2210a8a look), built with
    # floats rather than CSS grid/flex — Chrome's print engine fragments a
    # float across pages cleanly, whereas a grid/flex item breaking mid-row
    # tends to overlap or clip. Cards are paired into rows and cleared after
    # each row so a very long card (e.g. a day with much more copy than its
    # neighbour) never throws off the alignment of subsequent rows. A day
    # whose copy runs far longer than the rest (Day 4 here) is given its own
    # full-width row instead of being paired — pairing it would strand its
    # partner's column empty for however many pages the long day keeps
    # running, which reads as a half-blank page. ----
    rest_days = itinerary[1:]
    lens = [len(str(d.get('text') or '')) for d in rest_days]
    avg_len = (sum(lens) / len(lens)) if lens else 0
    day_rows = []
    i = 0
    while i < len(rest_days):
        d = rest_days[i]
        if avg_len and len(str(d.get('text') or '')) > 1.8 * avg_len:
            is_last = (1 + i == last_day_idx)
            wrap_class = 'day-row day-row-solo day-last' if is_last else 'day-row day-row-solo'
            day_rows.append('<div class="%s">%s</div>'
                             % (wrap_class, day_block(d, 'day day-card day-card-solo')))
            i += 1
            continue
        pair = rest_days[i:i + 2]
        cards = ''.join(
            day_block(d, 'day day-card day-card-left' if j == 0 else 'day day-card day-card-right',
                      last=(1 + i + j == last_day_idx))
            for j, d in enumerate(pair))
        day_rows.append('<div class="day-row">%s</div>' % cards)
        i += 2
    days_html = day1_html + ''.join(day_rows)

    # ---- hosts (full bios, own page) ----
    hannah = _story_bios()

    def host_block(h, img):
        paras = ''.join('<p>%s</p>' % _cesc(p) for p in h['full_paras'])
        cropped = print_image(img, 260, 260, top=True)
        return ('<div class="host-full"><div class="host-full-portrait"><img src="../../%s" alt=""></div>'
                '<div class="host-full-copy"><h3>%s</h3><p class="host-role">%s</p>%s</div></div>'
                % (cropped, _cesc(h['name']), _cesc(h['role']), paras))

    hannah_html = host_block(hannah, 'assets/img/hannah.jpg')

    def about_company_html():
        text = str(g.get('about_company') or '').strip()
        if not text:
            return ''
        paras = ''.join('<p>%s</p>' % _cesc(ln) for ln in text.split('\n') if ln.strip())
        return ('<div class="host-full host-about"><div class="host-full-copy">'
                '<h3>About L&rsquo;Dor Vador Travel</h3>%s</div></div>' % paras)

    def guide_host_html(gd):
        name = _cesc(gd['name'])
        role = _cesc(gd.get('hosts_role') or gd['role'])
        bio = str(gd.get('bio') or '').strip()
        bio_html = ''.join('<p>%s</p>' % _cesc(ln) for ln in bio.split('\n') if ln.strip())
        img = gd.get('image')
        if img:
            cropped = print_image(img, 260, 260, top=True)
            portrait = '<div class="host-full-portrait"><img src="../../%s" alt=""></div>' % cropped
        else:
            portrait = ''
        return ('<div class="host-full">%s<div class="host-full-copy"><h3>%s</h3><p class="host-role">%s</p>%s</div></div>'
                % (portrait, name, role, bio_html))

    guides_html = ''.join(guide_host_html(gd) for gd in guides)

    # ---- partner logos (cover strip, right side) ----
    def partner_logos_html():
        items = [p for p in (g.get('partner_logos') or []) if p.get('image')]
        if not items:
            return ''
        tiles = ''.join(
            '<span class="p-partner-logo"><img src="%s" alt="%s"></span>'
            % (pimg(p['image']), _cesc(p.get('name') or 'Partner logo'))
            for p in items)
        return ('<div class="p-partner-logos"><span class="p-partner-label">In Partnership With</span>'
                '<span class="p-partner-row">%s</span></div>' % tiles)

    # ---- closing photo, full-width, after Day 6 (the last itinerary day) ----
    CLOSING_IMG_W_PX = int(round(7.1 * _PRINT_DPI))
    CLOSING_IMG_H_PX = int(round(2.4 * _PRINT_DPI))

    def closing_photo_html():
        img = g.get('closing_image')
        if not img:
            return ''
        src = pimg(print_image(img, CLOSING_IMG_W_PX, CLOSING_IMG_H_PX))
        return '<div class="p-closing-photo"><img src="%s" alt=""></div>' % src

    included = bullets('included')
    not_included = bullets('not_included')

    def notes_html():
        raw = g.get('notes')
        if not raw:
            return ''
        items = [ln.strip() for ln in str(raw).split('\n') if ln.strip()]
        if not items:
            return ''
        lis = ''.join('<li>%s</li>' % _cesc(it) for it in items)
        return ('<div class="p-notes"><p class="p-eyebrow">Program Notes</p>'
                '<ul class="p-notes-list">%s</ul></div>' % lis)

    contact_rows = ''
    if contact_email:
        contact_rows += '<p>Email &middot; <b>%s</b></p>' % contact_email
    if contact_phone:
        contact_rows += '<p>Phone &middot; <b>%s</b></p>' % contact_phone
    contact_rows += '<p>Online &middot; <b>%s</b></p>' % page_url

    # ---- led-by row on the cover: Hannah, then each guide (portrait only
    # when the guide has one set — no placeholder) ----
    def led_cell(portrait_img, name, role):
        p = ('<span class="led-p"><img src="%s" alt=""></span>' % portrait_img) if portrait_img else ''
        return ('<div class="led-cell">%s<p class="led-names">%s<span class="led-role">%s</span></p></div>'
                % (p, name, role))

    led_cells = [led_cell(
        '../../%s' % print_image('assets/img/hannah.jpg', 120, 120, top=True),
        'Hannah Berkeley Cohen', 'L&rsquo;Dor Vador Travel')]
    for gd in guides:
        portrait = (pimg(print_image(gd['image'], 120, 120, top=True))
                    if gd.get('image') else '')
        led_cells.append(led_cell(portrait, _cesc(gd['name']), _cesc(gd['role'])))
    led_row = '<div class="cover-led">%s</div>' % ''.join(led_cells)

    cover_contact_bits = [b for b in [contact_email, contact_phone, 'www.ldorvadortravel.com'] if b]
    cover_contact = '<p class="cover-contact">%s</p>' % ' &middot; '.join(cover_contact_bits)

    # ---- stacked lockup (cover, on-photo, cream) and compact lockup (closing page) ----
    stack_mark = '<div class="brand p-brand-stack"><span class="brand-stack"><span class="brand-word">L&rsquo;Dor</span><span class="brand-word">Vador</span></span><span class="brand-tx">Heritage Travel</span></div>'
    compact_mark = '<header class="logo-min header-solid p-brand-compact"><div class="brand"><span class="brand-stack"><span class="brand-word">L&rsquo;Dor</span><span class="brand-word">Vador</span></span><span class="brand-tx">Heritage Travel</span></div></header>'

    # ---- assemble: a fixed full-bleed cover, then one continuous flow ----
    # Note: a `position:fixed` running header was tried but dropped — headless
    # Chrome's page.pdf() does not repeat fixed elements on every printed
    # page (a documented Chromium paged-media limitation); it renders the
    # element once, at whatever page its single-flow position happens to
    # land on. Not worth a post-processing step for a brochure, same call
    # as dropping page numbers below.
    cover_html = """
<div class="sheet cover">
  %(hero_img)s
  <div class="cover-scrim"></div>
  %(stack_mark)s
  <div class="cover-text">
    <h1>%(title)s</h1>
    <p class="p-facts">%(facts)s</p>
    <p class="p-eyebrow on-photo cover-congregation">%(congregation)s</p>
    %(led_row)s
  </div>
  <div class="cover-strip">%(cover_contact)s%(partner_logos)s</div>
</div>""" % dict(
        hero_img=('<img src="%s" alt="">' % hero) if hero else '',
        congregation=congregation, title=title,
        facts=' &middot; '.join(b for b in [dates, duration, group_size] if b),
        led_row=led_row, stack_mark=stack_mark,
        cover_contact=cover_contact,
        partner_logos=partner_logos_html(),
    )

    body_html = cover_html + """
<div class="flow">
  <div class="p-cols journey">
    <div class="journey-copy">
      <p class="p-eyebrow">Overview</p>
      <h2>The Journey</h2>
      %(intro)s
      %(highlights)s
    </div>
    <div class="journey-glance">
      <p class="p-eyebrow">At a Glance</p>
      <div class="glance-list">%(glance_items)s</div>
      <p class="p-eyebrow" style="margin-top:1.4em">Itinerary at a Glance</p>
      <ul class="p-itin-glance">%(itin_glance)s</ul>
    </div>
  </div>

  <div class="day-flow-page">%(days_html)s%(closing_photo)s</div>

  <section class="p-hosts"><p class="p-eyebrow">Your Hosts</p>
  <div class="hosts-full-list">%(hannah)s%(guides)s</div></section>

  <section class="p-final">
  <div class="p-cols included-cols">
    <div><p class="p-eyebrow">What&rsquo;s Included</p>%(included)s</div>
    <div><p class="p-eyebrow">Not Included</p>%(not_included)s</div>
  </div>
  %(price_section)s
  %(notes)s
  %(about_company)s
  <div class="p-closing">
  <div class="p-contact">
    <p class="p-eyebrow">Questions or to Register Your Interest</p>
    %(contact_rows)s
  </div>
  %(compact_mark)s
  </div>
  </section>
</div>""" % dict(
        intro=intro,
        highlights=('<p class="p-eyebrow" style="margin-top:1.6em">Highlights</p><ul class="p-highlights">%s</ul>'
                     % bullet_items('highlights')) if g.get('highlights') else '',
        glance_items=glance_items,
        itin_glance=itin_glance_items(),
        days_html=days_html,
        closing_photo=closing_photo_html(),
        hannah=hannah_html, about_company=about_company_html(), guides=guides_html,
        included=included, not_included=not_included,
        price_section=('<p class="p-price">%s</p>' % price_note) if price_note else '',
        notes=notes_html(),
        contact_rows=contact_rows,
        compact_mark=compact_mark,
    )

    html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>%(title)s | Trip Details</title>
<link rel="stylesheet" href="../../assets/app.css?v=%(ver)s">
<style>%(print_fonts)s</style>
<style>
  @page { size: Letter; margin: 0; }
  body::before,body::after{display:none!important;content:none!important} /* the site's grain overlay rasterises per page in PDF */
  *{box-sizing:border-box}
  html{background:#fff9f3;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{margin:0;background:#fff9f3;color:#282819;font-family:var(--body);font-size:12.5pt;line-height:1.6;orphans:3;widows:3}
  h1,h2,h3{font-family:var(--display);font-weight:600;color:#282819;margin:0 0 .3em}
  h2,h3,h4{break-after:avoid;page-break-after:avoid}
  p{margin:0 0 .7em}
  .sheet{position:relative;width:8.5in;height:11in;overflow:hidden}
  .sheet.cover{page:cover;break-after:page;page-break-after:always}

  /* ---- continuous flow: everything after the cover, natural pagination ---- */
  .flow{padding:0.7in 0.7in 0.8in;-webkit-box-decoration-break:clone;box-decoration-break:clone;background:#fff9f3}

  .p-eyebrow{text-transform:uppercase;letter-spacing:.2em;font-size:9pt;font-weight:700;color:#7d9065;font-family:var(--body);margin:0 0 .5em}
  .p-eyebrow-sm{text-transform:uppercase;letter-spacing:.2em;font-size:9pt;font-weight:700;color:#7d9065;font-family:var(--body);margin:0 0 .3em}

  /* ---- cover: full-bleed photo, no padding ---- */
  .sheet.cover{background:#282819}
  .sheet.cover > img{position:absolute;inset:0;width:100%%;height:100%%;object-fit:cover}
  .sheet.cover .led-p img{position:static;inset:auto}
  .cover-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,20,10,.42) 0%%,rgba(20,20,10,0) 30%%,rgba(20,20,10,0) 55%%,rgba(20,20,10,.86) 100%%)}

  /* stacked lockup, top-right, on-photo cream — mirrors .brand-stack from css.tmpl */
  /* Lockups use the SITE's own .brand rules from app.css; print only positions them
     and pins the on-photo / on-light colours the site applies by context. */
  .p-brand-stack,.p-brand-compact{--tagline:var(--body)}
  .p-brand-stack{position:absolute;left:0.6in;top:0.55in;--logo:85px}
  .p-brand-stack .brand-word{color:#fff;text-shadow:0 1px 10px rgba(0,0,0,.28)}
  .p-brand-stack .brand-tx{color:#fff;opacity:1;text-shadow:0 1px 10px rgba(0,0,0,.28)}
  /* in the continuous flow this sits after the contact block in normal
     document order (not pinned to a fixed sheet bottom, which in a flow
     of unknown total height would land it over unrelated content) */
  .p-brand-compact{margin-top:0.12in;position:static!important;inset:auto!important;height:auto!important;min-height:0!important;max-height:none!important;width:auto!important;display:block!important;transform:none!important}
  .p-brand-compact .brand{position:static;height:auto}
  .p-brand-compact .brand-word{color:var(--green-d);text-shadow:none}
  .p-brand-compact .brand-tx{color:var(--green-d)}
  /* neutralise site-wide layout rules that must not leak into print */
  .sheet section,.sheet footer{all:revert}
  .p-brand-compact{background:none;box-shadow:none;height:auto;width:auto;padding:0}
  .p-brand-compact::before,.p-brand-compact::after{content:none}
  .p-brand-compact,.p-brand-compact .brand{border:0!important}
  .sheet a{color:inherit;text-decoration:none}

  .cover-text{position:absolute;left:0.6in;right:0.6in;bottom:1.5in;color:#fffdfa}
  .cover-text .p-eyebrow.on-photo{color:rgba(255,253,250,.85)}
  .cover-text h1{font-size:40pt;color:#fffdfa;line-height:1.04;margin:.1em 0 .3em}
  .cover-congregation{margin:.35em 0 0}
  .p-facts{font-size:12.5pt;color:#f3ead9;font-family:var(--body);letter-spacing:.01em;margin-bottom:.4in}
  .cover-led{display:flex;align-items:center;gap:.25in;padding-top:.3in;border-top:1px solid rgba(255,253,250,.35)}
  .led-cell{display:flex;align-items:center;gap:.14in;width:2.3in}
  .led-p{flex:none;width:0.75in;height:0.75in;border-radius:50%%;overflow:hidden;border:1.5px solid #e6d9c2;box-shadow:0 0 0 3px #282819}
  .led-p img{width:100%%;height:100%%;display:block;object-fit:cover}
  .led-names{font-family:var(--body);font-size:10.5pt;color:#fffdfa;margin:0;line-height:1.3}
  .led-role{display:block;text-transform:uppercase;letter-spacing:.2em;font-size:8pt;font-weight:700;color:#e6d9c2;margin-top:.15em}
  .cover-strip{position:absolute;left:0;right:0;bottom:0;background:#fff9f3;color:#282819;padding:.3in 0.6in;font-family:var(--body);font-size:9.5pt;letter-spacing:.02em;display:flex;align-items:center;justify-content:space-between;gap:0.4in}
  .cover-contact{margin:0}
  .p-partner-logos{display:flex;align-items:center;gap:0.18in;flex:none}
  .p-partner-label{text-transform:uppercase;letter-spacing:.16em;font-size:7.5pt;font-weight:700;color:#7d9065;white-space:nowrap}
  .p-partner-row{display:flex;align-items:center;gap:0.16in}
  .p-partner-logo{display:inline-flex;align-items:center;height:0.28in}
  .p-partner-logo img{height:100%%;width:auto;display:block;filter:grayscale(1)}
  .p-closing-photo{width:100%%;height:2.4in;overflow:hidden;margin:.35in 0 0;border-radius:2px;break-inside:avoid;page-break-inside:avoid}
  .p-closing-photo img{width:100%%;height:100%%;display:block;object-fit:cover}

  /* ---- journey / at-a-glance (page 2) ---- */
  .p-cols{display:flex;gap:0.55in}
  .p-cols > div{flex:1}
  /* the 2210a8a overview look: intro/highlights beside at-a-glance, as a
     CSS grid rather than flex — a grid row simply doesn't fragment (its
     items are locked to one row height), so as long as the two columns'
     content fits within a page this reproduces the original side-by-side
     layout cleanly; only the day-1 feature below is left to paginate
     naturally onto the next page */
  .p-cols.journey{display:grid;grid-template-columns:1fr 2.6in;gap:0 0.55in;align-items:start}
  .journey-glance{border-left:1px solid #ebe1d1;padding-left:0.55in;padding-top:0;margin-top:0;max-width:none}
  .glance-list{display:flex;flex-direction:column}
  .glance-item{padding:10px 0;border-bottom:1px solid #ebe1d1;break-inside:avoid;page-break-inside:avoid}
  .glance-item:first-child{padding-top:0}
  .gl-label{display:block;text-transform:uppercase;letter-spacing:.2em;font-size:9pt;font-weight:700;font-family:var(--body);color:#7d9065;margin-bottom:3px}
  .gl-value{display:block;font-size:10.5pt;line-height:1.35;color:#282819}
  .journey-copy p{font-size:10.5pt;line-height:1.5;color:#555a45;margin:0 0 .5em}
  .p-highlights{list-style:none;margin:0;padding:0;column-count:1;font-size:10.5pt;line-height:1.5;color:#555a45}
  .p-highlights li{position:relative;padding-left:1.05em;margin:.24em 0;line-height:1.32}
  .p-highlights li::before{content:'';position:absolute;left:0;top:.55em;width:5px;height:5px;background:#7d9065;border-radius:50%%}
  ul.p-highlights{padding-left:0}
  .p-itin-glance{list-style:none;margin:0;padding:0;font-size:10.5pt;line-height:1.35;color:#555a45}
  .p-itin-glance li{padding:5px 0;border-bottom:1px solid #ebe1d1;line-height:1.3;break-inside:avoid;page-break-inside:avoid}
  .p-itin-glance li:first-child{padding-top:0}

  /* ---- day by day, full copy: each .day is a header (eyebrow/title/
     subtitle/photo, never split) followed by heading+bullets groups (each
     never split); the browser breaks pages wherever they naturally fall.
     Day 1 runs full-width as the page-2 feature; days 2+ are two-up cards
     built with floats (see day-row/day-card below) ---- */
  .day{break-before:auto}
  .p-day-header{break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid}
  .p-day-header + h4,.p-day-header + h4 + ul{break-before:avoid;page-break-before:avoid}
  .day-flow-page h3{font-size:16.5pt;margin-bottom:.08em}
  .p-day-sub{font-family:var(--body);font-style:italic;font-size:10.5pt;color:#8a8270;margin:0 0 .3em}
  .p-day-photo{width:100%%;height:2.4in;overflow:hidden;margin:.1em 0 .2em;border-radius:2px;break-inside:avoid;page-break-inside:avoid}
  .p-day-photo img{width:100%%;height:100%%;display:block;object-fit:cover}
  .p-day-group{break-inside:avoid;page-break-inside:avoid}
  .day-flow-page h4{font-size:12pt;font-family:var(--display);font-weight:600;color:#282819;margin:.9em 0 .2em}
  .day-flow-page h4:first-of-type{margin-top:.05em}
  .day-flow-page ul{list-style:none;margin:0 0 .1em;padding:0}
  .day-flow-page li{position:relative;padding-left:1em;margin:.22em 0;font-size:10.5pt;line-height:1.5;color:#555a45}
  .day-flow-page li::before{content:'';position:absolute;left:0;top:.55em;width:4px;height:4px;background:#7d9065;border-radius:50%%}
  .p-day-meta{font-family:var(--body);font-size:10.5pt;color:#8a8270;margin-top:.3em;margin-bottom:.5em}
  /* one rule set for EVERY day (feature and cards alike): same eyebrow, title, subtitle,
     body size, photo height and a fixed gap + hairline between consecutive days */
  .day1-feature,.day-card,.day-card-solo{font-size:10.5pt;width:100%%;float:none}
  /* hairline sits BELOW each day (not above, where it reads as a stray
     line under the header when a day lands at the top of a page); the
     gap between days is unchanged, just relocated to the trailing edge.
     No line after the very last day (.day-last). */
  .day1-feature{margin-top:.3in;padding-bottom:.3in;border-bottom:1px solid #ebe1d1}
  .day-row{display:block}
  .day-card,.day-row-solo{margin-top:.45in;padding-bottom:.3in;border-bottom:1px solid #ebe1d1}
  .day-row-solo .day-card{margin-top:0;padding-bottom:0;border-bottom:0}
  .day-last.day1-feature,.day-row-solo.day-last,.day-card.day-last{border-bottom:0;padding-bottom:0}
  .day-break{break-before:page;page-break-before:always}
  .day1-feature .p-day-photo,.day-card .p-day-photo,.day-card-solo .p-day-photo{height:2.2in}
  .day-flow-page h3,.day1-feature h3,.day-card h3,.day-card-solo h3{font-size:16.5pt;font-family:var(--display);font-weight:600;color:#282819;margin:0 0 .08em}
  .day1-feature .p-eyebrow-sm,.day-card .p-eyebrow-sm{font-size:9pt;letter-spacing:.18em;color:#7d9065;margin:0 0 .3em}
  .p-hosts{break-before:page;page-break-before:always;break-after:avoid;margin:0;padding:0;font-size:10.5pt;height:9.5in;overflow:visible}
  .hosts-full-list{column-count:2;column-gap:.3in;column-fill:auto;height:9.3in}
  .host-full{break-inside:auto}
  .p-hosts p{font-size:10.5pt;line-height:1.4;color:#555a45;margin:.2em 0}
  .p-hosts .host-full-portrait{width:.9in;height:.9in;margin:0 .18in .08in 0}
  .hosts-full-list{margin-bottom:0}
  .flow section{padding:0;margin:0}
  .p-final{break-before:page;page-break-before:always;font-size:10.5pt;margin:0;padding:0}
  .p-final .p-cols,.p-final .p-notes,.p-final .p-closing{break-inside:avoid;page-break-inside:avoid}
  .p-final .included-cols{margin-top:0;padding-top:0}
  .p-final li,.p-final p{font-size:10.5pt;line-height:1.4;color:#555a45}
  .p-final .p-eyebrow{margin-bottom:.3em}
  .p-final li{margin:.12em 0}
  .p-hosts .p-eyebrow{margin-top:0}
  .p-hosts .p-eyebrow{break-after:avoid}

  /* ---- hosts: full bios, each never split (but the two hosts can) ---- */
  .hosts-full-list{display:block;margin-bottom:.3in}
  .hosts-full-list > * + *{margin-top:.25in}
  .host-full{display:block;break-inside:auto}
  .host-full-portrait{float:left;margin:0 .35in .15in 0}
  .host-full::after{content:'';display:table;clear:both}
  .host-full-portrait{flex:0 0 auto;width:1.7in;height:1.7in;overflow:hidden;border-radius:2px}
  .host-full-portrait img{width:100%%;height:100%%;display:block;object-fit:cover}
  .host-full-copy{display:block;orphans:3;widows:3}
  .host-full-copy h3,.host-full-copy .p-eyebrow{break-after:avoid}
  .host-full-copy h3{font-size:16.5pt;margin:0 0 .02em;line-height:1.1}
  .p-hosts .host-full-copy p{font-size:10.5pt;line-height:1.4;color:#555a45;margin:0 0 .25em}
  .host-role{font-family:var(--body);text-transform:uppercase;letter-spacing:.2em;font-size:9pt;font-weight:700;color:#7d9065;margin-bottom:.35em}

  /* ---- closing: included / notes / contact ---- */
  .included-cols{margin-bottom:.1in;break-inside:avoid;page-break-inside:avoid}

  ul{margin:.15em 0;padding-left:1.2em}
  li{margin:.22em 0;font-size:10.5pt;line-height:1.5;color:#555a45}
  .p-price{font-style:italic;color:#8a8270;margin:.1in 0 0;font-size:10.5pt}
  .p-notes{margin-top:.06in}
  .p-notes-list{column-count:2;column-gap:.3in}
  .p-notes .p-eyebrow{break-after:avoid}
  .p-notes-list{list-style:none;margin:0;padding:0;column-count:2;column-gap:0.4in;-webkit-column-count:2}
  .p-notes-list li{font-size:10.5pt;line-height:1.4;margin:0 0 .18em;break-inside:avoid}
  .p-notes-list li b{color:#282819}
  .p-contact{margin-top:.1in;padding-top:.1in;border-top:1px solid #ebe1d1}
  .p-contact p{margin:.25em 0;font-size:10.5pt;line-height:1.5;color:#555a45}
</style>
</head><body>
%(body)s
</body></html>""" % dict(
        title=title, ver=VER, body=body_html, print_fonts=R('fonts_print.css'),
    )
    return html

groups_built = build_groups()

# ---- self-contained English homepage for the artifact ----
def datauri(path):
    mt = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    return 'data:%s;base64,%s' % (mt, base64.b64encode(open(os.path.join(D, path), 'rb').read()).decode())

body = fill_content(R('home.body.html').replace('__HEADER__', header).replace('__FOOTER__', footer)
        .replace('__DISCOVER__', discover)).replace('__LANGNAV__', langnav('en', 'index.html', TRANS['en']))
css_self = css_raw
for tok, rel in imgmap.items():
    css_self = css_self.replace(tok, datauri(rel))
    body = body.replace(tok, datauri(rel))
sc = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
      '<meta name="viewport" content="width=device-width, initial-scale=1">'
      '<title>L’Dor Vador | Jewish Heritage Travel to Curaçao</title>'
      '<style>%s</style></head><body>\n%s\n<script>%s</script></body></html>'
      % (css_self, body, R('js.tmpl')))
W('home_selfcontained.html', sc)

# ---- deploy support: redirects always; robots/sitemap only for production ----
W('_redirects', '/home / 301\n/cart / 301\n')
W('_headers', '''/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; media-src 'self'; connect-src 'self' https://api.web3forms.com https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self' https://api.web3forms.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'
''')
def _listed_slugs():
    gdir = os.path.join(D, 'content', 'groups')
    out = []
    if not os.path.isdir(gdir) or os.environ.get('LDV_PLACEBO'):
        return out
    for fn in sorted(os.listdir(gdir)):
        if fn.startswith('.') or not fn.endswith('.json'):
            continue
        try:
            g = json.load(open(os.path.join(gdir, fn), encoding='utf-8'))
        except Exception:
            continue
        if g.get('published') is False or not g.get('listed'):
            continue
        out.append(g.get('slug') or fn[:-5])
    return out

if PROD:
    W('robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n' % SITE)
    urls = []
    for page in PAGES:
        alts = ''.join('  <xhtml:link rel="alternate" hreflang="%s" href="%s"/>\n'
                       % (HTMLLANG[c], page_url(c, page)) for c in LOCALES)
        for c in LOCALES:
            urls.append(' <url>\n  <loc>%s</loc>\n%s </url>' % (page_url(c, page), alts))
    # /groups/ is always indexable and in the sitemap; individual trip pages
    # join it only when their `listed` flag opts them in (see build_groups)
    urls.append(' <url>\n  <loc>%s/groups/</loc>\n </url>' % SITE)
    for slug in _listed_slugs():
        urls.append(' <url>\n  <loc>%s/groups/%s/</loc>\n </url>' % (SITE, slug))
    W('sitemap.xml',
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
      'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n%s\n</urlset>\n' % '\n'.join(urls))

print('built %d pages across %s%s' % (built, ', '.join(LOCALES),
      ' [PRODUCTION: %s]' % SITE if PROD else ' [preview]'))
print('group pages built:', groups_built)
print('images mapped:', len(imgmap))
