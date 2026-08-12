# Credit cards

Why the card account drifts in MyMoney, and what Peace should do instead.

Status: **partly built.** Written after nine days of real use, before Stage 2; the first slice
shipped after it.

| # | Change | State |
|---|---|---|
| 1 | Liability balances shown as **owed**, with available credit | ✅ shipped |
| — | **Balance corrections** — an adjustment that moves the balance and never spending | ✅ shipped |
| — | Per-card **fee profile** (limit, foreign %, cash %) rather than one bank's rules in the app | ✅ shipped |
| 2 | **Refund** as a negative expense against the original category | ✅ shipped |
| 3 | **"Pay this card"** — became a prefill on the transfer, not a button | ✅ shipped |
| 4 | `statementDay` / `dueDay` and a derived statement view | **not planned** — see below |
| 5 | Foreign purchases store the settled amount, fee computed from the card | ✅ shipped |

Two things the shipped slice settled that this document had left open:

- **Corrections are their own kind of row**, not an income or expense with a special category. They
  move the balance and the running position and are excluded from income, expense, budgets and the
  category charts. There are now two reasons a row is not ordinary spending — a transfer leg and an
  adjustment — with *different* consequences, so the rules live once in `src/db/repo/predicates.ts`
  rather than being written out at each of the six queries that need them.
- **A card is set up with its credit limit, not an opening balance.** Whatever is already owed
  arrives through "Update balance" as a dated correction: visible in the list, questionable later,
  deletable. An undated number quietly sitting under the account name is a bad place to keep a debt.
  The reconcile sheet accepts *either* the outstanding balance or the available credit, because
  banking apps disagree about which they show and doing the subtraction yourself, at the moment you
  are fixing an error, is how a correction becomes a second error.

---

## The one rule everything follows from

> **A credit card changes _which account_ moved. It never changes _whether_ something
> was an expense.**

Every credit-card bug in a personal finance app is a violation of that sentence. Once it holds,
the monthly totals stop drifting on their own.

## A card is a liability, not a wallet

Cash and bank accounts are assets: the balance is money you have. A credit card is the mirror
image — the balance is money you **owe**. Peace's schema already handles this without any change,
because a balance is `SUM(amount_minor)` and a card purchase is negative like any other spend:

```
Bank      +20,000
Card       −5,000      (five thousand owed)
          ────────
Net worth  15,000      ← correct: assets minus liabilities
```

`accounts.type` already has `'card'`, so nothing structural is missing. What is missing is that
the UI presents `−E£5,000` as if the card were an emptied wallet.

## The four things that actually cause drift

### 1. Paying the bill logged as an expense — double counting

This is the big one. Buying a E£300 dinner on the card is an expense on the day you eat. Paying
the statement three weeks later is **not** a second E£300 of spending; it is money moving from
bank to card. Log it as an expense and August shows E£600 of dinner.

Peace already models this correctly: a bill payment is a **Transfer**, Bank → Card. Transfers are
two rows sharing a `transfer_pair_id` and are excluded from income and expense totals by
construction — see the invariant comment in `src/db/schema.ts`.

So the mechanism exists and the discipline is the only gap. Proposed fix is discoverability, not
plumbing: on a card account, offer **"Pay this card"**, which opens the record screen pre-filled as
a transfer into that card for the amount outstanding.

### 2. Refunds logged as income — inflated both sides

Return a E£800 pair of shoes and the money comes back to the card. Logged as Income, that month
now reports E£800 more income than you earned and E£800 more expense than you spent. Both totals
are wrong, the net is right, and every category breakdown is a lie. The seeded **Refunds** income
category is the MyMoney way of doing this, and it is where a good chunk of the drift comes from.

A refund is a **negative expense against the original category**. Clothing should read E£800 less,
not Income E£800 more.

This is the one change that needs repository work. `createRecord` currently takes an unsigned
amount plus a type and derives the sign, which is a deliberate guard. A refund needs an expense-kind
row whose `amount_minor` is positive. That is a small, contained relaxation — the guard becomes
"expense rows are negative **unless** explicitly flagged a refund" — but it must be tested hard,
because a sign bug here is exactly the class of quiet corruption the repository layer exists to
prevent.

**Open question: are your refunds usually reversals of a specific purchase, or standalone credits?**
If they are usually tied to a purchase, linking the refund to the original record is worth the
extra column — it makes "show me what this actually cost" answerable, and lets a full reversal be
one tap. If they are mostly standalone, a plain flag is enough.

