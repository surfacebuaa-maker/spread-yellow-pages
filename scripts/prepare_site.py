"""Stage only public files and version assets by content to avoid stale browser/CDN code."""
from hashlib import sha256
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
output = root / "_site"
files = ["index.html", ".nojekyll", "anthropic/index.html", "anthropic/app.js", "anthropic/style.css",
         "anthropic/data/latest.json", "anthropic/data/history.json"]
for name in files:
    dest = output / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / name, dest)
page = output / "anthropic/index.html"
html = page.read_text()
for name, attr in [("app.js", "src"), ("style.css", "href")]:
    digest = sha256((output / "anthropic" / name).read_bytes()).hexdigest()[:12]
    html = html.replace(f'{attr}="{name}"', f'{attr}="{name}?v={digest}"')
page.write_text(html)
print("Prepared public site with content-versioned assets")
