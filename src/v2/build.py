#!/usr/bin/env python3
import os, re, base64, mimetypes

D = os.path.dirname(os.path.abspath(__file__))
def R(p): return open(os.path.join(D,p),encoding='utf-8').read()
def W(p,s): open(os.path.join(D,p),'w',encoding='utf-8').write(s)

# ---- fonts: reuse the @font-face block already embedded in the built app.css ----
old_css = R('assets/app.css').splitlines()
# lines 2..13 (1-indexed) are the 12 @font-face rules; keep them verbatim
fonts = "\n".join(old_css[1:13])

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
trips  = R('trips.frag.html')

def entesc(s):
    return ''.join(c if ord(c)<128 else '&#%d;'%ord(c) for c in s)
def jsesc(s):
    return ''.join(c if ord(c)<128 else '\\u%04x'%ord(c) for c in s)

# ---- app.js (external, ASCII-escaped) ----
W('assets/app.js', jsesc(R('js.tmpl')))

HEAD = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="robots" content="noindex, nofollow">'
        '<meta name="description" content="Curated Jewish heritage journeys to Curacao.">'
        '<title>%s</title><link rel="stylesheet" href="assets/app.css"></head><body>\n')
TAIL = '\n<script src="assets/app.js" defer></script></body></html>'

def sub(s):
    s = s.replace('__HEADER__', header).replace('__FOOTER__', footer).replace('__TRIPS__', trips)
    for k,v in imgmap.items(): s = s.replace(k,v)
    return s

pages = {
    'index.html':     ('home.body.html',      "L'Dor Vador — Jewish Heritage Travel to Curaçao"),
    'history.html':   ('history.body.html',   "The Story — L'Dor Vador"),
    'story.html':     ('story.body.html',     "Our Story — L'Dor Vador"),
    'itinerary.html': ('itinerary.body.html', "Example Itinerary — L'Dor Vador"),
}
for out,(src,title) in pages.items():
    body = sub(R(src))
    W(out, entesc(HEAD%title + body + TAIL))

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
      '<title>L’Dor Vador — Jewish Heritage Travel to Curaçao</title>'
      '<style>%s</style></head><body>\n%s\n<script>%s</script></body></html>' % (css_self, body, js))
W('home_selfcontained.html', sc)
print('built:', ', '.join(pages), '+ home_selfcontained.html')
print('images mapped:', len(imgmap))
