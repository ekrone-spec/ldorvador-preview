#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the site in English (root) plus /es/, /nl/ and /he/.

Hand-built localisation: one set of source templates, translated at build time
from locales/<code>.json. Each locale gets its own folder of real HTML pages,
its own <html lang>/dir, hreflang tags, and a language switcher wired to the
matching page in every other locale.
"""
import os, re, json, base64, mimetypes
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
def build_groups():
    gdir = os.path.join(D, 'content', 'groups')
    if not os.path.isdir(gdir):
        return 0
    tmpl = re.sub(r'^\s*<!--.*?-->\s*', '', R('group.body.html'), count=1, flags=re.S)
    n = 0
    for fn in sorted(os.listdir(gdir)):
        if fn.startswith('.') or not fn.endswith('.json'):
            continue
        g = json.load(open(os.path.join(gdir, fn), encoding='utf-8'))
        if g.get('published') is False:
            continue
        slug = g.get('slug') or fn[:-5]

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
                paras = ''.join('<p>%s</p>' % _cesc(ln) for ln in
                                 str(d.get('text') or '').split('\n') if ln.strip())
                img = d.get('image')
                img_html = ('<img src="%s" alt="" loading="lazy">' % gimg(img)) if img else ''
                out.append(
                    '<div class="group-day" id="day-%d"><div class="gday-head"><span class="gday-n">%s</span>'
                    '<span class="gday-t">%s</span></div>'
                    '<div class="gday-body">%s%s</div></div>'
                    % (i + 1, day, title, img_html, paras))
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

        def pdf_link():
            pdf = g.get('pdf')
            if not pdf:
                return ''
            return '<a class="btn btn-line" href="%s" download>Download trip details (PDF)</a>' % gimg(pdf)

        def pdf_link_hero():
            pdf = g.get('pdf')
            if not pdf:
                return ''
            return ('<a class="btn btn-line on-photo grouphero-pdf" href="%s" download>'
                    'Download trip details (PDF)</a>' % gimg(pdf))

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
            '__G_LEADER__':      gv('leader'),
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
            '__G_HIGHLIGHTS_LIST__':   bullets('highlights'),
            '__G_ITIN_GLANCE__':       itin_glance(),
            '__G_ITINERARY_ROWS__':    itinerary_rows(),
            '__G_VIGNETTES__':         vignettes(),
            '__G_GALLERY__':           gallery(),
            '__G_PDF_LINK__':          pdf_link(),
            '__G_PDF_LINK_HERO__':     pdf_link_hero(),
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
        head = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width, initial-scale=1">'
                '<meta name="robots" content="noindex,nofollow">'
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
    return n

# ---- printable trip-details page: content/groups/<slug>.json -> /groups/<slug>/print.html ----
# Self-contained (inline CSS), noindex, not in the sitemap or golden manifest.
# Rendered to PDF locally by make_pdf.py — the Cloudflare build has no Chrome.
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

    def days():
        out = []
        for d in (g.get('itinerary') or []):
            day = _cesc(d.get('day'))
            title = _cesc(d.get('title'))
            paras = ''.join('<p>%s</p>' % _cesc(ln) for ln in
                             str(d.get('text') or '').split('\n') if ln.strip())
            img = d.get('image')
            img_html = ('<img src="%s" alt="">' % pimg(img)) if img else ''
            out.append('<div class="p-day">%s<div class="p-day-copy"><h3>%s &middot; %s</h3>%s</div></div>'
                        % (img_html, day, title, paras))
        return ''.join(out)

    title = pv('title')
    congregation = pv('congregation')
    subtitle = pv('subtitle')
    dates = pv('dates')
    duration = pv('duration')
    group_size = pv('group_size')
    leader = pv('leader')
    hero = pimg(g.get('hero_image'))
    intro = ''.join('<p>%s</p>' % _cesc(ln) for ln in
                     str(g.get('intro') or '').split('\n') if ln.strip())
    page_url = '%s/groups/%s/' % (SITE, slug)
    contact_email = pv('contact_email') or 'connect@ldorvadortravel.com'
    contact_phone = pv('contact_phone')

    glance_rows = ''.join(
        '<tr><th>%s</th><td>%s</td></tr>' % (label, val) for label, val in [
            ('Dates', dates), ('Duration', duration), ('Group size', group_size),
            ('Start / finish', pv('start_finish')), ('Pace', pv('pace')),
            ('Accommodation', pv('accommodation')),
        ] if val)

    contact_rows = ''
    if contact_email:
        contact_rows += '<p>Email: <b>%s</b></p>' % contact_email
    if contact_phone:
        contact_rows += '<p>Phone: <b>%s</b></p>' % contact_phone
    contact_rows += '<p>Online: <b>%s</b></p>' % page_url

    price_note = pv('price_note')

    html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>%(title)s | Trip Details</title>
<style>
  %(display_face)s
  @page { size: Letter; margin: 0; }
  *{box-sizing:border-box}
  body{margin:0;background:#fff9f3;color:#282819;font-family:Georgia,'Times New Roman',serif;font-size:13.5pt;line-height:1.5}
  h1,h2,h3{font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:600;color:#282819;margin:0 0 .3em}
  .p-body{padding:0 0.6in 0.6in}
  .p-cover{position:relative;margin:0 0 24px;height:3.2in;overflow:hidden;background:#282819}
  .p-cover img{width:100%%;height:100%%;object-fit:cover;opacity:.82}
  .p-cover-text{position:absolute;left:0;right:0;bottom:0;padding:28px 40px;color:#fffdfa;background:linear-gradient(0deg,rgba(20,20,10,.72),rgba(20,20,10,0))}
  .p-eyebrow{text-transform:uppercase;letter-spacing:.22em;font-size:11pt;font-weight:700;color:#e6d9c2;font-family:Helvetica,Arial,sans-serif}
  .p-cover-text h1{font-size:28pt;color:#fffdfa;margin:.15em 0}
  .p-facts{font-size:13pt;color:#f3ead9;font-family:Helvetica,Arial,sans-serif}
  section{margin:0 0 26px}
  h2{font-size:17pt;border-bottom:2px solid #ebe1d1;padding-bottom:6px;margin-bottom:12px}
  table.glance{width:100%%;border-collapse:collapse;font-size:13pt}
  table.glance th{text-align:left;color:#555a45;font-weight:700;padding:6px 14px 6px 0;width:34%%;vertical-align:top;font-family:Helvetica,Arial,sans-serif;font-size:11.5pt;text-transform:uppercase;letter-spacing:.06em}
  table.glance td{padding:6px 0;vertical-align:top}
  table.glance tr{border-bottom:1px solid #ebe1d1}
  ul{margin:.2em 0;padding-left:1.3em}
  li{margin:.35em 0}
  .p-cols{display:flex;gap:36px}
  .p-cols > div{flex:1}
  .p-day{display:flex;gap:16px;margin-bottom:16px;page-break-inside:avoid}
  .p-day img{width:1.6in;height:1.15in;object-fit:cover;border-radius:4px;flex:none}
  .p-day-copy h3{font-size:13.5pt;color:#555a45;margin-bottom:.25em}
  .p-day-copy p{margin:.25em 0}
  .p-price{font-style:italic;color:#555a45}
  .p-contact{background:#f3ead9;border-radius:8px;padding:20px 26px;page-break-inside:avoid}
  .p-contact p{margin:.3em 0;font-size:13pt}
  .p-footer{margin-top:18px;font-size:10pt;color:#8a8270;font-family:Helvetica,Arial,sans-serif}
</style>
</head><body>

<div class="p-cover">
  %(hero_img)s
  <div class="p-cover-text">
    <p class="p-eyebrow">%(congregation)s</p>
    <h1>%(title)s</h1>
    <p class="p-facts">%(dates)s &middot; %(duration)s &middot; %(group_size)s%(leader_suffix)s</p>
  </div>
</div>

<div class="p-body">
<section>
  <h2>Overview</h2>
  %(intro)s
</section>

<section>
  <h2>At a Glance</h2>
  <table class="glance">%(glance_rows)s</table>
</section>

%(highlights_section)s

<section>
  <h2>Day by Day</h2>
  %(days)s
</section>

<section class="p-cols">
  <div><h2>What's Included</h2>%(included)s</div>
  <div><h2>Not Included</h2>%(not_included)s</div>
</section>

%(price_section)s

<section class="p-contact">
  <h2 style="border:0;margin-bottom:8px">Questions or to Register Your Interest</h2>
  %(contact_rows)s
</section>

<p class="p-footer">L'Dor Vador Travel &middot; %(page_url)s</p>
</div>

</body></html>""" % dict(
        title=title, congregation=congregation, subtitle=subtitle,
        display_face=_print_display_face(),
        hero_img=('<img src="%s" alt="">' % hero) if hero else '',
        dates=dates, duration=duration, group_size=group_size,
        leader_suffix=(' &middot; Led by %s' % leader) if leader else '',
        intro=intro, glance_rows=glance_rows,
        highlights_section=('<section><h2>Highlights</h2>%s</section>' % bullets('highlights')) if g.get('highlights') else '',
        days=days(),
        included=bullets('included'), not_included=bullets('not_included'),
        price_section=('<section><p class="p-price">%s</p></section>' % price_note) if price_note else '',
        contact_rows=contact_rows, page_url=page_url,
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
if PROD:
    W('robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n' % SITE)
    urls = []
    for page in PAGES:
        alts = ''.join('  <xhtml:link rel="alternate" hreflang="%s" href="%s"/>\n'
                       % (HTMLLANG[c], page_url(c, page)) for c in LOCALES)
        for c in LOCALES:
            urls.append(' <url>\n  <loc>%s</loc>\n%s </url>' % (page_url(c, page), alts))
    W('sitemap.xml',
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
      'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n%s\n</urlset>\n' % '\n'.join(urls))

print('built %d pages across %s%s' % (built, ', '.join(LOCALES),
      ' [PRODUCTION: %s]' % SITE if PROD else ' [preview]'))
print('group pages built:', groups_built)
print('images mapped:', len(imgmap))
