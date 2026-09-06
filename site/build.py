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
_story_bios_cache = None
def _story_bios():
    """Hosts content for the trip-details PDF, pulled from content/story.json
    so the hosts page is identical across every group's brochure. Hannah's
    bio is a run of discrete p_2.. paragraphs (one, p_3, continues an inline
    link that splits p_2 — rejoined here); Cornelis's is one long p_10 field
    with blank-line-separated paragraphs."""
    global _story_bios_cache
    if _story_bios_cache is None:
        try:
            story = json.load(open(os.path.join(D, 'content', 'story.json'), encoding='utf-8'))
            bio = story.get('bio') or {}
        except Exception:
            bio = {}
        hannah_p1 = ' '.join(x for x in [bio.get('p_2'), bio.get('a_1'), bio.get('p_3')] if x)
        hannah = {
            'name': bio.get('h2_1') or 'Hannah Berkeley Cohen',
            'role': bio.get('p_1') or 'Co-founder',
            'paras': [p for p in [hannah_p1, bio.get('p_4')] if p][:2],
        }
        cornelis_paras = [p.strip() for p in str(bio.get('p_10') or '').split('\n\n') if p.strip()]
        cornelis = {
            'name': bio.get('h2_2') or 'Cornelis Greiwe',
            'role': bio.get('p_9') or 'Co-founder',
            'paras': cornelis_paras[:2],
        }
        _story_bios_cache = (hannah, cornelis)
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
    leader = pv('leader')
    leader_image = g.get('leader_image')
    hero = pimg(g.get('hero_image'))
    intro = ''.join('<p>%s</p>' % _cesc(ln) for ln in
                     str(g.get('intro') or '').split('\n') if ln.strip())
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

    # ---- day-by-day ----
    itinerary = g.get('itinerary') or []
    rest_days = itinerary[1:]  # day 1 is the page-2 feature; the grid starts at day 2
    n_rest = len(rest_days)
    # photo sizing per plan: <=6 remaining days -> 1.7in; <=8 -> 1.3in; beyond 8, no photo
    if n_rest <= 6:
        grid_photo_h = '1.7in'
    else:
        grid_photo_h = '1.3in'

    def day_meta(d):
        overnight = _cesc(d.get('overnight'))
        meals = _cesc(d.get('meals'))
        bits = []
        if overnight:
            bits.append('Overnight in %s' % overnight)
        if meals:
            bits.append('(%s)' % meals)
        return ' &middot; '.join(bits)

    def day_cell(d, idx):
        day = _cesc(d.get('day'))
        date = _cesc(d.get('date'))
        dtitle = _cesc(d.get('title'))
        paras = ''.join('<p>%s</p>' % _cesc(ln) for ln in
                         str(d.get('text') or '').split('\n') if ln.strip())
        img = d.get('image')
        eyebrow = '%s%s' % (day, ' &middot; %s' % date if date else '')
        meta = day_meta(d)
        meta_html = ('<p class="p-day-meta">%s</p>' % meta) if meta else ''
        show_img = img and idx < 8  # drop photos for the 7th+ grid day
        media_html = '<div class="p-day-img"><img src="%s" alt=""></div>' % pimg(img) if show_img else ''
        return ('<div class="p-day"><div class="p-day-body">%s'
                '<p class="p-eyebrow-sm">%s</p><h3>%s</h3>%s%s</div></div>'
                % (media_html, eyebrow, dtitle, paras, meta_html))

    def day1_feature(d):
        day = _cesc(d.get('day'))
        date = _cesc(d.get('date'))
        dtitle = _cesc(d.get('title'))
        paras = ''.join('<p>%s</p>' % _cesc(ln) for ln in
                         str(d.get('text') or '').split('\n') if ln.strip())
        img = pimg(d.get('image') or g.get('hero_image'))
        eyebrow = '%s%s' % (day, ' &middot; %s' % date if date else '')
        meta = day_meta(d)
        meta_html = ('<p class="p-day-meta">%s</p>' % meta) if meta else ''
        return ('<div class="p-day1"><p class="p-eyebrow-sm">%s</p><h3>%s</h3>'
                '<div class="p-day1-img"><img src="%s" alt=""></div>%s%s</div>'
                % (eyebrow, dtitle, img, paras, meta_html))

    day1_block_html = day1_feature(itinerary[0]) if itinerary else ''
    day_grid_html = ''.join(day_cell(d, i) for i, d in enumerate(rest_days))

    # ---- hosts (compact block on the closing page) ----
    hannah, cornelis = _story_bios()
    def host_col(h, img):
        one_para = ' '.join(h['paras'])
        text = _cap_words(one_para, 60)
        # if capping at 60 leaves a very short sentence, that's fine; if the
        # whole bio is under 45 words the source copy is used as-is
        return ('<div class="host-col"><div class="host-portrait"><img src="../../%s" alt=""></div>'
                '<div class="host-copy"><h3>%s</h3><p class="host-role">%s</p><p>%s</p></div></div>'
                % (img, _cesc(h['name']), _cesc(h['role']), _cesc(text)))
    hosts_html = host_col(hannah, 'assets/img/hannah.jpg') + host_col(cornelis, 'assets/img/cornelis.jpg')

    included = bullets('included')
    not_included = bullets('not_included')

    contact_rows = ''
    if contact_email:
        contact_rows += '<p>Email &middot; <b>%s</b></p>' % contact_email
    if contact_phone:
        contact_rows += '<p>Phone &middot; <b>%s</b></p>' % contact_phone
    contact_rows += '<p>Online &middot; <b>%s</b></p>' % page_url

    # ---- led-by row on the cover ----
    led_portraits = ('<div class="led-portraits">'
                     '<span class="led-p"><img src="../../assets/img/hannah.jpg" alt=""></span>'
                     '<span class="led-p"><img src="../../assets/img/cornelis.jpg" alt=""></span>'
                     + ('<span class="led-p"><img src="%s" alt=""></span>' % pimg(leader_image) if leader and leader_image else '')
                     + '</div>')
    led_names = ('<p class="led-names">Hannah Berkeley Cohen &amp; Cornelis Greiwe'
                 '<br><span class="led-role">Co-founders</span>'
                 + ('<br><span class="led-with">with %s</span>' % leader if leader else '') + '</p>')
    led_row = '<div class="cover-led">%s%s</div>' % (led_portraits, led_names)

    cover_contact_bits = [b for b in [contact_email, contact_phone, 'www.ldorvadortravel.com'] if b]
    cover_contact = '<p class="cover-contact">%s</p>' % ' &middot; '.join(cover_contact_bits)

    # ---- stacked lockup (cover, on-photo, cream) and compact lockup (closing page) ----
    stack_mark = ('<div class="brand-stack-mark"><span class="bm-name">'
                  '<span class="bm-word">L&rsquo;Dor</span><span class="bm-word">Vador</span></span>'
                  '<span class="bm-tag">Heritage Travel</span></div>')
    compact_mark = ('<div class="brand-compact-mark"><span class="bc-name">'
                     '<span class="bc-word">L&rsquo;Dor</span><span class="bc-word">Vador</span></span>'
                     '<span class="bc-tag">Heritage Travel</span></div>')

    # ---- assemble the 4 sheets, then number pages 2-4 ----
    sheets = []
    sheets.append(('cover', """
<div class="sheet cover">
  %(hero_img)s
  <div class="cover-scrim"></div>
  %(stack_mark)s
  <div class="cover-text">
    <p class="p-eyebrow on-photo">%(congregation)s</p>
    <h1>%(title)s</h1>
    <p class="p-facts">%(dates)s &middot; %(duration)s &middot; %(group_size)s</p>
    %(led_row)s
  </div>
  <div class="cover-strip">%(cover_contact)s</div>
</div>""" % dict(
        hero_img=('<img src="%s" alt="">' % hero) if hero else '',
        congregation=congregation, title=title, dates=dates, duration=duration,
        group_size=group_size, led_row=led_row, stack_mark=stack_mark,
        cover_contact=cover_contact,
    )))

    sheets.append(('body', """
<div class="sheet page">
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
    </div>
  </div>
  %(day1)s
</div>""" % dict(
        intro=intro,
        highlights=('<p class="p-eyebrow" style="margin-top:1.6em">Highlights</p><ul class="p-highlights">%s</ul>'
                     % bullet_items('highlights')) if g.get('highlights') else '',
        glance_items=glance_items,
        day1=day1_block_html,
    )))

    sheets.append(('day', """
<div class="sheet page day-page">
  <div class="p-runhead"><span>%(title)s</span><span>Day by day</span></div>
  <div class="day-grid" style="--gh:%(gh)s">%(days)s</div>
</div>""" % dict(title=title, days=day_grid_html, gh=grid_photo_h)))

    sheets.append(('last', """
<div class="sheet page closing-page">
  <p class="p-eyebrow">Your Hosts</p>
  <div class="hosts-cols">%(hosts)s</div>
  <div class="p-cols included-cols">
    <div><p class="p-eyebrow">What&rsquo;s Included</p>%(included)s</div>
    <div><p class="p-eyebrow">Not Included</p>%(not_included)s</div>
  </div>
  %(price_section)s
  <div class="p-contact">
    <p class="p-eyebrow">Questions or to Register Your Interest</p>
    %(contact_rows)s
  </div>
  %(compact_mark)s
</div>""" % dict(
        hosts=hosts_html,
        included=included, not_included=not_included,
        price_section=('<p class="p-price">%s</p>' % price_note) if price_note else '',
        contact_rows=contact_rows,
        compact_mark=compact_mark,
    )))

    # number pages 2-4; the cover carries no number
    numbered = [sheets[0][1]]
    for n, (kind, markup) in enumerate(sheets[1:], start=2):
        m = markup.rstrip()
        if m.endswith('</div>'):
            m = m[:-len('</div>')] + ('<p class="p-pageno">%d</p></div>' % n)
        numbered.append(m)
    body_html = ''.join(numbered)

    html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>%(title)s | Trip Details</title>
