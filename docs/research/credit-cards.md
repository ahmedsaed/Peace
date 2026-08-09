# Credit cards

Why the card account drifts in MyMoney, and what Peace should do instead.

Status: **proposal, not built.** Written after nine days of real use, before Stage 2.

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

## Decisions

Settled on 2026-08-09.

| Question | Decision | Consequence |
|---|---|---|
| Owed or negative? | **`E£5,000 owed`** — positive, expense colour | Presentation only. The stored sign never flips, so `SUM(amount_minor)` and net worth are untouched. Needs a liability-aware formatter, not a schema change. |
| Refunds tied to a purchase? | **Both, roughly equally** | Ship the flag first, since that is what fixes the totals. The optional link to an original record is a later addition, not a prerequisite. |
| Carry a balance? | **Paid in full every month** | No interest modelling. `interestRate` stays a loan-only column. Drop it from the card scope entirely. |

That removes interest from the slice and splits the refund work in two, leaving:

1. Liability balances render as **owed** *(presentation)*
2. **Refund flag** — a signed expense that nets against its category *(repo + record form)*
3. **"Pay this card"** — pre-filled Bank → Card transfer *(account screen)*
4. `statementDay` / `dueDay` and a derived statement view *(schema + account screen)*
5. Foreign purchases store the **settled** amount *(Stage 2)*
6. ~~Interest~~ — dropped
7. *Later:* link a refund to the purchase it reverses

Item 2 is the one that stops the numbers drifting, and it is the one that needs the most careful
tests: relaxing "expense rows are negative" is exactly the class of change the repository layer
exists to police.
