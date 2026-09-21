import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ArchivedGroup } from '@/components/archived-group';
import { EntityActions, type EntityItem } from '@/components/entity-actions';
import { Snackbar } from '@/components/snackbar';
import { Icon } from '@/components/icon';
import { ReconcileSheet } from '@/components/reconcile-sheet';
import { Fab, Screen } from '@/components/screen';
import { db } from '@/db/client';
import {
  balanceByCurrency,
  listAccountsWithBalance,
  listArchivedAccounts,
  updateAccount,
  type CurrencyTotal,
} from '@/db/repo/accounts';
import { accountBalance, reconcileAccount } from '@/db/repo/adjust';
import { checkDeletion, deleteEntity } from '@/db/repo/archive';
import { InvariantError } from '@/db/repo/categories';
import { availableCredit, isLiability, owedDisplay } from '@/lib/liability';
import { idSlug } from '@/lib/slug';
import { useSetting } from '@/state/settings';
import { useMoney, type Money } from '@/state/money';

export default function AccountsScreen() {
  const money = useMoney();
  const router = useRouter();
  const [accounts, setAccounts] = useState<ReturnType<typeof listAccountsWithBalance>>([]);
  const [archived, setArchived] = useState<ReturnType<typeof listAccountsWithBalance>>([]);
  const [totals, setTotals] = useState<CurrencyTotal[]>([]);
  const [acting, setActing] = useState<EntityItem | null>(null);
  /** The account whose balance is being corrected, held apart from the sheet. */
  const [reconciling, setReconciling] = useState<Row | null>(null);
  /**
   * What just happened, shown over the list rather than at the top of it.
   *
   * It was a line of text above the rows, which meant a message about the
   * account you had just scrolled down to and held was rendered off-screen
   * above you — a screen answering a question where you were not looking. The
   * snackbar is pinned, so the answer arrives where the action did. `token`
   * restarts its timer, or a second message inherits the first's countdown.
   */
  const [said, setSaid] = useState<{ text: string; bad: boolean; token: number } | null>(null);
  const say = useCallback((text: string, bad = false) => {
    setSaid({ text, bad, token: Date.now() });
  }, []);
  const homeCurrency = useSetting('homeCurrency');

  const reload = useCallback(() => {
    setAccounts(listAccountsWithBalance(db));
    setArchived(listArchivedAccounts(db));
    setTotals(balanceByCurrency(db));
  }, []);

  // Re-read on focus so a balance change, or a newly added account, shows up on
  // the way back from any other screen.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  /**
   * Everything the sheet needs, asked for once per long press.
   *
   * The counts are aggregate queries; folding them into the list would pay for
   * them on every row whether or not anybody ever asks.
   */
  function open(account: Row) {
    const { blocking, records } = checkDeletion(db, { kind: 'account', id: account.id });
    setSaid(null);
    setActing({
      kind: 'account',
      id: account.id,
      name: account.name,
      icon: account.icon,
      color: account.color,
      // Capitalised HERE rather than with a `capitalize` class on the sheet:
      // that detail line also carries "On 2 records" for a tag, which CSS
      // would turn into "On 2 Records".
      detail: `${capitalise(account.type)} · ${money(account.balanceMinor, account.currency)}`,
      archived: account.archived,
      records,
      blocking,
      testKey: idSlug(account.id),
    });
  }

  function showRecords(item: EntityItem) {
    const { filter } = checkDeletion(db, { kind: 'account', id: item.id });
    setActing(null);
    // Null only when nothing points at it, and the action is not offered then.
    if (filter) router.push({ pathname: '/search', params: filter });
  }

  function archive(item: EntityItem) {
    updateAccount(db, item.id, { archived: !item.archived });
    setActing(null);
    say(item.archived ? `${item.name} is back.` : `${item.name} is put away.`);
    reload();
  }

  function remove(item: EntityItem) {
    try {
      deleteEntity(db, { kind: 'account', id: item.id });
      say(`${item.name} deleted.`);
    } catch (error) {
      // The repository refuses rather than trusting a screen, so a caught error
      // here is better than a crash on a ledger that changed underneath.
      say(
        error instanceof InvariantError ? error.message : `Could not delete ${item.name}.`,
        true
      );
    }
    setActing(null);
    reload();
  }

  return (
    <Screen testID="accounts-screen">
      {/* No "Accounts" caption: the active tab already says which screen this
          is, and repeating it cost a row of height for no information. */}
      {/* One row per currency held, rather than one converted number.
          Valuing a whole balance needs a rate for today, and the only rates
          this app has belong to individual past records — see
          balanceByCurrency. With a single currency, which is the normal case,
          this is exactly the one line it always was. */}
      <View className="items-center bg-surface px-4 pb-4 pt-1">
        <Text className="mb-1 text-[10px] uppercase tracking-widest text-muted">All accounts</Text>
        {totals.length === 0 ? (
          <Text className="text-xl font-semibold text-ink" testID="accounts-total">
            {money(0, homeCurrency)}
          </Text>
        ) : (
          totals.map((total, index) => (
            <Text
              key={total.currency}
              className={`font-semibold text-ink ${index === 0 ? 'text-xl' : 'text-base'}`}
              testID={index === 0 ? 'accounts-total' : `accounts-total-${total.currency}`}>
              {money(total.balanceMinor, total.currency)}
            </Text>
          ))
        )}
      </View>

      <ScrollView contentContainerClassName="p-4 gap-3">
        {accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            onPress={() => router.push({ pathname: '/account', params: { id: account.id } })}
            onLongPress={() => open(account)}
          />
        ))}

        {/* The total above counts these, so the list has to account for them —
            a figure that includes money the screen never mentions is a screen
            disagreeing with itself. The header carries that money, so the
            group can stay shut. */}
        <ArchivedGroup
          count={archived.length}
          summary={archivedSummary(archived, money)}
          hint="Still counted in the total above, and off every picker. Hold one to bring it back."
          testID="accounts-archived">
          {archived.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              dimmed
              onPress={() => router.push({ pathname: '/account', params: { id: account.id } })}
              onLongPress={() => open(account)}
            />
          ))}
        </ArchivedGroup>

        <Text className="px-1 pt-2 text-xs leading-5 text-muted">
          Hold an account for its records, its balance, or to put it away.
        </Text>
      </ScrollView>

      <EntityActions
        item={acting}
        onClose={() => setActing(null)}
        onShowRecords={showRecords}
        onUpdateBalance={(item) => {
          const row = [...accounts, ...archived].find((a) => a.id === item.id) ?? null;
          setActing(null);
          setReconciling(row);
        }}
        onEdit={(item) => {
          setActing(null);
          router.push({ pathname: '/account', params: { id: item.id } });
        }}
        onRename={() => {}}
        onArchive={archive}
        onDelete={remove}
      />

      {/* Handed the account as a NON-NULL prop rather than read back out of
          state inside a handler — the sheet is closed almost all of the time. */}
      {reconciling ? (
        <ReconcileSheet
          visible
          accountName={reconciling.name}
          accountType={reconciling.type}
          currency={reconciling.currency}
          currentMinor={accountBalance(db, reconciling.id)}
          creditLimitMinor={reconciling.creditLimit}
          onClose={() => setReconciling(null)}
          onConfirm={(targetMinor) => {
            reconcileAccount(db, reconciling.id, targetMinor);
            setReconciling(null);
            reload();
          }}
        />
      ) : null}


      {/* Pinned, so the answer arrives where the action did rather than at the
          top of a list the user has scrolled away from. */}
      {said ? (
        <Snackbar
          message={said.text}
          token={said.token}
          onDismiss={() => setSaid(null)}
          durationMs={said.bad ? 12000 : 5000}
          testID="accounts-notice"
        />
      ) : null}

      <Fab onPress={() => router.push('/account')} testID="fab-account"
        // Lifted clear of the snackbar, exactly as the records list does:
        // otherwise the message — and on that screen its Undo — sits under it.
        raised={!!said}
      />
    </Screen>
  );
}

