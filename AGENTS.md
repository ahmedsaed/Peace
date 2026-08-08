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
| E2E flows | `npm run e2e` |
| Regenerate migrations | `npm run db:generate` (after editing `src/db/schema.ts`) |
| Validate the JS bundle without a device | `npx expo export --platform android` |
| Dev server | `npm start` |

## How to verify a change

Cheapest first — most changes never need a device.

1. `npm test` + `npm run typecheck` for logic.
2. `npx expo export --platform android` catches Metro/babel/NativeWind config breakage in ~30s.
3. Only then boot a device: `npm run emu`, then `npm start`, then screenshot.

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

## Hard rules

- **Money is integer minor units.** `amount_minor` is a signed integer (negative = money out).
  Never store or arithmetic money as a float. Convert only at the render boundary via
  `src/lib/money.ts`. Any new money code needs a test in `money.test.ts`.
- **Hermes `Intl` is not Node's `Intl`.** Android ships less ICU data, and it degrades
  *silently* rather than throwing — `currencyDisplay: 'narrowSymbol'` returns `"EGP 12,500.00"`
  on device while Node returns `"E£12,500.00"`. A green `npm test` proves nothing about currency
  rendering. Anything touching `Intl` must be checked with a screenshot on a real device, and
  symbols belong in `SYMBOL_OVERRIDES` rather than trusting the platform.
- **Add a `testID` to anything a flow needs to find.** Maestro matches on it; text labels change.
- **testIDs must be regex-safe** — letters, digits, hyphens between words. Maestro matches ids as
  **regular expressions**, so `key-op-+` reads as "`key-op` then one or more hyphens" and silently
  taps the *minus* key. That shipped a green E2E test that saved `120 - 35` while claiming to test
  `120 + 35`. Never put `+ * ? . ( ) [ ] |` in a testID.
- **A passing flow that asserts nothing specific proves only that the app did not crash.** Assert
  the value the user would check, not just that a screen appeared.
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
