import sys, pathlib, shutil, re
SRC = pathlib.Path('bsp-consult-dashboard.html')
base = SRC.read_text()

CHIP_OLD = """          <span style="min-width:34px;height:20px;padding:0 6px;border-radius:5px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.14);color:#c6ccdb;font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:0.06em;display:inline-flex;align-items:center;justify-content:center;flex:none;">${mark}</span>
          <span style="font-size:13px;font-weight:800;color:#e7e9ee;">${label}</span>"""

BAR_OLD = """<span style="width:48px;height:5px;border-radius:4px;background:rgba(255,255,255,0.06);flex:none;overflow:hidden;"><span style="display:block;height:100%;width:${w}%;border-radius:4px;background:${on ? '#5b9bff' : 'rgba(255,255,255,0.22)'};"></span></span>"""

# token map is injected before `const cols =`
ANCHOR = "  const cols = COLS.map(([label, mark]) => {"

def build(name, tokens_js, chip_js, bar_js):
    s = base
    assert s.count(ANCHOR) == 1
    s = s.replace(ANCHOR, tokens_js + "\n" + ANCHOR)
    assert s.count(CHIP_OLD) == 1, "chip anchor"
    s = s.replace(CHIP_OLD, chip_js)
    assert s.count(BAR_OLD) == 1, "bar anchor"
    s = s.replace(BAR_OLD, bar_js)
    out = pathlib.Path(f'variant-{name}.html')
    out.write_text(s)
    print("built", out)

# ---- shared token block -------------------------------------------------
TOK = """  // TEN-242 item 1 — surface tint. Design-system tokens ONLY.
  const SURF = { clay:'#e8a84e', hard:'#4db8ff', grass:'#2ab8a0' };
  // The tint is derived from the ROW'S OWN surface, never from the column, so a
  // column that is not surface-pure cannot paint a row the wrong colour.
  const tintOf = t => SURF[t.surface] || SURF.hard;
  const colTint = label => label==='Clay' ? SURF.clay : label==='Grass' ? SURF.grass : SURF.hard;
  const hexA = (h,a) => 'rgba('+parseInt(h.slice(1,3),16)+','+parseInt(h.slice(3,5),16)+','+parseInt(h.slice(5,7),16)+','+a+')';
"""

# (a) literal: Indoor and Outdoor both full hard-blue
build('a', TOK,
  """          <span style="min-width:34px;height:20px;padding:0 6px;border-radius:5px;background:${hexA(colTint(label),0.14)};border:1px solid ${hexA(colTint(label),0.45)};color:${colTint(label)};font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:0.06em;display:inline-flex;align-items:center;justify-content:center;flex:none;">${mark}</span>
          <span style="font-size:13px;font-weight:800;color:${colTint(label)};">${label}</span>""",
  """<span style="width:48px;height:5px;border-radius:4px;background:rgba(255,255,255,0.06);flex:none;overflow:hidden;"><span style="display:block;height:100%;width:${w}%;border-radius:4px;background:${on ? '#5b9bff' : hexA(tintOf(t),0.55)};"></span></span>""")

# (b) opacity: indoor at lower alpha
build('b', TOK,
  """          <span style="min-width:34px;height:20px;padding:0 6px;border-radius:5px;background:${hexA(colTint(label), label==='Indoor'?0.07:0.14)};border:1px solid ${hexA(colTint(label), label==='Indoor'?0.22:0.45)};color:${label==='Indoor'?hexA(colTint(label),0.60):colTint(label)};font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:0.06em;display:inline-flex;align-items:center;justify-content:center;flex:none;">${mark}</span>
          <span style="font-size:13px;font-weight:800;color:${label==='Indoor'?hexA(colTint(label),0.62):colTint(label)};">${label}</span>""",
  """<span style="width:48px;height:5px;border-radius:4px;background:rgba(255,255,255,0.06);flex:none;overflow:hidden;"><span style="display:block;height:100%;width:${w}%;border-radius:4px;background:${on ? '#5b9bff' : hexA(tintOf(t), label==='Indoor'?0.28:0.55)};"></span></span>""")

# (c) colour = surface only; the IND/OUT split is carried by chip FILL, not hue
build('c', TOK,
  """          <span style="min-width:34px;height:20px;padding:0 6px;border-radius:5px;background:${label==='Indoor'?colTint(label):'transparent'};border:1px solid ${hexA(colTint(label),0.55)};color:${label==='Indoor'?'#06070a':colTint(label)};font-family:${MONO};font-size:9.5px;font-weight:700;letter-spacing:0.06em;display:inline-flex;align-items:center;justify-content:center;flex:none;">${mark}</span>
          <span style="font-size:13px;font-weight:800;color:${colTint(label)};">${label}</span>""",
  """<span style="width:48px;height:5px;border-radius:4px;background:rgba(255,255,255,0.06);flex:none;overflow:hidden;"><span style="display:block;height:100%;width:${w}%;border-radius:4px;background:${on ? '#5b9bff' : hexA(tintOf(t),0.55)};"></span></span>""")
