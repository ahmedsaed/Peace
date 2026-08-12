import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Keypad, type KeyPress } from '@/components/keypad';
import { PickerSheet, type PickerOption } from '@/components/picker-sheet';
import palette from '@/constants/palette';
import { db } from '@/db/client';
import { listAccountsWithBalance } from '@/db/repo/accounts';
import { InvariantError, listCategoryTree } from '@/db/repo/categories';
import {
  createRecord,
  createTransfer,
  deleteRecord,
  getRecord,
  updateRecord,
  updateTransfer,
} from '@/db/repo/transactions';
import {
  backspace,
  calcFromMinor,
  committedMinor,
  equals,
  initialCalc,
  inputDigit,
  inputDot,
  inputOp,
} from '@/lib/calculator';
import { ageInDays, fetchRate, formatRateDate, RateError } from '@/lib/fx';
import { byDensity, useDensity } from '@/lib/layout';
import { convertMinor, formatMinor, groupDigits } from '@/lib/money';
import { formatDayLabel, formatTimeLabel } from '@/lib/period';
import { flowKeyLabel, nextAction, type Sheet } from '@/lib/record-flow';
import { createCardPurchase } from '@/db/repo/card';
import { CURRENCIES } from '@/lib/currencies';
import { foreignPurchase } from '@/lib/fees';
import { isLiability } from '@/lib/liability';
import { useSetting } from '@/state/settings';
import { useUndoStore } from '@/state/undo';

type RecordType = 'income' | 'expense' | 'transfer';

const TYPES: { value: RecordType; label: string }[] = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'transfer', label: 'Transfer' },
];

