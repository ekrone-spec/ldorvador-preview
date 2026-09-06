#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render each published group's printable trip-details page to a PDF.

The Cloudflare build has no Chrome, so these PDFs are generated locally and
committed to assets/pdf/<slug>.pdf. build.py writes the print source at
groups/<slug>/print.html for every published content/groups/<slug>.json;
this script drives headless Chrome to print that page to PDF.

Usage:
    cd site
    python3 make_pdf.py            # builds the site, then renders every
                                    # published group's PDF
    python3 make_pdf.py <slug>     # render just one group (site must
                                    # already be built)

Requires Google Chrome installed at the default macOS location. After
running, review the PDFs in assets/pdf/ and commit them alongside the
content change that set each group's "pdf" field.
"""
import os, sys, subprocess, json

D = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def published_slugs():
    gdir = os.path.join(D, 'content', 'groups')
    out = []
    for fn in sorted(os.listdir(gdir)):
        if fn.startswith('.') or not fn.endswith('.json'):
            continue
        g = json.load(open(os.path.join(gdir, fn), encoding='utf-8'))
        if g.get('published') is False:
            continue
        out.append(g.get('slug') or fn[:-5])
    return out


def render(slug):
    src = os.path.join(D, 'groups', slug, 'print.html')
    if not os.path.isfile(src):
        print('skip %s: %s not found (run build.py first)' % (slug, src))
        return False
    out_dir = os.path.join(D, 'assets', 'pdf')
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, '%s.pdf' % slug)
    cmd = [
        CHROME,
        '--headless=new',
        '--disable-gpu',
        '--no-pdf-header-footer',
        '--run-all-compositor-stages-before-draw',
        '--virtual-time-budget=4000',
        '--print-to-pdf=%s' % out,
        'file://%s' % src,
    ]
    print('rendering %s -> %s' % (slug, out))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        return False
    return os.path.isfile(out)


def main():
    if not os.path.isfile(CHROME):
        print('Google Chrome not found at %s' % CHROME)
        sys.exit(1)

    args = sys.argv[1:]
    if not args:
        r = subprocess.run([sys.executable, os.path.join(D, 'build.py')], cwd=D)
        if r.returncode != 0:
            sys.exit(r.returncode)
        slugs = published_slugs()
    else:
        slugs = args

    ok = True
    for slug in slugs:
        if not render(slug):
            ok = False
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
