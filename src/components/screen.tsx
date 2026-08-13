import { router, useNavigation } from 'expo-router';
import type { DrawerNavigationProp } from 'expo-router/drawer';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Wordmark } from '@/components/wordmark';
import palette from '@/constants/palette';
import { addMonths, formatPeriod, type Period } from '@/lib/period';

/** Header icon button. 44px square: the Material minimum touch target. */
export function HeaderButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-11 w-11 items-center justify-center rounded-full active:bg-raised">
      <Icon name={icon} size={22} color={palette.ink} />
    </Pressable>
  );
}

/**
 * The app's own header, on every tab screen. The tab bar already says which
 * section you are in, so this carries the name rather than repeating the tab
 * label — the same choice the reference app makes.
 *
 * Menu on the left, search on the right: both thumb-reachable corners, and the
 * arrangement every Android user already has muscle memory for.
 */
export function AppHeader({ right }: { right?: React.ReactNode }) {
  // Addressed to the drawer layout explicitly rather than relying on the tab
  // navigator inheriting `openDrawer` from its parent. Passing the path makes
  // expo-router throw "Could not find parent navigation" if the (drawer) group
  // is ever moved — far better than a hamburger that silently does nothing.
  const drawer = useNavigation<DrawerNavigationProp<ReactNavigation.RootParamList>>('/(drawer)');

  return (
    <View className="flex-row items-center bg-surface px-1 pb-2 pt-1">
      <HeaderButton
        icon="menu"
        label="Open menu"
        testID="nav-menu"
        onPress={() => drawer.openDrawer()}
      />
      <Wordmark style={{ flex: 1, paddingLeft: 4 }} testID="app-title" />
      {right}
      <HeaderButton
        icon="search"
        label="Search records"
        testID="nav-search"
        onPress={() => router.push('/search')}
      />
    </View>
  );
}

/**
 * Header for a screen pushed over the tabs — carries a back arrow and its own
 * title instead of the app name.
 */
export function StackHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ paddingTop: insets.top }} className="bg-surface">
      <View className="flex-row items-center bg-surface px-1 pb-2 pt-1">
        <HeaderButton icon="back" label="Go back" testID="nav-back" onPress={() => router.back()} />
        <Text className="flex-1 pl-1 text-xl font-semibold tracking-tight text-ink">{title}</Text>
        {right}
      </View>
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

// ScreenHeader ("Accounts", "Categories") lived here and is gone: the tab bar
// already names the screen you are on, so it spent a row of height restating
// it. Screens pushed *over* the tabs still need a title and a back arrow —
// that is StackHeader, above.

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
  balanceLabel = 'Balance',
  balanceTestID = 'summary-balance',
}: {
  expense: string;
  income: string;
  balance: string;
  /** Drives the balance colour. Passed separately so this stays presentational. */
  balanceMinor: number;
  /**
   * The third cell is either the month's net ("Balance") or the running
   * position ("Now"), depending on whether carry-over is on. It stays ONE cell
   * either way: a fourth column, or a line under the row, is a whole extra band
   * of chrome above the thing you actually came to look at.
   *
   * The testID moves with the label on purpose. Two different numbers under one
   * id would make every assertion about it ambiguous — and a flow that cannot
   * tell which of the two it is reading is a flow that proves nothing.
   */
  balanceLabel?: string;
  balanceTestID?: string;
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
      {/* Takes its colour from its sign. Showing a month you overspent — or a
          position you are underwater on — in the income colour is exactly
          backwards. */}
      {cell(
        balanceLabel,
        balance,
        balanceMinor < 0 ? 'text-expense' : 'text-income',
        balanceTestID
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
  onLongPress,
  longPressLabel,
  testID = 'fab',
  raised = false,
}: {
  onPress: () => void;
  /**
   * The shortcut, when the screen has one.
   *
   * Optional so the category and account FABs are unaffected — a long press
   * that does something on one screen and nothing on another is fine; one that
   * does something DIFFERENT on each is not.
   */
  onLongPress?: () => void;
  /** Named in the accessible label, because a long press is invisible. */
  longPressLabel?: string;
  onPressIn?: () => void;
  testID?: string;
  raised?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={
        longPressLabel ? `Add record. Hold to ${longPressLabel}` : 'Add record'
      }
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
