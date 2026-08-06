#!/usr/bin/env python3
import os, re, base64, mimetypes

D = os.path.dirname(os.path.abspath(__file__))
def R(p): return open(os.path.join(D,p),encoding='utf-8').read()
def W(p,s): open(os.path.join(D,p),'w',encoding='utf-8').write(s)

# ---- fonts: reuse the @font-face block already embedded in the built app.css ----
old_css = R('assets/app.css').splitlines()
# lines 2..13 (1-indexed) are the 12 @font-face rules; keep them verbatim
fonts = "\n".join(old_css[1:13]) + "\n" + R('fonts_extra.css')

# ---- image token map from assets/img ----
imgmap = {}
for fn in os.listdir(os.path.join(D,'assets','img')):
    name = os.path.splitext(fn)[0]
    imgmap['__IMG_%s__'%name] = 'assets/img/%s'%fn

css_raw = R('css.tmpl').replace('/*__FONTS__*/', fonts)   # still holds __IMG_ tokens
css = css_raw
# in app.css (served from /assets/), url() is relative to the stylesheet -> use img/x.jpg
for k,v in imgmap.items(): css = css.replace(k, v.replace('assets/',''))
W('assets/app.css', css)

header = R('header.frag.html')
footer = R('footer.frag.html')
discover = R('discover.frag.html')

def entesc(s):
    return ''.join(c if ord(c)<128 else '&#%d;'%ord(c) for c in s)
def jsesc(s):
    return ''.join(c if ord(c)<128 else '\\u%04x'%ord(c) for c in s)

# ---- app.js (external, ASCII-escaped) ----
W('assets/app.js', jsesc(R('js.tmpl')))

HEAD = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="robots" content="noindex, nofollow">'
        '<meta name="description" content="%s">'
        '<meta property="og:title" content="%s"><meta property="og:description" content="%s">'
        '<meta property="og:type" content="website">'
        '<title>%s</title><link rel="stylesheet" href="assets/app.css"></head><body>\n')
TAIL = '\n<script src="assets/app.js" defer></script></body></html>'

def sub(s):
    s = s.replace('__HEADER__', header).replace('__FOOTER__', footer).replace('__DISCOVER__', discover)
    for k,v in imgmap.items(): s = s.replace(k,v)
    return s

# title, meta description. The site description keeps "Jewish Heritage Travel"
# (that is what shows in search); the on-page tagline is just "Heritage Travel".
pages = {
    'index.html':     ('home.body.html',
        "L'Dor Vador | Jewish Heritage Travel to Curaçao",
        "L'Dor Vador is a Jewish Heritage Travel company in Curaçao. We curate journeys through 375 years of Jewish Atlantic history, connecting travelers with local academics, cultural experts, and community members."),
    'history.html':   ('history.body.html',
        "A History Lesson | L'Dor Vador Jewish Heritage Travel",
        "How Jewish life took root and flourished in Curaçao: 375 years from Samuel Cohen and Congregation Mikvé Israel to the Snoa, Beth Haim, and the Jewish Museum Curaçao."),
    'story.html':     ('story.body.html',
        "About Us | L'Dor Vador Jewish Heritage Travel",
        "Our origin story. L'Dor Vador was founded by Hannah Berkeley Cohen, former New York Times stringer in Havana, and Cornelis Greiwe, founder of CULTURESCAPE in Curaçao."),
    'itinerary.html': ('itinerary.body.html',
        "Example Itinerary | L'Dor Vador Jewish Heritage Travel",
        "A sample week in Jewish Curaçao: the sand-floor synagogue, Beth Haim, the Jewish Museum, people-to-people encounters, and Shabbat with the community."),
}
for out,(src,title,desc) in pages.items():
    body = sub(R(src))
    W(out, entesc(HEAD%(desc,title,desc,title) + body + TAIL))

# ---- self-contained homepage (inline css+js, data-uri images) ----
def datauri(path):
    mt = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    b = base64.b64encode(open(os.path.join(D,path),'rb').read()).decode()
    return 'data:%s;base64,%s'%(mt,b)

body = sub(R('home.body.html'))
# inline css with data-uri images (start from the raw css that still has __IMG_ tokens)
css_self = css_raw
for tok in imgmap:                      # __IMG_hero__ -> data:...
    rel = imgmap[tok]
    css_self = css_self.replace(tok, datauri(rel))
for fn in os.listdir(os.path.join(D,'assets','img')):
    rel = 'assets/img/%s'%fn
    if rel in body:
        body = body.replace(rel, datauri(rel))
js = R('js.tmpl')
sc = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
      '<meta name="viewport" content="width=device-width, initial-scale=1">'
      '<title>L’Dor Vador | Jewish Heritage Travel to Curaçao</title>'
      '<style>%s</style></head><body>\n%s\n<script>%s</script></body></html>' % (css_self, body, js))
W('home_selfcontained.html', sc)
print('built:', ', '.join(pages), '+ home_selfcontained.html')
print('images mapped:', len(imgmap))
