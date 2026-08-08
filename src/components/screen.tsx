import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { addMonths, formatPeriod, type Period } from '@/lib/period';

/**
 * The app's own header, on every screen. The tab bar already says which section
 * you are in, so this carries the name rather than repeating the tab label —
 * the same choice the reference app makes.
 */
export function AppHeader({ right }: { right?: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between bg-surface px-4 pb-2 pt-1">
      <Text className="text-xl font-semibold tracking-tight text-accent" testID="app-title">
        Peace
      </Text>
      {right}
    </View>
  );
}

export function Screen({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  // Explicit inset rather than <SafeAreaView edges={['top']}>: Android draws
  // edge-to-edge, and relying on the wrapper put the header inside the status
  // bar. Applying paddingTop to the surface also lets the header's background
  // extend behind the status bar, which is what makes it look intentional.
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-ground" testID={testID}>
      <View style={{ paddingTop: insets.top }} className="bg-surface">
        <AppHeader />
      </View>
      {children}
    </View>
  );
}

/** Section label for the screens that are not scoped to a month. */
export function ScreenHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between bg-surface px-4 pb-3">
      <Text className="text-base font-medium text-muted">{title}</Text>
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
  balanceMinor,
}: {
  expense: string;
  income: string;
  balance: string;
  /** Drives the balance colour. Passed separately so this stays presentational. */
  balanceMinor: number;
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
      {/* Balance takes its colour from its sign. Showing a month you overspent
          in the income colour is exactly backwards. */}
      {cell(
        'Balance',
        balance,
        balanceMinor < 0 ? 'text-expense' : 'text-income',
        'summary-balance'
      )}
    </View>
  );
}

/**
 * Floating action button, bottom-right above the tab bar.
 *
 * `raised` lifts it clear of a snackbar. Material does this too, and the reason
 * is practical rather than decorative: left in place, the FAB sits on top of the
 * snackbar's action and swallows taps meant for "Undo".
 */
export function Fab({
  onPress,
  testID = 'fab',
  raised = false,
}: {
  onPress: () => void;
  testID?: string;
  raised?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Add record"
      className={`absolute right-5 h-14 w-14 items-center justify-center rounded-full bg-accent active:opacity-80 ${
        raised ? 'bottom-24' : 'bottom-5'
      }`}
      style={{
        elevation: 6,
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
      }}>
      <Text className="text-3xl leading-9 text-accent-ink">+</Text>
    </Pressable>
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
