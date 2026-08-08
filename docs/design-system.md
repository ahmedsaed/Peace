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

## Naming

The app is **Peace** — as in peace of mind. Lowercase `peace` remains the project slug and the
Android package suffix (`com.ahmed.peace`); the display name and the in-app wordmark are
capitalised.

## Open

- A light theme is deliberately out of scope. Tokens make adding one later a config change rather
  than a refactor.
- The icon set is functional but hand-drawn. Worth revisiting if the category list grows much past
  40 entries.
