import { ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Screen, ScreenHeader } from '@/components/screen';
import { db } from '@/db/client';
import { listAccountsWithBalance, totalBalance } from '@/db/repo/accounts';
import { formatMinor } from '@/lib/money';

/**
 * Reads synchronously on render. There is nothing to mutate accounts from yet,
 * so a live query would buy nothing; this moves to `useLiveQuery` in Stage 1
 * when records start changing balances.
 */
export default function AccountsScreen() {
  const accounts = listAccountsWithBalance(db);
  const total = totalBalance(db);

  return (
    <Screen testID="accounts-screen">
      <ScreenHeader title="Accounts" />

      <View className="items-center bg-surface px-4 pb-4">
        <Text className="mb-1 text-[10px] uppercase tracking-widest text-muted">All accounts</Text>
        <Text className="text-xl font-semibold text-ink" testID="accounts-total">
          {formatMinor(total, 'EGP')}
        </Text>
      </View>

      <ScrollView contentContainerClassName="p-4 gap-3">
        {accounts.map((account) => (
          <View
            key={account.id}
            className="flex-row items-center gap-3 rounded-xl bg-surface p-3"
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
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
