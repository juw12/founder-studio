"""Self-contained smoke test for Founder Studio's API.

    python test_api.py

Starts its own server on a temporary copy of the demo project, so it never touches
your real projects. Exit code 0 = all checks pass.
"""
import http.server
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parent
DEMO = APP / "projects" / "demo-matcha"
failures = []
for stream in (sys.stdout, sys.stderr):
    stream.reconfigure(encoding="utf-8", errors="replace")
# Talk to 127.0.0.1 directly, even when HTTP(S)_PROXY is set (office networks).
DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def start_server(root, port):
    process = subprocess.Popen(
        [sys.executable, str(APP / "server.py"), "--root", str(root), "--port", str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
    )
    line = process.stdout.readline()
    if "http://127.0.0.1:" not in line:
        process.kill()
        raise SystemExit(f"server did not start: {line}")
    base = line.split("on ")[1].split()[0]
    return process, base


def make_caller(base):
    def call(path, body=None):
        request = urllib.request.Request(
            base + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"content-type": "application/json"},
            method="GET" if body is None else "POST",
        )
        try:
            with DIRECT.open(request, timeout=90) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode()[:300]

    def status_of(path):
        try:
            with DIRECT.open(base + path, timeout=10) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code

    return call, status_of


def expect(label, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + label + (f"  ({detail})" if detail else ""))
    if not condition:
        failures.append(label)


def fake_answers(personas):
    answers = []
    for index, persona in enumerate(personas):
        buys = index % 4 == 0
        answers.append({
            "id": persona["id"], "buys": buys, "purchases_first_month": int(buys),
            "reason_code": "need" if buys else "price", "reason": "smoke test", "objection": persona["objection"],
            "would_change_my_mind": "", "price_too_cheap": 2, "price_cheap": 4 + index % 3,
            "price_expensive": 7 + index % 4, "price_too_expensive": 10 + index % 5,
        })
    return answers


def test_folder_of_projects(workspace):
    root = workspace / "projects"
    # Copy only the tracked demo inputs; local runs leave generated panel folders next to them.
    generated = shutil.ignore_patterns("panel", "panel-*", "pitch-panel-*.md")
    shutil.copytree(DEMO, root / "demo-matcha", ignore=generated)
    official = root / "demo-matcha" / "panel" / "results.json"
    official.parent.mkdir(parents=True)
    official.write_text('{"buys": 9, "passes": 11, "answered": 20, "buy_rate": 0.45}', encoding="utf-8")
    official_before = official.read_text(encoding="utf-8")

    process, base = start_server(root, 18791)
    call, status_of = make_caller(base)
    try:
        statics = {p: status_of(p) for p in ["/", "/styles.css", "/js/app.js", "/js/arena.js", "/vendor/three.module.min.js"]}
        expect("static assets served", all(v == 200 for v in statics.values()), statics)
        blocked = {p: status_of(p) for p in ["/server.py", "/test_api.py", "/tools/panel.py", "/projects/demo-matcha/numbers.json"]}
        expect("non-public files blocked", all(v == 404 for v in blocked.values()), blocked)

        code, projects = call("/api/projects")
        names = [p["name"] for p in projects["projects"]] if code == 200 else []
        expect("demo project listed", names == ["demo-matcha"], names)
        expect("bundled tools found", code == 200 and projects["tools"] and projects["tools"].endswith("tools"), projects.get("tools") if code == 200 else code)

        customer = json.loads((DEMO / "customer.json").read_text(encoding="utf-8"))
        code, dealt = call("/api/deal", {
            "name": "demo-matcha", "variant": "panel-quick", "customer": customer,
            "pitch": (DEMO / "pitch.md").read_text(encoding="utf-8"), "n": 20, "seed": 4242,
        })
        expect("deal 20 buyers via panel.py", code == 200 and len(dealt["personas"]) == 20 and len(dealt["briefs"]) == 20, code)
        code2, again = call("/api/deal", {
            "name": "demo-matcha", "variant": "panel-quick-b", "customer": customer, "pitch": "offer B", "n": 20, "seed": 4242,
        })
        same = code2 == 200 and [p["name"] for p in again["personas"]] == [p["name"] for p in dealt["personas"]]
        expect("same seed deals the same buyers (A/B)", same)
        expect("briefs are the skill's isolated briefs", code == 200 and "=== WHO YOU ARE ===" in dealt["briefs"]["P001"])

        code, saved = call("/api/answers", {"name": "demo-matcha", "variant": "panel-quick", "answers": fake_answers(dealt["personas"]), "price": 6.5})
        expect("answers validated + tallied by panel.py", code == 200 and "valid" in saved["check"] and saved["results"]["buys"] == 5, saved["check"] if code == 200 else saved)
        expect("price curve from van_westendorp.py", code == 200 and len(saved["pricing"].get("range", [])) == 2, saved["pricing"] if code == 200 else "")

        numbers = json.loads((DEMO / "numbers.json").read_text(encoding="utf-8"))
        code, cfo = call("/api/numbers", {"name": "demo-matcha", "numbers": numbers, "what_ifs": {"half": ["--volume", 0.5]}})
        expected = numbers["price"] - sum(item["cost"] for item in numbers["variable"])
        ok = code == 200 and abs(cfo["cfo"]["contribution"] - expected) < 0.01 and "half" in cfo["what_ifs"]
        expect("unit_economics.py via API", ok, cfo["cfo"]["contribution"] if code == 200 else cfo)

        code, verdict = call("/api/verdict", {"name": "demo-matcha", "min_buy_rate": 0.25})
        expect("compile.py verdict reads only the official panel", code == 200 and "Verdict:" in verdict["check"], verdict["check"].splitlines()[0] if code == 200 else verdict)

        code, _ = call("/api/save", {"name": "demo-matcha", "file": "../../evil.md", "content": "x"})
        expect("save refuses paths outside whitelist", code == 400)
        code, _ = call("/api/project?name=..%2Fdemo-matcha")
        expect("project names are validated", code == 400)
        expect("official panel untouched by sim runs", official.read_text(encoding="utf-8") == official_before)
    finally:
        process.kill()


