#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Resolve locales.py (index -> translation) into locales/<code>.json (English -> translation).

Run after editing locales.py. The sanity checks exist because the translations are
keyed by index: a single mis-numbered entry silently shifts everything after it, so
we look for the symptoms of that rather than trusting the numbering.
"""
import json, io, os, re, sys
import locales as L

D = os.path.dirname(os.path.abspath(__file__))
strs = json.load(io.open(os.path.join(D, '_strings.json'), encoding='utf-8'))

# left in English on purpose: brand names, people, places, codes, figures
KEEP = {2,3,7,15,16,17,18,19,23,27,28,29,35,36,40,41,45,48,50,65,102,103,109,112,115,116,118,121,
        146,165,168,172,176,177,179,183}

# words that legitimately match the English (place names, shared vocabulary)
SAME_OK = {('es',110),('es',119),('nl',14),('nl',25),('nl',79),('nl',110),('nl',113),('nl',119)}

problems = []
for code, d in L.LOCALES.items():
    out = {}
    for i, t in sorted(d.items()):
        if i >= len(strs):
            problems.append('%s: index %d out of range' % (code, i)); continue
        en = strs[i]
        # a translation identical to the source is usually a numbering slip
        if t == en and i not in KEEP and (code, i) not in SAME_OK:
            problems.append('%s[%d] identical to English: %r' % (code, i, en[:50]))
        # a very long English string paired with a very short translation, or the
        # reverse, is the classic symptom of an off-by-one
        if len(en) > 60 and len(t) < len(en) * 0.35:
            problems.append('%s[%d] suspiciously short: EN %d chars -> %d chars' % (code, i, len(en), len(t)))
        if len(en) < 25 and len(t) > 90:
            problems.append('%s[%d] suspiciously long: EN %r -> %d chars' % (code, i, en[:30], len(t)))
        out[en] = t
    out.update(getattr(L, 'EXTRA', {}).get(code, {}))
    io.open(os.path.join(D, 'locales', '%s.json' % code), 'w', encoding='utf-8').write(
        json.dumps(out, ensure_ascii=False, indent=1))
    missing = [i for i in range(len(strs)) if i not in d and i not in KEEP]
    print('%s: %d translated, %d missing' % (code, len(out), len(missing)))
    for i in missing:
        print('   MISSING %3d %s' % (i, strs[i][:70]))

if problems:
    print('\n%d PROBLEM(S):' % len(problems))
    for p in problems:
        print('  ' + p)
    sys.exit(1)
print('\nall locale files written, no numbering problems detected')
