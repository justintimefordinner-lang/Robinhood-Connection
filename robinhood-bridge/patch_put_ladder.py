#!/usr/bin/env python3
"""One-time patch for am_report.py:
1. Rewrites put_ladder() to return 5 real strikes from the chain (2 nearest
   above 20-delta, 3 at-or-under 20-delta), each reporting its own observed
   delta to 1 decimal — instead of 3 fixed-target (30/25/20) lookups that can
   collapse onto the same strike on a thin/coarse chain.
2. Decouples the entry-gate's 30-delta reference from the display ladder, so
   this change can't affect tiering/scoring/ranking — the gate keeps using its
   own dedicated 30-delta lookup exactly as before.

Run once from the robinhood-bridge directory:
    .venv/bin/python3 patch_put_ladder.py
It edits am_report.py in place and prints what changed. Safe to re-run: if the
old text is already gone (patch already applied), it says so and exits 0.
"""
import pathlib

PATH = pathlib.Path("am_report.py")
src = PATH.read_text()

OLD_FUNC = '''def put_ladder(chain: dict) -> list[dict]:
    """The 30 / 25 / 20-delta puts in the ~30-DTE expiration, each with premium %,
    OI, spread, and annualized return (premPct × 365/DTE — how hard the collateral
    works at that delta). First leg (30Δ) is the primary used for the entry gate."""
    from datetime import date
    pmap = chain.get("putExpDateMap") or {}
    exp = _near_monthly_exp(pmap)
    if not exp:
        return []
    dte = (date.fromisoformat(exp.split(":")[0]) - date.today()).days
    exp_label = exp.split(":")[0]
    legs = []
    for dtarget in (0.30, 0.25, 0.20):
        leg = _put_at_delta(pmap[exp], dtarget)
        if not leg:
            continue
        leg["dTarget"] = int(round(dtarget * 100))
        leg["dte"] = dte
        leg["exp"] = exp_label
        leg["annPct"] = round(leg["premPct"] * 365 / dte, 1) if dte > 0 else None
        legs.append(leg)
    return legs'''

NEW_FUNC = '''def put_ladder(chain: dict) -> list[dict]:
    """Five real strikes from the actual ~30-DTE put chain, centered on the
    20-delta line: the two nearest strikes with delta > 20 (closest to 20 from
    above), then three strikes at-or-under 20-delta (closest available at/under
    20, then the next two further out). Each leg reports its own observed
    delta to 1 decimal (e.g. 24.3) rather than snapping to a fixed 30/25/20
    target, so distinct strikes never collapse into duplicate rows on a
    coarse/thin chain. Display only — the entry gate uses its own dedicated
    30-delta lookup (_put_at_delta directly), so this doesn't touch tiering or
    scoring."""
    from datetime import date
    pmap = chain.get("putExpDateMap") or {}
    exp = _near_monthly_exp(pmap)
    if not exp:
        return []
    dte = (date.fromisoformat(exp.split(":")[0]) - date.today()).days
    exp_label = exp.split(":")[0]

    candidates = []
    for strike, lst in pmap[exp].items():
        c = lst[0]
        dl = c.get("delta")
        if dl in (None, -999, -999.0):
            continue
        candidates.append((float(strike), abs(dl), c))
    if not candidates:
        return []
    candidates.sort(key=lambda t: t[1], reverse=True)  # ITM (~1) -> deep OTM (~0)
    cross = next((i for i, (_, dl, _) in enumerate(candidates) if dl <= 0.20), len(candidates))
    selected = candidates[max(0, cross - 2):cross] + candidates[cross:cross + 3]

    legs = []
    for strike, dl, c in selected:
        mark = c.get("mark") or (((c.get("bid") or 0) + (c.get("ask") or 0)) / 2)
        prem_pct = (mark / strike * 100) if strike else 0.0
        bid, ask = c.get("bid"), c.get("ask")
        spread_pct = (((ask - bid) / mark) * 100) if (mark and bid is not None and ask is not None) else 999.0
        leg = {
            "dTarget": round(dl * 100, 1),
            "strike": round(strike, 2),
            "mark": round(mark, 2),
            "premPct": round(prem_pct, 2),
            "oi": int(c.get("openInterest") or 0),
            "spreadPct": round(spread_pct, 1),
        }
        leg["dte"] = dte
        leg["exp"] = exp_label
        leg["annPct"] = round(leg["premPct"] * 365 / dte, 1) if dte > 0 else None
        legs.append(leg)
    return legs'''

OLD_GATE_1 = '''    ladder = put_ladder(chain) if chain else []
    put = ladder[0] if ladder else None    # 30Δ leg = the gate reference'''

NEW_GATE_1 = '''    pmap = (chain.get("putExpDateMap") or {}) if chain else {}
    gate_exp = _near_monthly_exp(pmap) if pmap else None
    put = _put_at_delta(pmap[gate_exp], 0.30) if gate_exp else None    # dedicated 30\u0394 gate reference, independent of the display ladder'''

OLD_GATE_2 = '''        ladder = put_ladder(chain)
        if not ladder:
            continue
        row["ladder"] = ladder
        row["chain"] = ladder[0]'''

NEW_GATE_2 = '''        pmap = chain.get("putExpDateMap") or {}
        gate_exp = _near_monthly_exp(pmap) if pmap else None
        gate_leg = _put_at_delta(pmap[gate_exp], 0.30) if gate_exp else None
        if not gate_leg:
            continue
        display_ladder = put_ladder(chain)
        row["ladder"] = display_ladder if display_ladder else [gate_leg]
        row["chain"] = gate_leg'''

REPLACEMENTS = [
    ("put_ladder() function", OLD_FUNC, NEW_FUNC),
    ("entry-gate lookup (_entry_gate-ish function)", OLD_GATE_1, NEW_GATE_1),
    ("board-loop lookup (main board-building loop)", OLD_GATE_2, NEW_GATE_2),
]

changed = 0
for name, old, new in REPLACEMENTS:
    if old in src:
        src = src.replace(old, new, 1)
        print(f"[patched] {name}")
        changed += 1
    elif new in src:
        print(f"[skip] {name} — already patched")
    else:
        print(f"[MISMATCH] {name} — anchor text not found verbatim. "
              f"No changes were made for this block; file left untouched for review.")

if changed:
    PATH.write_text(src)
    print(f"\nWrote am_report.py ({changed} block(s) patched).")
else:
    print("\nNo changes written.")
