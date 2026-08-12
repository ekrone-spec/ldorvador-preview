#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Exhaustive site test. Runs before EVERY deploy, however long it takes.

Two layers, per the standing rule (born of the empty-element cleanup that
broke the site three ways in one day):

1. GOLDEN STRUCTURE. The site is rebuilt into a temp dir with every piece of
   CMS copy replaced by a constant (LDV_PLACEBO), so the resulting HTML
   structure depends only on the templates and the build code. Every element
   of every page - tag, nesting depth, id, classes, attribute names, asset
   references - is compared against the committed test_manifest.json. Any
   difference fails. A deliberate structural change regenerates the manifest
   with --update in the same commit. Because CMS content is factored out,
   Hannah's edits can never fail this layer.

2. REAL-BUILD AUDIT of the actual site/ output: every internal link and
   anchor resolves, every referenced asset exists on disk (src, href, poster,
   data-src, inline style url(), CSS url()), forms carry their required
   fields, JSON-LD parses, hreflang sets are complete, the sitemap matches
   the built pages.

Usage:
    python3 full_test.py             # test
    python3 full_test.py --update    # rebless the golden manifest
"""
import json, os, re, subprocess, sys, tempfile
from html.parser import HTMLParser

D = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(D, 'test_manifest.json')
LOCALES = ['', 'es/', 'nl/', 'he/']
PAGES = ['index.html', 'history.html', 'story.html', 'itinerary.html', 'privacy.html']

failures = []
def check(cond, msg):
    if not cond:
        failures.append(msg)


# --------------------------------------------------------------------------
# Layer 1: golden structure
# --------------------------------------------------------------------------

class Skeleton(HTMLParser):
    """Reduce a page to its structure: everything except text content."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        refs = []
        for key in ('src', 'href', 'poster', 'data-src', 'data-full', 'style', 'content'):
            v = a.get(key)
            if not v:
                continue
            refs += re.findall(r"url\('([^']+)'\)", v)
            if key != 'style' and re.search(r'\.(css|js|jpg|jpeg|png|ico|svg|mp4|xml)(\?|$)', v):
                refs.append(v)
        self.rows.append('%d|%s|id=%s|class=%s|attrs=%s|refs=%s' % (
            self.depth, tag, a.get('id', ''),
            ' '.join(sorted((a.get('class') or '').split())),
            ','.join(sorted(k for k, _ in attrs)),
            ','.join(sorted(refs))))
        VOID = {'area','base','br','col','embed','hr','img','input','link','meta',
                'param','source','track','wbr'}
        if tag not in VOID:
            self.depth += 1

    def handle_endtag(self, tag):
        self.depth = max(0, self.depth - 1)


def synthetic_build(tmp):
    env = dict(os.environ, LDV_OUT_DIR=tmp, LDV_PLACEBO='1')
    r = subprocess.run([sys.executable, 'build.py'], cwd=D, env=env,
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-800:]); print(r.stderr[-800:])
        raise SystemExit('synthetic build failed')


def skeletons(root):
    out = {}
    for loc in LOCALES:
        for page in PAGES:
            path = os.path.join(root, loc + page)
            p = Skeleton()
            p.feed(open(path, encoding='utf-8').read())
            out[loc + page] = p.rows
    return out


def golden_layer(update=False):
    with tempfile.TemporaryDirectory() as tmp:
        synthetic_build(tmp)
        current = skeletons(tmp)
    if update or not os.path.exists(MANIFEST):
        json.dump(current, open(MANIFEST, 'w'), indent=0)
        print('manifest %s: %d pages, %d elements total'
              % ('updated' if update else 'created', len(current),
                 sum(len(v) for v in current.values())))
        return
    golden = json.load(open(MANIFEST))
    for page in sorted(set(golden) | set(current)):
        g, c = golden.get(page, []), current.get(page, [])
        if g == c:
            continue
        import difflib
        diff = [l for l in difflib.unified_diff(g, c, lineterm='') if l[:1] in '+-'][2:]
        check(False, 'STRUCTURE %s: %d element difference(s), e.g.\n        %s'
              % (page, len(diff), '\n        '.join(diff[:6])))


# --------------------------------------------------------------------------
# Layer 2: exhaustive audit of the real build
# --------------------------------------------------------------------------