def test_single_founder_folder(workspace):
    founder = workspace / "my-cafe-idea" / "founder"
    shutil.copytree(DEMO, founder)
    process, base = start_server(founder, 18792)
    call, _ = make_caller(base)
    try:
        code, projects = call("/api/projects")
        names = [p["name"] for p in projects["projects"]] if code == 200 else []
        expect("a skill founder/ folder opens as one project", names == ["my-cafe-idea"], names)
        code, project = call("/api/project?name=my-cafe-idea")
        expect("single project loads", code == 200 and project.get("customer", {}).get("business"), code)
    finally:
        process.kill()


def test_no_panel_is_incomplete(workspace):
    founder = workspace / "numbers-only" / "founder"
    shutil.copytree(DEMO, founder)
    sys.path.insert(0, str(APP))
    import server  # same tool lookup as the app: bundled tools/, then the skill's tools/
    tools = server.default_tools_dir()
    completed = subprocess.run(
        [sys.executable, str(tools / "compile.py"), "--dir", str(founder), "--check"],
        capture_output=True, text=True, encoding="utf-8",
    )
    expect("compile.py: good numbers without a panel = Incomplete", "Incomplete" in completed.stdout, completed.stdout.strip()[:80])


def start_model_stub(port):
    """A tiny OpenAI-compatible stub: answers by role (buyer / reviewer / editor) and records system prompts."""
    seen = []

    class Stub(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["content-length"])))
            system = body["messages"][0]["content"]
            seen.append(system)
            if "reviewer on a startup board" in system:
                content = {"verdict": "fix", "note": "Answer the top doubt.", "change": "Add one line on taste."}
            elif "copy editor" in system:
                content = {"pitch": "Stub pitch v2. $6.50 a cup.", "changes": ["Added a taste line (confirm)"]}
            else:
                content = {"buys": True, "purchases_first_month": 1, "reason_code": "need", "reason": "stub",
                           "would_change_my_mind": "", "price_too_cheap": 2, "price_cheap": 4,
                           "price_expensive": 7, "price_too_expensive": 10}
            data = json.dumps({"choices": [{"message": {"content": json.dumps(content)}}]}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Stub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, seen


def test_review_loop_api(workspace):
    """The review loop's server side: review variant, reviewer/editor roles, the review report."""
    root = workspace / "review-projects"
    shutil.copytree(DEMO, root / "demo-matcha")
    process, base = start_server(root, 18794)
    call, status_of = make_caller(base)
    stub, seen = start_model_stub(18795)
    stub_url = "http://127.0.0.1:18795/v1"
    try:
        expect("review.js served", status_of("/js/review.js") == 200)
        customer = json.loads((DEMO / "customer.json").read_text(encoding="utf-8"))
        code, first = call("/api/deal", {"name": "demo-matcha", "variant": "panel-quick-review", "customer": customer,
                                         "pitch": "v0 pitch", "n": 20, "seed": 777})
        code2, second = call("/api/deal", {"name": "demo-matcha", "variant": "panel-quick-review", "customer": customer,
                                           "pitch": "v1 pitch with a new line", "n": 20, "seed": 777})
        same = code == 200 and code2 == 200 and [p["name"] for p in first["personas"]] == [p["name"] for p in second["personas"]]
        expect("review rounds keep the same buyers (same seed)", same)
        expect("each round's brief carries the new pitch", code2 == 200 and "v1 pitch with a new line" in second["briefs"]["P001"])

        code, reviewed = call("/api/llm", {"role": "reviewer", "base_url": stub_url, "api_key": "stub", "brief": "review this"})
        expect("reviewer role reaches the model with the reviewer prompt",
               code == 200 and reviewed["answer"]["verdict"] == "fix" and "reviewer on a startup board" in seen[-1], reviewed)
        code, edited = call("/api/llm", {"role": "editor", "base_url": stub_url, "api_key": "stub", "brief": "rewrite"})
        expect("editor role returns a new pitch", code == 200 and edited["answer"]["pitch"].startswith("Stub pitch"), edited)
        code, bought = call("/api/llm", {"base_url": stub_url, "api_key": "stub", "brief": "buyer brief"})
        expect("buyer role is still the default", code == 200 and "simulated buyer" in seen[-1], bought)
        code, _ = call("/api/llm", {"role": "judge", "base_url": stub_url, "brief": "x"})
        expect("unknown bot roles are refused", code == 400)

        code, _ = call("/api/save", {"name": "demo-matcha", "file": "review-loop.md", "content": "# Review loop\n"})
        report = root / "demo-matcha" / "review-loop.md"
        expect("review report saved to the project", code == 200 and report.read_text(encoding="utf-8").startswith("# Review loop"))
    finally:
        stub.shutdown()
        process.kill()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as temp:
        workspace = Path(temp)
        test_folder_of_projects(workspace)
        test_single_founder_folder(workspace)
        test_no_panel_is_incomplete(workspace)
        test_review_loop_api(workspace)
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1 if failures else 0)
