# Reference app: MyMoney

`peace` exists because MyMoney does most things right but is missing features. This document
records what MyMoney actually does, based on **8 screenshots of the running app (v6.6-free)**
plus store listings and user reviews.

- **App:** MyMoney—Track Expense & Budget
- **Package:** `com.raha.app.mymoney.free` ([Play Store](https://play.google.com/store/apps/details?id=com.raha.app.mymoney.free))
- **Developer:** Ananta Raha · ~2.6M downloads · 4.78★ (65k ratings)
- **Version observed:** 6.6-free, dark theme, currency EGP (`E£`)

Screen observations are first-hand. Anything about *internals* is inference and marked ⚠️.

## Information architecture

Five bottom tabs, plus a hamburger drawer:

```
Records  ·  Analysis  ·  Budgets  ·  Accounts  ·  Categories        [drawer]
```

Drawer holds only meta: Preferences · Export Report · Backup & Restore · Delete & Reset ·
Pro version · Like · Help · Feedback. **No sync, no account, no login** — it is genuinely offline.

A **month navigator** (`‹ August 2026 ›`) is a persistent header on Records, Analysis and Budgets.
Accounts and Categories instead show an all-time header. This is the app's spine: almost
everything is scoped to a single month.

## Screen by screen

### Records — the default tab

- Header: month navigator + **EXPENSE / INCOME / BALANCE** trio, colour-coded (red / green / green)
- A filter icon (top right) opens **Display options** (below)
- Body: transactions **grouped by day**, with day headings like `Aug 06, Thursday`
- Each row: colored circular category icon · category name · account chip · optional note in
  `" quotes "` · signed amount, right-aligned and colour-coded
- **Transfers render as a single row** — blue arrows icon, and `Bank → Credit Card` inline where
  the account chip normally sits
- Floating `+` action button, bottom right

### Analysis

- Same month header
- A collapsible **EXPENSE OVERVIEW** selector (implies an income counterpart)
- **Donut chart** with a colour legend of categories
- Below: a ranked list — icon, category, amount, **progress bar**, and **percentage of total**
  (e.g. Installments 92.90%)

### Budgets

- Month navigator + **TOTAL BUDGET / TOTAL SPENT**
- Section `Budgeted categories: Aug 2026`
- Empty state: *"Set budget-limits for this month, or copy your budget-limits from past months."*
- Section `Not budgeted this month` — every category with a `SET BUDGET` button

**Budgets are per (category, month)**, not a single standing limit. The "copy from past months"
affordance exists precisely because each month starts empty.

### Accounts

- Header: `[ All Accounts E£23,475.80 ]` with all-time **EXPENSE SO FAR / INCOME SO FAR**
- Account cards: icon, name, `Balance:` value, `···` overflow menu
- `ADD NEW ACCOUNT` button
- Observed: Bank 7,738.98 + Credit Card 15,736.82 = 23,475.80 — the header is a plain sum

### Categories

- Two flat sections: **Income categories** then **Expense categories**
- Each row: colored icon, name, `···` menu
- Income set observed: Awards, Coupons, Grants, Loan, Lottery, Refunds, Rental, Salary, Sale
- Expense set observed: Baby, Beauty, Bills, Car, Cash, Clothing, Food, Transportation,
  Entertainment, Telephone, Installments, Unknown

**A category is income XOR expense** — they are separate lists, never mixed. And the list is
**completely flat**: this is the confirmed absence of sub-categories.

### Add record — the most important screen

This is the highest-frequency interaction in the app and the thing most worth copying precisely.

```
CANCEL                                    SAVE
      INCOME  |  ✓ EXPENSE  |  TRANSFER
   [ Account ]            [ Category ]
   ┌──────────────────────────────────┐
   │ Add notes                        │
   └──────────────────────────────────┘
   ┌──────────────────────────────────┐
   │                          0    ⌫  │
   └──────────────────────────────────┘
   ┌────┬────┬────┬────┐
   │ +  │ 7  │ 8  │ 9  │
   │ -  │ 4  │ 5  │ 6  │
   │ ×  │ 1  │ 2  │ 3  │
   │ ÷  │ 0  │ .  │ =  │
   └────┴────┴────┴────┘
      Aug 07, 2026    |    7:14 PM
```

Things worth noting:

1. **The keypad is a calculator, not a number pad.** `+ − × ÷ =` are first-class. You can enter
   `120+35` at the till without doing mental arithmetic. This is the single best idea in the app.
2. **Type selector is the top-level control** — Income / Expense / Transfer switches the whole
   form's meaning. Choosing Transfer must swap the Category picker for a destination Account.
3. **Everything is on one screen.** No wizard, no scrolling. Account, category, note, amount,
   date and time are all reachable without leaving.
4. **Date and time both default to now** and sit at the bottom as quiet, tappable text — present
   but never in the way.
5. Amount starts at `0` with a dedicated backspace.

### Display options (filter icon)

| Setting | Values |
|---|---|
| View mode | DAILY · WEEKLY · **MONTHLY** · 3 MONTHS ★ · 6 MONTHS ★ · YEARLY ★ |
| Show total | YES / NO |
| Carry over | **ON** / OFF |

★ = Pro-gated. **Carry over**: *"monthly surplus will be added to the next month."* That is a real
budgeting behaviour, not cosmetic — an unspent surplus rolls forward.

## Design language

Eyeballed from screenshots — approximate, to be refined when we pick our own palette.

| Role | Approx. | Notes |
|---|---|---|
| Background | `#2E2E2B` | warm near-black, never pure black |
| Surface / header | `#4A4A44` | olive-grey, distinctly warm |
| Primary text | `#F5F2C8` | cream, not white |
| Accent (logo, active tab) | `#F5E85C` | bright yellow |
| Expense | `#F08878` | salmon, softer than pure red |
| Income | `#7DC98A` | muted green |
| Transfer | `#5B9BD5` | blue — a *third* semantic colour |
| Muted text | `#A8A89C` | |

The whole palette is warm and low-contrast; it reads as calm rather than clinical. Category icons
are saturated colored circles with flat white glyphs and a subtle long-shadow — they carry nearly
all the colour, letting the chrome stay neutral. The wordmark is a script face, the rest is a
geometric sans.

**Transfer being its own colour matters**: money moving between your own accounts is neither
income nor expense, and the UI never pretends otherwise.

## Confirmed gaps

Verified absent in the screenshots, and corroborated by reviews:

1. **No sub-categories.** Categories are one flat level. Most-requested feature in reviews.
2. **No recurring transactions.** Note that "Installments" is a *category*, not a schedule — the
   user is re-entering these by hand every month.
3. **No multi-device sync.** Drawer offers only local Backup & Restore and Export Report.
4. **No due dates / bill reminders** on budgets.
5. **No interest rate** on loan-type accounts (from reviews).

## Implications for our schema

Against [`src/db/schema.ts`](../../src/db/schema.ts) as it stands:

| Concern | Status |
|---|---|
| `categories.kind` = income \| expense | ✅ correct — matches the two-list split exactly |
| `categories.icon` + `color` | ✅ present |
| Signed `amountMinor` | ✅ correct — makes the EXPENSE/INCOME/BALANCE header one query |
| Per-transaction `currency` + `fxRate` | ✅ we exceed MyMoney here |
| **Sub-categories** | ❌ needs `categories.parentId`, depth capped at 2 |
| **Recurring rules** | ❌ needs a new table |
| **Budgets per (category, month)** | ⚠️ currently a single `budgetMinor` column — needs to become a `budgets` table keyed by period |
| **Transfer modelling** | ⚠️ see below |

### The transfer decision

MyMoney renders a transfer as **one row**. Our schema currently uses `transferPairId`, i.e. two
rows (one negative on the source, one positive on the destination).

- **Paired rows** keep per-account balance a trivial `SUM(amount_minor) WHERE account_id = ?`,
  but the Records list must collapse pairs, or it shows every transfer twice.
- **Single row** with `accountId` + `toAccountId` renders naturally, but every balance query has
  to handle both directions.

I lean toward keeping paired rows and rendering only the outgoing leg, because ledger integrity
is worth more than list simplicity — but this should be decided before screens are written
against it, since it is a table-shape change rather than a column addition.

## What I'd copy, and what I'd change

**Copy:** the calculator keypad; one-screen entry; the persistent month navigator; the
Income/Expense/Transfer top-level switch; the three-colour semantic system; day-grouped records.

**Change:** two-tier categories; recurring rules; budgets that can carry due dates. Those are the
three features that made you build this, and none of them are cosmetic — all three are schema.

## Open questions

- Which of the five gaps matters most to you? That should set the build order.
- Do you want to keep MyMoney's warm dark palette, or is this a chance to design your own look?
- Is EGP your only currency, or do you need the multi-currency support the schema already allows?
