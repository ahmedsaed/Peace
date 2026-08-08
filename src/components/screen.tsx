import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { addMonths, formatPeriod, type Period } from '@/lib/period';

export function Screen({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-ground" testID={testID}>
      {children}
    </SafeAreaView>
  );
}

/** Plain title bar, for the screens that are not scoped to a month. */
export function ScreenHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between bg-surface px-4 py-3">
      <Text className="text-lg font-semibold text-ink">{title}</Text>
      {right}
    </View>
  );
}

/**
 * The month navigator that anchors Records, Analysis and Budgets. It is the
 * app's spine — almost everything is scoped to one month — so it stays pinned
 * above the content rather than scrolling away with it.
 */
export function MonthHeader({
  period,
  onChange,
  children,
}: {
  period: Period;
  onChange: (next: Period) => void;
  children?: React.ReactNode;
}) {
  return (
    <View className="bg-surface px-4 pb-3 pt-2">
      <View className="flex-row items-center justify-center gap-6">
        <Pressable
          onPress={() => onChange(addMonths(period, -1))}
          hitSlop={16}
          testID="month-prev"
          accessibilityRole="button"
          accessibilityLabel="Previous month">
          <Text className="text-2xl leading-7 text-muted">‹</Text>
        </Pressable>

        <Text className="text-base font-semibold text-ink" testID="month-label">
          {formatPeriod(period)}
        </Text>

        <Pressable
          onPress={() => onChange(addMonths(period, 1))}
          hitSlop={16}
          testID="month-next"
          accessibilityRole="button"
          accessibilityLabel="Next month">
          <Text className="text-2xl leading-7 text-muted">›</Text>
        </Pressable>
      </View>
      {children}
    </View>
  );
}

/**
 * Summary trio under the month navigator. Amounts are pre-formatted by the
 * caller so this stays presentational.
 */
export function SummaryTrio({
  expense,
  income,
  balance,
}: {
  expense: string;
  income: string;
  balance: string;
}) {
  const cell = (label: string, value: string, tone: string, testID: string) => (
    <View className="flex-1 items-center">
      <Text className="mb-0.5 text-[10px] uppercase tracking-widest text-muted">{label}</Text>
      <Text className={`text-xs font-semibold ${tone}`} testID={testID}>
        {value}
      </Text>
    </View>
  );

  return (
    <View className="mt-3 flex-row">
      {cell('Expense', expense, 'text-expense', 'summary-expense')}
      {cell('Income', income, 'text-income', 'summary-income')}
      {cell('Balance', balance, 'text-income', 'summary-balance')}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: string;
  title: string;
  hint: string;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-10">
      <Icon name={icon} size={40} color={palette.line} />
      <Text className="text-center text-base font-medium text-muted">{title}</Text>
      <Text className="text-center text-sm leading-5 text-muted opacity-70">{hint}</Text>
    </View>
  );
}
