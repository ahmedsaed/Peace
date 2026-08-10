# Peace

A local-first expense tracker for Android. Peace of mind about where the money went.

Built because [MyMoney](docs/research/mymoney.md) gets the daily experience right but is missing
sub-categories, recurring payments, multi-currency, receipt attachments and any kind of assisted
entry. Peace keeps what works — the calculator keypad, the one-screen record form, the month as the
organising unit — and adds the rest.

**Local-first and offline.** Your ledger lives in SQLite on the device. There is no server, no
account, and no network dependency anywhere in the core product.

## Status

| Stage | Scope | State |
|---|---|---|
| 0 | Schema, design system, navigation shell, repository layer | ✅ done |
| 1 | Daily driver — records, calculator keypad, edit/delete, accounts & categories | ✅ done |
| — | App icon, side menu, search entry point (chrome, pulled ahead of Stage 2) | ✅ done |
| 2 | Multi-currency, budgets, analysis, export | in progress — settings screen ✅ |
| 3 | Recurring payments | planned |
| 4 | Receipt attachments | planned |
| 5 | OCR + voice entry (Gemini Flash) | planned |
| 6 | Bank notification ingestion | planned |

Full plan and the reasoning behind the ordering: [docs/roadmap.md](docs/roadmap.md).

Stage 1's finish line was never a feature list — it is *logging a real week of spending without
reaching for MyMoney*. **That test has been passed**: nine days of real records, and the only
things it turned up were a broken split-screen layout and a handful of papercuts, all since fixed.

## Stack

Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript · expo-router · NativeWind ·
Drizzle ORM + expo-sqlite · Jest · Maestro

