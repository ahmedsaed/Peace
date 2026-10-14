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
      (`oss` client done in 1.16; the `play` client waits for Play's app-signing SHA-1 — Phase 4)
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
- [ ] **Themes**: palette → CSS variables (NativeWind `vars()`); Tailwind colours as
      `rgb(var(--x) / <alpha-value>)`; the ~130 `palette.x` literals go through a `useTheme()` hook;
      remove the dark-only plugin so a light theme is possible. Every preset is checked for contrast
      and for the income/expense pair under colour-blindness simulation.

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

- [ ] Release builds an **AAB** for Play (`bundleRelease`) alongside the APK for GitHub, through the same reusable workflow
- [ ] Play App Signing enrolled; upload key kept out of the repo like the current signing key
- [ ] Drive OAuth: Android client for Play's app-signing SHA-1; consent screen to production with brand verification
- [x] Notification-listener **prominent disclosure** screen, consent before deep-linking to settings.
      **Built once, with onboarding** — the onboarding step IS the disclosure, and the Settings card
      opens the same screen for anyone who skipped it. Play reviews closed-test builds too, so this
      must land **before the first AAB is uploaded**, even if the rest of onboarding is not done.
- [ ] Privacy policy + data-safety page on `peace.merope.dev`; Data safety form filled to match
      (Gemini requests, Drive backup, notification contents read on device)
- [x] Check the merged manifest's alarm permissions (`SCHEDULE_EXACT_ALARM` fine, `USE_EXACT_ALARM` needs a declaration)
      — neither is requested; expo-notifications falls back to inexact alarms
- [x] Target SDK meets Play's current minimum (36)
- [ ] Store listing: screenshots (`npm run shot`), feature graphic, short and long description
- [ ] Sideload → Play migration documented on the website (backup → install → restore)
- [ ] Closed testing track: 12+ testers opted in for 14 consecutive days (mandatory — personal account). Testers join through a Google Group and an opt-in link, then install from the Play Store as normal.
- [ ] Internal testing track for our own devices from day one (does not count towards the 12)

## Phase 5 — Features before launch

- [ ] **CSV import** — generic column mapping, plus a preset for MyMoney exports. Imports are
      previewed and undoable as one batch; sides go through `ledgerSide`, never the amount's sign.
- [ ] **App lock** (biometric / PIN, `expo-local-authentication`) — **off by default**, so nobody pays
      a step they did not ask for. Optional grace period ("lock after 5 minutes away").
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
- Home-screen widget / launcher shortcut for quick add
- Accessibility pass — TalkBack labels on keypad and charts; large-font scaling against the density system
- Crash visibility through Play Console vitals (no SDK)
- Store video / demo

## Settled questions

- **Personal** Play developer account — Merope is a personal brand, not a company. The closed test
  (12 testers, 14 consecutive days) is therefore mandatory before production.
- Pricing, starter grant and credit recovery — see [Peace Cloud](#peace-cloud-v11).
- The name stays **Peace**; no finance app by that name turned up on Play. The store title uses the
  30 characters it is allowed for search: "Peace: Expense Tracker".
