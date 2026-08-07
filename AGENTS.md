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

To actually see the app: `npm run shot -- after-change` and read the returned PNG.
Drive the UI with `adb shell input tap X Y`, `adb shell input text "..."`,
`adb shell input keyevent KEYCODE_BACK`. Prefer Maestro flows in `.maestro/` for anything repeatable.

## Hard rules

- **Money is integer minor units.** `amount_minor` is a signed integer (negative = money out).
  Never store or arithmetic money as a float. Convert only at the render boundary via
  `src/lib/money.ts`. Any new money code needs a test in `money.test.ts`.
- **Add a `testID` to anything a flow needs to find.** Maestro matches on it; text labels change.
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

- WSL2, ~7.6 GB RAM. The emulator is configured headless with 2 GB and swiftshader.
  Do not run two emulators, and prefer `-no-window`.
- iOS cannot be built or run here. iOS output requires EAS cloud builds.
- The emulator needs the `kvm` group. If `emulator -accel-check` complains about
  `/dev/kvm` permissions, the user must run `sudo usermod -aG kvm $USER` and restart WSL.
