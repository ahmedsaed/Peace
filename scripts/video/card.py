"""One frame of the promo video's captions, as HTML, for headless Chrome.

    python3 card.py <name> <fontsource dir> <screen x> <screen y> <screen w> <screen h>

Scene cards leave a phone-shaped hole where compose.sh lays the recording;
`intro` and `outro` are full-frame. The palette is Ledger's and the type the
website's (Roboto, with Pacifico for the wordmark), so the video, the store
graphics and the site read as one thing. Copy reuses the site's lines.
"""

import html
import sys

name, fonts, sx, sy, sw, sh = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7])

GROUND = '#17140f'
SURFACE = '#241f17'
LINE = '#2e271d'
INK = '#efe4ce'
MUTED = '#9a8e79'
ACCENT = '#e3a33c'

AI = 'Optional · uses your own Google Gemini API key'

SCENES = {
    'scene-1-one-handed': (
        'One-handed',
        'Log a spend',
        'with your thumb.',
        'Type 12.50 + 3. The same key adds it up, picks the account and the category, and saves.',
        None,
    ),
    'scene-2-bank': (
        'Bank messages',
        'Bank texts become',
        'records.',
        'Peace reads the alerts from the banks you name and offers each one as a record to approve.',
        AI,
    ),
    'scene-3-invoice': (
        'Penny, the assistant',
        'Hand Penny',
        'an invoice.',
        'She reads the total, the shop and the date off a photo or a PDF, and files it when you say yes.',
        AI,
    ),
    'scene-4-penny': (
        'Penny, the assistant',
        'Ask about',
        'your money.',
        'Answers and charts from your own ledger, every figure cited, never guessed.',
        AI,
    ),
    'scene-5-widgets': (
        'Widgets',
        'On your',
        'home screen.',
        'Your balance, your budget, and a spend added in one tap.',
        None,
    ),
}


def font(family, weight, file):
    return (
        f"@font-face {{ font-family: '{family}'; font-weight: {weight}; "
        f"src: url('file://{fonts}/{file}') format('woff'); }}"
    )


style = f"""
{font('Roboto', 400, 'roboto/files/roboto-latin-400-normal.woff')}
{font('Roboto', 700, 'roboto/files/roboto-latin-700-normal.woff')}
{font('Roboto', 900, 'roboto/files/roboto-latin-900-normal.woff')}
{font('Pacifico', 400, 'pacifico/files/pacifico-latin-400-normal.woff')}
html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; }}
body {{
  position: relative; color: {INK}; font-family: 'Roboto', sans-serif;
  background: radial-gradient(circle at 72% 45%, #2a2115 0%, {GROUND} 62%);
}}
.copy {{ position: absolute; left: 150px; top: 0; bottom: 0; width: 940px;
  display: flex; flex-direction: column; justify-content: center; }}
.eyebrow {{ font-size: 30px; font-weight: 700; letter-spacing: 4px; text-transform: uppercase; color: {ACCENT}; }}
h1 {{ margin: 22px 0 0; font-size: 104px; font-weight: 900; line-height: 1.04; letter-spacing: -2.5px; }}
h1 span {{ display: block; color: {ACCENT}; }}
p {{ margin: 34px 0 0; font-size: 38px; line-height: 1.4; color: {MUTED}; max-width: 860px; }}
.note {{ margin-top: 40px; font-size: 26px; color: {MUTED}; opacity: 0.8; }}
.phone {{ position: absolute; left: {sx - 16}px; top: {sy - 16}px; width: {sw + 32}px; height: {sh + 32}px;
  box-sizing: border-box; border-radius: 56px; background: {SURFACE}; border: 3px solid {LINE};
  box-shadow: 0 60px 120px rgba(0, 0, 0, 0.55); }}
.center {{ position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; }}
.wordmark {{ font-family: 'Pacifico'; font-size: 190px; color: {ACCENT}; line-height: 1.2; }}
.tag {{ font-size: 64px; font-weight: 900; letter-spacing: -1.5px; line-height: 1.15; }}
.sub {{ margin-top: 34px; font-size: 38px; color: {MUTED}; }}
"""

if name == 'intro':
    body = f"""<div class="center">
  <div class="wordmark">Peace</div>
  <div class="tag">Peace of mind. <span style="color:{ACCENT}">Piece of cake.</span></div>
  <div class="sub">A private expense tracker for Android.</div>
</div>"""
elif name == 'outro':
    body = f"""<div class="center">
  <div class="tag" style="font-size:96px">Peace of mind.<br><span style="color:{ACCENT}">Piece of cake.</span></div>
  <div class="sub">Free · Open source · No account · Nothing leaves your phone unless you turn it on</div>
  <div class="wordmark" style="font-size:96px; margin-top:44px">Peace</div>
  <div class="sub" style="margin-top:6px">peace.merope.dev</div>
</div>"""
else:
    eyebrow, title, highlight, sub, note = SCENES[name]
    e = html.escape
    body = f"""<div class="copy">
  <div class="eyebrow">{e(eyebrow)}</div>
  <h1>{e(title)}<span>{e(highlight)}</span></h1>
  <p>{e(sub)}</p>
  {f'<div class="note">{e(note)}</div>' if note else ''}
</div>
<div class="phone"></div>"""

print(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>{style}</style></head>
<body>{body}</body></html>""")
