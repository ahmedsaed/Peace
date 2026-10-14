# Design system

Four themes, chosen in Settings › Appearance, plus **Match phone** (Ledger at night, Paper by day).
Colour values live in [`src/constants/themes.js`](../src/constants/themes.js) — nothing outside
that file hard-codes a chrome colour, so a new theme is one entry there.

**How a colour reaches the screen.** Every Tailwind colour is a CSS variable
(`bg-surface` → `rgb(var(--color-surface) / <alpha-value>)`), and `ThemeRoot`
([`src/state/theme.tsx`](../src/state/theme.tsx)) sets the variables once, at the root, from the
active theme. A colour needed as a VALUE — an SVG fill, a navigator option, an icon's `color` —
comes from `useTheme()`. Never import the table into a screen: a module-level colour is invisible to
the React Compiler and stays the old theme's until something else re-renders.
`no-static-colours.test.ts` enforces this.

**Who gets which.** A fresh install follows the phone. An install from before themes has no
setting and reads the default, **Ledger** — somebody who has looked at the dark app every evening
must not open it one morning to a cream one.

## Themes

| Token | Ledger | Graphite | Paper | Mist | Role |
|---|---|---|---|---|---|
| `ground` | `#17140F` | `#000000` | `#F4EEE3` | `#EDF0F3` | app background |
| `surface` | `#241F17` | `#121212` | `#FFFDF8` | `#FFFFFF` | headers, tab bar, cards, sheets |
| `raised` | `#302818` | `#1F1F1F` | `#EAE1D1` | `#E1E6EB` | inputs, chips, selected segment, pressed rows |
| `line` | `#2E271D` | `#262626` | `#E2D8C6` | `#D5DBE2` | hairline separators |
| `ink` | `#EFE4CE` | `#F2F2F0` | `#2A231A` | `#1C232B` | primary text |
| `muted` | `#9A8E79` | `#A3A39D` | `#6B5F4C` | `#566170` | secondary text, inactive tabs, placeholders |
| `accent` | `#E3A33C` | `#E9AC48` | `#985A0C` | `#2B65A0` | FAB, active tab, progress fill, links |
| `accent-ink` | `#17140F` | `#000000` | `#FFFFFF` | `#FFFFFF` | text/icons placed on `accent` |
| `income` | `#9CC46A` | `#A3CC70` | `#3C6F18` | `#376D19` | money in |
| `expense` | `#E5806A` | `#F07E97` | `#B03366` | `#B03366` | money out |
| `transfer` | `#75A8C4` | `#7DB3D1` | `#2D6A8F` | `#7A4FB0` | between own accounts |

**Ledger** is the original: warm, low-contrast dark, chosen over a cool teal-slate and a near-black
high-contrast direction because an expense tracker is used late at night as often as in daylight.
The neutrals are warm-biased on purpose — a pure grey reads as unconsidered. **Graphite** is that
rejected near-black direction, kept for OLED screens. **Paper** is Ledger in daylight. **Mist** is a
cool light theme in blue.

**A light theme inverts the surface order.** In a dark theme each surface is lighter than the one
beneath it. In a light one cards are the LIGHTEST thing, and `raised` is a step DARKER than the card
— otherwise an input on a card, a selected segment or a pressed row would be invisible.

**Every theme is checked, not eyeballed** ([`src/lib/theme.test.ts`](../src/lib/theme.test.ts)):
ink at 7:1 and muted at 4.5:1 on `ground`, `surface` and `raised`; the accent at 4.5:1 as text and
under its own ink; each money colour at 4.5:1 on all three surfaces; income and expense at least
ΔE 20 apart under simulated protanopia, deuteranopia and tritanopia (Machado 2009), and transfer
at least ΔE 12 from both.

Ledger is the one waiver. Its salmon expense (`#E5806A`) sits ΔE **9** from its income under
deuteranopia, which is close to the same olive. Expense was moved to rose for 1.23.0, which passed,
and moved back in 1.24.0 because the rose read as pink rather than as money going out. Every red that
clears 20 against a yellow-green turns pink, so the choice is between the colour and the number. The
test records the waiver with a floor of 8, so the pair cannot quietly get worse. Rule 1 below carries
the meaning, and the other three themes clear the bar for anybody who needs the colour to do it.

## Rules

**1. Colour is never the only signal for money direction.**
Always render an explicit `+` or `−`. Roughly one man in twelve has red–green colour deficiency,
and the amount is the most important element on screen. The money colours must still differ for
him: income leans yellow-green and expense rose, so under deuteranopia they land on opposite ends
of the blue–yellow axis. Verify with the simulation in `theme.test.ts`, not by eye.

