# peace — expense tracker

Local-first Android expense tracker. Expo SDK 57, React Native 0.86, React 19.2, TypeScript.

## Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.
SDK 57 / RN 0.86 are newer than most training data — do not write Expo or RN APIs from memory,
and do not copy patterns from older tutorials (e.g. `expo-sqlite/legacy`, Expo Router v2 layouts).

## Toolchain

Everything is installed under `$HOME`, no sudo, no system packages. `~/.bashrc` exports:

```
JAVA_HOME=$HOME/.local/jdks/jdk-17.0.20+8
ANDROID_HOME=$HOME/Android/Sdk
PATH += $JAVA_HOME/bin, $ANDROID_HOME/{cmdline-tools/latest/bin,platform-tools,emulator}, $HOME/.maestro/bin
```

Non-login shells may not source `.bashrc`. If `adb`/`emulator`/`maestro` is not found, export those first.

## Commands

| Task | Command |
|---|---|
| Unit tests | `npm test` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Boot headless emulator | `npm run emu` |
| Screenshot the device | `npm run shot -- <name>` → prints PNG path |
| E2E flows | `npm run e2e` (against a release APK — see below) |
| Release APK for your phone | `npm run apk` (arm64) |
| Release APK for the emulator | `npm run apk:emu` (x86_64) |
| Regenerate migrations | `npm run db:generate` (after editing `src/db/schema.ts`) |
| Regenerate app icons | `npm i --no-save sharp && node scripts/make-icons.mjs` |
| Check the lockfile like CI does | `npm run verify:lock` |
| Validate the JS bundle without a device | `npx expo export --platform android` |
| Dev server | `npm start` |

## How to verify a change

Cheapest first — most changes never need a device.

1. `npm test` + `npm run typecheck` for logic.
2. `npx expo export --platform android` catches Metro/babel/NativeWind config breakage in ~30s.
3. Only then boot a device: `npm run emu`, then `npm start`, then screenshot.

**Added a route? `npm run typecheck` will lie to you.** `typedRoutes` is on, and the union of valid
hrefs lives in `.expo/types/router.d.ts`, which is written by **the dev server** — not by `tsc`,
and not by `expo export`. A stale copy rejects `router.push('/your-new-screen')` with a wall of
literal types. Start `npx expo start` once, wait for the file to change, then kill it by port.
CI is the mirror image: `.expo/` is gitignored, so a fresh checkout has no generated types at all
and the same push typechecks whether the route exists or not. Neither machine can catch a typo in
a route path on its own.

**Killing Metro: go by port, not by name.** Node renames its main thread, so a stale dev server
shows up as `MainThread` and `pkill -f "expo start"` misses it — while `pkill -f` *does* match the
shell running that very command, killing your own session instead. A leftover Metro keeps serving
a stale module graph, so edits appear to do nothing:

```
PID=$(ss -tlnp | grep -oP '8081.*pid=\K[0-9]+' | head -1) && kill "$PID"
```

To actually see the app: `npm run shot -- after-change` and read the returned PNG.
Drive the UI with `adb shell input tap X Y`, `adb shell input text "..."`,
`adb shell input keyevent KEYCODE_BACK`. Prefer Maestro flows in `.maestro/` for anything repeatable.

## Versioning

| Field | Where it comes from | When it changes |
|---|---|---|
| `version` (semver) | `app.json`, by hand | when a human decides a release deserves a new number |
| `versionCode` | `git rev-list --count HEAD` | every commit |
| `gitSha` | `git rev-parse --short HEAD` | every commit |

`app.config.js` layers the last two onto the static `app.json`; `src/lib/build-info.ts` reads
them back through `expo-constants`, and the About screen shows `1.0.0 (build 25)` plus the commit.
A build made from a dirty tree is marked `-dirty`, because it is not reproducible from its sha and
showing the sha unqualified is how you end up debugging code that was never in the APK.

Three ways this breaks:

- **`npm run apk` does not refresh the version.** `versionCode` is baked into
  `android/app/build.gradle` by `expo prebuild`; Gradle alone reuses whatever is already there. Run
  `npx expo prebuild --platform android` first, or the APK will carry a stale number and Android
  will refuse the in-place upgrade. CI asserts the two agree.
- **A shallow clone makes every build "build 1".** `actions/checkout` defaults to `fetch-depth: 1`,
  so `git rev-list --count HEAD` returns 1. The workflows set `fetch-depth: 0` for this reason
  alone.
- Version numbers are only trustworthy in a release build. In development `Constants.expoConfig`
  reflects whatever the dev server last evaluated.

## Working on this repo

