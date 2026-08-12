#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regression test for the built site. Run BEFORE every deploy.

Exists because a build-time "tidy up empty elements" change silently deleted
<span id="yr"></span>, which made app.js throw on its first line and killed
every script on every page. The build succeeded, the pages looked structurally
fine, and the site was broken. These assertions encode the invariants that
must hold no matter what the CMS content says.

    python3 smoke_test.py            # test the local build output
    python3 smoke_test.py --live     # test https://www.ldorvadortravel.com
"""
import os, re, sys, json

D = os.path.dirname(os.path.abspath(__file__))
LOCALES = ['', 'es/', 'nl/', 'he/']
PAGES = ['index.html', 'history.html', 'story.html', 'itinerary.html', 'privacy.html']
LIVE = 'https://www.ldorvadortravel.com'

failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


def fetch_local(path):
    p = os.path.join(D, path)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else None


def fetch_live(path):
    import urllib.request
    url = '%s/%s' % (LIVE, path.replace('index.html', '').replace('.html', ''))
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        return urllib.request.urlopen(req, timeout=20).read().decode('utf-8')
    except Exception as e:
        return None


def main():
    live = '--live' in sys.argv
    get = fetch_live if live else fetch_local
    label = 'LIVE' if live else 'local build'

    # --- the JS entry points every page's script touches on load ---
    # A missing hook here is what took the whole site down.
    REQUIRED_IDS = ['yr', 'header', 'main']
    HOME_IDS = ['top', 'discover', 'contact', 'mobilenav', 'inquiryform']

    for loc in LOCALES:
        for page in PAGES:
            path = loc + page
            html = get(path)
            check(html is not None, '%s: could not be fetched' % path)
            if not html:
                continue

            for i in REQUIRED_IDS:
                check('id="%s"' % i in html,
                      '%s: missing id="%s" (a script hook — its absence breaks app.js)' % (path, i))
            if page == 'index.html':
                for i in HOME_IDS:
                    check('id="%s"' % i in html, '%s: missing id="%s"' % (path, i))
                # decorative empty elements the design depends on: a cleanup
                # pass has now deleted these twice. Counts, not presence.
                check(html.count('door-img') == 3,
                      '%s: expected 3 door-img tiles, found %d' % (path, html.count('door-img')))
                nav = re.search(r'<button class="navtoggle".*?</button>', html, re.S)
                bars = nav.group(0).count('<span>') if nav else 0
                check(bars == 3,
                      '%s: hamburger has %d bars, expected 3' % (path, bars))
                cue = re.search(r'<div class="scrollcue".*?</div>', html, re.S)
                check(bool(cue and '<span>' in cue.group(0)),
                      '%s: scroll cue missing its animated span' % path)
                check('class="bg"' in html, '%s: hero background element missing' % path)
                check(html.count('hero-video') >= 3, '%s: hero videos missing' % path)
                check('formnote' in html,
                      '%s: form confirmation element missing (submissions send but show nothing)' % path)

            # structure
            check(html.count('<h1') == 1, '%s: expected exactly one <h1>, found %d'
                  % (path, html.count('<h1')))
            check('rel="canonical"' in html, '%s: no canonical link' % path)
            check('application/ld+json' in html, '%s: no structured data' % path)
            check('assets/app.css' in html, '%s: stylesheet not linked' % path)
            check('assets/app.js' in html, '%s: script not linked' % path)

            # nothing half-rendered
            check('__C_' not in html, '%s: unresolved content token left in output' % path)
            check('__IMG_' not in html, '%s: unresolved image token left in output' % path)
            check('null' not in re.findall(r'>\s*(null)\s*<', html),
                  '%s: literal "null" rendered as text' % path)

            # locale correctness
            if loc == 'he/':
                check('dir="rtl"' in html, '%s: Hebrew page is not RTL' % path)
            expect_lang = (loc.rstrip('/') or 'en')
            check('<html lang="%s"' % expect_lang in html,
                  '%s: wrong <html lang>' % path)

    # --- the script itself must be intact and parseable-ish ---
    js = get('assets/app.js') if not live else fetch_live('assets/app.js')
    if js is None and live:
        import urllib.request
        req = urllib.request.Request(LIVE + '/assets/app.js',
                                     headers={'User-Agent': 'Mozilla/5.0'})
        js = urllib.request.urlopen(req, timeout=20).read().decode('utf-8')
    check(bool(js), 'app.js could not be fetched')
    if js:
        check(js.count('(') == js.count(')'), 'app.js: unbalanced parentheses')
        check(js.count('{') == js.count('}'), 'app.js: unbalanced braces')
        # every getElementById on a page-specific node must be guarded
        for m in re.finditer(r"getElementById\('([\w-]+)'\)\.", js):
            check(False, "app.js: unguarded getElementById('%s') — a missing "
                         "node here kills the whole script" % m.group(1))

    print('%s: %d check(s) failed' % (label, len(failures)))
    for f in failures:
        print('  FAIL  %s' % f)
    if not failures:
        print('  all invariants hold')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
