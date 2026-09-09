#!/usr/bin/env python3
"""Screenshot the site's real .brand markup via headless Chrome CDP, cropped to element bounds."""
import json, subprocess, time, sys, os, base64
import urllib.request
import websocket  # pip: websocket-client

PORT = 9333
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE = os.path.dirname(os.path.abspath(__file__))

def start_chrome():
    profile = "/tmp/ldv-shot-profile"
    proc = subprocess.Popen([
        CHROME, f"--remote-debugging-port={PORT}", "--headless=new",
        "--disable-gpu", f"--user-data-dir={profile}", "--hide-scrollbars",
        "--force-device-scale-factor=3", "--window-size=1400,900",
        "--remote-allow-origins=*",
    ])
    time.sleep(1.5)
    return proc

def new_tab():
    req = urllib.request.Request(f"http://localhost:{PORT}/json/new", method="PUT")
    data = json.loads(urllib.request.urlopen(req).read())
    return data["id"], data["webSocketDebuggerUrl"]

def shoot(html_path, selector, out_png, bg_is_dark=False):
    tab_id, ws_url = new_tab()
    ws = websocket.create_connection(ws_url, timeout=20)
    mid = [0]
    def send(method, params=None):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
        while True:
            resp = json.loads(ws.recv())
            if resp.get("id") == mid[0]:
                return resp

    send("Page.enable")
    url = "file://" + os.path.abspath(html_path)
    send("Page.navigate", {"url": url})
    time.sleep(1.2)  # let webfonts load

    # get bounding box of the element
    doc = send("DOM.getDocument", {"depth": -1})
    node = send("DOM.querySelector", {"nodeId": doc["result"]["root"]["nodeId"], "selector": selector})
    node_id = node["result"]["nodeId"]
    box = send("DOM.getBoxModel", {"nodeId": node_id})
    quad = box["result"]["model"]["border"]
    xs = quad[0::2]; ys = quad[1::2]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    pad = 6
    clip = {"x": max(0, x0 - pad), "y": max(0, y0 - pad),
            "width": (x1 - x0) + pad * 2, "height": (y1 - y0) + pad * 2, "scale": 1}

    shot = send("Page.captureScreenshot", {
        "format": "png", "clip": clip, "captureBeyondViewport": True,
    })
    img_data = base64.b64decode(shot["result"]["data"])
    with open(out_png, "wb") as f:
        f.write(img_data)
    ws.close()
    urllib.request.Request(f"http://localhost:{PORT}/json/close/{tab_id}")
    try:
        urllib.request.urlopen(urllib.request.Request(f"http://localhost:{PORT}/json/close/{tab_id}"))
    except Exception:
        pass
    print("wrote", out_png)

if __name__ == "__main__":
    proc = start_chrome()
    try:
        shoot(os.path.join(BASE, "lockup-compact.html"), "a.brand", os.path.join(BASE, "raw-compact.png"))
        shoot(os.path.join(BASE, "lockup-stacked.html"), "a.brand", os.path.join(BASE, "raw-stacked.png"))
    finally:
        proc.terminate()
