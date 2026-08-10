import { flowKeyLabel, nextAction, type FlowState, type Sheet } from './record-flow';

const base: FlowState = {
  hasPendingOp: false,
  type: 'expense',
  accountId: 'acc-cash',
  toAccountId: null,
  categoryId: null,
  amountMinor: null,
  offered: [],
};

const state = (over: Partial<FlowState> = {}): FlowState => ({ ...base, ...over });

describe('nextAction — arithmetic comes first', () => {
  // The whole risk of this feature: `120 + 35 =` must show 155, not save a
  // record. If this ever regresses, the key silently commits half-typed sums.
  it('evaluates while an operation is pending, whatever else is missing', () => {
    expect(nextAction(state({ hasPendingOp: true }))).toEqual({ kind: 'evaluate' });
  });

  it('evaluates even when the record is otherwise ready to save', () => {
    expect(
      nextAction(
        state({
          hasPendingOp: true,
          categoryId: 'cat-food',
          amountMinor: 15500,
          offered: ['account', 'category'],
        })
      )
    ).toEqual({ kind: 'evaluate' });
  });
});

describe('nextAction — the expense sequence', () => {
  it('offers the account first, even though it has a default', () => {
    expect(nextAction(state())).toEqual({ kind: 'open', sheet: 'account' });
  });

  it('offers the category second', () => {
    expect(nextAction(state({ offered: ['account'] }))).toEqual({
      kind: 'open',
      sheet: 'category',
    });
  });

  it('asks for an amount once both pickers have been offered', () => {
    expect(nextAction(state({ offered: ['account', 'category'], categoryId: 'cat-food' }))).toEqual(
      { kind: 'incomplete', message: 'Enter an amount to save' }
    );
  });

  it('saves once everything is present', () => {
    expect(
      nextAction(
        state({ offered: ['account', 'category'], categoryId: 'cat-food', amountMinor: 15500 })
      )
    ).toEqual({ kind: 'save' });
  });

  // A category is optional for saving, so an unanswered category prompt must
  // not become a loop the user cannot leave.
  it('does not reopen a category that was offered and dismissed', () => {
    expect(
      nextAction(state({ offered: ['account', 'category'], categoryId: null, amountMinor: 15500 }))
    ).toEqual({ kind: 'save' });
  });
});

describe('nextAction — the transfer sequence', () => {
  const transfer = (over: Partial<FlowState> = {}) =>
    state({ type: 'transfer', ...over });

  it('asks for the destination account instead of a category', () => {
    expect(nextAction(transfer({ offered: ['account'] }))).toEqual({
      kind: 'open',
      sheet: 'toAccount',
    });
  });

  // Driving the flow forward the way a user would — answering each prompt as it
  // arrives — must never surface a category picker, which would offer expense
  // categories for a movement that is neither income nor expense.
  it('never offers a category', () => {
    const sheets: Sheet[] = [];
    let s = transfer({ amountMinor: 5000 });

    for (let i = 0; i < 5; i++) {
      const action = nextAction(s);
      if (action.kind !== 'open') break;
      sheets.push(action.sheet);
      // Answer the prompt, as a user would, rather than only marking it asked.
      s = {
        ...s,
        offered: [...s.offered, action.sheet],
        accountId: action.sheet === 'account' ? 'acc-cash' : s.accountId,
        toAccountId: action.sheet === 'toAccount' ? 'acc-bank' : s.toAccountId,
      };
    }

    expect(sheets).toEqual(['account', 'toAccount']);
    expect(nextAction(s)).toEqual({ kind: 'save' });
  });

  it('saves a complete transfer', () => {
    expect(
      nextAction(
        transfer({
          offered: ['account', 'toAccount'],
          toAccountId: 'acc-bank',
          amountMinor: 5000,
        })
      )
    ).toEqual({ kind: 'save' });
  });

  // Both legs pointing at one account is not a transfer, and the repository
  // would refuse it. Reopen the picker rather than letting `=` do nothing.
  it('reopens the destination when it matches the source', () => {
    expect(
      nextAction(
        transfer({
          offered: ['account', 'toAccount'],
          toAccountId: 'acc-cash',
          amountMinor: 5000,
        })
      )
    ).toEqual({ kind: 'open', sheet: 'toAccount' });
  });
});

describe('nextAction — nothing is ever a dead key', () => {
  it('reopens the account picker when it was dismissed and nothing is set', () => {
    expect(
      nextAction(
        state({ offered: ['account', 'category'], accountId: null, amountMinor: 15500 })
      )
    ).toEqual({ kind: 'open', sheet: 'account' });
  });

  it('treats a zero or negative amount as missing', () => {
    for (const amountMinor of [0, -100, null]) {
      expect(
        nextAction(state({ offered: ['account', 'category'], amountMinor })).kind
      ).toBe('incomplete');
    }
  });
});

describe('flowKeyLabel', () => {
  // A key labelled "=" that silently saves a record is a trap. The label has to
  // describe the next press.
  it('says what the press will do', () => {
    expect(flowKeyLabel({ kind: 'evaluate' })).toBe('=');
    expect(flowKeyLabel({ kind: 'save' })).toBe('✓');
    expect(flowKeyLabel({ kind: 'open', sheet: 'account' })).toBe('→');
    expect(flowKeyLabel({ kind: 'incomplete', message: 'x' })).toBe('→');
  });
});
