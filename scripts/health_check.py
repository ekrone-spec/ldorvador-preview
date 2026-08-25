#!/usr/bin/env python3
"""Scheduled live health check. Relationship-based assertions only -
content markers, shapes, and latency ceilings, never snapshot values.
Exit 1 on any failure -> workflow fails -> GitHub emails the owner."""
import os, sys, time, urllib.request

FAILS = []
def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (("  - " + detail) if detail else ""))
    if not ok: FAILS.append(name)

def fetch(url, timeout=30):
    t0 = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": "tcstudio-health-check"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace"), time.time() - t0

def probe(label, url, marker, min_kb=10, max_s=8, want_form=None):
    try:
        st, html, el = fetch(url)
    except Exception as e:
        check(label + " reachable", False, str(e)[:150]); return
    check(label + " HTTP 200", st == 200, "got %s" % st)
    check(label + " content marker present", marker in html, "missing %r" % marker)
    check(label + " page not empty/truncated", len(html) > min_kb * 1024, "%d bytes" % len(html))
    check(label + " latency < %ds" % max_s, el < max_s, "%.1fs" % el)
    if want_form is not None:
        check(label + " contact form present", ("<form" in html) == want_form)

def finish():
    if os.environ.get("FORCE_FAIL") == "1":
        check("deliberate test failure (FORCE_FAIL=1)", False, "alarm test - ignore")
    print("\n%d checks failed" % len(FAILS))
    sys.exit(1 if FAILS else 0)

# Preview URL until the real domain is connected; update url= then.
# Page is ~4.8MB today, hence the generous latency ceiling.
probe("ldorvador preview", "https://ekrone-spec.github.io/ldorvador-preview/",
      "Dor Vador", min_kb=100, max_s=20, want_form=True)
finish()
