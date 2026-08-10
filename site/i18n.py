#!/usr/bin/env python3
"""Tiny build-time translator.

Walks HTML, treats each contiguous run of text (entities included) as one unit,
and swaps it for a translation when the locale file has one. Keeping runs whole
means the keys are complete sentences, so a short phrase can never accidentally
match inside a longer one.
"""
import html, re
from html.parser import HTMLParser


def _esc(s):
    """Escape a replacement value for insertion into markup."""
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

VOID = {'area','base','br','col','embed','hr','img','input','link','meta',
        'param','source','track','wbr'}
SKIP = {'script','style'}
# attributes whose value is shown to a person
ATTRS = ('alt','title','placeholder','aria-label','content','value','data-ok','data-err')


class _Walk(HTMLParser):
    def __init__(self, mapping=None, collect=None):
        super().__init__(convert_charrefs=False)
        self.map = mapping or {}
        self.collect = collect          # list to append found runs to, or None
        self.buf = []                   # rebuilt output
        self.run = []                   # current text run
        self.skip = 0

    # --- text runs -------------------------------------------------------
    def _flush(self):
        if not self.run:
            return
        raw = ''.join(self.run)
        self.run = []
        stripped = raw.strip()
        if not stripped or self.skip:
            self.buf.append(raw)
            return
        # keep surrounding whitespace exactly as it was
        lead = raw[:len(raw) - len(raw.lstrip())]
        tail = raw[len(raw.rstrip()):]
        # keys are entity-decoded so &rsquo; and a literal quote compare equal
        key = html.unescape(stripped)
        if self.collect is not None:
            if not re.fullmatch(r'[\s\W\d]+', key) and key not in self.collect:
                self.collect.append(key)
        new = self.map.get(key)
        if new is None or new == key:
            self.buf.append(raw)          # untouched: keep original entity forms
        else:
            self.buf.append(lead + _esc(new) + tail)

    def handle_data(self, d):
        self.run.append(d)

    def handle_entityref(self, n):
        self.run.append('&%s;' % n)

    def handle_charref(self, n):
        self.run.append('&#%s;' % n)

    # --- tags ------------------------------------------------------------
    def handle_starttag(self, tag, attrs):
        self._flush()
        if tag in SKIP:
            self.skip += 1
        self.buf.append(self._tag_text(tag, attrs))

    def handle_startendtag(self, tag, attrs):
        self._flush()
        self.buf.append(self._tag_text(tag, attrs, self_close=True))

    def _tag_text(self, tag, attrs, self_close=False):
        src = self.get_starttag_text()
        for name, val in attrs:
            if not val or name not in ATTRS:
                continue
            s = html.unescape(val.strip())
            if not s or re.fullmatch(r'[\s\W\d]+', s):
                continue
            if self.collect is not None:
                if s not in self.collect:
                    self.collect.append(s)
            new = self.map.get(s)
            if new and new != s:
                for q in ('"', "'"):
                    old_attr = '%s=%s%s%s' % (name, q, val, q)
                    if old_attr in src:
                        src = src.replace(old_attr, '%s=%s%s%s' % (name, q, _esc(new), q))
                        break
        return src

    def handle_endtag(self, tag):
        self._flush()
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
        if tag not in VOID:
            self.buf.append('</%s>' % tag)

    def handle_comment(self, d):
        self._flush(); self.buf.append('<!--%s-->' % d)

    def handle_decl(self, d):
        self._flush(); self.buf.append('<!%s>' % d)

    def handle_pi(self, d):
        self._flush(); self.buf.append('<?%s>' % d)

    def unknown_decl(self, d):
        self._flush(); self.buf.append('<![%s]>' % d)

    def result(self):
        self._flush()
        return ''.join(self.buf)


def translate(html, mapping):
    p = _Walk(mapping=mapping)
    p.feed(html)
    return p.result()


def extract(html, into):
    p = _Walk(collect=into)
    p.feed(html)
    p.result()
    return into