### 2b. The charge that gets taken and then given back — Murabaha

The specific card in use is **Banque Misr Kenana**, which is an *Islamic* card running on
"Murabaha covered by Wakala". That is not a variant of interest, it is a different contract, and it
is why the behaviour looks strange in a tracker.

In a Murabaha the bank buys the goods and resells them to you at cost plus a **fixed mark-up**,
payable over time. The mark-up has to be fixed and known upfront — a charge that accrues with
elapsed time would be interest, which is the thing being avoided. So the bank books the whole
marked-up amount as debt the moment a transaction is treated as Murabaha. Settle early and it
returns the unearned portion. That rebate has a name too: **ibra'**.

**So yes, this is common.** It is standard for Islamic cards, not a quirk of one bank.

From the published Kenana terms:

- **3% monthly** Murabaha rate, applied *only* if the full statement balance is not settled by the
  26th of the following month. Pay in full and "the Murabaha process is not carried out".
- Grace period **up to 56 days**
- International transactions: **3% of transaction value**
- Cash withdrawal in Egypt: 5%, minimum EGP 50
- Minimum payment = the Murabaha premium

The observed behaviour — money taken, then returned once settled — is consistent with the bank
booking the Murabaha *provisionally* and reversing it on full settlement. The published terms
describe the end state; the statement shows the intermediate one.

**The distinction that fixes the ledger.** There are two kinds of "extra money" on this card and
they are not the same thing:

| | What it is | Comes back? | How to record it |
|---|---|---|---|
| 3% foreign commission, 5% cash fee, annual fee | a real, permanent cost | never | expense, `Bank fees`, on the card |
| provisional Murabaha premium | the bank's booking, not your spending | yes, on settlement | see below |

Recording the second as an expense and its reversal as income is *precisely* what makes the monthly
totals drift: one month inflated, the next credited back as income that was never earned.

### 3. Foreign purchases settled at the bank's rate

A card in EGP used abroad shows one number at the till and a different number on the statement,
because the bank applies its own rate plus a fee, days later.

The rule: **the amount that moves the card account is the settled amount in the card's currency.**
The original currency and amount are metadata hanging off the record, useful for "what did this
cost in euros" and nothing else. Store the foreign amount as the account movement and the card
balance can never agree with the statement — that is a guaranteed, permanent drift.

This lands with Stage 2's per-record `currency` + `fxRate`, so the card case needs no extra
machinery, only the rule written down before the code is written.

### 4. Statement period versus calendar month

"What did I spend in August" and "what is on the August statement" are different questions, and
mixing them is the last source of confusion. Peace's month view is spend-based, keyed on the
transaction date, and that should stay the primary view — it is the honest answer to "where did the
money go".

The statement view is presentation only: give card accounts a `statementDay` and `dueDay`, and
derive "current statement" from transaction dates on the account screen. **Never a second stored
balance.** Two stored numbers for one account is how they get to disagree.

## What this means for interest and fees

Genuine expenses, on the card account, in a normal category. No special handling — interest is
money that left, and it left through the card.

---

## Proposed slice

Ordered by how much drift each removes per unit of work:

| # | Change | Where |
|---|---|---|
| 1 | Show liability balances as **owed** — positive number, expense colour. Sign in the database never flips; presentation only. | UI |
| 2 | **Refund** as a negative expense against the original category, replacing the Refunds income category | repo + record form |
| 3 | **"Pay this card"** action pre-filling a Bank → Card transfer | account screen |
| 4 | `statementDay` / `dueDay` on card accounts, and a derived "current statement" view | schema + account screen |
| 5 | Foreign purchases store the **settled** amount; original amount and rate as metadata | Stage 2 |

1 and 3 are cheap. 2 is the one that fixes the numbers. 4 and 5 can wait.

## The open choice: mirror the statement, or record reality

This is the one decision the rest hangs off, and it is a philosophy question rather than a
technical one.

**(A) Mirror the statement.** Record everything the bank posts, provisional Murabaha charges and
their reversals included. The card balance in Peace always matches the bank's app. Cost: more data
entry, and every month distorts unless each reversal is linked back to the charge it undoes.

**(B) Record economic reality.** Record purchases and the real fees; skip provisional postings that
are known to reverse. Every month is truthful as it stands. Cost: the card balance disagrees with
the bank's app during the window between posting and settlement.