type Row = ReturnType<typeof listAccountsWithBalance>[number];

/** "cash" is how the type is stored; "Cash" is how a sentence starts. */
function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * What is still sitting in the archive.
 *
 * Only when everything in there is held in ONE currency. With several, a single
 * sum would be a number nobody could check — the same reason the total above is
 * one line per currency rather than one converted figure — so the header says
 * nothing and the group is there to be opened.
 */
function archivedSummary(rows: Row[], money: Money): string | undefined {
  if (rows.length === 0) return undefined;
  const currencies = new Set(rows.map((r) => r.currency));
  if (currencies.size !== 1) return undefined;
  const total = rows.reduce((sum, r) => sum + r.balanceMinor, 0);
  return money(total, rows[0].currency);
}

/**
 * One account, in either group.
 *
 * Shared rather than written twice: an archived account is the same row with
 * the colour turned down, and two copies would drift the moment a card grew a
 * field. Tapping edits it; HOLDING is where everything that is not editing
 * lives, which is the same split the records list has used all along.
 */
function AccountRow({
  account,
  onPress,
  onLongPress,
  dimmed = false,
}: {
  account: Row;
  onPress: () => void;
  onLongPress: () => void;
  dimmed?: boolean;
}) {
  const money = useMoney();

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className={`flex-row items-center gap-3 rounded-xl bg-surface p-3 active:opacity-70 ${
        dimmed ? 'opacity-60' : ''
      }`}
      testID={`account-${account.id}`}>
      <View
        className="h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: account.color ?? '#6B5B4A' }}>
        <Icon name={account.icon ?? 'wallet'} size={18} color="#FFFFFF" />
      </View>

      <View className="flex-1">
        <Text className="text-base text-ink">{account.name}</Text>
        <Text className="text-xs capitalize text-muted" testID={`account-sub-${account.id}`}>
          {accountSubtitle(account, money)}
        </Text>
      </View>

      <AccountAmount account={account} />
    </Pressable>
  );
}

