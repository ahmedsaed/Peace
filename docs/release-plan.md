# Play Store release plan

Peace has been a daily driver for one person; this is the plan for making it an app other people
install from the Play Store. Decisions are recorded with their reason so they are not re-litigated;
open questions are kept at the bottom until they are answered.

The staged feature history is [roadmap.md](roadmap.md); the engineering rules are
[AGENTS.md](../AGENTS.md).

## Decisions

| Decision | Why |
|---|---|
| Package name becomes **`dev.merope.peace`** | Merope is the publishing studio and owns `merope.dev`. A Play package name can never change after the first upload, so it is settled before it. |
| **Two build flavors from one codebase**: `play` and `oss` | The Play build needs things the open build must not carry (billing, Play In-App Updates); the open build needs things Play forbids (a self-updater). See [Build flavors](#build-flavors). |
| GitHub builds install **beside** the Play build, not over it | Someone testing a release from GitHub must not lose or overwrite their Play install. Different package id, different signature — Android treats them as two apps. Moving data between them is backup → restore. |
| Existing sideloaded installs (`com.ahmed.peace`) are **not upgraded** into the Play build | The signature and package differ, so Android cannot do it. The path is backup → install → restore, and it must be smooth and written down. |
| Hosted AI ("Peace Cloud") is **v1.1, not a launch blocker** | Launch with bring-your-own-key, learn whether AI is used at all, then build a server. |
| Peace Cloud is paid with **consumable credit packs that never expire** | No subscription to forget about; buy as much as you want, use it whenever. Credits must be **fully transparent** — see [Peace Cloud](#peace-cloud-v11). |
| Peace Cloud lives **in the main codebase** behind an `AiProvider` interface | The client half is just another endpoint. What is private is the server and its key, not the app code. The `oss` flavor simply never offers it. |
| Themes are **curated presets**, not a free colour picker | The money colours are chosen to survive colour-blindness; a picker lets anyone undo that. Presets: Ledger (dark, current), a light theme, a few accents. |
| **Localisation is backlog**, separate from de-personalising | Every string is an English literal with no i18n layer, and Arabic means RTL. Worth doing, too big to block release. |
| **Onboarding is skippable per step** and every step is reachable again from Settings | Skipping must never be permanent. |
| **Maestro flows skip onboarding**, except one flow that tests it | Every flow opens with `clearState` and gates on `home-screen`; onboarding would otherwise break the whole suite at once. |
| Store title **"Peace: Expense Tracker"** | "Peace" alone is unsearchable; the title is where Play search looks. |
| Website at **`peace.merope.dev`** hosts the privacy policy, data-safety explanation and support contact | Play requires a public privacy-policy URL; it also gives the store listing a home. |

## Build flavors

A *flavor* is a build-time switch that decides what goes into the binary — not a runtime setting.
One environment variable, read by `app.config.js`:

```
PEACE_FLAVOR=play   →  dev.merope.peace          signed by Play App Signing, AAB
PEACE_FLAVOR=oss    →  dev.merope.peace.oss      signed by our key, APK on GitHub Releases
```

| | `play` | `oss` |
|---|---|---|
| Updates | Play In-App Updates (or nothing — Play updates it) | GitHub release checker (`update-check.ts`) |
| AI | Own Gemini key **or** Peace Cloud (v1.1) | Own Gemini key only |
| Billing dependency | linked | **not linked** (autolinking exclude), so no Play code ships in it |
| App name | Peace | Peace (OSS) — so two icons on one phone can be told apart |
| Google Drive OAuth client | registered with Play's app-signing SHA-1 | registered with our release SHA-1 |

The flavor is exposed to JS through `expo-constants` (`extra.flavor`), the same way `build-info.ts`
reads the version. Code that differs per flavor sits behind one small module per concern
(`updates`, `ai-provider`), never as `if (flavor === …)` scattered through screens.

## Phase 1 — De-personalise and polish

- [x] Package name → `dev.merope.peace` (+ `.oss`); new Android OAuth clients for Drive
      (`oss` client done in 1.16; the `play` client registered against Play's app-signing SHA-1 — Phase 4)
- [x] `homeCurrency` default detected from the device locale (`expo-localization`), confirmed in onboarding
      (1.17 — the detected currency is written once, on a first launch, before Cash and Bank are seeded in it)
- [x] Card handling worded generally — "installment plan" first, Murabaha as one kind of it, not the headline
- [x] UI copy: remove region-specific examples (bank names, E£ in hints and placeholders)
- [x] About screen: Peace by Merope, links to `peace.merope.dev` and the source
      ("Made by · Merope" shipped in 1.15.1; website, privacy policy and source links in 1.18)
- [x] Review Penny's system prompt and default category set for anything that assumes one person or one country
      — reviewed in 1.16.3. Penny's prompt, the receipt prompt and the bank-message prompt assume no
      country, bank or currency (the home currency is passed in). The default categories are generic;
      "Telephone" became "Phone" for new installs (existing ledgers keep their names — seeding never
      overwrites). The one regional default left is `homeCurrency: 'EGP'`, which onboarding replaces
      by design.

## Phase 2 — Customisation

- [x] **Keypad layout** setting: calculator (7-8-9 on top, current) / phone (1-2-3 on top). `ROWS` in
      `keypad.tsx` becomes two tables. Operators left/right for left-handed use, same setting family.
- [x] **First day of week** and **first day of month** (payday budgeting) — reaches `periodBounds`,
      records grouping, budgets, analysis. A flow asserts a month boundary moving on a different screen.
      (1.20 — months start on any day 1–28 and are named after the calendar month holding most of
      them; Records, Budgets, Analysis, carry-forward, search's month chips and Penny all follow.
      The week start reaches the date picker and Penny's week buckets, the only week-shaped things.)
- [x] **Themes**: Ledger, Graphite (true black), Paper and Mist (light), plus Match phone — Settings ›
      Appearance (1.23). Tokens are CSS variables set at the root; literals go through `useTheme()`
      and a test forbids importing the table into a screen. Every theme is checked for contrast and
      for the income/expense pair under simulated colour blindness. Ledger's expense went to rose for
      that in 1.23 and back to the salmon red in 1.24 (the rose read as pink); its deuteranopia pair is
      a recorded waiver in `theme.test.ts`. Existing installs keep Ledger; new ones follow the phone.
      Native dialogs follow through night mode.

## Phase 3 — Onboarding

1. **Welcome** — local-first, nothing leaves the phone unless you turn it on.
2. **Currency** — detected, confirm or change.
3. **Accounts** — rename Cash / Bank, set starting balances.
4. **Keypad layout** — pick by picture.
5. **Optional features**, each explained in plain words, permission asked only on "yes":
   - Daily reminder (`POST_NOTIFICATIONS`)
   - Bank notifications — its own disclosure screen before the system settings page (Play requires it)
   - AI — paste a key (later: "use Peace Cloud")
   - Backups — choose a folder and/or Google Drive
6. **"Getting set up 3/6" card** on Records afterwards, dismissable, so a skipped step is one tap away.

Shipped in 1.17 as `/setup` (`?step=<name>` for one step on its own), the "Finish setting up" card,
and Settings › Walk through setup again. The bank step is the disclosure, and the Settings card's
"Allow…" routes to it. Welcome also offers "I have a backup to restore".

Testing: a launch argument (or debug-only intent extra) marks onboarding done; every existing flow
passes it; one new flow walks onboarding end to end and asserts the chosen currency and keypad
layout on the screens that use them.

## Phase 4 — Store requirements

- [x] Release builds an **AAB** for Play (`bundleRelease`) alongside the APK for GitHub, through the same reusable workflow
      — on request only: Actions › **Play bundle**, since every upload burns its versionCode
- [x] Play App Signing enrolled; upload key kept out of the repo like the current signing key
      (2026-10-14. Upload key SHA-1 `56:46:7E:…:0F:7C` is our release key; Play's app-signing key is
      `6C:21:29:A1:C3:56:6E:9B:93:50:DD:BE:10:4E:CD:CB:52:8A:B7:9A` — use the single "Copy SHA-1" at
      the top of the page, not "copy all", which also lists the previous and quantum-ready keys)
- [x] Drive OAuth: Android client for Play's app-signing SHA-1 (`dev.merope.peace`, the `6C:21…` key above),
      in the same Cloud project as the `oss` client. Drive connect verified on the internal-test build
      1.23.0 (269), 2026-10-14
- [x] OAuth consent screen published to production (in Testing, only listed test users can connect and
      grants expire after 7 days), confirmed in production 2026-10-14
- [x] Notification-listener **prominent disclosure** screen, consent before deep-linking to settings.
      **Built once, with onboarding** — the onboarding step IS the disclosure, and the Settings card
      opens the same screen for anyone who skipped it. Play reviews closed-test builds too, so this
      must land **before the first AAB is uploaded**, even if the rest of onboarding is not done.
- [x] Privacy policy + data-safety page on `peace.merope.dev` (`/privacy/`, `/data/`)
- [x] Play Data safety form filled (2026-10-14): importable as `store/data-safety.csv`, explained in
      `site/content/data-safety.md`; the deletion URL is `/delete/`
- [x] Check the merged manifest's alarm permissions (`SCHEDULE_EXACT_ALARM` fine, `USE_EXACT_ALARM` needs a declaration)
      — neither is requested; expo-notifications falls back to inexact alarms
- [x] Target SDK meets Play's current minimum (36)
- [x] Store listing: screenshots (`npm run shot`), feature graphic, short and long description — `store/`, graphics at `/store/`
- [x] Sideload → Play migration documented on the website (backup → install → restore) — `/move/`; flip
      `ON_PLAY` in `site/app/move/page.tsx` when the listing is public
- [ ] Closed testing track: 12+ testers opted in for 14 consecutive days (mandatory — personal account). Testers join through a Google Group and an opt-in link, then install from the Play Store as normal.
- [x] Internal testing track for our own devices from day one (does not count towards the 12)
      — 1.23.0 (269) released to it 2026-10-14

## Phase 5 — Features before launch

- [x] **CSV import** — ONE format, Peace's own export, documented at `/import/` with a template;
      no column mapping and no per-app preset (decided 2026-10-14: people adjust their file once).
      Previewed with every refused row by line, undoable as one batch; the `type` column decides
      the side, never the amount's sign.
- [x] **App lock** (biometric / PIN, `expo-local-authentication`) — **off by default**, so nobody pays
      a step they did not ask for. Grace period: immediately / 1 / 5 / 15 minutes (default 1). Uses
      the phone's own lock rather than a Peace PIN, fails open on a phone with none, and blanks the
      recent-apps preview on Android 13+.
- [x] **Empty states that teach** — on a ledger with no data, Analysis, Budgets, Portfolio and
      Recurring each say what the screen is for and offer the one action that fills it, instead of
      a blank chart or "No data".

## Peace Cloud (v1.1)

- **Client**: `AiProvider` interface; `byok-gemini` (today) and `peace-cloud`. Only the `play` flavor offers the second.
- **Server**: a thin streaming proxy. Stores no content, logs no content, paid Gemini tier only
  (the free tier allows Google to train on requests).
- **Entitlement without accounts**: Play purchase tokens verified server-side (RevenueCat or the
  Play Developer API directly); Play Integrity so the endpoint cannot be scripted for free Gemini.
- **Credits**: consumable packs, never expire. No free starter grant for now.
- **Pricing**:
  - Receipts and bank messages are a **fixed price** per reading — bounded input, structured output.
  - Penny is **metered**: every step resends the conversation, so cost grows with it. Credits are
    fine-grained (one credit is a fixed slice of tokens) so the meter shows real cost rather than
    rounding every action up.
  - A **live meter** while Penny answers, and the exact cost on every reply.
  - A **per-question ceiling** the user sets: past it, Penny pauses and asks before spending more.
    This is not a step cap — Penny may take as many steps as it needs; the user is asked before
    their money is.
  - A hint when a conversation grows long that a new one costs less.
- **Balance survives a new phone**: Play forgets a consumable once it is consumed, so "restore
  purchases" cannot bring credits back. The server keeps the balance under a random **anonymous
  id** that travels in the backup, local and Drive alike — restore the backup, the balance comes
  with it. Every verified purchase is recorded against that id, so a user who lost their backup can
  email their Play order ids and have the balance reassigned. No accounts.
- **Transparency** — the non-negotiable part:
  - A price list in the app and on the website: what one credit buys, and roughly what each
    action costs (reading a receipt, reading a bank message, an assistant question).
  - The balance visible wherever a credit is about to be spent.
  - The cost of every request shown after it, and a history of every spend.
  - A failed request costs nothing.
- **Privacy**: onboarding and the policy say plainly that Peace Cloud sends the request through our
  server; bring-your-own-key remains the option where only Google sees it.

## Backlog

- Localisation (string extraction first, then Arabic + RTL)
- [x] Launcher shortcuts for quick add (1.25): hold the icon for Expense, Income or Receipt — static
      shortcuts deep-linking into the record screen with Records anchored beneath. A home-screen
      WIDGET is still open.
- [x] Accessibility pass (1.25): keypad keys and the `=`/next/save key speak words, the amount is a live
      region, analysis rows and the six-month bars read as one sentence each (masked like the screen),
      swatches and icons in the pickers have names. Large text: density divides by the font scale (up
      to 1.5x, so large text alone never drops to the split-screen layout), and the tab labels, keypad
      digits and record title cap how far they grow. Checked on the emulator at 1.3x and 2x.
- Crash visibility through Play Console vitals (no SDK)
- Store video / demo

## Settled questions

- **Personal** Play developer account — Merope is a personal brand, not a company. The closed test
  (12 testers, 14 consecutive days) is therefore mandatory before production.
- Pricing, starter grant and credit recovery — see [Peace Cloud](#peace-cloud-v11).
- The name stays **Peace**; no finance app by that name turned up on Play. The store title uses the
  30 characters it is allowed for search: "Peace: Expense Tracker".