Development happens on branches with a PR into `main`. CI
(`.github/workflows/pr.yml`) runs typecheck, lint and unit tests in ~1 min, then
builds a signed APK and attaches it to the PR.

**The APK build lives once**, in `.github/workflows/build-apk.yml`, called by both the PR and the
release workflows. A release built by a drifting second copy of those steps would be a different
artifact from the one that was reviewed.

Merging to `main` runs `.github/workflows/release.yml`, which publishes a GitHub Release tagged
`v<version>+build.<n>` with the signed APK attached. The tag carries the build number because the
semver alone repeats across merges and the second release would collide.

**A job output whose value contains a secret is silently DROPPED, not masked.** The APK artifact was
named `peace-1.0.0-build28`, and `peace` is the value of the `PEACE_KEY_ALIAS` secret — so passing
that name between jobs produced an empty string, and the release step failed on `".apk"` with "no
matches found". `version` and `build-number` came through fine, which made it look like a typo in
one line rather than a rule about all of them. **The tell is `***` where the value should be in the
log.** Never build a cross-job output out of anything that might match a secret; glob for the file
instead.

**The release path cannot be tested from a pull request** — it only runs on push to `main`. Anything
in the `publish` job is therefore unverified until it runs for real. Keep that job small, and make
it fail loudly rather than publish something broken: a release with no APK attached looks
installable and is not.

Three things that are true only because CI caught them, and will bite again:

- **`android/` is gitignored and generated.** CI runs `expo prebuild` itself. Never commit it,
  and never assume a file under it survives.
- **`expo-env.d.ts` is gitignored too**, so a fresh checkout has no ambient types. Anything the
  typechecker needs must live in the committed `types.d.ts`.
- **`npm ci` is stricter than `npm install`.** It validates the lockfile against package.json and
  rejects the inconsistent optional-dependency subtrees that `npm install` happily tolerates.
  **`npm run verify:lock` reproduces exactly that check in about a minute** — run it before pushing
  any dependency change, because a working tree that already has `node_modules` will never show you
  the problem.
- **`.nvmrc` pins an exact version on purpose.** It used to say `24`, so CI installed whatever the
  newest 24.x was and got a different bundled npm from the one here — and npm versions disagree
  about how optional platform subtrees are recorded. The result was a lockfile that `npm ci`
  accepted locally and rejected in CI, which makes local verification worthless. Bump it
  deliberately, and run `npm run verify:lock` after you do.
- **Be suspicious of `overrides`.** Two of them pinned `@emnapi/core` and `@emnapi/runtime`, which
  npm had stopped hoisting — so the override named a package the lockfile no longer contained and
  `npm ci` failed with `Missing: @emnapi/core@1.11.3 from lock file`. Removing them let npm nest
  those packages under `@unrs/resolver-binding-wasm32-wasi` where they belong, and the lockfile
  became self-consistent. An override that survives its original problem becomes the next one.

**Maestro does not run in CI** — it needs a booted emulator. Run `npm run e2e` locally before
merging anything that touches a screen.

### Run E2E against a release APK, not the dev build

```
npm run apk:emu                                    # x86_64, ~5 min
adb uninstall com.ahmed.peace
adb install -r android/app/build/outputs/apk/release/app-release.apk
npm run e2e
```

The dev build is the wrong target for flows and wastes a lot of time proving it:

- **`clearState` wipes the dev client's saved packager URL.** The next launch falls back to an
  embedded bundle that a debug build does not have, and dies on a `loadJSBundleFromAssets` red box.
  Flows then fail on their first assertion looking exactly like a broken screen.
- Even when it does connect, a cold launch re-downloads ~2,200 modules from Metro. Measured on this
  machine: **~200s for the dev build against 9s for the release APK**, and the whole suite went from
  17m17s to 4m41s.

Every flow still opens with `launchApp: clearState` followed by an `extendedWaitUntil` on
`home-screen`, which covers migrations and seeding on the fresh-install path. Keep the gate when
adding a flow; do not "fix" a slow launch by relaxing the assertions that follow it.

