"""Where to cut a raw scene recording: keep what moves, drop what waits.

    python3 cut.py <clip.mp4> <from> <to> [hold]   → one "start end speed" per line

A recording is mostly STILL — Maestro pausing between taps, Gemini thinking —
with short bursts of motion: a tap, a sheet sliding up, a page turning. Playing
the whole clip faster shortens the waits but hurries every animation with them,
and on screenrecord's variable frame rate the motion comes out uneven. So the
motion is kept at real speed and only the stillness is cut.

Motion is found with ffmpeg's scene score on a downscaled copy: 0.0003 is
sensitive enough to see one keypad tap. Each burst keeps a short lead-in and a
hold after it, long enough to read what just happened. A burst that runs for
many seconds is continuous motion — Penny's answer streaming in — and that one
thing is sped up, gently, rather than shown at full length.
"""

import re
import subprocess
import sys

clip, start_at, end_at = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
hold_after = float(sys.argv[4]) if len(sys.argv) > 4 else None

THRESHOLD = 0.0003
MERGE_GAP = 0.35   # changes closer than this are one burst
LEAD = 0.2         # seconds kept before a burst
HOLD = hold_after or 0.7  # seconds kept after one, to read the result
FINAL_HOLD = 1.6   # after the last, the scene's payoff
LONG = 4.0         # a span of motion longer than this is typing or streaming…
LONG_SPEED = 1.8   # …and plays this much faster

out = subprocess.run(
    ['ffmpeg', '-hide_banner', '-i', clip, '-vf',
     f"scale=360:-1,select='gt(scene,{THRESHOLD})',showinfo", '-an', '-f', 'null', '-'],
    capture_output=True, text=True,
).stderr
times = [float(t) for t in re.findall(r'pts_time:([0-9.]+)', out)]
times = [t for t in times if start_at <= t <= end_at]
if not times:
    sys.exit(f'{clip}: nothing moves between {start_at} and {end_at}')

bursts = [[times[0], times[0]]]
for t in times[1:]:
    if t - bursts[-1][1] <= MERGE_GAP:
        bursts[-1][1] = t
    else:
        bursts.append([t, t])

# Each burst becomes a kept span; spans that touch are joined.
spans = []
for i, (a, b) in enumerate(bursts):
    hold = FINAL_HOLD if i == len(bursts) - 1 else HOLD
    s, e = max(start_at, a - LEAD), min(end_at, b + hold)
    if spans and s <= spans[-1][1]:
        spans[-1][1] = max(spans[-1][1], e)
    else:
        spans.append([s, e])

# Continuous motion is decided on the JOINED span: Maestro typing a message
# and a reply streaming in are many small bursts that never pause.
for s, e in spans:
    if e - s > 0.05:
        print(f'{s:.3f} {e:.3f} {LONG_SPEED if e - s > LONG else 1.0}')
