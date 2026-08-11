# Design system

Dark only. Tokens live in [`tailwind.config.js`](../tailwind.config.js) — nothing outside that
file hard-codes a hex value, so re-theming stays a one-file change.

## Palette: "Ledger"

Warm, low-contrast. MyMoney's warmth without copying its olive-and-cream. Chosen over two
alternatives — a cool teal-slate ("Delta") and a near-black high-contrast direction ("Graphite") —
because an expense tracker is used late at night as often as in daylight, and this is the easiest
of the three to look at in the dark.

| Token | Hex | Role |
|---|---|---|
| `ground` | `#17140F` | app background |
| `surface` | `#241F17` | headers, tab bar, cards |
| `raised` | `#302818` | sheets, menus, pressed rows |
| `line` | `#2E271D` | hairline separators |
| `ink` | `#EFE4CE` | primary text |
| `muted` | `#9A8E79` | secondary text, inactive tabs, placeholders |
| `accent` | `#E3A33C` | FAB, active tab, progress fill |
| `accent-ink` | `#17140F` | text/icons placed on `accent` |
| `income` | `#8FBF6A` | money in |
| `expense` | `#E5806A` | money out |
| `transfer` | `#75A8C4` | between own accounts |

The neutrals are warm-biased on purpose. A pure grey reads as unconsidered; these carry a faint
brown so the ground feels chosen rather than inherited.

## Rules

**1. Colour is never the only signal for money direction.**
Always render an explicit `+` or `−`. Roughly one man in twelve has red–green colour deficiency,
and the amount is the most important element on screen. The three money colours are also separated
by *lightness*, not just hue — under deuteranopia `income` and `expense` both drift toward olive,
and that lightness gap is what keeps them apart. Verify with a colour-blindness simulator, not by
eye.

**2. Transfer is a third colour because it is a third thing.**
Money moving between your own accounts is neither income nor expense. It must never be summed into
either, in the UI or in a query.

**3. `accent` is for interaction only.**
FAB, active tab, progress fill, focused input. The moment it decorates something non-interactive
it stops signalling, and the interface loses its only strong affordance.

**4. Category colours are data, not theme.**
Each category stores its own `color`. These saturated circles carry nearly all the colour in the
app, which is precisely what lets the chrome stay quiet — the trick MyMoney gets right, and why
its muted shell never feels drab. They do not change if the palette changes.

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
- Chrome glyphs (`menu`, `search`, `settings`, `export`, `info`, `back`) must be added to `CHROME`
  in the same file, or they leak into the category icon picker.

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
dark-mode setting — so on a phone in light mode the date picker rendered as a bright white sheet in
the middle of a dark app. `app.json`'s `userInterfaceStyle: "dark"` does *not* fix this; it drives
the JS colour scheme only.

[`plugins/with-dark-theme.js`](../plugins/with-dark-theme.js) repoints the parent at
`Theme.AppCompat.NoActionBar` (the dark variant). It is a config plugin because `android/` is
regenerated by `expo prebuild`, which would undo a direct edit to `styles.xml`.

### Theming the date and time dialogs

Dark is not the same as themed. With only the parent swapped, the pickers still drew their
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
Android package suffix (`com.ahmed.peace`); the display name and the in-app wordmark are
capitalised.

## Open

- A light theme is deliberately out of scope. Tokens make adding one later a config change rather
  than a refactor.
- The icon set is functional but hand-drawn. Worth revisiting if the category list grows much past
  40 entries.