**`npm run apk` builds arm64 only — it will not run on the emulator.** The install *succeeds*
(arm64-v8a is in the emulator's `abilist`) and then the app dies at startup with
`couldn't find DSO to load: libreactnative.so`, which reads like a broken native module rather than
an ABI mismatch. `npm run apk:emu` builds x86_64 for the emulator; `npm run apk` stays arm64 for a
real phone. Check with `adb shell getprop ro.product.cpu.abi` against
`unzip -l …/app-release.apk | grep lib/`.

**Kill the Gradle daemon after a native build, not just before.** It idles at ~3 GB for hours; left
alive next to the emulator it starves the system, and the first symptom is Android's
"System UI isn't responding" dialog swallowing every `adb shell input tap` — which looks like the
app ignoring input. `pkill -f GradleDaemon`.

## Hard rules

- **Money is integer minor units.** `amount_minor` is a signed integer (negative = money out).
  Never store or arithmetic money as a float. Convert only at the render boundary via
  `src/lib/money.ts`. Any new money code needs a test in `money.test.ts`.
- **Hermes `Intl` is not Node's `Intl`.** Android ships less ICU data, and it degrades
  *silently* rather than throwing — `currencyDisplay: 'narrowSymbol'` returns `"EGP 12,500.00"`
  on device while Node returns `"E£12,500.00"`. A green `npm test` proves nothing about currency
  rendering. Anything touching `Intl` must be checked with a screenshot on a real device, and
  symbols belong in `SYMBOL_OVERRIDES` rather than trusting the platform.
- **The rate fetch must never be load-bearing.** Peace is local-first; a plane, a dead signal or a
  dead API cannot stop a record being saved. Every failure in `src/lib/fx.ts` ends with the rate
  field staying manual and the screen saying why. It also has a timeout — without one, a captive
  portal leaves the button spinning and the user cannot tell whether to wait or to type.
- **Do not collapse a network error into a friendly sentence and nothing else.** The first version
  did, and when it failed on a device that plainly had a working network there was nothing to debug
  from. Friendly message for the user, `console.warn` with the real error for whoever has to fix it.
- **Minor units are not comparable across currencies.** Yen has no decimal places, dinars have
  three — so converting is `amount x rate x 10 ** (decTo - decFrom)`, and the scale term is
  invisible in an EGP-only app right up until it is wrong by a factor of a hundred. Use
  `convertMinor` in money.ts; never multiply by a rate by hand.
- **Rounding money must be symmetric.** `Math.round` rounds toward +infinity, so `-0.5` becomes
  `-0` and a converted expense ends up a unit away from the matching income. And round only AFTER
  trimming float noise: `5000 * 3.03 * 0.01` is `151.49999999999997`, which rounds down and quietly
  loses half a unit on every conversion.
- **Split-screen is a supported layout, not an edge case.** Records get logged with a bank
  notification open beside the app, which leaves roughly 340dp of height instead of 800. Anything
  with a fixed-height stack must pin what the user needs (the keypad) and let the rest scroll —
  see `src/lib/layout.ts` and the comment in `src/app/record.tsx`. Test it without split-screen
  using `adb shell wm size 1080x1150`, and `adb shell wm size reset` afterwards.
- **A setting that nothing reads must not appear in Settings.** `SETTING_DEFAULTS` declares
  preferences ahead of the features that consume them, which is fine — but rendering a control for
  one before anything reads it ships a switch that silently does nothing. That is how an app
  teaches its user to stop trusting it. Add the row in the same change as the code that honours it,
  and prove it with a flow that asserts the value moving on a *different* screen.
- **Settings are read through `src/state/settings.ts`, never `getSetting` in a component.** The
  store is a write-through cache: SQLite stays the source of truth, and the in-memory copy is what
  makes a change repaint every screen rather than only the one that made it.
- **`LIKE` treats `%` and `_` as wildcards, and nothing warns you.** A user searching for "50%"
  matches the entire ledger; "Lunc_" matches "Lunch". Both look exactly like an ordinary search
  that found more than expected, which is why it survives review. Text goes through
  `likePattern` in `src/lib/search-query.ts` and every query carries `ESCAPE '\'` — and the test
  that catches a missing `ESCAPE` is the one searching for a note that *really does* contain a
  percent sign, not the one searching for a bare `%`. A bare `%` returns nothing either way.
- **A total under a capped list must be computed over the whole match, not the rows on screen.**
  Search caps its list at 300 because a one-letter query matches most of a ledger. Summing the
  array that was capped gives a number that silently means "the first 300 of them" — worse than
  showing no total at all. Two queries: one for the rows, one aggregate for the figures. The test
  runs with `limit: 1` and asserts the full total.
- **A default that only works for someone with history is a dead feature.** `suggestBudgets` first
  averaged the three months *before* the one being budgeted, which returns nothing for a ledger a
  few weeks old — precisely the person who has never set a budget, i.e. the entire audience. It now
  falls back to the month being budgeted and says which basis it used. Whenever a feature reads
  past data, work out what it does on day one.
- **When the number changes, the sentence above it has to change too.** The budget offer read
  "Rounded up from your average" directly beneath "No full month to go on yet" — two lines
  contradicting each other about the figure the user was being asked to commit to. Copy tied to a
  computed value belongs in the same conditional as the value.
- **A rule kept in a parallel list is a rule that gets forgotten — make it structural.** Which
  glyphs the category picker may offer used to be a second list of names filtered out of the path
  map, and it was forgotten on the very next glyph added: `filter` went into the paths and not into
  `CHROME`, which would have offered a funnel as a category icon. `icon.tsx` now holds three
  separate maps and `ICON_NAMES` *is* the category one, so a glyph's group is where it is written.
  Look for the same shape wherever a comment says "remember to also add it to…".
- **Add a `testID` to anything a flow needs to find.** Maestro matches on it; text labels change.
- **testIDs must be regex-safe** — letters, digits, hyphens between words. Maestro matches ids as
  **regular expressions**, so `key-op-+` reads as "`key-op` then one or more hyphens" and silently
  taps the *minus* key. That shipped a green E2E test that saved `120 - 35` while claiming to test
  `120 + 35`. Never put `+ * ? . ( ) [ ] |` in a testID.
- **A passing flow that asserts nothing specific proves only that the app did not crash.** Assert
  the value the user would check, not just that a screen appeared.
- **A safety net has to be reachable.** Restore parks the pre-restore database in the cache under a
  FIXED name — not the dated one exports use. The first version reused `peace-<date>.db`, so tapping
  "Back up everything" on the same day deleted it: the screen promised the restore was undoable
  while the only thing making it undoable was one tap from destruction. There is now an explicit
  "Undo last restore" button, because a recovery file the user cannot reach is not a recovery.
- **A file that exists is not a file that has content.** The backup flow passed while producing a
  **0-byte** `.db` — `File.copy()` is async and was being called synchronously, so the share sheet
  offered an empty file under a perfectly correct filename. Nothing downstream could tell. Every
  export now goes through a size check that throws, the size is rendered in the UI, and the flow
  asserts a non-zero one. Anything that writes a file needs the same treatment: assert the bytes,
  not the name.
- **Schema changes go through drizzle-kit.** Edit `src/db/schema.ts`, run `npm run db:generate`,
  commit the generated `drizzle/` files. Never hand-edit a migration that has shipped.
- **Native module added? The Expo Go client is no longer enough** — a dev build is required
  (`npx expo run:android`). Pure-JS changes hot-reload as usual.

## Layout

```
src/app/         Expo Router routes (file-based)
src/components/  shared UI
src/db/          drizzle schema, client, migration provider
src/lib/         pure logic — this is where unit tests live
drizzle/         generated migrations (committed)
.maestro/        E2E flows
scripts/         emu-up.sh, screenshot.sh
```

## Known environment constraints

### Memory — read this before any native build

WSL2 defaults to 50% of host RAM. `C:\Users\Ahmed\.wslconfig` raises it to 11 GB (of 16 GB);
that file only takes effect after `wsl --shutdown` from Windows. If `free -h` shows ~7.6 GB
total, the config has not been applied and everything below is much tighter.

Rough working-set sizes: qemu/emulator ~3.7 GB, Metro ~3 GB (cold bundle), Gradle daemon ~2 GB,
plus ninja's C++ compilers (see below). Three of those at once will not fit in 7.6 GB.

Three separate OOM kills were hit while setting this up, each with a different cause:

1. **Gradle daemon + a separate Kotlin daemon.** Kotlin compilation spawns its *own* ~2 GB JVM
   by default, and it lingers for 2 hours after the build. Fixed in `~/.gradle/gradle.properties`
   with `kotlin.compiler.execution.strategy=in-process`. If a build dies mysteriously, check for
   a stray `KotlinCompileDaemon` process first.
2. **ninja's C++ compilers during `:app:buildCMakeDebug`.** Skia, reanimated and worklets compile
   native code, and ninja defaults its job count to `nproc` (16 here) — 16 concurrent compilers,
   each a few hundred MB, none of them governed by any Gradle heap setting. Fix: run Gradle under
   `taskset -c 0-3`, which caps the affinity the whole process tree derives its job count from.
   With that, a clean debug build takes ~2 min.
3. **Emulator + Metro doing a cold bundle.** Cold bundling of ~1900 modules peaks around 3 GB.
   A warm Metro cache re-bundles the same tree in ~3 s, so this only bites on the first run.

Safe order for a native build: stop the emulator → build → start emulator → `adb install`.

- iOS cannot be built or run here. iOS output requires EAS cloud builds.
- The emulator needs the `kvm` group (`sudo usermod -aG kvm $USER`, then restart WSL).
