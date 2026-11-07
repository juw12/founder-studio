# Founder Studio

Interactive, local pre-launch simulator for the `ambitious-founder` skill. You set up a product, price,
buyer segments and pitch, then watch 3D buyer bots walk up to your stall, think, and walk to **BUY** or **PASS**.
Every number they produce is checked by the skill's own scripts (`panel.py`, `van_westendorp.py`,
`unit_economics.py`, `compile.py`).

## Online demo

**https://juw12.github.io/founder-studio/** - nothing to install.

- The page runs the same `server.py` and the skill's four scripts in your browser, through
  [Pyodide](https://pyodide.org) (Python compiled to WebAssembly, bundled in `docs/pyodide/`, MPL-2.0).
- It opens the `demo-matcha` project. Quick sim, pricing, numbers and the verdict all come from the real scripts.
- What needs the local app: AI buyers (they call a language model), and saving. Edits in the online demo are lost on reload.
- First load downloads about 14 MB (the Python runtime), then the browser caches it.
- Rebuild after changing the app: `python scripts/build_pages.py --pyodide path/to/pyodide-0.27.7.tgz`
  (without `--pyodide` it downloads the Pyodide release from npm). GitHub Pages serves `main:/docs`.

## Run

Python 3.9+ standard library only. three.js r160 is bundled in `vendor/`, so there is no install step and no CDN.

```
git clone https://github.com/juw12/founder-studio
cd founder-studio
python server.py                         # opens the demo project in ./projects
python server.py --root path/to/founder  # one founder folder from the skill = one project
python server.py --root path/to/ideas    # a folder with one sub-folder per idea
python test_api.py                       # 17 smoke checks on temporary folders
```

- The server prints its URL (default `http://127.0.0.1:8777`, next free port if busy).
- `--root` order: the flag, then `FOUNDER_STUDIO_ROOT`, then `./projects`.
  - If the root itself holds `customer.json`, `numbers.json` or `idea.md`, it opens as a single project.
- `--tools` is optional. The skill's scripts are bundled in `tools/`. When the app is installed inside the
  skill (`ambitious-founder/studio/`), it uses the skill's `tools/` instead.
- URL options: `?project=demo-matcha&mode=quick|ai|replay&autorun=1&speed=1..4`.

## Modes

| Mode | Who decides | Writes to | Counts for the verdict? |
|---|---|---|---|
| Quick sim | Seeded heuristic (need sliders, price vs anchor and income, objections answered by the pitch) | `panel-quick/` | No |
| AI buyers | An LLM reads each buyer's isolated brief from `panel.py prompts` | `panel-ai/` | Only after you confirm "Make this AI run the official panel" |
| Replay | The saved official `panel/` answers, animated | nothing | — |

- **A/B offer** deals the *same buyers* (same seed) to pitch B and shows which buyers you won or lost.
- **AI models:** any OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio, OpenRouter) or Anthropic.
  - The key can come from the form (it is not saved to disk) or from `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`.
- **Tabs:**
  - Results: segment and behaviour rates, reasons, what would flip a no, and one **Next test** with a button to write offer B.
  - Pricing: the Van Westendorp curve.
  - Numbers: `unit_economics.py` plus what-ifs.
  - Competitors: `competitors.md` editor plus a "beat-them board" of unanswered objections.
  - A/B offer.
  - Verdict: `compile.py`, ending with one recommended next test.

## Honesty rules (built in)

- Every screen carries "Simulated buyers - upper bound, not customers".
- Quick sim is labelled heuristic: it is not AI and it is not evidence.
- The official `panel/` is never overwritten silently.
- The verdict reads only the official panel. With no official panel `compile.py` says **Incomplete**, even if the numbers look profitable.
- A simulated panel is a filter for bad ideas, not proof of demand. Confirm with real pre-orders, a waitlist or a smoke test.

## Versus paid synthetic-research tools

Prices come from web research in Nov 2026 (vendor pages, plus getminds.ai comparison pages, which are written by a competitor). Re-check the vendor pages before quoting them.

| | Founder Studio | Minds | Synthetic Users | Ask Rally | Yabble Virtual Audiences |
|---|---|---|---|---|---|
| Price | Free, local (you pay only for LLM calls, or $0 with Ollama) | ~US$0.12/response or US$199/user/mo | from ~US$12.5k/yr | ~US$20/mo | ~US$800/mo |
| Bring your own model | Yes (OpenAI-compatible, Ollama, Anthropic) | No | No | No | No |
| Live 3D buyers you can click | Yes | No | No | No | No |
| Same-seed A/B of offers | Yes | Partial | Partial | Partial | Partial |
| Van Westendorp pricing | Yes (`van_westendorp.py`) | Yes (+ Gabor-Granger) | — | — | — |
| Unit economics + verdict | Yes (`unit_economics.py`, `compile.py`) | No | No | No | No |
| Data stays on your PC | Yes | No | No | No | No |

The whole category shares one limit: synthetic respondents are not representative and not validated against
real buyers. That is why the studio labels everything and keeps real-world tests in the plan.

## Files

- `server.py`: API and static server.
  - Name and variant validation, same-origin check on POST, and a whitelist for saved files.
- `index.html`, `styles.css`: the UI.
- `js/app.js`: the controller.
- `js/arena.js`: the 3D arena.
- `js/engine.js`: the heuristic buyer.
- `test_api.py`: self-contained smoke tests. It starts its own servers on temporary folders.
- `tools/`: bundled copies of the skill's scripts (`panel.py`, `van_westendorp.py`, `unit_economics.py`, `compile.py`).
- `projects/demo-matcha/`: the skill's worked example.
- `licenses/`: MIT licences of the two skills the method comes from.

## Known limits

- Quick sim weights are hand-set; they are not fitted to any data.
- AI runs cost tokens. 20 buyers is about 20 calls.
- In background tabs, browsers throttle animation. Bots snap to their final spot when the run ends.

## Design pass (/hone, Nov 2026)

Judged by a 3-model council against a frozen rubric, with code-checked gates (A1-A8) the judges cannot override.
Scored on six screenshots: idle, mid-run and finished, at 1280 px and 390 px.
Result: **6.65 -> 8.08 (3 judges, mean of 2 scoring runs), all gates passing, API tests passing.** Target is 8.5, so this
is not "done" yet. An earlier 8.43 came from only 2 judges (the vision judge was failing on image size); with all 3 judges
that version re-scores 7.6, and round 11 beat it.

- Rounds 1-2 (earlier pass): favicon/title, 12 px floor, contrast, phone layout with 44 px targets, Next-test card,
  arena kept clear.
- Round 5: decided buyers stand in a tidy grid inside BUY/PASS with a green/red ring each; names show only while
  walking or thinking (or when selected); a live line under the arena shows the newest decision and, at the end,
  "N of 20 would buy - below your 25% target" with a See results button; results open with that headline;
  Skip to results (also `?skip=1`); optional setup fields are collapsed.
- Round 6: short stall title that never hides behind the counters; the honesty badges no longer overlap the buy-rate card.
- Round 7: name labels never cover the stall sign, a stronger thinking ring, more space in the piles, the three modes
  explained under How it works, and a `?` button to reopen the arena tip.

- Round 11: the Buyers section starts collapsed with a one-line summary; the badge says "rule-based, not AI"; the final
  line names the top reason to pass; roomier BUY/PASS zones; the phone legend sits inside the arena; a phone Setup button.

Still open (from the judges): telling individual buyers apart inside a full pile, a shorter first-run setup form,
and a less crowded phone layout (arena, feed and setup on one screen).
