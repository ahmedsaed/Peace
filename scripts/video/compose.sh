#!/usr/bin/env bash
# Compose .video/clips/*.mp4 (from `make-video.sh record`) into the promo video:
# .video/peace-promo.mp4, 1920×1080, 30fps, silent — Play's player starts muted,
# so every scene carries its point as a caption.
#
# Caption frames are HTML (scripts/video/card.py) in the website's own fonts
# and colours, screenshotted by headless Chrome; ffmpeg puts each recording in
# a phone on its frame, then joins the scenes with short fades.
set -euo pipefail
cd "$(dirname "$0")/../.."

OUT=.video
CLIPS=$OUT/clips
WORK=$OUT/work
mkdir -p "$WORK"

FONTS="$PWD/site/node_modules/@fontsource"
[[ -d $FONTS/roboto ]] || { echo "needs the site's fonts: cd site && npm ci" >&2; exit 1; }

# The phone's screen on the 1920×1080 frame: 940 tall at the recording's 9:20.
SCREEN_W=423
SCREEN_H=940
SCREEN_X=1240
SCREEN_Y=70

# Rounded corners for the recording, as an alpha mask.
magick -size ${SCREEN_W}x${SCREEN_H} xc:black -fill white \
  -draw "roundrectangle 0,0,$((SCREEN_W - 1)),$((SCREEN_H - 1)),40,40" "$WORK/mask.png"

card() { # card <name> — renders $WORK/<name>.png from scripts/video/card.py
  python3 scripts/video/card.py "$1" "$FONTS" "$SCREEN_X" "$SCREEN_Y" "$SCREEN_W" "$SCREEN_H" > "$WORK/$1.html"
  google-chrome --headless --disable-gpu --hide-scrollbars --window-size=1920,1080 \
    --screenshot="$WORK/$1.png" "file://$PWD/$WORK/$1.html" 2>/dev/null
}

ENC=(-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r 30 -an)

still() { # still <card> <seconds>
  card "$1"
  ffmpeg -v error -y -loop 1 -t "$2" -i "$WORK/$1.png" \
    -vf "fps=30,fade=in:st=0:d=0.4,fade=out:st=$(python3 -c "print($2-0.4)"):d=0.4" \
    "${ENC[@]}" "$WORK/seg-$1.mp4"
}

scene() { # scene <clip> <from> <to> <speed> — the clip's from..to, played at speed
  local name=$1 from=$2 to=$3 speed=$4 len
  len=$(python3 -c "print(round(($to-$from)/$speed, 3))")
  card "$name"
  ffmpeg -v error -y -loop 1 -t "$len" -i "$WORK/$name.png" -i "$CLIPS/$name.mp4" -loop 1 -i "$WORK/mask.png" \
    -filter_complex "\
[1:v]trim=start=$from:end=$to,setpts=(PTS-STARTPTS)/$speed,fps=30,scale=$SCREEN_W:$SCREEN_H:flags=lanczos,format=rgba[screen];\
[2:v]format=gray,scale=$SCREEN_W:$SCREEN_H[mask];\
[screen][mask]alphamerge[phone];\
[0:v][phone]overlay=$SCREEN_X:$SCREEN_Y:shortest=1,\
fade=in:st=0:d=0.35,fade=out:st=$(python3 -c "print($len-0.35)"):d=0.35" \
    -t "$len" "${ENC[@]}" "$WORK/seg-$name.mp4"
  echo "$name: ${len}s"
}

picture() { # picture <card> <png> <seconds> — a still image in the phone
  local name=$1 png=$2 len=$3
  card "$name"
  ffmpeg -v error -y -loop 1 -t "$len" -i "$WORK/$name.png" -loop 1 -i "$png" -loop 1 -i "$WORK/mask.png" \
    -filter_complex "\
[1:v]scale=$SCREEN_W:$SCREEN_H:flags=lanczos,format=rgba[screen];\
[2:v]format=gray,scale=$SCREEN_W:$SCREEN_H[mask];\
[screen][mask]alphamerge[phone];\
[0:v][phone]overlay=$SCREEN_X:$SCREEN_Y,fps=30,\
fade=in:st=0:d=0.35,fade=out:st=$(python3 -c "print($len-0.35)"):d=0.35" \
    -t "$len" "${ENC[@]}" "$WORK/seg-$name.mp4"
  echo "$name: ${len}s"
}

# The widgets are the website's home screen: the REAL widget renders on Peace's
# wallpaper (store/README.md). A recording of the launcher would put Gmail,
# YouTube and a search bar in our video.
HOME_SCREEN=site/out/store/home-screen.png
[[ -s $HOME_SCREEN ]] || (cd site && npm run build >/dev/null)

# The cut, in order. Times are seconds into each raw clip, chosen from where
# the screen actually changes; speed > 1 is waiting compressed (Maestro types
# slowly, and Gemini thinks), never a UI animation hurried for its own sake.
still intro 3
scene scene-1-one-handed 7.0 38.5 2.6
scene scene-2-bank 3.0 14.0 1.15
scene scene-3-invoice 9.0 52.0 3.0
scene scene-4-penny 28.5 72.5 3.0
picture scene-5-widgets "$HOME_SCREEN" 5
still outro 4

: > "$WORK/list.txt"
for seg in intro scene-1-one-handed scene-2-bank scene-3-invoice scene-4-penny scene-5-widgets outro; do
  echo "file 'seg-$seg.mp4'" >> "$WORK/list.txt"
done
ffmpeg -v error -y -f concat -safe 0 -i "$WORK/list.txt" -c copy -movflags +faststart "$OUT/peace-promo.mp4"
echo "wrote $OUT/peace-promo.mp4 ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/peace-promo.mp4")s)"
