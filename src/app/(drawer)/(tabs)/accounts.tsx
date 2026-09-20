import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Fab, Screen } from '@/components/screen';
import { db } from '@/db/client';
import {
  balanceByCurrency,
  listAccountsWithBalance,
  listArchivedAccounts,
  type CurrencyTotal,
} from '@/db/repo/accounts';
import { availableCredit, isLiability, owedDisplay } from '@/lib/liability';
import { useSetting } from '@/state/settings';
import { useMoney, type Money } from '@/state/money';

export default function AccountsScreen() {
  const money = useMoney();
  const router = useRouter();
  const [accounts, setAccounts] = useState<ReturnType<typeof listAccountsWithBalance>>([]);
  const [archived, setArchived] = useState<ReturnType<typeof listAccountsWithBalance>>([]);
  const [totals, setTotals] = useState<CurrencyTotal[]>([]);
  const homeCurrency = useSetting('homeCurrency');

  // Re-read on focus so a balance change, or a newly added account, shows up on
  // the way back from any other screen.
  useFocusEffect(
    useCallback(() => {
      setAccounts(listAccountsWithBalance(db));
      setArchived(listArchivedAccounts(db));
      setTotals(balanceByCurrency(db));
    }, [])
  );

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
          />
        ))}

        {/* The total above counts these, so the list has to show them — a
            figure that includes money the screen never mentions is a screen
            disagreeing with itself. They sit at the foot, dimmed, because the
            point of archiving one is that it stops being in the way. */}
        {archived.length > 0 ? (
          <View className="gap-3 pt-3" testID="accounts-archived">
            <View className="px-1">
              <Text className="text-[10px] uppercase tracking-widest text-muted">Archived</Text>
              <Text className="pt-0.5 text-xs text-muted">
                Still counted above, and off every picker. Settings brings one back.
              </Text>
            </View>
            {archived.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                dimmed
                onPress={() => router.push({ pathname: '/account', params: { id: account.id } })}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <Fab onPress={() => router.push('/account')} testID="fab-account" />
    </Screen>
  );
}

type Row = ReturnType<typeof listAccountsWithBalance>[number];

/**
 * One account, in either group.
 *
 * Shared rather than written twice: an archived account is the same row with
 * the colour turned down, and two copies would drift the moment a card grew a
 * field. It stays tappable while dimmed — the editor is where the archive
 * toggle lives, so the row is also a way back.
 */
function AccountRow({
  account,
  onPress,
  dimmed = false,
}: {
  account: Row;
  onPress: () => void;
  dimmed?: boolean;
}) {
  const money = useMoney();

  return (
    <Pressable
      onPress={onPress}
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
