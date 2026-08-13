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

**"System UI isn't responding" fails the FIRST assertion of the first flow after a boot.** On a
tight-memory machine SystemUI misses its deadline during the first launch, Android throws a modal
over the app, and it swallows every tap — so Maestro dies on `home-screen is visible` looking
exactly like a broken app, while the app underneath is rendering perfectly. `scripts/emu-up.sh` now
sets `hide_error_dialogs 1` on the test AVD. If a flow ever fails on its launch gate again, take a
screenshot before believing it.

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
- **Never infer which side of the ledger a row belongs to from the sign of its amount.** A refund is
  an EXPENSE with a POSITIVE amount, so `amount_minor < 0 ? 'expense' : 'income'` reads it as
  income — and saving from there flips the sign and makes it one. Use `onExpenseSide` /
  `onIncomeSide` from `src/db/repo/predicates.ts`. This was fixed in the SQL first and then found
  again, by an E2E flow, in three JavaScript callers: `updateRecord` and two initialisers in
  `record.tsx`. Fixing the query layer is not fixing the rule. **A FOURTH caller was found later
  still** — the CSV export, which had no flow watching it and wrote every refund out as `income`,
  so a spreadsheet built from an export showed more income than was earned and more expense than
  was spent with a net that came out right and hid it. The rule now exists in JavaScript as
  `ledgerSide` in `predicates.ts`, beside the SQL. Never answer the question anywhere else.
- **A second reason to exclude a row is a second place to forget it.** There are now two kinds of
  row that are not ordinary spending — a transfer leg and a balance correction — and they have
  DIFFERENT consequences: both stay out of income and expense, but a correction still moves the
  running position. Written out at each of the six queries that need them, one gets missed, and the
  miss reads as a category screen quietly disagreeing with a header. `src/db/repo/predicates.ts`
  holds `countsAsSpending`, `movesPosition` and `movesAccountBalance`; never write the guard inline.
- **Negating zero gives negative zero, and it is a different value.** `Object.is(-0, 0)` is false,
  `toEqual` will not catch it, and it can reach the screen as "-E£0.00" on a card that is exactly
  settled. Anywhere money is negated at a boundary — `liability.ts` does it twice — normalise it.
- **A feature whose design keeps forcing awkward questions is usually the wrong feature.** Budget
  carry-over — an unspent limit growing next month's limit — had two questions with no good answer
  (does it compound into an unbounded balance? does an overspend carry as a debt?). Both existed
  because a limit that gets easier when you fail to use it is not a limit. Budgets keep no memory;
  what carries between months is *money*, and a running cash position needs no exceptions at all.
  When the exceptions pile up, re-read the premise before designing around them.
- **Two screens showing the same money must reconcile, and a test must say so.** `broughtForward` +
  this month's balance is exactly the Accounts total, opening balances included — `carry.test.ts`
  asserts that identity directly rather than testing each side on its own. Without it the two
  screens can drift apart and the user has no way to tell which one is lying.
- **Percentages that are rounded independently do not add up to 100.** Three equal slices print
  33.3 three times, and a legend summing to 99.9 reads as a bug on a screen whose whole job is
  accounting for money. `sharePercents` in `src/lib/analysis.ts` distributes the error by largest
  remainder and breaks ties on the earlier index, so the same data never reorders itself between
  two renders. Drive chart *geometry* from the amounts, never from the rounded percentages, or the
  ring shows a hairline of background wherever the rounding went.
- **A single 100% slice is the arc a donut cannot draw.** Start and end land on the same point, so
  the renderer draws *nothing at all* — and one category owning a whole month is common, not an
  edge case. It has to be special-cased into two half-circles. Same family: an SVG path containing
  `NaN` renders nothing on Android rather than throwing.