**Recommendation: (B).** Peace exists to answer "where did my money go", not to reproduce the
bank's ledger. Since the balance is paid in full inside the grace period, the Murabaha premium
always nets to zero, so recording it is pure noise — and (A) is exactly the mechanism that produced
the drift in MyMoney.

(B) does lose something real: you can no longer check the app against the statement, which is how a
forgotten record gets caught. So it should be paired with a **reconciliation** affordance on the
card account — type in the balance the bank shows, and Peace reports the difference and what it
believes is outstanding. That is a check, not a second stored balance, and it keeps the
"balances are derived, never stored" rule intact.

## What a statement settled

These four questions decided the data model. Three are now answered from the real statement, which
is why the shipped design looks the way it does.

| | Question | Answer |
|---|---|---|
| 1 | Provisional Murabaha: separate line, or purchases posted inflated? | **Separate line** |
| 2 | Reversal: one credit on settlement, or per transaction? | Unknown — too many lines to tell |
| 3 | Is the 3% foreign commission its own line? | **Its own line** |
| 4 | Does the statement carry the original currency and amount? | **Yes** |

**(1) mattered most, and came out the good way.** With the mark-up on its own line, a recorded
purchase matches the bank's purchase line exactly — a E£1,000 dinner is E£1,000 on both — so any
single transaction can be checked against the statement, and the provisional lines are noise that is
simply never recorded. Had purchases posted *inflated* instead, every line would have disagreed by a
different amount and spot-checking would have been impossible.

That confirms **(B) record economic reality** as the right choice, and adds one rule of thumb:

> **Reconcile after settlement, not mid-cycle.** Between a purchase and settlement the bank's
> balance carries provisional mark-up that is going to reverse. Reconciling inside that window
> imports the mark-up and is wrong again once it unwinds.

**(3) and (4) both validate the shipped design**: the commission is a separate record filed under
Bank fees, exactly as the statement presents it, and `originalCurrency` / `originalAmountMinor`
mirror figures the bank actually provides rather than something Peace invents.

**(2) stays open and matters least.** It only decides how noisy the reversal looks; nothing is
recorded either way.

## Why the statement view is not planned

`statementDay` and `dueDay` exist as columns and are deliberately unread. The idea was to split the
balance into "due by the 26th" and "lands on next month's statement", since it is the *statement*
balance that must clear to avoid the Murabaha.

Two reasons it was dropped:

- **Paying in full always covers the statement balance.** Paying the total is early, never short, so
  the split protects against nothing.
- **The only real prize was a due-date reminder, and the bank already sends one.** Rebuilding an
  alert someone already receives competes with the bank's own.

The columns stay because they cost nothing and the question could return if the payment habit
changes. Nothing reads them, and no UI offers them.

## Decisions

Settled on 2026-08-09.

| Question | Decision | Consequence |
|---|---|---|
| Owed or negative? | **`E£5,000 owed`** — positive, expense colour | Presentation only. The stored sign never flips, so `SUM(amount_minor)` and net worth are untouched. Needs a liability-aware formatter, not a schema change. |
| Refunds tied to a purchase? | **Both, roughly equally** | Ship the flag first, since that is what fixes the totals. The optional link to an original record is a later addition, not a prerequisite. |
| Carry a balance? | **Paid in full every month** | No interest modelling. `interestRate` stays a loan-only column. Drop it from the card scope entirely. |

That removes interest from the slice and splits the refund work in two, leaving:

1. ✅ Liability balances render as **owed** *(presentation)*
2. ✅ **Refund** — reached by long-pressing the purchase it reverses, so it inherits that account and category rather than being filed by hand
3. ✅ **Paying a card** — became a prefill on the transfer rather than a button. Transferring into a
   card already *was* paying it; only the amount was missing.
4. ~~`statementDay` / `dueDay`~~ — not planned, see above
5. ✅ Foreign purchases store the **settled** amount, with the fee computed from the card
6. ~~Interest~~ — dropped
7. *Later:* link a refund to the purchase it reverses

Also shipped, and not on the original list: **balance corrections**. A card drifts, and the fix has
to move the balance without inventing a purchase — which turned out to need a second kind of
non-spending row alongside transfer legs, and a single home for that rule in
`src/db/repo/predicates.ts`.

**Everything on this list has now shipped.** Item 2 was the one that stops the numbers drifting, and
relaxing "expense rows are negative" was exactly the class of change the repository layer exists to
police: the SQL was fixed to decide sides by `isRefund` rather than by sign, and three JavaScript
callers were then found still doing the old test — caught by an E2E flow that duplicated a refund
and produced income.
