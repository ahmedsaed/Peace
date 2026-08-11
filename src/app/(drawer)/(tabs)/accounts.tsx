import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Fab, Screen } from '@/components/screen';
import { db } from '@/db/client';
import { balanceByCurrency, listAccountsWithBalance, type CurrencyTotal } from '@/db/repo/accounts';
import { formatMinor } from '@/lib/money';
import { useSetting } from '@/state/settings';

export default function AccountsScreen() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ReturnType<typeof listAccountsWithBalance>>([]);
  const [totals, setTotals] = useState<CurrencyTotal[]>([]);
  const homeCurrency = useSetting('homeCurrency');

  // Re-read on focus so a balance change, or a newly added account, shows up on
  // the way back from any other screen.
  useFocusEffect(
    useCallback(() => {
      setAccounts(listAccountsWithBalance(db));
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
            {formatMinor(0, homeCurrency)}
          </Text>
        ) : (
          totals.map((total, index) => (
            <Text
              key={total.currency}
              className={`font-semibold text-ink ${index === 0 ? 'text-xl' : 'text-base'}`}
              testID={index === 0 ? 'accounts-total' : `accounts-total-${total.currency}`}>
              {formatMinor(total.balanceMinor, total.currency)}
            </Text>
          ))
        )}
      </View>

      <ScrollView contentContainerClassName="p-4 gap-3">
        {accounts.map((account) => (
          <Pressable
            key={account.id}
            onPress={() => router.push({ pathname: '/account', params: { id: account.id } })}
            className="flex-row items-center gap-3 rounded-xl bg-surface p-3 active:opacity-70"
            testID={`account-${account.id}`}>
            <View
              className="h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: account.color ?? '#6B5B4A' }}>
              <Icon name={account.icon ?? 'wallet'} size={18} color="#FFFFFF" />
            </View>

            <View className="flex-1">
              <Text className="text-base text-ink">{account.name}</Text>
              <Text className="text-xs capitalize text-muted">
                {account.type} · {account.currency}
              </Text>
            </View>

            <Text
              className={`text-base font-semibold ${
                account.balanceMinor < 0 ? 'text-expense' : 'text-income'
              }`}>
              {formatMinor(account.balanceMinor, account.currency)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <Fab onPress={() => router.push('/account')} testID="fab-account" />
    </Screen>
  );
}
