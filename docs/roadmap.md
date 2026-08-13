# peace — staged roadmap

Target: everything MyMoney does, plus multi-currency, recurring payments, receipt attachments,
AI-assisted entry (image + voice), and bank-SMS ingestion. Dark theme, similar shape to MyMoney.

Baseline behaviour is documented in [research/mymoney.md](research/mymoney.md).

Ordering principle: **nothing intelligent matters until manual entry is excellent.** AI assist is
a shortcut around typing — if typing is bad, the shortcut just hides it. Stages 4–6 also depend
on 0–3 structurally (you cannot OCR into a record type that does not exist yet).

**All six stages have shipped**, plus two features that were never on this list — Google Drive
backup and portfolio rebalancing. Each stage below keeps its original plan, with a
*"what shipped differently"* note where the work disagreed with it; those notes are the useful part
of this document now.

---

## Stage 0 — Foundations ✅ done

Schema and design system. Cheap now, expensive later — every one of these is a *table-shape*
change, not a column addition.

- ✅ `categories.parentId` — two-tier categories (MyMoney's most-requested gap)
- ✅ `budgets` table keyed by `(categoryId, period)` — replaced the standing `budgetMinor` column
- ✅ `recurring_rules` table
- ✅ `attachments` table
- ✅ Settings: **home currency** (the one all reporting converts to)
- ✅ Transfer modelling: **paired rows**, plus a denormalised `counterAccountId` on both legs so
  the records list renders "Bank → Cash" without a self-join on its hottest query
- ✅ Dark palette ("Ledger") as NativeWind tokens, sourced from `src/constants/palette.js`
- ✅ 5-tab navigation shell: Records · Analysis · Budgets · Accounts · Categories
- ✅ Seed 33 categories (7 of them second-level) + 2 accounts, idempotently
- ✅ **Repository layer** (`src/db/repo/`) enforcing what SQLite cannot express: category depth
  and kind, unsigned-amount-plus-type for records, atomic transfer pairs, derived balances

**Done when:** schema is stable enough that later stages only add columns. — Met. 92 unit tests,
Maestro walks the whole shell.

---

## Stage 1 — Daily driver ✅ done

The point where you can stop using MyMoney. This is the stage that matters most.

- ✅ **Keypad arithmetic** (`src/lib/calculator.ts`) — see the model below
- ✅ **Add record** — one-screen layout, Income/Expense/Transfer switch, account and category
  pickers (two-tier), note. Writes through the repository layer.
- ✅ **Records list** — month navigator, day grouping, EXPENSE/INCOME/BALANCE wired to real data,
  transfers listed once and excluded from the totals
- ✅ **Edit an existing record** — tap a row to reopen it prefilled. Editing cannot convert a
  record into a transfer or back, since that changes how many rows exist.
- ✅ **Date and time picker** — native dialogs, dark-themed. Future dates are allowed: a known
  upcoming bill is a legitimate entry, and Stage 3's recurring rules generate future-dated
  records anyway.
- ✅ **Delete with undo** — the deleted rows are held in memory rather than soft-deleted, so the
  schema stays honest: a deleted record is gone, not hiding behind a filter.
- ✅ **Accounts CRUD** — with a guard: an account holding records cannot be deleted, because
  `account_id` cascades and would take the history with it. Archive instead.
- ✅ **Categories CRUD** — deleting is safe by construction: records survive uncategorised and
  sub-categories are promoted rather than deleted.

### The keypad is an immediate-execution calculator

Confirmed against the reference app, and the model matters more than it looks:

- **No expression is displayed.** Only the current number.
- **Pressing an operator computes what is pending** and replaces the display with the result.
  `120 +` then `35 +` shows `155`.
- **Only one operation is ever pending.** Two operators in a row swaps the operator; the user
  corrected themselves, they did not ask for a calculation.
- **`=` is optional.** Save evaluates anything still outstanding.

Operand semantics are the trap: for `+` and `−` both sides are money, so arithmetic runs in exact
integer minor units. For `×` and `÷` the second operand is a **count** — "25 × 3" is three items at
25 = 75, not 7,500. Results round to the currency's precision after every step so float dust cannot
accumulate across a chain.

**Done when:** you have logged a real week of your own spending in it without reaching for MyMoney.

### Navigation shell (landed early, ahead of Stage 2)

The app icon and the side menu were built before Stage 2 rather than during it, because both are
chrome that every later screen hangs off — retrofitting a hamburger into six finished screens is
worse than putting it there first.

- ✅ **App icon**, generated from one vector definition — see
  [design-system.md](design-system.md#app-icon) for the adaptive/monochrome geometry
- ✅ **Side menu** behind a hamburger, holding Settings, Export & backup, About. The five tabs are
  the app's *content* and stay in the tab bar; the drawer holds what you touch a few times a year.
  Duplicating the tabs into it would only give two answers to "where is Budgets".
- ✅ **Search entry point** in the header
- ✅ **About** — the one destination that is real rather than a placeholder, because the version
  number is the first thing worth knowing when a sideloaded APK misbehaves

Settings, Export and Search are laid out but **not wired**. They belong to Stage 2.

### Polish pass (after nine days of real use)

- ✅ **Split-screen layout.** The record screen is used with a bank notification open beside it, and
  the keypad used to slide off the bottom while the note collapsed to nothing. The amount, keypad
  and date row are now pinned and everything above them scrolls. See
  [design-system.md](design-system.md#density-designing-for-split-screen).
- ✅ **Date and time dialogs in the Ledger palette** — no platform blue left anywhere
- ✅ Account picker shows each account's **balance**, so "which account still has money in it" is
  answerable at the moment of choosing
- ✅ Amounts over a thousand show **separators** while being typed
- ✅ Icon and colour pickers **wrap** instead of hiding two thirds of their options off-screen
- ✅ Picker sheets lost their dark scrim, which flashed in as a slab against the slide animation
- ✅ Accounts and Categories lost their redundant sub-headers — the tab bar already names the screen

- ✅ **One-handed entry.** The keypad's bottom-right key walks the whole record — account, category,
  save — so a spend can be logged without reaching the top of the screen. `=` still finishes a sum
  first, and the key's label says which of the three it will do. See
  [design-system.md](design-system.md#the-keypad-drives-the-record-screen).

Still open from that pass: a **default account** setting (Stage 2's settings screen) and
[credit-card handling](research/credit-cards.md), where the model is now settled and the remaining
work depends on Stage 2's per-record currency.

---

## Stage 2 — Money features ✅ done

- ✅ **Settings screen** — home currency and default account, both wired through to the screens
  that use them. **Only settings that do something are shown**: `carryOver`, `viewMode` and
  `showTotal` are stored but nothing reads them yet, and three switches that silently do nothing
  would be worse than an empty screen — they ship with the features that consume them.
  `src/state/settings.ts` is a write-through cache over the settings table, so a change repaints
  every screen instead of waiting for a restart.
- ✅ **Multi-currency** — a record in an account that does not hold the home currency asks for a
  rate and stores the converted amount alongside the original. Month totals sum the converted
  amount; each account keeps showing what it actually holds.

  Three decisions worth knowing:

  - **The converted amount is stored, not computed.** `amount x rate` is float arithmetic, and
    doing it per row at read time is how drift gets into totals. Money stays integer minor units.
  - **The rate is captured per record.** A purchase made when the dollar was fifty pounds stays at
    fifty forever; re-converting history at today's rate would silently rewrite what last month
    cost.
  - **There is no single cross-currency "all accounts" number.** Valuing a whole balance needs a
    rate for today, and the only rates here belong to individual past records. The screen shows one
    row per currency held — with a single currency, which is the normal case, that is the one line
    it always was.

  The rate is **fetched** from [Frankfurter](https://frankfurter.dev) when a foreign account is
  chosen, and can be overridden by typing. Its **v2** dataset is the one that matters: v1 carries
  only the ECB's 31 currencies, which do not include EGP and would have been useless for the one
  conversion this app actually needs.

  **The network is a convenience, never a requirement.** Every failure path ends with the field
  simply staying manual, and the screen says so. Fetching is triggered by choosing the account, not
  by opening the screen — an effect on mount would put a request in front of every record,
  including the overwhelming majority that need no rate at all. Existing records are never
  re-fetched: their rate is history.
- ✅ **Budgets** — a limit per category per month, with progress bars and an over-budget state.
  Four decisions worth knowing:

  - **Top-level expense categories only.** A limit at any depth needs a rule for what happens when
    a parent and its child both have one, and every version of that rule is invisible until it
    surprises someone. Restricting to the top level makes "a parent's spending includes its
    children" the whole story: a record filed under Coffee lands on Food, nothing is counted twice,
    and the total is always the sum of the rows above it. Income is excluded because a limit on
    money coming in is a target, not a budget, and would need the opposite of every colour.
  - **The first run suggests amounts from what you actually spent.** MyMoney's only affordance is
    "copy from past months", which is useless in the month you start: there is nothing to copy, so
    it opens on a blank screen asking for nineteen numbers you have no basis for. That is the most
    likely reason the feature goes unused. Peace offers an amount per category, rounded **up** —
    a limit rounded down is one you are guaranteed to breach in a month that looks like the last
    three.
  - **A ledger with no complete month still gets an offer.** The average divides by the months that
    contain spending, not by the window, or a three-week-old ledger would suggest a third of what
    the person spends. And when *no* earlier month has data it falls back to the month being
    budgeted — that user, weeks in and never having budgeted, is the entire audience. It is
    deliberately **not** extrapolated to a full month: rent logged on the 2nd would be multiplied by
    fifteen, and a confidently wrong number is worse than a modest one. The screen says which of
    the three bases it used, because the sentence has to change with the number.
  - **TOTAL SPENT is spending against the budget**, not the month's expenses. Adding unbudgeted
    categories in would make it the figure the records screen already shows, and would make "over
    budget" true on any month with a single unwatched purchase. Uncategorised spending, records
    with no home-currency value, and limits written in another currency are each reported on their
    own line rather than silently folded in or dropped.

  Budgets deliberately have **no carry-over**. See the carry-over entry below for why.
- ✅ **Analysis** — a category ring with ranked shares, and income against spending over the last
  six months. Expense and income each get the same chart rather than one getting a chart and the
  other a number.

  Five decisions worth knowing:

  - **The donut is hand-drawn SVG, and the chart libraries are gone.** `victory-native` and
    `@shopify/react-native-skia` were in package.json and *nothing imported them* — while
    `librnskia.so` was **11.7 MB of a 58 MB APK**. Every icon in the app is already an inline
    `react-native-svg` path, so a ring is a few arc commands. The geometry lives in
    `src/lib/analysis.ts` and is unit-tested, which is more than the library would have given.
  - **Percentages always total exactly 100.** Rounding each share independently does not: three
    equal slices give 33.3 three times and a legend summing to 99.9, which reads as a bug on a
    screen whose whole job is accounting for money. The error is distributed by largest remainder,
    ties broken on the earlier index so a legend never reorders itself between two renders of the
    same data.
  - **A single category owning the month is the case a donut cannot draw.** Start and end land on
    the same point, so the naive arc renders *nothing at all*. One full slice is drawn as two
    half-circles instead. Angles come from the amounts rather than the rounded percentages, or the
    ring would show a hairline of background wherever the rounding went.
  - **The roll-up matches Budgets.** Spending under Coffee lands on Food, on both screens, from one
    shared query in `src/db/repo/spend.ts` — two hand-kept copies of a money query is exactly how
    one screen ends up quietly disagreeing with another.
  - **Cash flow is N separate queries, not one `GROUP BY strftime`.** Grouping in SQL needs
    SQLite's `localtime` modifier, which reads the *process* timezone — so the same database would
    bucket differently on a phone set to Cairo and on CI set to UTC, and an 11pm purchase on the
    31st would land in the wrong month. `periodBounds` already gets local calendar boundaries right
    and is tested; six indexed range queries cost nothing next to being correct.

  Uncategorised money and records with no home-currency value are each reported on their own line.
  A donut is a claim to account for a whole, so anything left out of it has to be said out loud.

- ✅ **Carry-over** — but not the one that was planned.

  **Budget carry-over was considered and rejected.** The original idea was MyMoney's: an unspent
  limit grows next month's limit, so E£800 left on a E£2,000 Food budget makes September's E£2,800.
  Written out, it does not survive contact with what a budget *is* — a limit that gets easier every
  time you fail to use it is not a limit. And every question the design forces has no good answer:

  - Does it compound? Chained, a category you rarely touch accumulates without bound — six untouched
    months of E£2,000 is E£14,000 in the seventh, and the progress bar stops meaning anything. Not
    chained, and it is an arbitrary one-month rule dressed up as a principle.
  - Does an overspend carry as a debt? If not, overspending is free and the limit is a suggestion.
    If so, one bad month quietly punishes the next, and the limit has to be floored at zero to stop
    it going negative.

  Both awkward questions exist because the concept fights itself. So budgets keep no memory at all.

  **What actually carries between months is money**, which is a running cash position and needs no
  exceptions. The Records header's third cell shows it: with carry-over on it reads **Now** — what
  you are actually holding — and with it off it reads **Balance**, this month's net, as before. One
  cell either way, because a fourth column or a line beneath the row is a whole extra band of chrome
  above the thing you opened the app to do. The cost is that the month's own net stops being
  printed; it is the difference of the two cells beside it, so both operands stay on screen. The
  Analysis cash-flow strip carries the same figure across six months, turning "was this month
  unusual" into "am I accumulating anything".

  Two decisions worth knowing:

  - **Account opening balances count.** They have no date, so they belong before all time. Leaving
    them out would put the running total permanently below the Accounts screen by however much you
    started with, and neither screen would say why. A foreign-currency opening balance is *reported*
    rather than converted — there is no stored rate for "money that was already there", so any
    conversion would be at a rate nobody chose.
  - **Brought forward + this month's balance = the Accounts total.** That identity is the whole
    reason to trust the figure, and `carry.test.ts` pins it directly rather than testing the two
    sides separately.
- ✅ **Search and filters** — free text across the note, the category and both account names, plus
  filters for type, account, category, amount range and date range. Five decisions worth knowing:

  - **It is not scoped to a month.** The reason to reach for search is that you do not remember
    *when*; the month navigator is already the answer when you do.
  - **An empty query returns nothing, not everything.** Every record ever entered is not a search
    result — it is the records list with its navigator removed, and it is also the slowest thing
    the app could do on the keystroke that clears the field.
  - **The totals are a separate aggregate over every match**, not a sum of the rows on screen. The
    list is capped at 300 (a one-letter search matches most of a ledger), and a cap that quietly
    changed the total would make the total worse than useless. The screen says when it caps.
  - **A parent category matches its children.** Filtering by "Food" and being told there are no
    records — because every one of them is filed under Coffee or Restaurants — is the filter lying
    about the data.
  - **The wildcards are escaped.** SQLite's `LIKE` reads `%` and `_` as wildcards, so an unescaped
    `%` matches the whole ledger while looking exactly like an ordinary search that found more than
    expected. `likePattern` escapes them and every query carries `ESCAPE`.

  Amount bounds are **unsigned magnitudes** matched against `abs(amount_minor)`, because the number
  the user is searching for is the one on the row — an expense reads as "E£250", not "-250".
  Transfers appear once, as the outgoing leg, exactly as the records list shows them, and are
  excluded from the income and expense totals.
- ✅ **Export CSV + backup** — done first, because a month of real records with no way out is a
  worse risk than any missing feature. Both can be **saved to a folder on the device** (Storage
  Access Framework, no permission needed) or sent through the share sheet. Share alone was not
  enough: on a phone with no file manager claiming `text/csv` it offers only Drive and Gmail. CSV carries every record and **both legs of each transfer**
  (unlike the records list, which hides one) so per-account balances in the file add up. The backup
  is a byte copy of the SQLite file, taken after a `wal_checkpoint(TRUNCATE)` — without that it
  would silently omit the newest records, which are the ones you would notice missing.
- ✅ **Restore** — pick a backup and replace everything, with an **Undo** that puts back what was
  there before. Data is copied table by table inside one transaction rather than swapping the
  database file: swapping would need the live connection closed and the app restarted, and would
  carry the backup's migration history with it. Copying keeps this build's schema, so an older
  backup restores fine with newer columns taking their defaults. A backup from a *newer* build is
  refused rather than partly restored.

---

## Stage 3 — Recurring payments ✅ done

Your "Installments" category was 92.9% of August spending and is currently re-typed by hand every
month. This is likely the highest-value feature for you specifically.

- `recurring_rules`: amount, account, category, cadence (RRULE-like), start/end, next-run
- **Lazy catch-up on app open** — materialise any occurrences due since last launch. Simpler and
  far more robust than background scheduling, which Android will kill.
- Review-before-commit for generated records, so a wrong rule cannot silently corrupt history
- Optional reminders via `expo-notifications`
- Due dates on budget items

**What shipped differently.** Three things, each because the plan above fought the domain.

*No separate screen.* Rules were first given a page of their own with its own name, amount and
chip lists — a worse copy of the record screen, and a second place to fix everything twice.
Repeating is now a property you set *while entering the record*, on the screen that already owns
those inputs. The rules screen kept only what a list can do that a form cannot: pause, delete, and
see what is scheduled.

*No `next_run_on` cursor.* Storing progress as a pointer can express "handled up to here" and
nothing finer, so it invented rules the domain does not have — occurrences had to be dealt with in
order, and acting out of order had to be forbidden. Occurrences are independent: **approved is read
from the ledger** (a transaction carries its rule and its date, so its existence *is* the approval)
and dismissed from `recurring_skips`. A proposal is anything in range that appears in neither.

*Occurrence dates are derived from the rule's start by index*, never from the one that fired last.
A monthly rule anchored to the 31st must fire on 28 February and then on **31 March**; deriving
each date from the previous one lets February poison every month after it.

Reminders and budget due dates were dropped — a due row in the list is the reminder, and it is
already the first thing on the screen.

---

## Stage 4 — Attachments ✅ done

Prerequisite for Stage 5's OCR — build the storage layer before the intelligence.

- `expo-image-picker` + `expo-camera`
- Files in `FileSystem.documentDirectory`, path + hash in the `attachments` table (never blobs
  in SQLite — it bloats the DB and slows every query)
- Thumbnail on the record row, full-screen viewer
- Include attachments in backup/export

**What shipped differently.** "Include attachments in backup" turned out to be the whole stage.
The moment a row can point at a file, a backup that copies `peace.db` alone restores a ledger whose
every receipt is a broken thumbnail — on the one day a backup is being used at all. A Peace backup
is now a **zip container**: `peace.db` beside an `attachments/` folder, which keeps the property
that made it a bare `.db` in the first place. Old `.db` backups still restore, decided by reading
the bytes rather than the filename.

`expo-camera` was not needed — `expo-image-picker` covers both the camera and the library.
Files are content-addressed (`<sha256>.<ext>`), and the pre-restore safety copy is a container too,
because a restore sweeps files the incoming ledger does not mention and "undo" would otherwise hand
back rows whose photos had just been deleted.

---

## Stage 5 — AI-assisted entry (Gemini) ✅ done

Decision: **cloud processing via Gemini Flash**, for images and audio alike.

That choice removes two native dependencies. Gemini Flash is natively multimodal — it accepts
image **and audio** input directly — so there is no need for on-device ML Kit OCR, and no need for
`expo-speech-recognition`. The app just uploads the capture and receives structured JSON.

- **Receipt capture → prefilled record.** Photo goes straight to Gemini; response is structured
  via `responseSchema` (JSON Schema, so a **Zod schema can be reused directly** as both the API
  contract and the runtime validator).
- **Voice entry.** Record audio, send it, get the same structured record back. *"Forty two pounds
  on lunch at Cilantro yesterday"* → a filled form.
- Both must **prefill a form you approve**, never write silently. Confirmation is where trust in a
  ledger comes from — and it is also the cheapest guard against a hallucinated amount.
- **Offline behaviour must degrade, not break.** No network → the normal manual form, unchanged.
  Queue captures for later processing rather than blocking entry.

**Cost is a non-issue at personal scale.** A receipt is on the order of a fraction of a cent, and
the free tier (100–1,000 requests/day depending on model) very likely covers your usage outright.
Flash-Lite is ~5× cheaper than 3.6 Flash if it proves accurate enough on receipts — worth
measuring rather than assuming.

### API key handling — user-supplied, no backend

**The key is never in the APK.** It is entered by the user in Settings after install and stored
with `expo-secure-store` (Android Keystore), then read at call time.

This removes the need for a proxy entirely:

- Nothing sensitive ships in the build, so the APK can be shared or rebuilt freely
- No server to host, pay for, or keep alive — the app stays genuinely local-first
- Prompts live in JS, so **EAS Update** ships prompt and model changes over the air without a
  rebuild or reinstall — which was the only remaining argument for a proxy

Requirements this creates:

- Settings screen with a "Gemini API key" field, validated by a cheap test call
- Every AI feature must be **disabled and clearly explained** when no key is set, never a silent
  failure or a crash
- Surface the model name as a setting too, so switching between Flash and Flash-Lite is a
  preference rather than a code change

**What shipped differently.**

*Voice was dropped, not deferred.* Photographing a receipt answers the same question better, and a
second capture path would have been a second set of parsing rules to keep honest for a shortcut
nobody reached for.

*No Zod.* `responseSchema` is a plain object and the runtime validation is hand-written in
`lib/receipt.ts`, because the interesting cases are not "is this a number" but "is this number a
plausible receipt total" — a range check, a real-calendar-date check, and a cap on string length.
A schema library would have validated the shape and passed all of them.

*The model list is fetched, not typed.* A free-text model name is a 404 waiting to happen, so
Settings offers what the key can actually call, filtered on `generateContent`.

*The key is validated by using it, not by a test call.* An invalid key comes back as
**400 INVALID_ARGUMENT**, not 401 — Google puts the real reason in `error.details[].reason`, and
reading it is what lets the app blame the key rather than the model name.

---

## Unplanned, and shipped anyway ✅ done

Two features that were never on this roadmap and earned their place mid-flight.

**Google Drive backup.** Contradicts local-first on its face, which is why it is optional and why
the file is sealed on the device before it leaves: a passphrase, scrypt, AES-GCM, and everything
needed to open it travelling *inside* the file. The first version generated a random key instead —
cryptographically stronger and useless, because that key lives in the device's secure store and the
one scenario backups exist for is the one where the device is gone. Uploads go to `appdata`, a
folder invisible in Drive and reachable by nothing but this app, which is also why restoring *from*
Drive had to exist: otherwise the backups would be readable by no software on earth.

**Portfolio rebalancing.** A separate ledger with its own tables that never touches money — asset
classes with targets in basis points, holdings in micro-units, and a plan that says what to buy.
Kept deliberately apart from the expense ledger rather than integrated: they answer different
questions, and joining them would have made every total on every screen ask "which of the two do
you mean".

---

## Stage 6 — Bank notification ingestion ✅ done

Approach: **Android `NotificationListenerService`**, not `READ_SMS`.

This is the better mechanism regardless of store policy, for one reason that matters more than
permissions: **banks increasingly push through their own apps rather than SMS.** A notification
listener catches bank app pushes *and* SMS (the messaging app posts a notification carrying the
message), so it is strictly broader coverage from a single hook.

- `expo-android-notification-listener-service` exists as a third-party Expo module. It is small
  and niche — expect to vendor or fork it. Needs a dev build.
- **Read `EXTRA_BIG_TEXT` first, fall back to `EXTRA_TEXT`.** `EXTRA_TEXT` is the collapsed
  one-line form and truncates; `EXTRA_BIG_TEXT` carries the full body (up to 5120 chars) whenever
  the poster used `BigTextStyle`, which messaging apps and bank apps normally do. Reading only
  `EXTRA_TEXT` is the classic way this feature silently loses half of every message.
- Filter by source package + sender allowlist, so only known banks are ever parsed
- Per-bank regex templates for known formats — fast, free, offline, deterministic
- **Gemini fallback** for unrecognised formats; once parsed, offer to save a template so that
  sender never needs the LLM again
- Suggested records land in a review queue; **never auto-commit**

Trade-offs to accept:

- Permission is granted through a special system settings screen rather than a normal dialog. It
  is a one-time step and can be deep-linked, but it needs real onboarding copy.
- Nothing is captured if bank notifications are muted, or if the listener service is killed —
  so this must stay a convenience layered on manual entry, never the system of record.
- Keeps the Play Store door open if distribution ever changes, since no restricted permission is
  involved. `READ_SMS` would have closed it permanently.

**What shipped differently.**

*No per-bank regex templates.* They work on the four messages you tested with, and the fifth is a
template the bank rolled out on a Tuesday — so there is one parsing path and it is the model.
Everything it returns is range-checked and dropped if it does not survive, and the DIRECTION is read
from the message's words rather than inferred, because inferring it is how a refund becomes income.

*SMS only, not bank apps.* The plan argued for catching bank-app pushes too. In practice the filter
asks Android which app owns SMS and captures only that: one source, one shape of text, and no
guessing about which of a bank app's notifications are transactions.

*No review queue screen.* Captured messages are grey rows in the records list, exactly like a
recurring occurrence — same thing, waiting for the same decision. The raw message lives in the
long-press sheet, which is where the question "did it read this right" is actually asked. A separate
screen was a second inbox to remember to visit.

*The date is never parsed.* Android stamps the notification to the second and a bank alert arrives
when the money moves, so the model is not asked for a date at all.

*A local Expo module, not the third-party one.* `expo-android-notification-listener-service` was
last published well before SDK 57. The surface needed is four functions and a service.

*Three triggers, not one.* Launch and foreground both leave the case that gets noticed — a message
arriving while you are looking at the screen it belongs on. The native side signals the capture, via
a `SharedPreferences` listener on the store the service writes to.

**The cost, which the plan did not anticipate:** Play Protect **hard-blocks** the sideloaded APK
because the app declares notification access. There is no manifest change that avoids it while the
feature exists. `adb install` or pausing Play Protect gets past it; the Play Store door the plan kept
open is the only real escape, and it is still open.

---

## Decisions made

| Decision | Choice | Consequence |
|---|---|---|
| Distribution | **Personal use / sideload** | No store policies, no privacy-policy or data-safety declarations. iOS effectively out of scope. |
| AI processing | **Cloud, Gemini Flash** | Images and audio leave the device. No ML Kit, no on-device STT. Structured output via `responseSchema` + Zod. |
| API key | **User-supplied, in Settings** | Nothing secret in the APK. No proxy, no server. Key in `expo-secure-store`; prompts shipped via EAS Update. |
| Bank ingestion | **Notification listener**, not SMS | Broader coverage (bank apps *and* SMS). No restricted permission, so Play stays possible later. |

Since distribution is sideload-only, releases are just APKs — either `npx expo run:android
--variant release`, or EAS internal distribution if you want install links on your phone.

---

## Sequencing summary

| Stage | Theme | Depends on | Network needed |
|---|---|---|---|
| 0 | Schema + design system | — | no |
| 1 | Daily driver | 0 | no |
| 2 | Multi-currency, budgets, analysis | 1 | no (optional FX fetch) |
| 3 | Recurring payments | 0, 1 | no |
| 4 | Attachments | 1 | no |
| 5 | OCR + voice (Gemini) | 4 | **yes** |
| 6 | Notification ingestion | 1 | only for unknown formats |

Stages 0–4 need no network and no API key — the app is fully local-first and offline through the
entire core product. Stage 5 is the first network dependency, and it is an enhancement that must
degrade gracefully rather than a requirement.
