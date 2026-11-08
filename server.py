"""Founder Studio - interactive pre-launch simulator for the ambitious-founder skill.

Standard library only. Serves the web app and wraps the skill's own tools
(panel.py, van_westendorp.py, unit_economics.py, compile.py) so every number
the studio shows is computed by the same scripts the skill uses.

    python server.py                      # http://127.0.0.1:8777 (next free port if taken)
    python server.py --root path/to/projects --port 8777
    python server.py --root path/to/my-idea/founder     # one skill project

--root is either a folder that holds one founder-style folder per product, or a
single founder/ folder made by the ambitious-founder skill. Default: ./projects.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")
VARIANT_RE = re.compile(r"^panel(-[a-z0-9-]{1,40})?$")

# One system prompt per bot role. Buyers decide; reviewers apply one board lens; the editor rewrites.
SYSTEM_PROMPTS = {
    "buyer": (
        "You are one simulated buyer on a consumer panel. Answer exactly as instructed in the brief. "
        "Reply with ONLY the JSON object the brief asks for. Do not be agreeable; most people do not buy most things."
    ),
    "reviewer": (
        "You are one reviewer on a startup board and apply only the lens named in the brief. "
        "Be specific and blunt, never invent facts, and reply with ONLY the JSON object the brief asks for."
    ),
    "editor": (
        "You are a careful copy editor for a small business pitch. Apply the requested changes, keep every true fact, "
        "never invent facts or offers, and reply with ONLY the JSON object the brief asks for."
    ),
}
WRITE_LOCK = threading.Lock()
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".woff2": "font/woff2",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}


def default_tools_dir():
    home = Path.home()
    for candidate in (
        APP_DIR / "tools",                      # bundled copy (standalone app)
        APP_DIR.parent / "tools",               # installed as ambitious-founder/studio
        home / ".vector" / "skills" / "ambitious-founder" / "tools",
        home / ".claude" / "skills" / "ambitious-founder" / "tools",
    ):
        if (candidate / "panel.py").exists():
            return candidate
    return None


def slugify(text):
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]
    return slug or "project"


def is_project_folder(folder):
    return any((folder / name).exists() for name in ("customer.json", "numbers.json", "idea.md"))


class Studio:
    def __init__(self, root, tools):
        self.root = Path(root).resolve()
        self.tools = Path(tools).resolve() if tools else None
        self.root.mkdir(parents=True, exist_ok=True)
        # A single founder/ folder (the skill's layout) is shown as one project.
        self.single = None
        if is_project_folder(self.root):
            owner = self.root.parent if self.root.name == "founder" else self.root
            self.single = slugify(owner.name)

    # ---------- helpers ----------
    def project_dir(self, name, create=False):
        if not NAME_RE.match(name or ""):
            raise ValueError("project name must be lowercase letters, digits and dashes")
        if self.single:
            if name != self.single:
                raise FileNotFoundError(f"this studio is opened on one project ('{self.single}'); start it with a folder of projects to add more")
            return self.root
        folder = self.root / name
        if create:
            folder.mkdir(parents=True, exist_ok=True)
        elif not folder.is_dir():
            raise FileNotFoundError(f"no project '{name}'")
        return folder

    def run_tool(self, script, *args, stdin=None):
        if not self.tools:
            raise RuntimeError("skill tools not found; start with --tools <ambitious-founder/tools>")
        completed = subprocess.run(
            [sys.executable, str(self.tools / script), *[str(a) for a in args]],
            input=stdin,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
        )
        return completed.returncode, completed.stdout, completed.stderr

    @staticmethod
    def read_text(path):
        return path.read_text(encoding="utf-8") if path.exists() else None

    @staticmethod
    def read_json(path):
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    @staticmethod
    def retry_busy(action, attempts=6):
        """Run a file action, retrying briefly while Windows reports the file is in use."""
        for attempt in range(attempts):
            try:
                return action()
            except PermissionError:
                if attempt == attempts - 1:
                    raise
                time.sleep(0.1 * (attempt + 1))

    @classmethod
    def write(cls, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        if not isinstance(content, str):
            content = json.dumps(content, ensure_ascii=False, indent=2)
        cls.retry_busy(lambda: path.write_text(content, encoding="utf-8"))

    def panel_dir(self, folder, variant):
        variant = variant or "panel"
        if not VARIANT_RE.match(variant):
            raise ValueError("bad panel variant")
        return folder / variant

    # ---------- API ----------
    def list_projects(self):
        projects = []
        folders = [self.root] if self.single else sorted(p for p in self.root.iterdir() if p.is_dir())
        for folder in folders:
            if not (folder / "customer.json").exists():
                continue
            results = self.read_json(folder / "panel" / "results.json") or {}
            plan = self.read_text(folder / "business-plan.md") or ""
            verdict = re.search(r"Verdict[^:\n]*:\s*\**\s*(Profitable|Not yet|Incomplete)", plan)
            variants = sorted(p.name for p in folder.iterdir() if p.is_dir() and VARIANT_RE.match(p.name))
            projects.append({
                "name": self.single or folder.name,
                "business": (self.read_json(folder / "customer.json") or {}).get("business", folder.name),
                "buys": results.get("buys"),
                "answered": results.get("answered"),
                "buy_rate": results.get("buy_rate"),
                "verdict": verdict.group(1).strip() if verdict else None,
                "variants": variants,
            })
        return {"root": str(self.root), "tools": str(self.tools) if self.tools else None, "projects": projects}

    def get_project(self, name, variant=None):
        folder = self.project_dir(name)
        panel = self.panel_dir(folder, variant)
        answers = []
        answers_dir = panel / "answers"
        if answers_dir.is_dir():
            for path in sorted(answers_dir.glob("*.json")):
                try:
                    answers.append(json.loads(path.read_text(encoding="utf-8")))
                except json.JSONDecodeError:
                    pass
        panel_meta = self.read_json(panel / "panel.json") or {}
        return {
            "name": name,
            "variant": panel.name,
            "idea": self.read_text(folder / "idea.md"),
            "customer": self.read_json(folder / "customer.json"),
            "pitch": panel_meta.get("pitch") or self.read_text(folder / "pitch.md"),
            "numbers": self.read_json(folder / "numbers.json"),
            "competitors": self.read_text(folder / "competitors.md"),
            "personas": self.read_json(panel / "personas.json") or [],
            "seed": panel_meta.get("seed"),
            "answers": answers,
            "results": self.read_json(panel / "results.json"),
            "plan": self.read_text(folder / "business-plan.md"),
        }

    def deal(self, body):
        folder = self.project_dir(body["name"], create=True)
        panel = self.panel_dir(folder, body.get("variant"))
        customer = body["customer"]
        pitch = body["pitch"]
        self.write(folder / "customer.json", customer)
        pitch_file = folder / ("pitch.md" if panel.name == "panel" else f"pitch-{panel.name}.md")
        self.write(pitch_file, pitch)
        if body.get("idea"):
            self.write(folder / "idea.md", body["idea"])
        if body.get("competitors"):
            self.write(folder / "competitors.md", body["competitors"])
        if panel.exists():
            for old in list((panel / "answers").glob("*.json")) if (panel / "answers").exists() else []:
                self.retry_busy(lambda: old.unlink(missing_ok=True))
        args = ["--dir", panel, "init", "--customer", folder / "customer.json", "--pitch", pitch_file, "--n", int(body.get("n", 20))]
        if body.get("seed"):
            args += ["--seed", int(body["seed"])]
        code, out, err = self.run_tool("panel.py", *args)
        if code != 0:
            raise RuntimeError(err or out)
        self.run_tool("panel.py", "--dir", panel, "prompts")
        personas = self.read_json(panel / "personas.json") or []
        briefs = {}
        for persona in personas:
            brief = panel / "briefs" / f"{persona['id']}.md"
            briefs[persona["id"]] = self.read_text(brief) or ""
        meta = self.read_json(panel / "panel.json") or {}
        return {"variant": panel.name, "seed": meta.get("seed"), "personas": personas, "briefs": briefs}

    def save_answers(self, body):
        folder = self.project_dir(body["name"])
        panel = self.panel_dir(folder, body.get("variant"))
        answers_dir = panel / "answers"
        answers_dir.mkdir(parents=True, exist_ok=True)
        for answer in body["answers"]:
            if not re.match(r"^P\d{3,4}$", str(answer.get("id", ""))):
                continue
            self.write(answers_dir / f"{answer['id']}.json", answer)
        _, check_out, check_err = self.run_tool("panel.py", "--dir", panel, "check")
        _, tally_out, tally_err = self.run_tool("panel.py", "--dir", panel, "tally")
        results = self.read_json(panel / "results.json")
        price = body.get("price")
        vw_args = [answers_dir, "--json"]
        if price:
            vw_args += ["--price", price]
        if panel.name == "panel":
            vw_args += ["--out", folder / "pricing-curve.md"]
        code, vw_out, vw_err = self.run_tool("van_westendorp.py", *vw_args)
        pricing = json.loads(vw_out) if code == 0 and vw_out.strip().startswith("{") else {"error": (vw_err or vw_out).strip()}
        return {"check": (check_out + check_err).strip(), "tally": (tally_out + tally_err).strip(), "results": results, "pricing": pricing}

    def numbers(self, body):
        folder = self.project_dir(body["name"], create=True)
        self.write(folder / "numbers.json", body["numbers"])
        code, out, err = self.run_tool("unit_economics.py", folder / "numbers.json", "--out", folder / "cfo.md", "--json")
        if code != 0:
            raise RuntimeError(err or out)
        base = json.loads(out)
        what_ifs = {}
        for label, extra in (body.get("what_ifs") or {}).items():
            c2, o2, _ = self.run_tool("unit_economics.py", folder / "numbers.json", "--json", *[str(x) for x in extra])
            if c2 == 0:
                result = json.loads(o2)
                what_ifs[label] = {"year1_profit": result["year1_profit"], "payback_month": result["payback_month"], "flags": result["flags"]}
        return {"cfo": base, "what_ifs": what_ifs}

    def save_file(self, body):
        allowed = {"idea.md", "competitors.md", "pitch.md", "offer.md", "marketing.md", "brand.md", "ops.md", "launch.md", "review-loop.md"}
        file_name = body.get("file")
        if file_name not in allowed:
            raise ValueError(f"can only save {sorted(allowed)}")
        folder = self.project_dir(body["name"], create=True)
        self.write(folder / file_name, body.get("content", ""))
        return {"saved": str(folder / file_name)}

    def verdict(self, body):
        folder = self.project_dir(body["name"])
        bar = str(body.get("min_buy_rate", 0.25))
        _, check_out, check_err = self.run_tool("compile.py", "--dir", folder, "--check", "--min-buy-rate", bar)
        self.run_tool("compile.py", "--dir", folder, "--min-buy-rate", bar)
        check = (check_out + check_err).strip()
        if not (folder / "panel" / "results.json").exists():
            # compile.py skips the buyer check when no panel exists; the skill requires it, so the studio does not allow a verdict.
            lines = check.splitlines()[1:]
            check = "\n".join(["Verdict: Incomplete", "  ✗ No official buyer panel yet (panel/results.json). Run AI buyers and promote the run."] + lines)
        return {"check": check, "plan": self.read_text(folder / "business-plan.md")}

    def llm(self, body):
        provider = body.get("provider", "openai")
        model = body.get("model") or ""
        brief = body["brief"]
        role = body.get("role", "buyer")
        if role not in SYSTEM_PROMPTS:
            raise ValueError(f"unknown role {role!r}")
        system = SYSTEM_PROMPTS[role]
        if provider == "anthropic":
            key = body.get("api_key") or os.environ.get("ANTHROPIC_API_KEY", "")
            url = (body.get("base_url") or "https://api.anthropic.com").rstrip("/") + "/v1/messages"
            payload = {"model": model or "claude-sonnet-4-5", "max_tokens": 700, "system": system,
                       "messages": [{"role": "user", "content": brief}]}
            headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
        else:
            key = body.get("api_key") or os.environ.get("OPENAI_API_KEY", "")
            url = (body.get("base_url") or "https://api.openai.com/v1").rstrip("/") + "/chat/completions"
            payload = {"model": model or "gpt-4o-mini", "temperature": 0.9,
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": brief}]}
            headers = {"content-type": "application/json"}
            if key:
                headers["authorization"] = f"Bearer {key}"
        request = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"model API {error.code}: {error.read().decode('utf-8', 'replace')[:300]}")
        if provider == "anthropic":
            text = "".join(part.get("text", "") for part in data.get("content", []))
        else:
            text = data["choices"][0]["message"]["content"]
        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            raise RuntimeError("model did not return JSON")
        return {"answer": json.loads(match.group(0)), "raw": text}


def make_handler(studio):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            sys.stderr.write("[studio] " + fmt % args + "\n")

        def send_json(self, status, payload):
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(data)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path, _, query = self.path.partition("?")
            params = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
            try:
                if path == "/api/projects":
                    return self.send_json(200, studio.list_projects())
                if path == "/api/project":
                    return self.send_json(200, studio.get_project(params.get("name", ""), params.get("variant")))
            except (ValueError, FileNotFoundError) as error:
                return self.send_json(400, {"error": str(error)})
            except Exception as error:
                return self.send_json(500, {"error": str(error)})
            self.serve_static(path)

        def do_POST(self):
            length = int(self.headers.get("content-length", "0") or 0)
            if self.headers.get("origin") and not self.headers["origin"].startswith(("http://127.0.0.1", "http://localhost")):
                return self.send_json(403, {"error": "cross-origin requests are not allowed"})
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                routes = {
                    "/api/deal": studio.deal,
                    "/api/answers": studio.save_answers,
                    "/api/numbers": studio.numbers,
                    "/api/save": studio.save_file,
                    "/api/verdict": studio.verdict,
                    "/api/llm": studio.llm,
                }
                handler = routes.get(self.path)
                if not handler:
                    return self.send_json(404, {"error": "unknown endpoint"})
                if self.path == "/api/llm":
                    return self.send_json(200, handler(body))
                # Runs that write project files go one at a time, so two tabs can't collide on a file.
                with WRITE_LOCK:
                    return self.send_json(200, handler(body))
            except PermissionError:
                return self.send_json(409, {"error": "Project files were busy (another run was saving). Run again in a moment."})
            except (ValueError, FileNotFoundError, KeyError) as error:
                return self.send_json(400, {"error": str(error)})
            except Exception as error:
                return self.send_json(500, {"error": str(error)})

        def serve_static(self, path):
            relative = "index.html" if path in ("/", "") else path.lstrip("/")
            target = (APP_DIR / relative).resolve()
            public = {APP_DIR / "index.html", APP_DIR / "styles.css"}
            in_public_dir = any(folder in target.parents for folder in (APP_DIR / "js", APP_DIR / "vendor", APP_DIR / "fonts"))
            if (target not in public and not in_public_dir) or target.suffix not in MIME or not target.is_file():
                self.send_response(404)
                self.end_headers()
                return
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("content-type", MIME.get(target.suffix, "application/octet-stream"))
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Founder Studio")
    parser.add_argument("--root", default=None, help="folder of projects, or one founder/ folder (default: ./projects)")
    parser.add_argument("--tools", default=None, help="ambitious-founder/tools folder")
    parser.add_argument("--port", type=int, default=8777)
    args = parser.parse_args()
    root = args.root or os.environ.get("FOUNDER_STUDIO_ROOT") or APP_DIR / "projects"
    studio = Studio(root, args.tools or default_tools_dir())
    server = None
    for port in range(args.port, args.port + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(studio))
            break
        except OSError:
            continue
    if server is None:
        sys.exit(f"no free port between {args.port} and {args.port + 19}")
    port = server.server_address[1]
    print(f"Founder Studio on http://127.0.0.1:{port}  (projects: {studio.root}, tools: {studio.tools})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
