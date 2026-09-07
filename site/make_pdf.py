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
MAX_PAGES = 4


def _check_page_count(pdf_path, slug):
    """Fail loudly if a rendered brochure spills past the 4-page maximum."""
    try:
        import fitz
    except ImportError:
        print('warning: PyMuPDF (fitz) not installed, skipping page-count check for %s' % slug)
        return True
    doc = fitz.open(pdf_path)
    n = doc.page_count
    doc.close()
    if n > MAX_PAGES:
        print('FAIL %s: %s has %d pages, max is %d' % (slug, pdf_path, n, MAX_PAGES))
        return False
    return True


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
    if not os.path.isfile(out):
        return False
    _shrink(out)
    return _check_page_count(out, slug)


def _shrink(pdf_path):
    """Chrome's PDF export embeds a fresh copy of each <img> per occurrence
    even when several elements share the same src (e.g. a host portrait used
    on both the cover and the closing page), so recurring photos are stored
    twice. Losslessly dedup identical image streams and compact the xref
    table; this alone cuts a typical brochure from ~10MB to ~4MB with zero
    change to the rendered pixels."""
    try:
        import fitz
    except ImportError:
        return
    tmp = pdf_path + '.tmp'
    d = fitz.open(pdf_path)
    d.save(tmp, garbage=4, deflate=True, clean=True)
    d.close()
    os.replace(tmp, pdf_path)


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
