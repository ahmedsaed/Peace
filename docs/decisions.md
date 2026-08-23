# Why Peace behaves the way it does

Every row below is a decision that cost something to make — usually a bug that reached a screen, or
a design that kept forcing awkward questions until the premise was re-read. They are collected here
so the README can stay about the app, and so a future session can pick the work up without
re-deriving an answer that was already paid for.

Two different kinds of difference, kept apart on purpose: what Peace closes that its reference app
leaves open, and what Peace simply chooses to do differently.

The engineering rules these decisions produced live in [AGENTS.md](../AGENTS.md); the staged plan
they came out of is [roadmap.md](roadmap.md).

## Gaps in MyMoney that Peace closes

Verified from screenshots of v6.6 and corroborated by its reviews — see
[docs/research/mymoney.md](research/mymoney.md). Nothing here is a guess about a
competitor.

| Gap in MyMoney | Peace | State |
|---|---|---|
| **No sub-categories** — one flat level, its most-requested feature | Two-tier categories, enforced at the repository layer so a sub-category can never sprout children of its own | ✅ shipped |
| **No recurring transactions** — "Installments" is a *category*, re-typed by hand each month | Rules set while entering the record; occurrences proposed in the list and approved, edited or dismissed | ✅ shipped |
| **No receipt attachments** | Photograph or attach one per record, content-addressed and carried inside the backup | ✅ shipped |
| **No assisted entry** | Read a photographed receipt with Gemini and fill in the form | ✅ shipped |
| **No bank-message ingestion** — every record typed by hand | Bank SMS notifications are read and offered as records to approve | ✅ shipped |
| **No interest rate** on loan accounts | `interestRate` column exists on the schema | column only, no UI |
| **No multi-device sync** | Also none, deliberately — the ledger stays on the phone | by design |

## Choices Peace makes differently

Not claims about what MyMoney lacks — these are decisions about how this app should behave.