- **Group by month in JS, not with SQLite's `localtime`.** That modifier reads the *process*
  timezone, so the same database buckets differently on a phone set to Cairo and on CI set to UTC,
  and an 11pm purchase on the 31st lands in the wrong month. `periodBounds` gets local calendar
  boundaries right and is tested; N indexed range queries cost nothing next to being correct.
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
- **A glyph's legibility is set by its GAP, not its ink — rasterise it before shipping it.** A
  paperclip is mostly negative space: at 11px its hole closes and it becomes a blob, and widening
  the strokes to compensate makes it worse. `convert` on a one-line SVG at the exact `size` prop
  answers this in seconds and costs nothing, where finding out needs a 4-minute APK build and an
  emulator. Check the CENTRING the same way — the first paperclip was four units right of centre,
  invisible on its own and obvious beside text. Solid shapes (`document`) survive small sizes;
  rings (`search`, `camera`, `paperclip`) need ~14px, which is why the attach button is a folder.
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
- **Google withdrew custom URI scheme redirects for Android OAuth clients**, and deprecated
  loopback redirects with them — so `expo-auth-session` cannot carry a Google grant on this
  platform at all. That leaves the device flow (RFC 8628) or the native Sign-In SDK. Both were
  built; the native one won because **an Android OAuth client has no client secret**. It is
  identified by package name plus the SHA-1 of the signing certificate, so there is nothing to
  paste into Settings, nothing to bake in from CI, nothing extractable from the APK, and **no
  refresh token to store** — `getTokens` mints one from the grant on the device. Credentials you
  never hold are credentials you cannot leak.
- **An APK signed with an unregistered certificate fails sign-in with `DEVELOPER_ERROR` and no
  further detail.** Debug and release builds are signed differently and each needs its own Android
  OAuth client. `google-auth.ts` names this case explicitly, because the raw code sends you looking
  at scopes and consent screens for an afternoon.
- **Disconnecting Drive calls `signOut`, NEVER `revokeAccess`.** Revoking withdraws the grant, and
  Google deletes the app-data folder when that happens — so a user tapping "Disconnect" to pause
  backups would silently destroy every backup they had. Disconnecting and deleting must never be
  the same gesture.
- **Prune old backups AFTER a successful upload, never before.** Pruning first means a failed
  upload leaves the user with fewer backups than they started with: the system destroying its own
  safety margin at the exact moment it is failing. Mutating the order fails two tests in
  `drive.test.ts`.
- **Everything needed to open a sealed backup travels inside the file** — salt, scrypt cost, nonce
  and tag. A fresh install on a new phone needs the file and the passphrase and NOTHING else. The
  first version generated a random 256-bit key instead, which is cryptographically stronger and
  useless: it lived in the device's secure store, so the one scenario backups exist for is exactly
  the scenario where the key is gone. Whenever a recovery feature holds a secret, ask what survives
  the device.
- **Passphrases are NFC-normalised.** The same accented character can be typed as one code point or
  two depending on the keyboard, and the two hash differently — so restoring on a new phone would
  reject the passphrase the user is certain is right. A recovery bug that only appears on the worst
  day.
- **The Drive copy is a convenience, not the safety net.** `appdata` is unreachable from any
  browser and is scoped to the OAuth client, so deleting the Cloud project orphans the bytes
  permanently. The reachable backup is still the local one written to a folder the user picks.
- **A recurring occurrence is computed from the rule's START by index, never from the one that
  fired last.** A monthly rule anchored to the 31st must fire on 28 February and then on 31 MARCH.
  Derive each date by adding a month to the previous one and February poisons every month after it
  — the rule silently walks back to the 28th forever, and a payment is three days early for the
  rest of its life. Deriving occurrence *n* from the start means clamping applies to one month and
  cannot leak. Same design gives 29 February yearly its 29th back in the next leap year.
- **What a rule owes is DERIVED, never stored.** A pending row in `transactions` would be a third
  reason for every total to exclude something — forever, and in backups, exports, search and
  analysis — for records that are not real yet. Due rows are merged into the records list at render
  time, so the blast radius is one screen. `nextRunOn` moves only once something has actually been
  written or explicitly skipped, so closing the app mid-decision changes nothing.
- **Tell the rule only AFTER the record is written.** Tapping a due row opens the ordinary record
  screen — editing the amount first is the point, because "the rent went up" is the common case —
  so the write happens elsewhere and `advanceRule` runs after it returns. Advancing first loses the
  occurrence if the save then throws; not advancing at all enters it twice tomorrow.
- **An empty state must be gated on what is RENDERED, not on one of its sources.** The records list
  checked `rows.length === 0` and knew nothing about due rows, so a month with no records but a
  standing order owing money rendered "No records this month" and hid the very thing the feature
  exists for. Gate on the merged sections. Every unit test passed throughout.
- **A background task reads settings from SQLITE, never from the zustand store.** It runs in a
  headless JS context with no React tree, so the store was never loaded and hands back its built-in
  defaults — `driveCadence: 'off'` — and the task would decide there was nothing to do, forever,
  with nothing in any log to say why. A store is a UI cache; the database is the truth.
