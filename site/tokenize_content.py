#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One-off: lift the copy out of the HTML templates into content/*.json.

Reuses the i18n walker so "what is editable copy" is defined in exactly one
place: any run the translator would translate, the CMS can edit. Each run is
replaced with a __C_group.field__ token; the text (entities decoded, so the
editor never sees &rsquo;) lands in a JSON file keyed group -> field.

Groups follow the nearest id (or first class) seen on a section-level tag, so
the CMS sidebar mirrors the page structure. Run once; the tokenized templates
replace the originals and become the source of truth.
"""
import html, json, os, re, sys
import i18n

D = os.path.dirname(os.path.abspath(__file__))

# tags whose id/class names a content group in the editor
GROUPY = {'section', 'header', 'footer', 'div', 'form'}
# tags worth naming fields after; anything else inherits the nearest of these
FIELDY = {'h1','h2','h3','h4','p','blockquote','cite','a','button','figcaption',
          'span','li','em','strong','label','option','summary','td','th'}


class Tokenize(i18n._Walk):
    def __init__(self, pagekey):
        super().__init__(mapping=self)          # self.get() mints the tokens
        self.pagekey = pagekey
        self.content = {}                        # group -> {field: text}
        self.group = pagekey
        self.tagstack = []
        self.counts = {}
        self.attr = None                         # attr name during _tag_text

    # ---- mapping interface used by _Walk._flush ----
    def get(self, s, default=None):
        # leave build tokens (__HEADER__ etc.) and symbol/number-only runs alone
        if re.fullmatch(r'(?:\s*__[A-Z_]+__\s*)+', s) or re.fullmatch(r'[\s\W\d]+', s):
            return None
        tag = next((t for t in reversed(self.tagstack) if t in FIELDY), 'text')
        base = ('%s_%s' % (tag, self.attr)) if self.attr else tag
        n = self.counts[(self.group, base)] = self.counts.get((self.group, base), 0) + 1
        field = '%s_%d' % (base, n)
        self.content.setdefault(self.group, {})[field] = html.unescape(s)
        return '__C_%s.%s.%s__' % (self.pagekey, self.group, field)

    # ---- group + tag tracking ----
    def handle_starttag(self, tag, attrs):
        # flush first: the pending run belongs to the tag we are still inside
        super().handle_starttag(tag, attrs)
        self.tagstack.append(tag)
        if tag in GROUPY:
            a = dict(attrs)
            # div/form only rename the group when they carry an id; a bare
            # class like "reveal" is styling, not structure
            name = a.get('id') if tag in ('div', 'form') else (
                a.get('id') or (a.get('class', '').split() or [None])[0])
            if name:
                self.group = re.sub(r'[^a-z0-9]+', '_', name.lower())

    def handle_endtag(self, tag):
        super().handle_endtag(tag)   # flushes with this tag still on top
        if self.tagstack and self.tagstack[-1] == tag:
            self.tagstack.pop()

    # copy of _Walk._tag_text so the attr name reaches the key
    def _tag_text(self, tag, attrs, self_close=False):
        src = self.get_starttag_text()
        for name, val in attrs:
            if not val or name not in i18n.ATTRS:
                continue
            s = val.strip()
            if not s or re.fullmatch(r'[\s\W\d]+', s):
                continue
            self.attr = name.replace('-', '_')
            new = self.get(s)
            self.attr = None
            for q in ('"', "'"):
                old_attr = '%s=%s%s%s' % (name, q, val, q)
                if old_attr in src:
                    src = src.replace(old_attr, '%s=%s%s%s' % (name, q, new, q))
                    break
        return src


FILES = {
    'home':      'home.body.html',
    'history':   'history.body.html',
    'story':     'story.body.html',
    'itinerary': 'itinerary.body.html',
    'header':    'header.frag.html',
    'footer':    'footer.frag.html',
    'discover':  'discover.frag.html',
}

os.makedirs(os.path.join(D, 'content'), exist_ok=True)
for key, fn in sorted(FILES.items()):
    src = open(os.path.join(D, fn), encoding='utf-8').read()
    t = Tokenize(key)
    t.feed(src)
    out = t.result()
    # tokens must never appear inside other build tokens or scripts
    assert '__C___' not in out
    open(os.path.join(D, fn), 'w', encoding='utf-8').write(out)
    open(os.path.join(D, 'content', '%s.json' % key), 'w', encoding='utf-8').write(
        json.dumps(t.content, ensure_ascii=False, indent=1))
    nfields = sum(len(v) for v in t.content.values())
    print('%-10s %3d fields in %2d groups -> content/%s.json' % (key, nfields, len(t.content), key))