| | Why it exists |
|---|---|
| **One-handed entry** | The pickers sit at the top and the keypad at the bottom, so the bottom-right key walks the whole record — account, category, save. `=` still finishes a sum first, and the key's label says which of the three it will do. |
| **Split-screen as a supported layout** | Records get logged with a bank notification open beside the app, leaving ~340dp of height. The keypad is pinned and everything above it scrolls; below 520dp the pickers collapse to icons and the note joins them on one line. |
| **Per-record exchange rates** | A foreign purchase stores the settled amount, the rate used, *and* which home currency it was converted to. A purchase made when the dollar was fifty pounds stays at fifty forever. |
| **No invented cross-currency total** | Valuing a whole balance needs today's rate, and the only rates here belong to past records. The accounts screen shows one line per currency held rather than one authoritative-looking number. |
| **Undo after restoring a backup** | Restoring parks the previous state first, so recovering from a mistaken recovery is one tap. A backup you cannot get back out of is only half a safety net. |
| **CSV carries both legs of a transfer** | The records list hides one leg so a transfer doesn't look like double spending; the export is a copy of the ledger, so per-account balances in the file add up. |
| **No chart library** | The category ring is a few arc commands in `react-native-svg`, which every icon already uses. `victory-native` and `@shopify/react-native-skia` were dependencies nobody imported, and `librnskia.so` was 11.7 MB of a 58 MB APK. The arithmetic that replaced them is unit-tested — including that the percentages always total exactly 100, and that one category owning the whole month still draws a ring rather than nothing. |
| **Budgets that suggest themselves** | MyMoney's only way to start a month is "copy from past months", which is useless in the month you start — there is nothing to copy, so it opens on a blank screen asking for nineteen numbers you have no basis for. Peace offers a limit per category derived from what you actually spent, rounded up, and says whether it is averaging real months or falling back to this one. |
| **Search totals what it found** | Matching rows with no total leaves you adding them up by hand, and "how much did I spend on coffee" is the question behind most searches. The total is a separate aggregate over *every* match, so capping the list at 300 rows never changes the number above it. |
| **A parent category matches its children** | Filtering by "Food" returns the records filed under Coffee and Restaurants. Being told there are none, because they are all one level down, is the filter lying about the data. |
| **Refunds net against what they reverse** | Return E£800 of shoes and log it as Income — which is what a "Refunds" income category invites — and the month reports E£800 more income than you earned *and* E£800 more expense than you spent. The net is right, which is why the bug survives; every category breakdown is a lie. A refund in Peace is a positive amount on the expense side, so Clothing simply reads E£800 less. Long-press the purchase it reverses and the account and category come with it. |
| **A card reads as debt, not an emptied wallet** | A credit card at −E£5,000 is five thousand *owed*, shown unsigned beside the headroom left on its limit. The stored sign never changes, so net worth stays a plain sum across every account — this is the render boundary only. |
| **Balance corrections that are not spending** | Cards drift: the bank's rate differs, a fee posts, a record is missed. You type what the bank shows — outstanding *or* available, since banking apps disagree about which they display — and Peace writes a dated correction for the difference. It moves your balance and running total and never touches income, expense, budgets or the charts. Counting a correction as spending is what drops phantom expenditure into whichever month you happened to reconcile in. |
| **Card fees live on the card** | Credit limit, foreign-transaction fee and cash-withdrawal fee are per-account and optional, stored as basis points so a percentage never becomes a float multiplied by money. There is no "Kenana mode": one bank's rules baked into the app is a rule every other card then has to be excused from. |
| **Budgets have no carry-over** | An unspent limit rolling into next month is the feature MyMoney offers and Peace deliberately does not. A limit that gets easier every time you fail to use it is not a limit — and every question it forces (does it compound? does an overspend carry as a debt?) has no good answer, because the idea fights itself. What carries between months is *money*: the Records header's third cell reads **Now** — what you are actually holding — instead of this month's net, and that figure reconciles exactly with the Accounts total. |
| **Settings that do nothing are not shown** | A control for a preference nothing reads is a switch that silently does nothing, which is how an app teaches you to stop trusting it. Each row lands in the same change as the code that honours it. `viewMode` — a daily/weekly/yearly range — was declared early and **deleted rather than wired**: the app turned out to be month-shaped in a way it fought, since budgets are keyed by month and carry-forward runs month to month. A preference the design has outgrown is worse than none. |
| **The backup carries the receipts** | The moment a row can point at a file, the backup stops being the database. A Peace backup is a zip holding `peace.db` beside an `attachments/` folder — so it still opens without this app, which is why it was a bare `.db` to begin with. The manifest records how many receipts were packed and the restore *checks* it: a truncated archive still unzips, and restoring one would delete the originals and report success. |
| **Receipts are content-addressed** | A file is stored as `<sha256>.<ext>`, which buys three things at once: the same receipt attached twice is one file, a name a file manager supplied never reaches the disk or the archive, and a file cannot change under its own name. Two records can share one receipt, so deleting a row never deletes a file — only the ledger decides that. |
| **The prompts are yours to edit** | Settings carries the FINANCE half of each prompt — what a "total" means, which card is which, what to ignore — while the output contract stays in code. That split is the point: an editable instruction that could break the JSON shape would turn a bad sentence into an unparseable reply. Peace appends your own account and category names, so an instruction like "the card ending 0042 is Kenana" has something real to resolve to, and the record lands on the card that was actually charged with its currency and its fees. |
| **The model is a typist, not an accountant** | Gemini reads a receipt into *structured output*, never prose, and everything it returns is range-checked and dropped if it fails. A receipt whose date is unreadable but whose total is clear still fills in the total. Your API key lives in the device keystore, never in the settings table — that table travels inside every backup. |
| **The build identifies itself, and says when a newer one exists** | Settings → About shows `1.3.0 (build 130)` and the commit, marked `-dirty` if it was built from uncommitted code. The drawer checks the Releases page once a day and adds one quiet line when a **strictly newer build** is published — nothing otherwise, and nothing at all when the check fails. It compares build numbers rather than versions, because installing from a PR build routinely leaves you *ahead* of the latest release, and `1.0.0` has been released five separate times. |
| **Bank alerts are read, not your inbox** | Android hands over the notification the messaging app already showed — the same text you read off a lock screen. No `READ_SMS`, no conversation history, and nothing captured from any app but the one that owns SMS. The sender list **starts empty and reads nothing**, so granting the permission does not send every text you receive to Google. A captured message lands in the records list as a grey row like a recurring one, in no total, until you approve it. |
| **Cash out of a machine is a transfer** | A withdrawal has not been spent — it is spent later, one purchase at a time. Recorded as an expense it would be counted twice, so the month reads high and the cash account never fills. The reader asks for it as its own field and the record opens as a transfer into your cash account. |
| **What was read goes in the note, and so does what was received** | A receipt fills in the shop *and* its contents, line by line, because a total three months old says what a record cost and only the basket says what it was. A bank message keeps its own words under the merchant — which is the whole note when the reading fails, so the text is never lost at the one moment it becomes permanent. |
| **Your rules, not the app's wiring** | Settings carries the *finance* half of each prompt — which card is which, a charge that should not count. The output contract stays in code, because an editable instruction that could break the JSON shape turns a bad sentence into an unparseable reply. The box starts empty; the prompt is complete without it. |
| **A notification's own timestamp beats a parsed date** | The model is never asked when a transaction happened. Android stamps the arrival to the second and a bank alert arrives when the money moves, so the exact answer is already in hand — where `13/08/2026` is a valid date under two conventions and picking the wrong one cannot be spotted afterwards. |
| **Daily totals net the day** | Each day's heading carries what that day did to your position. Transfers are left out — the day you moved savings across should not read like the day you spent them — and corrections are left in, because they moved real money. It uses the same home-currency expression as the month total above it, so the two cannot drift. |

Where Peace is still **behind**: nothing it set out to close.