**2. Transfer is a third colour because it is a third thing.**
Money moving between your own accounts is neither income nor expense. It must never be summed into
either, in the UI or in a query.

**3. `accent` is for interaction only.**
FAB, active tab, progress fill, focused input. The moment it decorates something non-interactive
it stops signalling, and the interface loses its only strong affordance.

**4. Category colours are data, not theme.**
Each category stores its own `color`. These saturated circles carry nearly all the colour in the
app, which is precisely what lets the chrome stay quiet — the trick MyMoney gets right, and why
its muted shell never feels drab. They do not change with the theme, and neither does what sits on
them: an icon on a category circle is always white (`#FFFFFF`), never `ink`, which is near-white
in a dark theme and dark brown in a light one.

Default category palette, all tested against `ground`:

| | | | |
|---|---|---|---|
| `#B03A3A` red | `#C2622C` orange | `#C99A2E` gold | `#6E8B3D` olive |
| `#2E7D46` green | `#2F8A78` teal | `#2F6FA8` blue | `#3B4E9E` indigo |
| `#6B4CA8` violet | `#9C2D6B` magenta | `#A8475C` rose | `#6B5B4A` taupe |

## Typography

System stack — `system-ui` on Android resolves to Roboto, which is well-tuned for small UI text
and costs nothing to load.

Money **always** uses tabular figures (`font-variant-numeric: tabular-nums`). Amounts sit in a
right-aligned column, and proportional digits make that column visibly ragged.

## The wordmark

"Peace" is set in **Pacifico**, a brush script, at 26px in the header and 38px on About. Everything
else stays on the system sans — the script is the app's one flourish, and a second decorative face
would make it a theme rather than a signature.

Three things it needs that a sans does not:

- **More size.** 26px next to the 20px semibold sans it replaced, because a script's strokes read
  optically smaller.
- **An explicit line height.** Pacifico has tall ascenders and deep descenders; the default clips
  the loop of the P against the status bar. `lineHeight: size * 1.45`, and `includeFontPadding:
  false` so Android does not add its own.
- **One place to check.** A font that fails to load falls back SILENTLY to the system sans, and the
  only symptom is a wordmark that looks slightly ordinary. It lives in
  [`src/components/wordmark.tsx`](../src/components/wordmark.tsx) and is loaded once in the root
  layout, which holds render until it is ready rather than letting the header re-set itself a frame
  in. A load failure is deliberately not fatal — a missing font is cosmetic, and refusing to open a
  ledger over it would not be.

It costs ~308KB in the APK, which is more than the other candidates put together. That was a
deliberate trade for the one piece of personality the interface has.

## Icons

Hand-drawn inline SVG in [`src/components/icon.tsx`](../../src/components/icon.tsx), resolved from
the **slug** stored on each row (`categories.icon`, `accounts.icon`) — never a glyph. Swapping to a
different icon library later is therefore a change to one file, not a data migration. An unknown
slug falls back to `dots` so a missing icon looks deliberate rather than broken.

Two rules for adding a path:

- **Every segment must be a closed, filled shape.** The `<Path>` has no stroke, so an open line
  segment (`M5 8l3 2`) renders as nothing at all. This has already shipped two invisible icons.
- Draw on a 24×24 viewBox and check it at 14px inside a 26px circle, which is the smallest place
  it appears.
- A **ring** (the search lens, the About badge) needs its inner subpath wound the *opposite* way —
  `sweep-flag 1` against the outer's `0`. Same winding under non-zero fill gives a solid disc,
  which reads as a lollipop rather than a magnifier.
- **Write the path into the group it belongs to**, and there is nothing else to remember. The file
  holds three maps — `CHROME_PATHS` (header, tab bar, side menu), `CATEGORY_PATHS` (everything the
  picker offers, in the order it offers them) and `ALIAS_PATHS` (a slug that must keep resolving
  but draws a shape a pickable slug already draws). `ICON_NAMES` *is* the category map; rendering
  looks at all three merged.

  This used to be a parallel list of names — add a path, then remember to also add it to `CHROME`
  — and the rule was forgotten the first time it was tested: `filter` was added to the paths and
  left out of the list, which would have offered a funnel as a category icon. A rule that has to be
  remembered is a rule that gets forgotten, so it was made structural instead. `icon.test.ts`
  asserts the groups are disjoint, that no chrome glyph or alias reaches the picker, that no two
  *pickable* slugs draw the identical path, and that every icon named by the seed data resolves.

  `receipt` and `tag` duplicate the chrome glyphs `records` and `categories` on purpose: chrome is
  never offered, so each shape still appears exactly once in the picker.

