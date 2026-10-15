# Play Store listing

Everything Play Console asks for on the main store listing, kept next to the code so it changes in
the same pull request as the app it describes.

| What | Where |
|---|---|
| Name, short and full description, category, contact | [`listing.md`](listing.md) — `node scripts/check-listing.mjs` checks the lengths |
| App icon, feature graphic, 8 phone screenshots | built by the website: `https://peace.merope.dev/store/<file>` |
| Full-resolution captures the graphics are drawn from | [`screenshots/`](screenshots) — written by `npm run shots` |
| Data safety answers, importable | [`data-safety.csv`](data-safety.csv) — Play Console's own export format, filled in |

## Regenerating

1. `npm run apk:emu`, install it on the emulator, then `npm run shots`. That replays
   `scripts/demo-shots.yaml` — an invented month **in US dollars** with no country's shops in it — and
   writes the halved copies to `docs/screenshots/` (README, website) and the full-size ones here.
2. The widgets cannot be placed by a flow — a launcher is driven by drags — so their capture is
   by hand, once: with the dollar month on the emulator, place Budget, Balance stretched to 4×2,
   Balance at 4×1 and Quick add on the home screen, then run `npm run shots:widgets` on each page.
   It crops each widget by its own view id into `widget-*.png` here, corners transparent; the
   website composes them onto a home screen (`HomeScreen` in `site/lib/store-graphics.tsx`), which
   is screenshot 3 and the site's "On the home screen" section. Nothing but the wallpaper and the
   arrangement is drawn — the widgets are the real renders.
3. Build the site (`cd site && npm run build`). The store graphics land in `site/out/store/`, and a
   merge to `main` publishes them.

The graphics are generated, never edited by hand: captions live in `STORE_SHOTS` in
`site/lib/store-graphics.tsx`, and the phones in them are the real screens. A hand-made image stops
matching the app the first time a screen changes, and nothing fails when it does.

## Why the screenshots are framed

Play rejects a screenshot whose long side is more than twice the short side, and a modern phone's
1080×2400 is 2.22. The store images are 1080×1920 — Play's recommended size — with a caption above a
phone that runs off the bottom edge.

## Data safety

[`data-safety.csv`](data-safety.csv) is Play Console's Data safety export with every answer filled
in. Import it from **App content › Data safety** (the import option at the top of that page)
instead of clicking through the form, then read the summary before saving.

The reasoning behind each answer lives in
[`site/content/data-safety.md`](../site/content/data-safety.md). The CSV is the form; that file says
why — **change both in the same PR**. Edit the third column (*Response value*) only, and keep the
file's CRLF line endings: it is Play's format, round-tripped, not ours.