/**
 * "card · EGP", or the headroom left when a limit is recorded.
 *
 * Available credit is the number people actually plan against — "can I put this
 * on the card" is not answered by knowing what you owe.
 */
function accountSubtitle(account: Row, money: Money): string {
  const available = isLiability(account.type)
    ? availableCredit(account.balanceMinor, account.creditLimit)
    : null;

  if (available === null) return `${account.type} · ${account.currency}`;
  return `${money(available, account.currency)} of ${money(
    account.creditLimit ?? 0,
    account.currency
  )} available`;
}

/**
 * The balance, read the way the account actually works.
 *
 * A card at −5,000 is five thousand of DEBT, not an emptied wallet, and showing
 * the two identically is what teaches someone to distrust the screen. The
 * stored sign never changes — net worth is still a plain sum across every
 * account — this is the render boundary and only the render boundary.
 */
function AccountAmount({ account }: { account: Row }) {
  const money = useMoney();
  if (!isLiability(account.type)) {
    return (
      <Text
        className={`text-base font-semibold ${
          account.balanceMinor < 0 ? 'text-expense' : 'text-income'
        }`}
        testID={`account-amount-${account.id}`}>
        {money(account.balanceMinor, account.currency)}
      </Text>
    );
  }

  const owed = owedDisplay(account.balanceMinor);
  return (
    <View className="items-end">
      <Text
        className={`text-base font-semibold ${owed.isDebt ? 'text-expense' : 'text-income'}`}
        testID={`account-amount-${account.id}`}>
        {money(owed.magnitudeMinor, account.currency)}
      </Text>
      <Text className="text-[11px] text-muted" testID={`account-owed-${account.id}`}>
        {owed.label}
      </Text>
    </View>
  );
}