## App icon

Concept: a wallet with a sprout on it — money that grows, which is where the name comes from. The
wallet greens are deliberately deeper than the in-app `income` sage; the cards borrow `accent` and
`transfer` so the launcher icon and the UI are visibly the same product.

Everything is generated from one vector definition by
[`scripts/make-icons.mjs`](../scripts/make-icons.mjs):

```
npm i --no-save sharp && node scripts/make-icons.mjs
```

`sharp` is intentionally not a dependency — it is a large platform-specific binary, this runs
about twice a year, and `npm ci` validates the lockfile strictly. **Never hand-edit the PNGs**;
change the geometry in the script and re-run. The source SVGs land in `assets/logo/` so the
artwork stays diffable.

| Output | Purpose |
|---|---|
| `android-icon-foreground.png` | Adaptive icon foreground, transparent |
| `android-icon-background.png` | Adaptive icon background, radial ground |
| `android-icon-monochrome.png` | Android 13+ themed icon |
| `icon.png` | Legacy square launcher icon, web, stores |
| `splash-icon.png` | Splash, over `#17140F` |
| `logo-mark.png` | 144px in-app mark for the drawer and About |
| `favicon.png` | Web |

Two things about this that are easy to get wrong:

- **The adaptive foreground looks too small on purpose.** The launcher composes 108×108dp and masks
  down to 72×72dp, with only the central 66×66dp circle guaranteed visible. Art drawn edge-to-edge
  gets its corners eaten by a circular mask, so the geometry is scaled to fit that circle.
- **The monochrome layer uses only the alpha channel** — the colour is discarded and replaced by
  the wallpaper theme. Flattened naively, the cards, the wallet and the clasp merge into one
  unreadable blob. The mask therefore paints a transparent gap around every shape before filling
  it, and knocks the sprout out as a hole.

## Native surfaces

Android dialogs (date/time pickers, system alerts) inherit the **Android theme**, not our tokens.
Expo generates `AppTheme` with a `Theme.AppCompat.DayNight` parent, which follows the phone's
dark-mode setting — so a Ledger screen on a phone in light mode got a bright white date picker.

The parent STAYS DayNight, and `ThemeRoot` forces the app's night mode to match the theme with
`Appearance.setColorScheme` — lifted (`'unspecified'`) under Match phone, which is also what lets
`useColorScheme` report the phone's real setting. AppCompat then resolves `values-night/` for a dark
theme and `values/` for a light one. [`plugins/with-native-theme.js`](../plugins/with-native-theme.js)
writes `peace_*` colour resources into both — Ledger's at night, Paper's by day — and points the
dialogs at them. A resource cannot change at runtime, so Graphite's dialogs are Ledger's and Mist's
are Paper's: the right lightness, if not the exact shade. It also sets `colorAccent` on `AppTheme`
itself, or a system alert's buttons are AppCompat's teal. It is a config plugin because `android/`
is regenerated by `expo prebuild`, which would undo a direct edit to `styles.xml`.

### Theming the date and time dialogs

Night mode is not the same as themed. With only the parent right, the pickers still drew their
selection ring, header band and buttons in the platform's default blue-on-grey — the one thing on
screen that was not ours.

`@react-native-community/datetimepicker` builds its default (non-spinner) dialog with **no explicit
style**, so it resolves `android:datePickerDialogTheme` and `android:timePickerDialogTheme` from the
activity's theme. Pointing those two attributes at our own styles is enough: no prop to pass, no
fork of the library. Three things are easy to get wrong:

- **Both namespaces of `colorAccent` are needed.** The DatePicker and TimePicker are *framework*
  widgets and read `android:colorAccent`; the dialog's OK/Cancel buttons come from AppCompat and
  read the bare `colorAccent`. Set one and half the dialog stays blue.
- **The header band and clock face are widget properties, not theme colours.** They ignore
  `colorAccent` entirely and need `android:datePickerStyle` / `android:timePickerStyle` with
  `headerBackground`, `numbersBackgroundColor` and friends. Without them the result is amber on
  platform grey, which looks worse than the untouched default.
- **A dev build cannot verify any of this.** `styles.xml` is native, so it takes a `prebuild` plus a
  full Gradle build to see. Screenshot it.

## The keypad drives the record screen