- **WorkManager is an accelerator, never the mechanism.** It defers at the OS's discretion, and a
  force-stop — by the user or by an OEM battery manager "helping" — cancels pending work until the
  app is launched again. The on-open catch-up is what actually delivers a weekly backup, because
  this is an expense tracker and it gets opened. Ask to be woken roughly twice a day and do nothing
  unless a backup is owed: the OS gives no guarantee about *when*, so frequent cheap no-ops converge
  far better than one weekly request that gets missed.
- **A surviving mutant is a question, not a verdict.** `shouldBackUp` had an explicit
  `cadence === 'off'` guard that no test could kill — because `backupDue` already owned that rule.
  The line was dead, not the test weak. Deleting it put the rule back in one place, where mutating
  it now fails tests in both files. When a mutant survives, ask whether the code is redundant before
  assuming the assertion is.
- **A new capability belongs on the screen that already has its inputs, not on a screen of its
  own.** Recurring rules first got a whole page: name, amount, and chip lists standing in for the
  account and category pickers — a worse copy of the record screen, and a second place to fix every
  time either changed. Repeating is now a property you set while entering the record, and the rules
  screen kept only what a list can do that a form cannot: pause, delete, and see what is scheduled.
  Ask what the new screen would duplicate before building it.
- **A rule created from a record must be advanced past that record's own date.** The rule starts on
  the day the record is dated, so the occurrence just written is immediately owed — and the screen
  offers it back as a due row, showing one payment twice. Write the record, create the rule, then
  settle the first occurrence.
- **`!` is the one construct that turns a compile-time guarantee into a runtime promise.** The
  rules screen passed its sheet handlers as closures over state — `acting!.active` — and `acting` is
  null whenever the sheet is closed, which is almost always. Typecheck clean, lint clean, 748 unit
  tests green, and the screen was a hard crash on first open. Hand the value down from where it is
  known non-null instead of asserting it where it is not.
- **Android's `Intl` shortens September to "Sept", not "Sep".** Hermes ships different ICU data from
  Node, so a `[A-Z][a-z]{2}` month pattern that passes everywhere else fails on device — and
  `assertVisible` matches WHOLE text, so four letters simply do not match three. Same family as the
  currency-symbol rule above: anything formatted through `Intl` has to be seen on a device.
- **Storing progress as a POINTER invents rules the domain does not have.** Recurring occurrences
  were tracked with a single `next_run_on` cursor, which can express "handled up to here" and
  nothing finer — so occurrences had to be dealt with in order, acting out of order had to be
  forbidden, and future rows had to be made inert. Every one of those rules protected the storage,
  not the user. Occurrences are independent: approved is read from the LEDGER (a transaction carries
  its rule and its date, so its existence IS the approval) and dismissed from `recurring_skips`. A
  proposal is anything in range that appears in neither. When a model keeps forcing awkward rules,
  suspect the model.
- **A `Modal` is its own window and does NOT resize with the keyboard.** Android's `adjustResize`
  shrinks the app's window, which is why an ordinary screen can just scroll clear — a bottom sheet
  keeps its full height and everything near its foot stays underneath the keyboard, however hard the
  content scrolls. Lift it by hand with `useKeyboardHeight` from `layout.ts`, and listen to
  `keyboardDidShow`, never `keyboardWillShow`: Android only fires the `Did` events, so a `Will`
  listener reports zero on the one platform that needs it. The flow has to TYPE into the field and
  then assert the button below it is still visible; asserting the field exists proves nothing.
- **The moment a row can point at a FILE, the backup stops being the database.** Attachments live
  on disk with only their names in `attachments`, so copying `peace.db` alone restores a ledger
  whose every receipt is a broken thumbnail — on the one day a backup is being used at all. A
  backup is now a zip: `peace.db` beside an `attachments/` folder, which keeps the property that
  made it a bare `.db` in the first place (unzip it anywhere and the data is there without this
  app). Old `.db` backups still restore: `openBackupPayload` decides container-or-database by
  reading the bytes, in ONE place, so the file restore, the Drive restore and the backup check
  cannot drift apart. Ask what else refers to a file before adding the next thing that does.
- **A truncated zip still unzips.** The entries that survived read back perfectly, so nothing
  downstream notices that half the receipts are gone — and restoring it would delete the originals
  and report success. The manifest records how many attachments were packed and `readContainer`
  CHECKS it, which is what makes the loss visible before anything is deleted. Any container format
  needs a count that is verified rather than trusted.