export default function RecordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const density = useDensity();

  const accounts = useMemo(() => listAccountsWithBalance(db), []);

  // Load once. `id` does not change while the screen is mounted, and re-reading
  // on every render would fight the edits being made.
  const existing = useMemo(() => (id ? getRecord(db, id) : undefined), [id]);
  const isEdit = !!existing;
  const editingTransfer = !!existing?.transferPairId;

  const [type, setType] = useState<RecordType>(() => {
    if (!existing) return 'expense';
    if (existing.transferPairId) return 'transfer';
    return existing.amountMinor < 0 ? 'expense' : 'income';
  });

  const defaultAccountId = useSetting('defaultAccountId');

  // A transfer can be opened from either leg; the form always presents it as
  // "from the account that lost money".
  const [accountId, setAccountId] = useState(() => {
    if (!existing) {
      // The setting is only a preference, never a guarantee: an account can be
      // deleted or archived after being chosen as the default, and a form that
      // opened with no account selected because of a stale id would be a
      // confusing way to discover that. Fall back to the first account.
      const preferred = accounts.find((a) => a.id === defaultAccountId);
      return preferred?.id ?? accounts[0]?.id ?? '';
    }
    if (existing.transferPairId && existing.amountMinor > 0) {
      return existing.counterAccountId ?? existing.accountId;
    }
    return existing.accountId;
  });
  const [toAccountId, setToAccountId] = useState<string | null>(() => {
    if (!existing) return accounts[1]?.id ?? null;
    if (existing.transferPairId && existing.amountMinor > 0) return existing.accountId;
    return existing.counterAccountId ?? accounts[1]?.id ?? null;
  });

  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [occurredAt, setOccurredAt] = useState<Date>(existing?.occurredAt ?? new Date());
  const [picking, setPicking] = useState<'date' | 'time' | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  /**
   * Which pickers the `=` flow has already put in front of the user.
   *
   * Editing starts with everything answered: an existing record's account and
   * category were chosen once already, so re-prompting for them would make `=`
   * useless for the common edit, which is changing the amount.
   */
  const [offered, setOffered] = useState<Sheet[]>(() =>
    existing ? ['account', 'toAccount', 'category'] : []
  );
  const offerUndo = useUndoStore((state) => state.offer);

  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? 'EGP';
  const homeCurrency = useSetting('homeCurrency');

  const [calc, setCalc] = useState(() =>
    existing ? calcFromMinor(existing.amountMinor, existing.currency) : initialCalc()
  );

  /**
   * A record in an account that does not hold the home currency needs a rate,
   * or its value is unknowable and every month total that includes it is wrong.
   * Defaulting to 1 would be worse than asking: it looks like an answer.
   */
  const foreign = currency.toUpperCase() !== homeCurrency.toUpperCase();

  /**
   * SPENT ABROAD ON A CARD.
   *
   * A card denominated in EGP and used in Rome is charged in EGP at the bank's
   * rate, plus whatever commission the card charges. The amount that moves the
   * account is therefore the settled EGP — store the euros and the balance can
   * never agree with the statement.
   *
   * Offered only when the card is held in the home currency: a EUR purchase on
   * a USD card in an EGP ledger would need two rates at once, and two rate
   * fields on one screen is a worse answer than not offering it. Not offered
   * when editing either — rewriting a purchase and its fee together is a
   * different job from editing one row.
   */
  const cardAccount = !!account && isLiability(account.type);
  const canGoAbroad = cardAccount && !foreign && type === 'expense' && !existing;
  const [abroad, setAbroad] = useState<string | null>(null);
  // Deliberately NOT part of `Sheet`: that union is the one-handed flow's walk,
  // and the flow key would then insist on this optional step.
  const [abroadSheet, setAbroadSheet] = useState(false);
  const [abroadRateText, setAbroadRateText] = useState('');
  const abroadRate = Number(abroadRateText);
  const abroadRateValid =
    abroadRateText.trim() !== '' && Number.isFinite(abroadRate) && abroadRate > 0;
  // The currency the KEYPAD is entering. Everything below follows this.
  const entryCurrency = abroad ?? currency;
  const [rateText, setRateText] = useState(() =>
    existing && existing.fxRate !== 1 ? String(existing.fxRate) : ''
  );
  const fxRate = Number(rateText);
  const rateValid = rateText.trim() !== '' && Number.isFinite(fxRate) && fxRate > 0;

  /**
   * Where the number in the rate field came from, so the screen can say. A rate
   * the user typed and a rate a central bank published are not the same claim,
   * and only one of them should carry a date.
   */
  const [rateSource, setRateSource] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [fetchingRate, setFetchingRate] = useState(false);

  const fetchFor = useCallback(
    async (from: string) => {
      setFetchingRate(true);
      setRateError(null);
      try {
        const fetched = await fetchRate(from, homeCurrency);
        setRateText(String(fetched.rate));
        const age = ageInDays(fetched.date, new Date());
        // Central banks do not publish at weekends, so an older date is normal
        // rather than an error — but it has to be visible, because a Friday
        // rate used on a Monday is a real difference in what something cost.
        setRateSource(
          age <= 0
            ? `Frankfurter · ${formatRateDate(fetched.date)}`
            : `Frankfurter · ${formatRateDate(fetched.date)} (${age}d old)`
        );
      } catch (error) {
        setRateSource(null);
        setRateError(error instanceof RateError ? error.message : 'Could not fetch the rate.');
      } finally {
        setFetchingRate(false);
      }
    },
    [homeCurrency]
  );

  // Plain function for the same reason as fetchAbroadRate below: once the
  // component grew a second rate to fetch, the compiler could no longer prove
  // this useCallback's deps and gave up optimising the entire file.
  const onFetchRate = () => void fetchFor(currency);

  /**
   * The rate INTO THE CARD'S currency, which is a different question from the
   * one `fetchFor` answers — that one converts to the home currency for
   * reporting. Here the card is about to be charged in its own currency, and
   * that is the number the statement will show.
   *
   * Every failure still ends with the field simply staying manual, and says so.
   */
  // A plain function, not a useCallback: the React Compiler memoizes this
  // component, and a manual useCallback here is what made it give up on the
  // whole file — "existing memoization could not be preserved" disables the
  // optimisation for every hook in the component, not just this one.
  async function fetchAbroadRate() {
    if (!abroad) return;
    setFetchingRate(true);
    setRateError(null);
    try {
      const fetched = await fetchRate(abroad, currency);
      setAbroadRateText(String(fetched.rate));
    } catch (error) {
      setRateError(error instanceof RateError ? error.message : 'Could not fetch the rate.');
    } finally {
      setFetchingRate(false);
    }
  }

  /**
   * Fetching is triggered by CHOOSING the account, not by opening the screen.
   *
   * An effect on mount would put a network request in front of every record,
   * including the overwhelming majority that are in the home currency and need
   * no rate at all — and it would fire again on every remount. Selecting a
   * foreign account is the moment a rate becomes necessary, so that is where it
   * happens; the button covers everything else.
   *
   * Never for an existing record: its rate is history, and today's number must
   * not quietly overwrite what something actually cost.
   */
  const onPickAccount = useCallback(
    (pickedId: string) => {
      setAccountId(pickedId);
      setSheet(null);

      const picked = accounts.find((a) => a.id === pickedId);
      const pickedCurrency = picked?.currency ?? homeCurrency;
      const nowForeign = pickedCurrency.toUpperCase() !== homeCurrency.toUpperCase();
      if (nowForeign && !existing && rateText.trim() === '') {
        void fetchFor(pickedCurrency);
      }
    },
    [accounts, existing, fetchFor, homeCurrency, rateText]
  );

  // Only categories of the matching kind are offered — a category is income XOR
  // expense, so showing all of them would just invite an invalid pick.
  const categoryTree = useMemo(
    () => (type === 'transfer' ? [] : listCategoryTree(db, type)),
    [type]
  );
  const category = useMemo(
    () => categoryTree.flatMap((n) => [n, ...n.children]).find((c) => c.id === categoryId),
    [categoryTree, categoryId]
  );

  const amountMinor = committedMinor(calc, entryCurrency);

  /**
   * What the card will actually be charged. An ESTIMATE — the bank settles days
   * later at its own rate — which is what "Update balance" on the account is
   * for. An estimate you can correct beats a blank you forget to fill in.
   */
  const abroadPreview =
    abroad && abroadRateValid && amountMinor !== null && amountMinor > 0
      ? foreignPurchase(
          convertMinor(amountMinor, abroad, currency, abroadRate),
          account?.foreignFeeBp
        )
      : null;
  const homePreview =
    foreign && rateValid && amountMinor !== null
      ? convertMinor(amountMinor, currency, homeCurrency, fxRate)
      : null;

  const canSave =
    amountMinor !== null &&
    amountMinor > 0 &&
    !!accountId &&
    // Without a rate the record cannot be valued, so saving it would put a
    // number into the month total that means nothing.
    (!foreign || rateValid) &&
    // Same rule for a purchase abroad: without a rate there is no settled
    // amount, so the card would move by a number nobody computed.
    (!abroad || abroadRateValid) &&
    (type !== 'transfer' || (!!toAccountId && toAccountId !== accountId));

  /**
   * What `=` will do on the next press. Computed every render because it also
   * drives the key's label — see src/lib/record-flow.ts for why the key cannot
   * just say "=".
   */
  const flow = nextAction({
    hasPendingOp: calc.pendingOp !== null,
    type,
    accountId: accountId || null,
    toAccountId,
    categoryId,
    amountMinor,
    offered,
  });

  function openSheet(next: Sheet) {
    setOffered((current) => (current.includes(next) ? current : [...current, next]));
    setSheet(next);
  }

  /**
   * The keypad drives the whole screen. The pickers are at the top and the keys
   * at the bottom, so without this, logging a spend one-handed means reaching
   * across the phone twice.
   */
  function advance() {
    switch (flow.kind) {
      case 'evaluate':
        setCalc((state) => equals(state, entryCurrency));
        return;
      case 'open':
        openSheet(flow.sheet);
        return;
      case 'save':
        onSave();
        return;
      case 'incomplete':
        setHint(flow.message);
    }
  }

  function onKey(press: KeyPress) {
    setError(null);
    setHint(null);

    // `=` is handled outside the calculator: it only evaluates while a sum is
    // pending, and otherwise moves the record along.
    if (press.kind === 'equals') {
      advance();
      return;
    }

    setCalc((state) => {
      switch (press.kind) {
        case 'digit':
          return inputDigit(state, press.value, entryCurrency);
        case 'dot':
          return inputDot(state, entryCurrency);
        case 'op':
          return inputOp(state, press.value, entryCurrency);
      }
    });
  }

  /**
   * `onValueChange` fires only when a value is actually chosen — cancelling
   * goes to `onDismiss` — so there is no event type to check here. (The older
   * `onChange` callback, which received both, is deprecated in v9.)
   */
  function onPickDateTime(_event: unknown, picked: Date) {
    const mode = picking;
    setPicking(null);

    // The picker hands back a whole Date, so keep the half the user was not
    // editing — otherwise choosing a date silently resets the time to midnight.
    setOccurredAt((current) => {
      const next = new Date(current);
      if (mode === 'date') {
        next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      } else {
        next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      }
      return next;
    });
  }

  function onSave() {
    if (!canSave || amountMinor === null) return;
    try {
      if (existing) {
        if (editingTransfer) {
          updateTransfer(db, existing.id, {
            fromAccountId: accountId,
            toAccountId: toAccountId!,
            amountMinor,
            currency,
            fxRate: foreign ? fxRate : 1,
            homeCurrency,
            note: note.trim() || null,
            occurredAt,
          });
        } else {
          updateRecord(db, existing.id, {
            type: type as 'expense' | 'income',
            accountId,
            categoryId,
            amountMinor,
            currency,
            fxRate: foreign ? fxRate : 1,
            homeCurrency,
            note: note.trim() || null,
            occurredAt,
          });
        }
      } else if (type === 'transfer') {
        createTransfer(db, {
          fromAccountId: accountId,
          toAccountId: toAccountId!,
          amountMinor,
          currency,
          fxRate: foreign ? fxRate : 1,
          homeCurrency,
          note: note.trim() || null,
          occurredAt,
        });
      } else if (abroad) {
        // A purchase abroad on a card writes the settled charge AND the card's
        // commission, in one transaction. See createCardPurchase.
        createCardPurchase(db, {
          accountId,
          categoryId,
          amountMinor,
          originalCurrency: abroad,
          fxRate: abroadRate,
          homeCurrency,
          note: note.trim() || null,
          occurredAt,
        });
      } else {
        createRecord(db, {
          type,
          accountId,
          categoryId,
          amountMinor,
          currency,
          fxRate: foreign ? fxRate : 1,
          homeCurrency,
          note: note.trim() || null,
          occurredAt,
        });
      }
      router.back();
    } catch (e) {
      // An InvariantError is the user's mistake and worth showing verbatim;
      // anything else is a real fault and gets a generic line.
      setError(
        e instanceof InvariantError ? e.message : 'Could not save this record. Please try again.'
      );
    }
  }

  function onDelete() {
    if (!existing) return;
    try {
      // The rows come back so they can be put straight back on undo — see
      // src/state/undo.ts for why this is not a soft delete.
      const removed = deleteRecord(db, existing.id);
      offerUndo(removed, removed.length > 1 ? 'Transfer deleted' : 'Record deleted');
      router.back();
    } catch {
      setError('Could not delete this record.');
    }
  }

  // The balance, not the currency code — the currency is already visible in the
  // formatted amount, and "which account still has money in it" is the actual
  // question being asked at the moment of picking one.
  const accountOptions: PickerOption[] = accounts.map((a) => ({
    id: a.id,
    label: a.name,
    icon: a.icon,
    color: a.color,
    detail: formatMinor(a.balanceMinor, a.currency),
    detailTone: a.balanceMinor < 0 ? ('negative' as const) : ('neutral' as const),
  }));

  const categoryOptions: PickerOption[] = categoryTree.flatMap((node) => [
    { id: node.id, label: node.name, icon: node.icon, color: node.color },
    ...node.children.map((child) => ({
      id: child.id,
      label: child.name,
      icon: child.icon,
      color: child.color,
      indented: true,
    })),
  ]);

  /**
   * Editing cannot turn a record into a transfer or back — that changes how many
   * rows exist. Delete and re-add is clearer than a silent restructure.
   */
  const typeLocked = (value: RecordType) =>
    isEdit && (editingTransfer ? value !== 'transfer' : value === 'transfer');

  /**
   * Split-screen is a first-class way this screen gets used: half the display
   * shows the bank notification, half logs the record. See src/lib/layout.ts.
   *
   * The structure is the fix, and the density table is only the polish. The
   * amount, the keypad and the date row are PINNED to the bottom; everything
   * above them lives in a ScrollView. However short the window gets, the keys
   * stay on screen and the squeeze is absorbed by scrolling instead of by
   * pushing the keypad off the bottom edge.
   */
  const pad = byDensity(density, { regular: 'py-3', compact: 'py-2', tight: 'py-1.5' });
  const gap = byDensity(density, { regular: 'mb-3', compact: 'mb-2', tight: 'mb-1.5' });
  const amountText = byDensity(density, {
    regular: 'text-4xl',
    compact: 'text-3xl',
    tight: 'text-2xl',
  });
  // The note keeps a floor rather than a fixed height: with room it grows like a
  // web textarea, without room it stops at something still usable.
  const noteMinHeight = byDensity(density, { regular: 120, compact: 76, tight: 48 });
  // Below this there is not enough height for a labelled picker row AND a note
  // block, so they merge into one line. See the comment at that branch.
  const compact = density === 'tight';

  return (
    <View
      className="flex-1 bg-ground"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      testID="record-screen">
      <View className={`flex-row items-center justify-between px-4 ${pad}`}>
        <Pressable
          onPress={() => router.back()}
          testID="record-cancel"
          accessibilityRole="button"
          className="rounded-lg border border-line px-5 py-2.5 active:opacity-70">
          <Text className="text-sm font-medium text-muted">Cancel</Text>
        </Pressable>

        <Text className="text-sm font-medium text-muted" testID="record-title">
          {isEdit ? 'Edit record' : 'New record'}
        </Text>

        <Pressable
          onPress={onSave}
          disabled={!canSave}
          testID="record-save"
          accessibilityRole="button"
          className={`rounded-lg px-7 py-2.5 active:opacity-80 ${
            canSave ? 'bg-accent' : 'bg-surface'
          }`}>
          <Text className={`text-sm font-semibold ${canSave ? 'text-accent-ink' : 'text-line'}`}>
            Save
          </Text>
        </Pressable>
      </View>

      {/* `flexGrow: 1` lets the note expand into spare room on a full-height
          screen, while still allowing the whole block to scroll when there is
          none. Without it the content container collapses to its content and
          the note's flex-1 has nothing to grow into. */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled">
        <View className={`mx-4 flex-row rounded-lg bg-surface p-1 ${gap}`}>
          {TYPES.map(({ value, label }) => {
            const locked = typeLocked(value);
            return (
              <Pressable
                key={value}
                disabled={locked}
                onPress={() => {
                  setType(value);
                  setCategoryId(null);
                  setError(null);
                }}
                testID={`type-${value}`}
                accessibilityRole="button"
                className={`flex-1 items-center rounded-md py-2 ${
                  type === value ? 'bg-raised' : ''
                }`}>
                <Text
                  className={`text-sm ${
                    type === value
                      ? 'font-semibold text-accent'
                      : locked
                        ? 'text-line'
                        : 'text-muted'
                  }`}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* One row instead of three when the window is short: the two pickers
            collapse to their icons and the note takes the rest of the line.
            That is ~120dp back, which is the difference between scrolling to
            reach the note and everything being on screen at once.

            The labels are what get dropped, and they are the right thing to
            drop: the account and category are each shown by their own icon and
            colour, which is how they are recognised in the list anyway. The
            accessible name still carries the full text. */}
        {compact ? (
          <View className={`mx-4 flex-row items-center gap-2 ${gap}`}>
            <PickerSquare
              label={`${type === 'transfer' ? 'From account' : 'Account'}: ${account?.name ?? 'choose'}`}
              icon={account?.icon}
              color={account?.color}
              onPress={() => openSheet('account')}
              testID="pick-account"
            />
            {type === 'transfer' ? (
              <PickerSquare
                label={`To account: ${accounts.find((a) => a.id === toAccountId)?.name ?? 'choose'}`}
                icon={accounts.find((a) => a.id === toAccountId)?.icon ?? 'transfer'}
                color={accounts.find((a) => a.id === toAccountId)?.color}
                onPress={() => openSheet('toAccount')}
                testID="pick-to-account"
              />
            ) : (
              <PickerSquare
                label={`Category: ${category?.name ?? 'choose'}`}
                icon={category?.icon ?? 'categories'}
                color={category?.color}
                onPress={() => openSheet('category')}
                testID="pick-category"
              />
            )}
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Notes"
              placeholderTextColor={palette.muted}
              testID="record-note"
              className="h-11 flex-1 rounded-lg bg-surface px-3 text-sm text-ink"
            />
          </View>
        ) : (
          <>
            <View className={`mx-4 flex-row gap-3 ${gap}`}>
              <PickerButton
                label={type === 'transfer' ? 'From' : 'Account'}
                value={account?.name}
                icon={account?.icon}
                color={account?.color}
                onPress={() => openSheet('account')}
                testID="pick-account"
              />
              {type === 'transfer' ? (
                <PickerButton
                  label="To"
                  value={accounts.find((a) => a.id === toAccountId)?.name}
                  icon={accounts.find((a) => a.id === toAccountId)?.icon}
                  color={accounts.find((a) => a.id === toAccountId)?.color}
                  onPress={() => openSheet('toAccount')}
                  testID="pick-to-account"
                />
              ) : (
                <PickerButton
                  label="Category"
                  value={category?.name}
                  icon={category?.icon ?? 'categories'}
                  color={category?.color}
                  onPress={() => openSheet('category')}
                  testID="pick-category"
                />
              )}
            </View>

            {/* Notes claims every pixel left between the pickers and the amount,
                the way a web textarea fills its container — down to a floor,
                below which it stops shrinking and the block scrolls instead. */}
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Add notes"
              placeholderTextColor={palette.muted}
              multiline
              textAlignVertical="top"
              testID="record-note"
              style={{ minHeight: noteMinHeight }}
              className={`mx-4 flex-1 rounded-lg bg-surface px-4 py-3 text-base text-ink ${gap}`}
            />
          </>
        )}
      </ScrollView>

      {/* The amount owns a full block now, with the currency it is in on the
          left and — only when that is not the home currency — the rate and what
          it comes to underneath. The currency is INFORMATION, not a control: it
          follows the account, because an account whose rows are in mixed
          currencies could not have a balance at all. */}
      <View className={`mx-4 rounded-lg bg-surface px-4 ${pad} ${gap}`}>
        <View className="flex-row items-center gap-3">
          {/* The currency is INFORMATION, not a control — except on a card,
              where "I paid in euros" is a real thing to say and the card is
              still charged in its own currency. */}
          {canGoAbroad ? (
            <Pressable
              onPress={() => setAbroadSheet(true)}
              hitSlop={10}
              testID="amount-currency"
              accessibilityRole="button"
              accessibilityLabel={`Paid in ${entryCurrency}. Change`}>
              <Text className="text-sm font-medium text-accent">{entryCurrency} ▾</Text>
            </Pressable>
          ) : (
            <Text className="text-sm font-medium text-muted" testID="amount-currency">
              {entryCurrency}
            </Text>
          )}
          <Text
            className={`flex-1 text-right font-light text-ink ${amountText}`}
            numberOfLines={1}
            adjustsFontSizeToFit
            // The calculator's `entry` stays raw; grouping is display only, and
            // must never be parsed back.
            testID="amount-display">
            {groupDigits(calc.entry)}
          </Text>
          <Pressable
            onPress={() => setCalc(backspace)}
            hitSlop={12}
            testID="key-backspace"
            accessibilityRole="button"
            accessibilityLabel="Backspace">
            <Text className="text-2xl text-muted">&#9003;</Text>
          </Pressable>
        </View>

        {/* Spent abroad: the rate into the CARD's currency, and what the card
            will actually be charged once its commission is added. */}
        {abroad ? (
          <View className="mt-2 border-t border-line pt-2" testID="abroad-block">
            <View className="flex-row items-center gap-2">
              <Text className="text-xs text-muted">1 {abroad} =</Text>
              <TextInput
                value={abroadRateText}
                onChangeText={setAbroadRateText}
                placeholder="rate"
                placeholderTextColor={palette.muted}
                keyboardType="decimal-pad"
                testID="abroad-rate"
                className="min-w-14 py-0.5 text-sm font-medium text-ink"
              />
              <Text className="flex-1 text-xs text-muted">{currency}</Text>
              <Pressable
                onPress={() => void fetchAbroadRate()}
                disabled={fetchingRate}
                hitSlop={10}
                testID="abroad-rate-fetch"
                accessibilityRole="button"
                accessibilityLabel="Fetch today's rate">
                <Text className={`text-xs ${fetchingRate ? 'text-line' : 'text-accent'}`}>
                  {fetchingRate ? 'fetching…' : 'fetch'}
                </Text>
              </Pressable>
            </View>

            {abroadPreview ? (
              <Text className="mt-1 text-xs text-muted" testID="abroad-preview">
                {formatMinor(abroadPreview.settledMinor, currency)}
                {abroadPreview.feeMinor > 0
                  ? ` + ${formatMinor(abroadPreview.feeMinor, currency)} fee = ${formatMinor(
                      abroadPreview.totalMinor,
                      currency
                    )}`
                  : ''}{' '}
                — estimate, correct it when the statement lands
              </Text>
            ) : null}
          </View>
        ) : null}

        {foreign ? (
          <View className="mt-2 border-t border-line pt-2">
            <View className="flex-row items-center gap-2">
              <Text className="text-xs text-muted">1 {currency} =</Text>
              <TextInput
                value={rateText}
                onChangeText={(next) => {
                  setRateText(next);
                  // Typed over: the number is the user's now, so stop calling it
                  // the bank's.
                  setRateSource(null);
                }}
                placeholder="rate"
                placeholderTextColor={palette.muted}
                keyboardType="decimal-pad"
                testID="record-rate"
                className="min-w-14 py-0.5 text-sm font-medium text-ink"
              />
              <Text className="flex-1 text-xs text-muted">{homeCurrency}</Text>
              <Pressable
                onPress={onFetchRate}
                disabled={fetchingRate}
                hitSlop={10}
                testID="record-rate-fetch"
                accessibilityRole="button"
                accessibilityLabel="Fetch today's rate">
                <Text className={`text-xs ${fetchingRate ? 'text-line' : 'text-accent'}`}>
                  {fetchingRate ? 'fetching…' : 'fetch'}
                </Text>
              </Pressable>
            </View>

            <View className="mt-1 flex-row items-center justify-between">
              <Text className="text-[11px] text-muted" testID="record-rate-source">
                {rateError ?? rateSource ?? 'rate from your bank statement, or tap fetch'}
              </Text>
              <Text
                className={`text-sm ${homePreview === null ? 'text-line' : 'text-accent'}`}
                testID="record-home-preview">
                {homePreview === null
                  ? 'rate needed'
                  : formatMinor(type === 'income' ? homePreview : -homePreview, homeCurrency)}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {calc.error || error ? (
        <Text className="mx-4 mb-2 text-sm text-expense" testID="record-error">
          {calc.error ?? error}
        </Text>
      ) : hint ? (
        // Muted, not the expense colour: pressing "next" with nothing typed is
        // the user asking what comes next, not making a mistake.
        <Text className="mx-4 mb-2 text-sm text-muted" testID="record-hint">
          {hint}
        </Text>
      ) : null}

      {/* Delete sits at the bottom-left, far from Save, and is the only
          destructive control on the screen — hence the expense colour. */}
      {isEdit ? (
        <Pressable
          onPress={onDelete}
          testID="record-delete"
          accessibilityRole="button"
          className="mx-4 mb-2 self-start rounded-lg border border-expense/40 px-4 py-2 active:opacity-70">
          <Text className="text-sm font-medium text-expense">Delete</Text>
        </Pressable>
      ) : null}

      <View className="mx-3">
        <Keypad onKey={onKey} density={density} equalsLabel={flowKeyLabel(flow)} />
      </View>

      {/* Surface fill and radius match the account and category pickers, so the
          form reads as one set of controls. The value alone is the label here —
          a date needs no caption to be recognisable as a date. */}
      <View className={`mx-4 mb-1 flex-row gap-3 ${byDensity(density, { regular: 'mt-3', compact: 'mt-2', tight: 'mt-1.5' })}`}>
        <Pressable
          onPress={() => setPicking('date')}
          testID="record-date"
          accessibilityRole="button"
          accessibilityLabel={`Date, ${formatDayLabel(occurredAt)}`}
          className={`flex-1 items-center rounded-lg bg-surface active:opacity-70 ${pad}`}>
          <Text className="text-sm text-ink">{formatDayLabel(occurredAt)}</Text>
        </Pressable>
        <Pressable
          onPress={() => setPicking('time')}
          testID="record-time"
          accessibilityRole="button"
          accessibilityLabel={`Time, ${formatTimeLabel(occurredAt)}`}
          className={`flex-1 items-center rounded-lg bg-surface active:opacity-70 ${pad}`}>
          <Text className="text-sm text-ink">{formatTimeLabel(occurredAt)}</Text>
        </Pressable>
      </View>

      {picking ? (
        <DateTimePicker
          value={occurredAt}
          mode={picking}
          is24Hour={false}
          onValueChange={onPickDateTime}
          onDismiss={() => setPicking(null)}
        />
      ) : null}

      <PickerSheet
        visible={sheet === 'account'}
        title={type === 'transfer' ? 'From account' : 'Account'}
        options={accountOptions}
        selectedId={accountId}
        onSelect={onPickAccount}
        onClose={() => setSheet(null)}
        testID="sheet-account"
      />

      <PickerSheet
        visible={sheet === 'toAccount'}
        title="To account"
        options={accountOptions.filter((o) => o.id !== accountId)}
        selectedId={toAccountId}
        onSelect={(pickedId) => {
          setToAccountId(pickedId);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-to-account"
      />

      <PickerSheet
        visible={abroadSheet}
        title="Paid in"
        options={[
          {
            id: currency,
            label: `${currency} — no conversion`,
            icon: 'cash',
            detail: 'Card currency',
          },
          ...CURRENCIES.filter((c) => c.code !== currency).map((c) => ({
            id: c.code,
            label: c.name,
            icon: 'plane',
            detail: c.code,
          })),
        ]}
        selectedId={entryCurrency}
        onSelect={(code) => {
          // Back to the card's own currency means this was not a foreign
          // purchase after all — drop the rate with it rather than leaving a
          // stale number to be applied to the next thing typed.
          setAbroad(code === currency ? null : code);
          setAbroadRateText('');
          setAbroadSheet(false);
        }}
        onClose={() => setAbroadSheet(false)}
        testID="sheet-abroad"
      />

      <PickerSheet
        visible={sheet === 'category'}
        title="Category"
        options={categoryOptions}
        selectedId={categoryId}
        onSelect={(pickedId) => {
          setCategoryId(pickedId);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="sheet-category"
      />
    </View>
  );
}

/**
 * The icon-only form of PickerButton, for short windows.
 *
 * Same testID as the labelled version on purpose: which one renders is a
 * function of the window height, and a flow that had to know the density before
 * it could find the account picker would be testing the layout rather than the
 * app.
 */
function PickerSquare({
  label,
  icon,
  color,
  onPress,
  testID,
}: {
  label: string;
  icon?: string | null;
  color?: string | null;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-11 w-11 items-center justify-center rounded-lg bg-surface active:opacity-70">
      <View
        className="h-7 w-7 items-center justify-center rounded-full"
        style={{ backgroundColor: color ?? '#6B5B4A' }}>
        <Icon name={icon ?? 'dots'} size={14} color="#FFFFFF" />
      </View>
    </Pressable>
  );
}

function PickerButton({
  label,
  value,
  icon,
  color,
  onPress,
  testID,
}: {
  label: string;
  value?: string;
  icon?: string | null;
  color?: string | null;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      className="flex-1 flex-row items-center gap-2 rounded-lg bg-surface px-3 py-3 active:opacity-70">
      <View
        className="h-7 w-7 items-center justify-center rounded-full"
        style={{ backgroundColor: color ?? '#6B5B4A' }}>
        <Icon name={icon ?? 'dots'} size={14} color="#FFFFFF" />
      </View>
      <View className="flex-1">
        <Text className="text-[10px] uppercase tracking-wider text-muted">{label}</Text>
        <Text className={`text-sm ${value ? 'text-ink' : 'text-muted'}`} numberOfLines={1}>
          {value ?? 'Choose'}
        </Text>
      </View>
    </Pressable>
  );
}