The pickers sit at the top of the record screen and the keypad at the bottom, so logging a spend
one-handed meant reaching across the whole phone twice. The bottom-right key fixes that: it walks
the record forward — account, then category — and saves once everything is present.

**`=` keeps its arithmetic meaning.** A pending operation always wins, so `120 + 35 =` still shows
155 rather than saving a record. That is safe precisely because the calculator is
immediate-execution: an operator commits the previous step, so a pending operation exists exactly
when the user is mid-sum. The logic is pure and branch-tested in
[`src/lib/record-flow.ts`](../src/lib/record-flow.ts).

**The key says what it will do.** A key labelled `=` that silently writes a record is a trap, so
the label tracks the action:

| Label | Next press |
|---|---|
| `=` | finish the sum |
| `→` | open the next picker |
| `✓` | save the record |

Two rules that keep it predictable:

- **Each picker is offered once.** A category is not required to save, so re-prompting after a
  dismissal would be an inescapable loop around an optional field. Tapping a picker by hand counts
  as offered too, so `=` never re-asks something just answered.
- **The key is never dead.** If everything has been offered and the record still cannot be saved,
  it reopens whatever is actually missing — and when only the amount is absent, it says so in the
  muted colour rather than the error colour, because pressing "next" with nothing typed is a
  question, not a mistake.

## Density: designing for split-screen

Peace gets used with half the screen showing a bank notification, which leaves roughly **340dp of
height instead of 800**. That is a supported layout, not an edge case, and it is the state in which
a layout tuned for a whole phone stops merely looking cramped and starts losing controls off the
bottom edge.

[`src/lib/layout.ts`](../src/lib/layout.ts) resolves the window height to one of three densities:

| Density | Window height | Where it comes from |
|---|---|---|
| `regular` | ≥ 680dp | a whole phone |
| `compact` | 520–679dp | a large phone sharing the screen, or a small one whole |
| `tight` | < 520dp | split-screen portrait |

**The structure is the fix; the density table is only the polish.** On the record screen the
amount, keypad and date row are *pinned* to the bottom and everything above them scrolls, so however
short the window gets, the keys stay on screen and the squeeze is absorbed by scrolling. Shrinking
type and padding alone would only have delayed the failure.

Three rules that follow:

- **Decide what must never move, and pin that.** For the record screen it is the keypad: a keypad
  you have to scroll to is worse than no keypad.
- **Shrink to the touch target, then stop.** `tight` keys sit at the edge of the 44dp guideline.
  Going smaller trades a layout problem for a mis-tap problem, and a mis-typed amount is the more
  expensive of the two.
- **Drop labels before you drop controls.** At `tight` the account and category pickers collapse to
  44dp icon squares and the note joins them on the same line, which buys back ~120dp — enough that
  nothing scrolls at all. The labels are the right thing to lose: each picker already shows its own
  icon and colour, which is how it is recognised in the records list anyway, and the accessible
  name still carries the full text. Both forms keep the **same testID**, so a flow never has to
  know the density to find the account picker.

Search applies the first rule with a different answer. What must never move there is the **result**,
so the filter panel is the thing that gives way: it is bounded to `max(190dp, 40% of the window)`
and scrolls inside that, which keeps the count and the total on screen at 340dp with a row or two
of results under them. Filters you have to scroll are a mild annoyance; a filter you cannot see the
effect of is the reason nobody trusts the filter.

**The filters are inline, not a sheet.** A sheet would have to open the account and category
pickers on top of itself, and a modal over a modal is unreliable on Android — but the better reason
is that inline leaves the results visible while a filter is being changed, which is what tells you
whether the filter did what you meant.

### A chip label can wrap into a chip that has no room for it

`filter-range-year` rendered as **"This"** inside a pill correctly sized for "This year". Android
measured the text a fraction wider than the width it then laid out in, so the label wrapped to a
second line and the chip's single-line height clipped it. Nothing about the result looks like a
wrap — it looks like deliberate truncation, which is why it survived a full-height screenshot and
only appeared at split-screen height.

Every chip label carries `numberOfLines={1}`, and the E2E flow asserts the **full text** of the two
longest chips. Asserting the testID alone would have passed throughout.

## Naming

The app is **Peace** — as in peace of mind. Lowercase `peace` remains the project slug and the
Android package suffix (`dev.merope.peace`, published by Merope); the display name and the in-app wordmark are
capitalised.

## Open

- A light theme is deliberately out of scope. Tokens make adding one later a config change rather
  than a refactor.
- The icon set is functional but hand-drawn. Worth revisiting if the category list grows much past
  40 entries.