<style>
  %(display_face)s
  @page { size: Letter; margin: 0; }
  *{box-sizing:border-box}
  body{margin:0;background:#fff9f3;color:#282819;font-family:Georgia,'Times New Roman',serif;font-size:12.5pt;line-height:1.6}
  h1,h2,h3{font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:600;color:#282819;margin:0 0 .3em}
  p{margin:0 0 .7em}
  .sheet{position:relative;page-break-after:always;width:8.5in;height:11in;overflow:hidden}
  .sheet:last-child{page-break-after:auto}
  .sheet.page{padding:0.75in 0.6in}
  .p-eyebrow{text-transform:uppercase;letter-spacing:.22em;font-size:9.5pt;font-weight:700;color:#7d9065;font-family:Helvetica,Arial,sans-serif;margin:0 0 .6em}
  .p-eyebrow-sm{text-transform:uppercase;letter-spacing:.18em;font-size:9pt;font-weight:700;color:#8fa49b;font-family:Helvetica,Arial,sans-serif;margin:0 0 .3em}

  /* ---- cover: full-bleed photo, no padding ---- */
  .sheet.cover{background:#282819}
  .sheet.cover > img{position:absolute;inset:0;width:100%%;height:100%%;object-fit:cover}
  .sheet.cover .led-p img{position:static;inset:auto}
  .cover-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,20,10,.42) 0%%,rgba(20,20,10,0) 30%%,rgba(20,20,10,0) 55%%,rgba(20,20,10,.86) 100%%)}

  /* stacked lockup, top-right, on-photo cream — mirrors .brand-stack from css.tmpl */
  .brand-stack-mark{position:absolute;right:0.6in;top:0.55in;display:flex;flex-direction:column;align-items:flex-end;line-height:.9}
  .bm-name{display:flex;flex-direction:column;align-items:flex-end;line-height:.9}
  .bm-word{font-family:'Cormorant Garamond','Fraunces',Georgia,serif;font-weight:600;font-size:38pt;line-height:.9;letter-spacing:.004em;color:#fffdfa;text-shadow:0 1px 10px rgba(0,0,0,.28)}
  .bm-tag{font-family:Helvetica,Arial,sans-serif;font-weight:400;font-size:9pt;line-height:1.2;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,253,250,.85);margin-top:4pt}

  /* compact lockup, single row, for the closing page */
  .brand-compact-mark{position:absolute;left:0.6in;bottom:0.55in;display:flex;align-items:center;gap:10pt}
  .bc-name{display:flex;flex-direction:column;align-items:flex-end;line-height:.9}
  .bc-word{font-family:'Cormorant Garamond','Fraunces',Georgia,serif;font-weight:600;font-size:14pt;line-height:.9;color:#282819}
  .bc-tag{font-family:Helvetica,Arial,sans-serif;font-weight:400;font-size:7pt;letter-spacing:.1em;text-transform:uppercase;color:#282819;opacity:.85;padding-left:10pt;border-left:1px solid #282819}

  .cover-text{position:absolute;left:0.6in;right:0.6in;bottom:1.5in;color:#fffdfa}
  .cover-text .p-eyebrow.on-photo{color:rgba(255,253,250,.85)}
  .cover-text h1{font-size:40pt;color:#fffdfa;line-height:1.04;margin:.1em 0 .3em}
  .p-facts{font-size:12.5pt;color:#f3ead9;font-family:Helvetica,Arial,sans-serif;letter-spacing:.01em;margin-bottom:.4in}
  .cover-led{display:flex;align-items:center;gap:.2in;padding-top:.3in;border-top:1px solid rgba(255,253,250,.35)}
  .led-portraits{display:flex}
  .led-p{width:0.8in;height:0.8in;border-radius:50%%;overflow:hidden;border:1.5px solid #e6d9c2;margin-right:-0.16in;box-shadow:0 0 0 3px #282819}
  .led-p:last-child{margin-right:0}
  .led-p img{width:100%%;height:100%%;object-fit:cover;display:block}
  .led-names{font-family:Helvetica,Arial,sans-serif;font-size:10.5pt;color:#fffdfa;margin:0;line-height:1.4}
  .led-role{display:block;text-transform:uppercase;letter-spacing:.14em;font-size:8pt;color:#e6d9c2;margin-top:.15em}
  .led-with{display:block;font-style:italic;color:#f3ead9}
  .cover-strip{position:absolute;left:0;right:0;bottom:0;background:#fff9f3;color:#282819;padding:.3in 0.6in;font-family:Helvetica,Arial,sans-serif;font-size:9.5pt;letter-spacing:.02em}
  .cover-contact{margin:0}

  /* ---- journey / at-a-glance (page 2) ---- */
  .p-cols{display:flex;gap:0.55in}
  .p-cols > div{flex:1}
  .journey-glance{border-left:1px solid #ebe1d1;padding-left:0.55in;max-width:2.6in}
  .glance-list{display:flex;flex-direction:column}
  .glance-item{padding:10px 0;border-bottom:1px solid #ebe1d1}
  .glance-item:first-child{padding-top:0}
  .gl-label{display:block;text-transform:uppercase;letter-spacing:.1em;font-size:9pt;font-family:Helvetica,Arial,sans-serif;color:#8a8270;margin-bottom:3px}
  .gl-value{display:block;font-size:12pt}
  .p-highlights{list-style:none;margin:0;padding:0;column-count:1}
  .p-highlights li{position:relative;padding-left:1.05em;margin:.45em 0}
  .p-highlights li::before{content:'';position:absolute;left:0;top:.55em;width:5px;height:5px;background:#7d9065;border-radius:50%%}
  ul.p-highlights{padding-left:0}

  /* ---- day 1 feature (bottom of page 2) ---- */
  .p-day1{break-inside:avoid;page-break-inside:avoid;margin-top:.35in;padding-top:.25in;border-top:1px solid #ebe1d1}
  .p-day1 h3{font-size:18pt;margin-bottom:.2em}
  .p-day1-img{width:100%%;height:2.4in;overflow:hidden;margin:.25em 0 .35em;border-radius:2px}
  .p-day1-img img{width:100%%;height:100%%;object-fit:cover;display:block}
  .p-day1 p{margin:0 0 .35em}

  /* ---- day by day grid (page 3) ---- */
  .p-runhead{display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif;font-size:8.5pt;text-transform:uppercase;letter-spacing:.14em;color:#8a8270;border-bottom:1px solid #ebe1d1;padding-bottom:10px;margin-bottom:.3in}
  .sheet.day-page{padding-top:0.55in;padding-bottom:0.55in}
  .day-grid{display:grid;grid-template-columns:1fr 1fr;gap:.3in .5in}
  .p-day{break-inside:avoid;page-break-inside:avoid}
  .p-day-body{width:100%%}
  .p-day-img{width:100%%;height:var(--gh,1.7in);overflow:hidden;margin-bottom:.15em;border-radius:2px}
  .p-day-img img{width:100%%;height:100%%;object-fit:cover;display:block}
  .p-day-body h3{font-size:16pt;margin-bottom:.15em}
  .p-day-body p{margin:0 0 .25em;font-size:11pt}
  .p-day-meta{font-family:Helvetica,Arial,sans-serif;font-size:9.5pt;color:#8a8270;margin-top:.1em;margin-bottom:0}
  .p-pageno{position:absolute;right:0.6in;bottom:0.55in;font-size:9pt;color:#8a8270;font-family:Helvetica,Arial,sans-serif;margin:0}

  /* ---- closing page: hosts / included / contact ---- */
  .closing-page{padding-bottom:1.3in}
  .hosts-cols{display:flex;gap:0.5in;margin:.15em 0 .4in}
  .host-col{flex:1;display:flex;gap:.25in;align-items:flex-start}
  .host-portrait{flex:0 0 auto;width:1.5in;height:1.5in;overflow:hidden;border-radius:2px}
  .host-portrait img{width:100%%;height:100%%;object-fit:cover}
  .host-copy{flex:1}
  .host-col h3{font-size:13pt;margin-bottom:.05em}
  .host-role{font-family:Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:.1em;font-size:8.5pt;color:#7d9065;margin-bottom:.3em}
  .host-col p{font-size:9.5pt;line-height:1.38;margin:0 0 .3em}
  .included-cols{margin-bottom:.3in}

  ul{margin:.2em 0;padding-left:1.2em}
  li{margin:.3em 0;font-size:10.5pt}
  .p-price{font-style:italic;color:#555a45;margin-top:.15in;font-size:10.5pt}
  .p-contact{margin-top:.3in;padding-top:.3in;border-top:1px solid #ebe1d1}
  .p-contact p{margin:.3em 0;font-size:12pt}
</style>
</head><body>
%(body)s
</body></html>""" % dict(
        title=title, display_face=_print_display_face(), body=body_html,
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