- **Attachments are content-addressed (`<sha256>.<ext>`), and that is three rules in one.** The
  same receipt attached twice is one file; a name a file manager supplied never reaches the disk or
  the archive (`../../evil.jpg` is the classic zip escape); and a file cannot change under its own
  name. Never store a picked filename as a path — keep it in `original_name` for display only.
- **A row and its file are not one thing.** Two records can share one receipt — a purchase and its
  refund, an invoice split across two categories — so deleting a row must NOT delete the file, or
  removing a receipt from one record silently blanks it on the other. `orphanedFiles` in
  `repo/attachments.ts` is the only thing allowed to decide a file can go, and it answers by asking
  the ledger what it still refers to rather than by bookkeeping.
- **The safety copy has to hold everything the restore replaces, files included.** Restore sweeps
  the files the incoming ledger does not mention, which is correct and would otherwise destroy the
  OUTGOING ledger's photos — so "undo" would hand back rows whose files had just been deleted while
  the screen still called the restore undoable. The pre-restore copy is a container for exactly
  that reason. Same family as the fixed-name rule above it: a recovery path that quietly loses part
  of what it promised is worse than none.
- **The record does not exist when the photo is taken.** You open the record screen, photograph the
  receipt, and only then type the amount — so there is no transaction id for most of the time the
  screen is open. Bytes are written immediately (the camera leaves its output in a cache Android may
  reclaim, and losing a photo somebody just took is unforgivable); ROWS wait for the save, so
  backing out leaves the ledger untouched like every other field. The file left behind is collected
  by the orphan sweep on launch — a cost paid in bytes, not in receipts.
- **Downscale a photo before it is stored, never at render time.** A 4MB camera JPEG that reaches
  the disk is 4MB in every backup made from then on. 1600px at quality 0.7 still reads a total and
  a date, and is the difference between a year of receipts weighing 20MB and 400MB — which is the
  difference between a weekly Drive backup that works and one the user switches off. Failing to
  shrink must not fail the attach: store the original and let the size guard catch it.
- **`resize({ width })` constrains the WIDTH, and a receipt photo is portrait.** Pinning the width
  to 1600 turns a 1200x1800 photo into 1600x2400 — an UPSCALE, produced by the function whose only
  job is to make the file smaller, and completely invisible on screen because a bigger file looks
  exactly like a smaller one. Measure first, cap the LONG edge, and never resize something already
  under the cap. `resizeTarget` in `lib/attachment.ts` is pure and tested for exactly this reason;
  the same trap waits in any "max dimension" API that takes one named axis.
- **An HTTP status is not a diagnosis — read the error body.** Gemini answers an INVALID API KEY
  with **400 INVALID_ARGUMENT**, not the 401 or 403 every instinct expects, so mapping on the
  status alone told someone whose key was wrong to go and check their model name. Google puts the
  truth in `error.details[].reason` (`API_KEY_INVALID`, `SERVICE_DISABLED`, …) and its own
  `error.message` is usually better than anything you would invent — pass it through. Only a run
  against the real API finds this; a mocked 401 passes happily forever.
- **The model is a typist, not an accountant.** Everything an LLM returns is text somebody typed
  badly: range-check it, drop what does not survive, and never let it reach the ledger directly.
  Ask for STRUCTURED OUTPUT (`responseSchema` + `responseMimeType`) so the reply is fields rather
  than prose — parsing prose with a regex works on the receipts you test with and eventually reads
  the wrong figure off one you did not. Keep a partial reading: a receipt whose date is unreadable
  but whose total is clear still saves the typing, and refusing the whole thing over one junk field
  throws that away. `temperature: 0`, because the same photo read twice must not give two totals.
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
2. **ninja's C++ compilers during `:app:buildCMakeDebug`.** Reanimated and worklets compile
   native code, and ninja defaults its job count to `nproc` (16 here) — 16 concurrent compilers,
   each a few hundred MB, none of them governed by any Gradle heap setting. Fix: run Gradle under
   `taskset -c 0-3`, which caps the affinity the whole process tree derives its job count from.
   With that, a clean debug build takes ~2 min.
3. **Emulator + Metro doing a cold bundle.** Cold bundling of ~1900 modules peaks around 3 GB.
   A warm Metro cache re-bundles the same tree in ~3 s, so this only bites on the first run.

Safe order for a native build: stop the emulator → build → start emulator → `adb install`.

- iOS cannot be built or run here. iOS output requires EAS cloud builds.
- The emulator needs the `kvm` group (`sudo usermod -aG kvm $USER`, then restart WSL).