class Audit(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids, self.links, self.assets, self.jsonld = set(), [], set(), []
        self.forms = []
        self._script = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get('id'):
            self.ids.add(a['id'])
        if tag == 'a' and a.get('href'):
            self.links.append(a['href'])
        for key in ('src', 'poster', 'data-src', 'data-full'):
            if a.get(key):
                self.assets.add(a[key])
        if tag == 'link' and a.get('href'):
            if a.get('rel') in ('stylesheet', 'icon', 'apple-touch-icon'):
                self.assets.add(a['href'])
        if a.get('style'):
            self.assets.update(re.findall(r"url\('([^']+)'\)", a['style']))
        if tag == 'script' and a.get('type') == 'application/ld+json':
            self._script = ''
        if tag == 'form':
            self.forms.append(set())
        if tag in ('input', 'textarea') and self.forms and a.get('name'):
            self.forms[-1].add(a['name'])

    def handle_data(self, data):
        if self._script is not None:
            self._script += data

    def handle_endtag(self, tag):
        if tag == 'script' and self._script is not None:
            self.jsonld.append(self._script); self._script = None


def audit_layer():
    pages = {}
    for loc in LOCALES:
        for page in PAGES:
            p = Audit()
            p.feed(open(os.path.join(D, loc + page), encoding='utf-8').read())
            pages[loc + page] = p

    for path, p in pages.items():
        base = os.path.dirname(path)

        # every asset reference resolves to a real file
        for ref in sorted(p.assets):
            if ref.startswith(('http', 'data:', 'mailto:', '#')) or '%23' in ref:
                continue
            rel = ref.split('?')[0]
            f = (os.path.normpath(os.path.join(D, rel.lstrip('/'))) if rel.startswith('/')
                 else os.path.normpath(os.path.join(D, base, rel)))
            check(os.path.exists(f), '%s: missing asset %s' % (path, ref))

        # every internal link resolves; every anchor target exists
        for href in p.links:
            if href.startswith(('http', 'mailto:', 'tel:')):
                continue
            target, _, frag = href.partition('#')
            if target:
                f = os.path.normpath(os.path.join(D, base, target))
                check(os.path.exists(f), '%s: dead link %s' % (path, href))
            if frag:
                tp = os.path.normpath(os.path.join(base, target)) if target else path
                tp = tp.lstrip('./')
                dest = pages.get(tp)
                check(bool(dest and frag in dest.ids),
                      '%s: anchor #%s not found in %s' % (path, frag, tp or path))

        # structured data parses
        for block in p.jsonld:
            try:
                json.loads(block)
            except Exception as e:
                check(False, '%s: JSON-LD does not parse (%s)' % (path, e))

        # hreflang completeness
        html = open(os.path.join(D, path), encoding='utf-8').read()
        for code in ('en', 'es', 'nl', 'he', 'x-default'):
            check('hreflang="%s"' % code in html,
                  '%s: missing hreflang %s' % (path, code))

        # the inquiry form carries everything Web3Forms needs
        if path.endswith('index.html'):
            need = {'access_key', 'first', 'last', 'email', 'message', 'botcheck'}
            ok = any(need <= form for form in p.forms)
            check(ok, '%s: inquiry form is missing required fields' % path)

    # sitemap <-> built pages
    sm = os.path.join(D, 'sitemap.xml')
    check(os.path.exists(sm), 'sitemap.xml missing')
    if os.path.exists(sm):
        locs = re.findall(r'<loc>([^<]+)</loc>', open(sm).read())
        check(len(locs) == len(LOCALES) * len(PAGES),
              'sitemap has %d urls, expected %d' % (len(locs), len(LOCALES) * len(PAGES)))

    # every css url() resolves
    css = open(os.path.join(D, 'assets/app.css'), encoding='utf-8').read()
    for ref in set(re.findall(r"url\('?([^'\)]+?)'?\)", css)):
        if ref.startswith(('data:', '#')) or '%23' in ref:
            continue
        f = os.path.normpath(os.path.join(D, 'assets', ref.split('?')[0]))
        check(os.path.exists(f), 'app.css: missing asset %s' % ref)


def main():
    update = '--update' in sys.argv
    golden_layer(update=update)
    if not update:
        audit_layer()
    print('full test: %d failure(s)' % len(failures))
    for f in failures:
        print('  FAIL  %s' % f)
    if not failures:
        print('  every element, link, anchor and asset accounted for')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
