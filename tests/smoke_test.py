"""Smoke and security tests that run in CI without the password.

Checks that the site serves, the lock screen works and rejects a wrong password, the CSP blocks
inline script, nothing loads from other origins, and no content file is readable without the key.
"""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

SITE = os.path.join(os.path.dirname(__file__), "..", "site")
fails = []
def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    if not ok: fails.append(msg)

# ---- static checks ----
meta = json.load(open(os.path.join(SITE, "content/meta.json")))
check(meta["iter"] >= 600000 and len(meta["salt"]) >= 20, "key derivation uses PBKDF2 with >= 600k iterations and a random salt")
probes = [b"Hypertension", b"pericholecystic", b"Malette", b"\"cards\"", b"\"questions\""]
for root, _, files in os.walk(os.path.join(SITE, "content")):
    for f in files:
        if f == "meta.json": continue
        blob = open(os.path.join(root, f), "rb").read()
        check(f.endswith(".enc") and not any(p in blob for p in probes), f"content/{f} is encrypted")
html = open(os.path.join(SITE, "index.html")).read()
check("Content-Security-Policy" in html and "script-src 'self'" in html, "CSP restricts scripts to this site")
check("noindex" in html and open(os.path.join(SITE, "robots.txt")).read().strip().endswith("Disallow: /"), "search engines are asked not to index")
check("http://" not in html and "https://" not in html, "index.html loads nothing from other origins")

# ---- browser checks ----
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8799"], cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, vp in [("phone", {"width": 390, "height": 844}), ("desktop", {"width": 1280, "height": 900})]:
            ctx = b.new_context(viewport=vp); pg = ctx.new_page(); errs, foreign = [], []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            pg.on("request", lambda r: foreign.append(r.url) if not r.url.startswith("http://localhost:8799") and not r.url.startswith("data:") else None)
            pg.goto("http://localhost:8799/"); pg.wait_for_selector("#lockPw", state="visible", timeout=10000)
            check(not pg.is_visible("header.top"), f"{name}: app is hidden until unlocked")
            pg.click("#lockGo"); pg.wait_for_timeout(300)
            check("Enter the password" in pg.inner_text("#lockErr"), f"{name}: empty password is caught")
            pg.fill("#lockPw", "not-the-password"); pg.click("#lockGo")
            pg.wait_for_selector("#lockErr:not(:empty)", timeout=15000)
            check("did not work" in pg.inner_text("#lockErr"), f"{name}: wrong password is rejected")
            check(not pg.is_visible("header.top"), f"{name}: app stays hidden after a wrong password")
            blocked = pg.evaluate("()=>{try{const s=document.createElement('script');s.textContent='window.__x=1';document.head.appendChild(s);return !window.__x}catch(e){return true}}")
            check(blocked, f"{name}: CSP blocks injected inline script")
            ov = pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            check(ov <= 1, f"{name}: no horizontal overflow on the lock screen")
            check(not foreign, f"{name}: no requests to other origins {foreign[:2]}")
            check(not [e for e in errs if "Content Security Policy" not in e], f"{name}: no JavaScript errors {[e for e in errs if "Content Security Policy" not in e][:2]}")
            for path, code in [("missing-page", 404), ("content/data.enc", 200)]:
                r = pg.request.get("http://localhost:8799/" + path)
                check(r.status == code, f"{name}: GET /{path} returns {code}")
            ctx.close()
finally:
    srv.terminate()
print(f"\n{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
