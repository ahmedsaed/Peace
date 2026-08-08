# peace — staged roadmap

Target: everything MyMoney does, plus multi-currency, recurring payments, receipt attachments,
AI-assisted entry (image + voice), and bank-SMS ingestion. Dark theme, similar shape to MyMoney.

Baseline behaviour is documented in [research/mymoney.md](research/mymoney.md).

Ordering principle: **nothing intelligent matters until manual entry is excellent.** AI assist is
a shortcut around typing — if typing is bad, the shortcut just hides it. Stages 4–6 also depend
on 0–3 structurally (you cannot OCR into a record type that does not exist yet).

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

## Stage 1 — Daily driver 🚧

The point where you can stop using MyMoney. This is the stage that matters most.

- ✅ **Keypad arithmetic** (`src/lib/calculator.ts`) — see the model below
- **Add/edit record** — one-screen layout, Income/Expense/Transfer switch, account and category
  pickers, note, date/time
- **Records list** — month navigator, day grouping, EXPENSE/INCOME/BALANCE header wired to data
- Accounts CRUD, Categories CRUD (two-tier), Transfers
- Delete/edit with undo

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

---

## Stage 2 — Money features

- **Multi-currency** — per-account currency, per-record currency + `fxRate`, all reporting
  converted to home currency. Manual rate entry always available; optional rate fetch on top.
- **Budgets** — per month, "copy from last month", progress bars, over-budget states
- **Analysis** — donut by category, ranked bars with %, cash-flow over time, **carry-over**
- Search and filters
- **Export CSV + backup/restore** — MyMoney parity, and your safety net for switching

---

## Stage 3 — Recurring payments

Your "Installments" category was 92.9% of August spending and is currently re-typed by hand every
month. This is likely the highest-value feature for you specifically.

- `recurring_rules`: amount, account, category, cadence (RRULE-like), start/end, next-run
- **Lazy catch-up on app open** — materialise any occurrences due since last launch. Simpler and
  far more robust than background scheduling, which Android will kill.
- Review-before-commit for generated records, so a wrong rule cannot silently corrupt history
- Optional reminders via `expo-notifications`
- Due dates on budget items

---

## Stage 4 — Attachments

Prerequisite for Stage 5's OCR — build the storage layer before the intelligence.

- `expo-image-picker` + `expo-camera`
- Files in `FileSystem.documentDirectory`, path + hash in the `attachments` table (never blobs
  in SQLite — it bloats the DB and slows every query)
- Thumbnail on the record row, full-screen viewer
- Include attachments in backup/export

---

## Stage 5 — AI-assisted entry (Gemini Flash)

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

---

## Stage 6 — Bank notification ingestion

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
