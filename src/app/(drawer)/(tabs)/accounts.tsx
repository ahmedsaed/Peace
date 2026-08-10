import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Fab, Screen } from '@/components/screen';
import { db } from '@/db/client';
import { listAccountsWithBalance, totalBalance } from '@/db/repo/accounts';
import { formatMinor } from '@/lib/money';
import { useSetting } from '@/state/settings';

export default function AccountsScreen() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ReturnType<typeof listAccountsWithBalance>>([]);
  const [total, setTotal] = useState(0);
  const homeCurrency = useSetting('homeCurrency');

  // Re-read on focus so a balance change, or a newly added account, shows up on
  // the way back from any other screen.
  useFocusEffect(
    useCallback(() => {
      setAccounts(listAccountsWithBalance(db));
      setTotal(totalBalance(db));
    }, [])
  );

  return (
    <Screen testID="accounts-screen">
      {/* No "Accounts" caption: the active tab already says which screen this
          is, and repeating it cost a row of height for no information. */}
      <View className="items-center bg-surface px-4 pb-4 pt-1">
        <Text className="mb-1 text-[10px] uppercase tracking-widest text-muted">All accounts</Text>
        <Text className="text-xl font-semibold text-ink" testID="accounts-total">
          {formatMinor(total, homeCurrency)}
        </Text>
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
