"""Build the online demo in docs/ (served by GitHub Pages at https://juw12.github.io/founder-studio/).

The demo is the same app. Instead of server.py, js/browser-backend.js answers the /api/... calls
inside the browser with Pyodide (Python compiled to WebAssembly), running the real server.py
Studio class and the skill's scripts. Nothing is recorded or faked.

    python scripts/build_pages.py --pyodide path/to/pyodide-0.27.7.tgz
    python scripts/build_pages.py            # downloads the Pyodide core from the npm registry

Pyodide (MPL-2.0) is bundled in docs/pyodide/ so the demo needs no CDN.
"""
import argparse
import io
import json
import shutil
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
PYODIDE_VERSION = "0.27.7"
PYODIDE_FILES = (
    "pyodide.mjs",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
    "package.json",
)
STATIC = ("index.html", "styles.css", "LICENSE")
STATIC_DIRS = ("js", "vendor", "licenses")
PYTHON_FILES = ["server.py", *sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "tools").glob("*.py"))]
DEMO_PROJECT = ROOT / "projects" / "demo-matcha"

BANNER = (
    '<div class="demo-banner" role="note">Online demo: the studio runs in your browser '
    "(Python via WebAssembly), with the skill's own scripts. Nothing is saved, and AI buyers need the "
    '<a href="https://github.com/juw12/founder-studio#run">local app</a>.</div>'
)
BANNER_CSS = """
/* online demo only (added by scripts/build_pages.py) */
.demo-banner { padding: 7px 18px; font-size: 13px; color: var(--text); background: var(--panel); border-bottom: 1px solid var(--line); }
.demo-banner a { color: var(--accent-text); }
.demo-engine-status { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 50;
  padding: 10px 16px; border-radius: 10px; background: var(--panel-2); border: 1px solid var(--line);
  color: var(--text); font-size: 13px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45); }
"""

TEXT_SUFFIXES = {".html", ".css", ".js", ".md", ".txt", ".json"}


def pyodide_archive(path):
    if path:
        return Path(path).read_bytes()
    url = f"https://registry.npmjs.org/pyodide/-/pyodide-{PYODIDE_VERSION}.tgz"
    print(f"downloading {url}")
    with urllib.request.urlopen(url, timeout=180) as response:
        return response.read()


def copy_pyodide(archive_bytes, target):
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive_bytes)) as archive:
        for name in PYODIDE_FILES:
            member = archive.getmember(f"package/{name}")
            (target / name).write_bytes(archive.extractfile(member).read())
    (target / "NOTICE.md").write_text(
        f"Pyodide {PYODIDE_VERSION} core files from the npm package `pyodide`, MPL-2.0 licensed.\n"
        "Source: https://github.com/pyodide/pyodide - licence: https://www.mozilla.org/MPL/2.0/\n",
        encoding="utf-8",
        newline="\n",
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pyodide", help="path to a downloaded pyodide-<version>.tgz (npm package)")
    args = parser.parse_args()

    if DOCS.exists():
        shutil.rmtree(DOCS)
    DOCS.mkdir()
    for name in STATIC:
        shutil.copy2(ROOT / name, DOCS / name)
    for folder in STATIC_DIRS:
        shutil.copytree(ROOT / folder, DOCS / folder)
    # A Windows checkout with core.autocrlf=true has CRLF files; the site ships LF like the repo.
    for path in DOCS.rglob("*"):
        if path.is_file() and path.suffix in TEXT_SUFFIXES | {""}:
            data = path.read_bytes()
            if b"\r\n" in data:
                path.write_bytes(data.replace(b"\r\n", b"\n"))

    index = (DOCS / "index.html").read_text(encoding="utf-8")
    index = index.replace('<script type="module" src="js/app.js"></script>',
                          '<script type="module" src="js/browser-backend.js"></script>\n'
                          '  <script type="module" src="js/app.js"></script>', 1)
    index = index.replace("<body>", "<body>\n  " + BANNER, 1)
    if "browser-backend.js" not in index or "demo-banner" not in index:
        raise SystemExit("index.html changed shape; update build_pages.py")
    (DOCS / "index.html").write_text(index, encoding="utf-8", newline="\n")
    with (DOCS / "styles.css").open("a", encoding="utf-8", newline="\n") as css:
        css.write(BANNER_CSS)

    files = {path: (ROOT / path).read_text(encoding="utf-8") for path in PYTHON_FILES}
    for path in sorted(DEMO_PROJECT.iterdir()):
        if path.is_file():
            files[f"projects/demo-matcha/{path.name}"] = path.read_text(encoding="utf-8")
    (DOCS / "bundle.json").write_text(json.dumps({"files": files}, ensure_ascii=False), encoding="utf-8")

    copy_pyodide(pyodide_archive(args.pyodide), DOCS / "pyodide")
    (DOCS / ".nojekyll").write_text("", encoding="utf-8")
    total = sum(p.stat().st_size for p in DOCS.rglob("*") if p.is_file())
    print(f"docs/ ready: {len(files)} Python/project files bundled, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
