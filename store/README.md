# Play Store listing

Everything Play Console asks for on the main store listing, kept next to the code so it changes in
the same pull request as the app it describes.

| What | Where |
|---|---|
| Name, short and full description, category, contact | [`listing.md`](listing.md) — `node scripts/check-listing.mjs` checks the lengths |
| App icon, feature graphic, 8 phone screenshots | built by the website: `https://peace.merope.dev/store/<file>` |
| Full-resolution captures the graphics are drawn from | [`screenshots/`](screenshots) — written by `npm run shots` |

## Regenerating

1. `npm run apk:emu`, install it on the emulator, then `npm run shots`. That replays
   `scripts/demo-shots.yaml` — an invented month **in US dollars** with no country's shops in it — and
   writes the halved copies to `docs/screenshots/` (README, website) and the full-size ones here.
2. Build the site (`cd site && npm run build`). The store graphics land in `site/out/store/`, and a
   merge to `main` publishes them.

The graphics are generated, never edited by hand: captions live in `STORE_SHOTS` in
`site/lib/store-graphics.tsx`, and the phones in them are the real screens. A hand-made image stops
matching the app the first time a screen changes, and nothing fails when it does.

## Why the screenshots are framed

Play rejects a screenshot whose long side is more than twice the short side, and a modern phone's
1080×2400 is 2.22. The store images are 1080×1920 — Play's recommended size — with a caption above a
phone that runs off the bottom edge.
