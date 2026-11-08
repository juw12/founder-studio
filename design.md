# Founder Studio design system

One dark, neutral working surface. Colour is reserved for meaning, never decoration.
Chosen by a judged bracket (3-model council, screenshots at 1280 and 390 px):
Graphite beat Ledger (light, blue accent) 3-0 and Paper (warm, serif) 3-0.

## Palette (tokens in `styles.css :root`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#121314` | page background |
| `--panel` / `--panel-2` | `#1a1b1d` / `#222326` | cards, inputs |
| `--line` / `--line-strong` | `#2e3033` / `#3d4045` | borders, dividers |
| `--text` / `--text-2` / `--muted` | `#ecedee` / `#c9ccd1` / `#9a9ea5` | body, secondary, hints |
| `--accent` / `--accent-text` | `#2563eb` / `#7fb0ff` | the one accent: primary action fill (white text, 5.2:1), focus ring, active tab, progress; the lighter tone for blue text on dark |
| `--buy` / `--pass` / `--think` | `#3fb871` / `#ef5a5a` / `#e0a43a` | decision states only |
| `--seg-1..6` | sky, amber, teal, grey, cyan, ochre | buyer segments (bots, legend, feed dots) |
| `--scene-*` | neutral greys | 3D arena floor, grid, stall, sign labels |

The 3D arena (`js/arena.js`) reads every colour from these tokens; there are no hex values in JS.

## Type

- UI: `Segoe UI, Helvetica Neue, Arial, sans-serif`, 14 px base, 12 px minimum.
- Numbers: `font-variant-numeric: tabular-nums` everywhere.
- Headings: same family, semibold, letter-spacing -0.01em.

## Shape and spacing

- Radius: 10 px for cards and inputs, 99 px for pills and badges.
- Spacing steps: 4, 6, 8, 12, 14, 18 px.
- Borders over shadows; one soft shadow only on floating overlays (hint, toast).

## Voice

- Plain words, short sentences. Say what a number is and where it came from
  ("Source: heuristic, counted by panel.py", "Simulated buyers, upper bound, not customers").
- Buttons are verbs: Run panel, See results, Write offer B.

## Patterns

- Decided bots in the arena carry a 2-letter name chip coloured by decision; hover or select expands it
  to the full name. Hovering a feed entry highlights its bot; clicking a bot selects its feed entry.
- Reviewer bots (review loop) are light grey with an accent-blue cap, a clipboard and an accent floor
  ring, so they never read as buyers. Their row sits in front of the stall; their labels always show,
  bordered blue (FIX), green (OK) or grey (YOUR CALL). Amber still means thinking.
- First-run setup shows only Business, Target buyer, Price and Pitch. Market anchor, notes, buyer
  details and the AI model settings sit behind disclosure (the AI section appears only in AI mode).
- Stats strip: one bordered row of cells above the arena (progress, buy/pass counts, conversion,
  then a note cell with the mode and "Simulated buyers, not customers"). No separate badges.
- Live feed: flat rows split by 1 px dividers, no cards. Decision tags are text only (BUY in green,
  PASS in muted grey), no filled pills. Arena zones are faint (disc 0.11, rings 0.5 opacity).
- Prices show two decimals and no invented currency ("6.50 / cup").
- Phone (<= 760 px): brand + Run on one row, then project and mode rows; arena, live feed, results,
  then setup.

## Banned defaults

- No purple or violet anywhere, no gradients, no glow, no backdrop blur.
- No emoji or Unicode symbols as icons or separators (no arrows, ticks, crosses, times signs, gears),
  in markup or in JS strings; use words ("chose", "says", "Hide") or CSS shapes.
- No Inter-only font stack.
- Checked by `slop_check.py` (hone/design): 0 blockers required before shipping.