> **Expo has changed.** SDK 57 and RN 0.86 are newer than most training data and most tutorials.
> Read [the versioned docs](https://docs.expo.dev/versions/v57.0.0/) rather than writing APIs
> from memory. See [AGENTS.md](AGENTS.md).

## Getting started

The toolchain installs entirely under `$HOME` — no sudo, no system packages. See
[AGENTS.md](AGENTS.md) for the environment, and read its **memory** section before any native
build; this machine will OOM if you get the order wrong.

```bash
npm install
npm test              # unit tests, no device needed
npm run typecheck
npm run emu           # boot the headless Android emulator
npm start             # Metro dev server
```

| Task | Command |
|---|---|
| Unit tests | `npm test` |
| Typecheck / lint | `npm run typecheck` / `npm run lint` |
| Boot emulator | `npm run emu` |
| Screenshot the device | `npm run shot -- <name>` → prints a PNG path |
| E2E flows | `npm run e2e` |
| Standalone APK for a phone | `npm run apk` (arm64; `apk:emu` for x86_64) |
| Regenerate migrations | `npm run db:generate` |

### Installing on a phone

Distribution is **sideload only** — no Play Store, so no restricted-permission review.

**The easiest way is the [Releases page](../../releases).** Every merge to `main` publishes a signed
arm64 APK there. It upgrades an existing install in place — no uninstall, no data loss — because
every build is signed with the same key and carries an increasing `versionCode`.

`npm run apk` builds the same thing locally at
`android/app/build/outputs/apk/release/app-release.apk`, with the JS bundle embedded so it runs
with no laptop attached. CI also attaches an APK to every PR, for testing a change before it lands.

### Versioning

| Field | Source | Changes |
|---|---|---|
| `version` | `app.json`, edited by hand | when you decide a release deserves a new number |
| `versionCode` | commit count | every commit |
| commit sha | git | every commit |

[`app.config.js`](app.config.js) layers the last two onto `app.json`. **Settings → About** shows
`1.0.0 (build 25)` and the commit, so "which build am I actually running" is answerable from the
phone. A build made from a tree with uncommitted changes is marked `-dirty`, since it cannot be
reproduced from its sha.

The commit count is what makes in-place upgrades work: Android requires a monotonically increasing
`versionCode`, and a commit count gives one for free without a "bump version" commit that would
itself change the number.

### Signing

Release builds are signed with a **private key**, not Expo's shared debug keystore. Android treats a
differently-signed APK as a different app, so this identity must stay stable: lose the key and you
can never ship an update that upgrades an existing install.

- Keystore lives at `~/keystores/peace-release.jks`, outside the repository. **Back it up.**
- Credentials are Gradle properties in `~/.gradle/gradle.properties` (`PEACE_STORE_FILE`,
  `PEACE_STORE_PASSWORD`, `PEACE_KEY_ALIAS`, `PEACE_KEY_PASSWORD`), and GitHub secrets for CI.
- [`plugins/with-release-signing.js`](plugins/with-release-signing.js) wires them in. It is a
  config plugin because `expo prebuild` regenerates `android/`.
- **Missing credentials fall back to debug signing** rather than failing, so a fresh clone — or a
  PR from a fork, which cannot read secrets — still builds a working APK. It just is not
  upgrade-compatible with the signed one.

On a new machine, restore the `.jks` and re-add those four properties; nothing else is needed.

## Continuous integration

Every PR to `main` runs [`.github/workflows/pr.yml`](.github/workflows/pr.yml):

| Job | What it does |
|---|---|
| `check` | typecheck, lint, unit tests — about a minute, so it fails fast |
| `apk` | `expo prebuild` + Gradle release build, uploaded as a downloadable artifact |

Merging to `main` runs [`release.yml`](.github/workflows/release.yml), which repeats those checks
and publishes a GitHub Release tagged `v<version>+build.<n>` with the APK attached.

Both workflows call the **same** reusable build
([`build-apk.yml`](.github/workflows/build-apk.yml)) rather than keeping two copies of the steps —
a release built by a drifting second copy would not be the artifact that was reviewed.

`android/` is gitignored and generated from `app.json` plus the config plugins, so CI runs
`prebuild` itself rather than checking it out.

**Maestro flows do not run in CI** — they need a booted emulator, which is slow and flaky on
hosted runners. Run them locally with `npm run e2e` before merging anything that touches a screen.

## Layout

```
src/app/               expo-router routes
src/app/(drawer)/      side menu wrapped around...
src/app/(tabs)/          ...the five tabs. Both are groups, so URLs are unchanged.
src/components/        shared UI (screen chrome, icon set, drawer content)
src/constants/         palette.js — the single source of colour truth
src/db/                schema, client, migrations provider, seed
src/db/repo/           the ONLY place that writes to the database
src/lib/               pure logic — money, periods, calculator, ids. Tests live here.
src/state/             cross-screen state (settings cache, undo)
src/test/              test helpers (in-memory database from real migrations)
assets/logo/           source SVGs for the app icon (PNGs are generated)
scripts/               emulator, screenshots, icon generation
drizzle/               generated migrations (committed)
docs/                  research, roadmap, design system
.maestro/              E2E flows
```

Export and Search are routed and laid out but not yet wired — they are Stage 2.

## Rules that are not negotiable

These exist because breaking them corrupts a ledger quietly, which is the worst way to fail.

1. **Money is integer minor units.** `amount_minor` is a signed integer; negative is money out.
   Never store or do arithmetic on money as a float. Convert only at the render boundary, via
   [`src/lib/money.ts`](src/lib/money.ts).

2. **All writes go through `src/db/repo/`.** SQLite cannot express "categories are two levels
   deep" or "a transfer is two rows"; the repository can, and it is tested.

3. **Transfers are two rows** sharing a `transfer_pair_id`, written in one SQL transaction. Per-
   account balance stays a plain `SUM(amount_minor)`. Every query must render only the outgoing
   leg, and exclude transfers from income and expense totals — a transfer is neither.

4. **Balances are derived, never stored.** A stored running total is one missed update away from
   disagreeing with the ledger, with no way to tell afterwards which is right.

5. **Colour is never the only signal.** Every amount carries an explicit `+` or `−`. Roughly one
   man in twelve has red-green colour deficiency and the amount is the most important thing on
   screen. See [docs/design-system.md](docs/design-system.md).

6. **`Intl` on Hermes is not `Intl` on Node, and it fails silently.** A green `npm test` proves
   nothing about currency or date rendering. Check it with a screenshot on a device.

7. **Add a `testID` to anything a flow needs to find.** Maestro matches on it; labels get reworded.

## Documentation

| Document | What it holds |
|---|---|
| [AGENTS.md](AGENTS.md) | Toolchain, verification workflow, environment constraints and the OOM traps |
| [docs/roadmap.md](docs/roadmap.md) | Six stages, dependencies, and the decisions already made |
| [docs/research/mymoney.md](docs/research/mymoney.md) | The reference app, from screenshots of v6.6 |
| [docs/design-system.md](docs/design-system.md) | The "Ledger" palette, its rules, the app icon, and split-screen density |
| [docs/research/credit-cards.md](docs/research/credit-cards.md) | Why card accounts drift, and the proposed fix |

Keep these current. They are the reason a new session can pick the work up without re-deriving
decisions that were already made and paid for.
