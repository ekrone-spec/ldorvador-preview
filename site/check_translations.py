#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Report English copy that is no longer translated.

Translations are keyed by the exact English string, so when an editor changes
English text in the CMS the other locales silently fall back to showing that
new English. That is the correct behaviour (better than a translation of text
that no longer exists) but it is invisible, so this makes it visible.

Two categories are reported:
  DRIFTED  - a near-identical string exists in the locale file, i.e. someone
             edited English copy that used to be translated. Always actionable.
  NEW      - no close match at all: either genuinely new copy, or a proper
             noun that is meant to stay in English. Needs a human glance.

Exit code is always 0: this informs, it never blocks a deploy.
"""
import difflib, html, json, os, sys

D = os.path.dirname(os.path.abspath(__file__))
u = html.unescape
LOCALES = ('es', 'nl', 'he')


def load_content():
    out = {}
    cdir = os.path.join(D, 'content')
    for fn in sorted(os.listdir(cdir)):
        if not fn.endswith('.json'):
            continue
        data = json.load(open(os.path.join(cdir, fn), encoding='utf-8'))
        for group, fields in data.items():
            for key, val in fields.items():
                if not (val and val.strip()):
                    continue
                segs = [x.strip() for x in val.replace('\r','').split('\n') if x.strip()]
                for n, seg in enumerate(segs):
                    suffix = '' if len(segs) == 1 else '#%d' % (n + 1)
                    out['%s.%s.%s%s' % (fn[:-5], group, key, suffix)] = u(seg)
    return out


def report():
    content = load_content()
    drifted, new = {}, {}
    for code in LOCALES:
        path = os.path.join(D, 'locales', '%s.json' % code)
        tr = {u(k): v for k, v in json.load(open(path, encoding='utf-8')).items()}
        keys = list(tr)
        for field, text in content.items():
            if text in tr:
                continue
            near = difflib.get_close_matches(text, keys, n=1, cutoff=0.85)
            bucket = drifted if near else new
            bucket.setdefault(field, {'text': text, 'locales': [], 'was': near[0] if near else None})
            bucket[field]['locales'].append(code)
    return drifted, new


def main():
    drifted, new = report()
    lines = []
    if drifted:
        lines.append('DRIFTED - English was edited, so these now show in English '
                     'on the %s pages:' % '/'.join(l.upper() for l in LOCALES))
        for field, d in sorted(drifted.items()):
            lines.append('  %s  [%s]' % (field, ','.join(d['locales'])))
            lines.append('     now: %s' % d['text'][:100])
            lines.append('     was: %s' % (d['was'] or '')[:100])
    if new:
        lines.append('')
        lines.append('NEW/UNTRANSLATED (%d) - new copy, or proper nouns meant to '
                     'stay English:' % len(new))
        for field, d in sorted(new.items())[:40]:
            lines.append('  %-30s [%s] %s'
                         % (field, ','.join(d['locales']), d['text'][:60]))
        if len(new) > 40:
            lines.append('  ... and %d more' % (len(new) - 40))

    print('\n'.join(lines) if lines else 'All content strings are translated in every locale.')

    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as fh:
            fh.write('drifted=%d\n' % len(drifted))
            fh.write('report<<EOF\n%s\nEOF\n' % '\n'.join(lines))
    return 0


if __name__ == '__main__':
    sys.exit(main())
