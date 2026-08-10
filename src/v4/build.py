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
def W(p, s):
    full = os.path.join(D, p)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, 'w', encoding='utf-8').write(s)

SITE = 'https://ekrone-spec.github.io/ldorvador-preview/v3'

# ---- fonts: reuse the @font-face block already embedded in the built app.css ----
old_css = R('assets/app.css').splitlines()
fonts = "\n".join(old_css[1:13]) + "\n" + R('fonts_extra.css')

# ---- image token map ----
imgmap = {}
for fn in os.listdir(os.path.join(D, 'assets', 'img')):
    imgmap['__IMG_%s__' % os.path.splitext(fn)[0]] = 'assets/img/%s' % fn

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

PAGES = ['index.html', 'history.html', 'story.html', 'itinerary.html']
BODY  = {'index.html': 'home.body.html', 'history.html': 'history.body.html',
         'story.html': 'story.body.html', 'itinerary.html': 'itinerary.body.html'}

LOCALES = ['en', 'es', 'nl', 'he']
LABEL   = {'en': 'EN', 'es': 'ES', 'nl': 'NL', 'he': 'עב'}
HTMLLANG= {'en': 'en', 'es': 'es', 'nl': 'nl', 'he': 'he'}
RTL     = {'he'}

TRANS = {}
for code in LOCALES:
    p = os.path.join(D, 'locales', '%s.json' % code)
    TRANS[code] = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}

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
},
}

def rel_prefix(code):
    return '' if code == 'en' else '../'

def page_url(code, page):
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

HEAD = ('<!doctype html>\n<html lang="%s"%s><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="robots" content="noindex, nofollow">'
        '<meta name="description" content="%s">'
        '<meta property="og:title" content="%s"><meta property="og:description" content="%s">'
        '<meta property="og:type" content="website"><meta property="og:locale" content="%s">'
        '%s<link rel="canonical" href="%s">'
        '<title>%s</title><link rel="stylesheet" href="%sassets/app.css"></head><body>\n')
TAIL = '\n<script src="%sassets/app.js" defer></script></body></html>'

built = 0
for code in LOCALES:
    tr = TRANS[code]
    pre = rel_prefix(code)
    for page in PAGES:
        body = R(BODY[page])
        body = (body.replace('__HEADER__', header)
                    .replace('__FOOTER__', footer)
                    .replace('__DISCOVER__', discover))
        if code != 'en':
            body = i18n.translate(body, tr)
        body = body.replace('__LANGNAV__', langnav(code, page, tr))
        for k, v in imgmap.items():
            body = body.replace(k, pre + v)
        title, desc = META[code][page]
        head = HEAD % (HTMLLANG[code],
                       ' dir="rtl"' if code in RTL else '',
                       desc, title, desc, HTMLLANG[code],
                       hreflangs(page), page_url(code, page),
                       title, pre)
        out = page if code == 'en' else '%s/%s' % (code, page)
        W(out, entesc(head + body + TAIL % pre))
        built += 1

# ---- self-contained English homepage for the artifact ----
def datauri(path):
    mt = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    return 'data:%s;base64,%s' % (mt, base64.b64encode(open(os.path.join(D, path), 'rb').read()).decode())

body = (R('home.body.html').replace('__HEADER__', header).replace('__FOOTER__', footer)
        .replace('__DISCOVER__', discover).replace('__LANGNAV__', langnav('en', 'index.html', TRANS['en'])))
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

print('built %d pages across %s' % (built, ', '.join(LOCALES)))
print('images mapped:', len(imgmap))
