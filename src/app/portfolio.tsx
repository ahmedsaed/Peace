import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { StackHeader } from '@/components/screen';
import palette from '@/constants/palette';
import { db } from '@/db/client';
import {
  createAssetClass,
  createHolding,
  deleteAssetClass,
  deleteHolding,
  portfolioSnapshot,
  PortfolioError,
  rebalancePlan,
  updateAssetClass,
} from '@/db/repo/portfolio';
import { testIdSlug } from '@/lib/id';
import { parseAmountToMinor } from '@/lib/money';
import {
  driftBand,
  FULL_ALLOCATION_BP,
  UNIT_SCALE,
  type Recommendation,
} from '@/lib/portfolio';
import { useSetting } from '@/state/settings';
import { useMoney } from '@/state/money';

/**
 * Keeping an investment portfolio near its target allocation.
 *
 * DELIBERATELY NOT CONNECTED TO THE LEDGER. Buying units writes no transaction,
 * and none of these figures reach the Accounts total or the monthly summary.
 * That is a decision, not an omission: portfolio value moves with the market
 * every day, and letting it into those totals would make "what did I spend this
 * month" answerable only alongside "what did the market do this month".
 *
 * The strategy never says sell. Drift is corrected by pointing the NEXT
 * contribution at whatever is behind — no capital gains event, nothing to act
 * on until you were going to invest anyway.
 */
export default function PortfolioScreen() {
  const currency = useSetting('homeCurrency');
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Re-read on every change rather than holding a copy: the alternative is two
  // sources of truth for figures that must agree with each other.
  const snapshot = portfolioSnapshot(db);
  void version;

  const [className, setClassName] = useState('');
  const [classTarget, setClassTarget] = useState('');
  const [holdingName, setHoldingName] = useState('');
  const [holdingClass, setHoldingClass] = useState<string | null>(null);
  const [units, setUnits] = useState('');
  const [price, setPrice] = useState('');
  const [contribution, setContribution] = useState('');
  const [plan, setPlan] = useState<Recommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const format = useMoney();
  const money = (minor: number) => format(minor, currency);

  const guard = useCallback((work: () => void) => {
    try {
      setError(null);
      work();
    } catch (caught) {
      setError(caught instanceof PortfolioError ? caught.message : 'Something went wrong.');
    }
  }, []);

  const onAddClass = useCallback(() => {
    guard(() => {
      const percent = Number(classTarget);
      if (!Number.isFinite(percent) || percent <= 0) {
        throw new PortfolioError('Enter a target percentage.');
      }
      // Percent in, basis points stored. Rounding here rather than at the
      // boundary would let 12.345% become a target nothing can sum to 100.
      createAssetClass(db, { name: className, targetBp: Math.round(percent * 100) });
      setClassName('');
      setClassTarget('');
      setPlan(null);
      refresh();
    });
  }, [guard, className, classTarget, refresh]);

  const onAddHolding = useCallback(() => {
    guard(() => {
      if (!holdingClass) throw new PortfolioError('Pick an asset class first.');
      const unitCount = Number(units);
      if (!Number.isFinite(unitCount) || unitCount <= 0) {
        throw new PortfolioError('Units must be more than zero.');
      }
      createHolding(db, {
        name: holdingName,
        assetClassId: holdingClass,
        unitsMicro: Math.round(unitCount * UNIT_SCALE),
        priceMinor: parseAmountToMinor(price, currency) ?? 0,
      });
      setHoldingName('');
      setUnits('');
      setPrice('');
      setPlan(null);
      refresh();
    });
  }, [guard, holdingClass, holdingName, units, price, currency, refresh]);

  const onPlan = useCallback(() => {
    guard(() => {
      const minor = parseAmountToMinor(contribution, currency) ?? 0;
      if (minor <= 0) throw new PortfolioError('Enter what you plan to invest.');
      setPlan(rebalancePlan(db, minor));
    });
  }, [guard, contribution, currency]);

  const confirmDelete = useCallback(
    (title: string, message: string, remove: () => void) => {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            remove();
            setPlan(null);
            refresh();
          },
        },
      ]);
    },
    [refresh]
  );

  const targetPercent = (snapshot.targetsTotalBp / 100).toFixed(1);

  return (
    <View className="flex-1 bg-ground" testID="portfolio-screen">
      <StackHeader title="Portfolio" />

      <ScrollView contentContainerClassName="px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
        <View className="mb-6 px-1">
          <Text className="text-2xl font-semibold text-ink" testID="portfolio-total">
            {money(snapshot.totalValueMinor)}
          </Text>
          <Text className="mt-1 text-sm text-muted">
            {snapshot.holdings.length === 1 ? '1 holding' : `${snapshot.holdings.length} holdings`}
            {snapshot.classes.length > 0 ? ` across ${snapshot.classes.length} classes` : ''}
          </Text>
        </View>

        {/*
          THE ENTRY FORM SITS ABOVE ITS LIST IN BOTH CARDS, not below it.
          Underneath, the form drifts further down the screen with every row
          added — and once it passes the top of the keyboard, the units, price
          and Add controls are simply unreachable without dismissing the
          keyboard first. That is not hypothetical: an E2E run typed a holding's
          unit count into its NAME field, because the tap meant for "units"
          landed on a control hidden behind the keyboard.

          Above the list, the form's position does not move as the list grows.
        */}

        {/* --- Targets ------------------------------------------------- */}
        <Label>Target allocation</Label>
        <View className="mb-6 rounded-xl bg-surface p-4">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-sm text-muted">Total</Text>
            <Text
              className={`text-sm font-semibold ${
                snapshot.targetsComplete ? 'text-income' : 'text-expense'
              }`}
              testID="portfolio-target-total">
              {targetPercent}% of 100%
            </Text>
          </View>

          <View className="mb-3 flex-row items-center gap-2">
            <TextInput
              value={className}
              onChangeText={setClassName}
              placeholder="Asset class"
              placeholderTextColor={palette.muted}
              className="flex-1 rounded-lg border border-line px-3 py-2 text-ink"
              testID="portfolio-class-name"
            />
            <TextInput
              value={classTarget}
              onChangeText={setClassTarget}
              placeholder="%"
              placeholderTextColor={palette.muted}
              keyboardType="decimal-pad"
              className="w-16 rounded-lg border border-line px-2 py-2 text-right text-ink"
              testID="portfolio-class-target"
            />
            <Button label="Add" onPress={onAddClass} testID="portfolio-class-add" primary />
          </View>
          {snapshot.classes.map((c) => (
            <View
              key={c.id}
              className="mb-2 flex-row items-center gap-2"
              testID={`portfolio-class-${slug(c.name)}`}>
              <Text className="flex-1 text-[15px] text-ink" numberOfLines={1}>
                {c.name}
              </Text>
              <TextInput
                defaultValue={(c.targetBp / 100).toString()}
                keyboardType="decimal-pad"
                onEndEditing={(e) =>
                  guard(() => {
                    const percent = Number(e.nativeEvent.text);
                    if (!Number.isFinite(percent) || percent < 0) return;
                    updateAssetClass(db, c.id, { targetBp: Math.round(percent * 100) });
                    setPlan(null);
                    refresh();
                  })
                }
                className="w-16 rounded-lg border border-line px-2 py-1.5 text-right text-ink"
                testID={`portfolio-target-${slug(c.name)}`}
              />
              <Text className="w-4 text-sm text-muted">%</Text>
              <Pressable
                onPress={() =>
                  confirmDelete(
                    `Delete ${c.name}?`,
                    'Its holdings are deleted with it — a holding with no class would drop out of every total while still being listed as owned.',
                    () => deleteAssetClass(db, c.id)
                  )
                }
                testID={`portfolio-class-delete-${slug(c.name)}`}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${c.name}`}
                className="px-1 py-1">
                <Icon name="dots" size={16} color={palette.expense} />
              </Pressable>
            </View>
          ))}

        </View>

        {/* --- Holdings ------------------------------------------------ */}
        <Label>Holdings</Label>
        <View className="mb-6 rounded-xl bg-surface p-4">
          {snapshot.classes.length === 0 ? (
            <Text className="text-sm text-muted" testID="portfolio-no-classes">
              Add an asset class first — a holding has to belong to one.
            </Text>
          ) : (
            <>
              <View className="mb-3 gap-2">
                <TextInput
                  value={holdingName}
                  onChangeText={setHoldingName}
                  placeholder="Holding name"
                  placeholderTextColor={palette.muted}
                  className="rounded-lg border border-line px-3 py-2 text-ink"
                  testID="portfolio-holding-name"
                />
                <View className="flex-row flex-wrap gap-2">
                  {snapshot.classes.map((c) => (
                    <Chip
                      key={c.id}
                      label={c.name}
                      selected={holdingClass === c.id}
                      onPress={() => setHoldingClass(c.id)}
                      testID={`portfolio-pick-${slug(c.name)}`}
                    />
                  ))}
                </View>
                <View className="flex-row items-center gap-2">
                  <TextInput
                    value={units}
                    onChangeText={setUnits}
                    placeholder="Units"
                    placeholderTextColor={palette.muted}
                    keyboardType="decimal-pad"
                    className="flex-1 rounded-lg border border-line px-3 py-2 text-ink"
                    testID="portfolio-holding-units"
                  />
                  <TextInput
                    value={price}
                    onChangeText={setPrice}
                    placeholder="Price each"
                    placeholderTextColor={palette.muted}
                    keyboardType="decimal-pad"
                    className="flex-1 rounded-lg border border-line px-3 py-2 text-ink"
                    testID="portfolio-holding-price"
                  />
                  <Button label="Add" onPress={onAddHolding} testID="portfolio-holding-add" primary />
                </View>
              </View>
              {snapshot.holdings.map((h) => (
                <View
                  key={h.id}
                  className="mb-2 flex-row items-center gap-2"
                  testID={`portfolio-holding-${slug(h.name)}`}>
                  <View className="flex-1">
                    <Text className="text-[15px] text-ink" numberOfLines={1}>
                      {h.name}
                    </Text>
                    <Text className="text-xs text-muted">
                      {h.unitsMicro / UNIT_SCALE} × {money(h.priceMinor)}
                    </Text>
                  </View>
                  <Text className="text-sm text-ink">
                    {money(Math.round((h.unitsMicro * h.priceMinor) / UNIT_SCALE))}
                  </Text>
                  <Pressable
                    onPress={() =>
                      confirmDelete(`Delete ${h.name}?`, 'This removes the holding.', () =>
                        deleteHolding(db, h.id)
                      )
                    }
                    testID={`portfolio-holding-delete-${slug(h.name)}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${h.name}`}
                    className="px-1 py-1">
                    <Icon name="dots" size={16} color={palette.expense} />
                  </Pressable>
                </View>
              ))}

            </>
          )}
        </View>

        {/* --- Drift ---------------------------------------------------- */}
        {snapshot.holdings.length > 0 ? (
          <>
            <Label>Drift</Label>
            <View className="mb-6 rounded-xl bg-surface p-4" testID="portfolio-drift">
              {snapshot.drift.map((row) => {
                const band = driftBand(row.driftBp);
                const tone =
                  band === 'off-target'
                    ? 'text-expense'
                    : band === 'drifting'
                      ? 'text-accent'
                      : 'text-income';
                return (
                  <View key={row.assetClassId} className="mb-3 last:mb-0">
                    <View className="mb-1 flex-row items-center justify-between">
                      <Text className="text-[15px] text-ink">{row.name}</Text>
                      <Text className={`text-sm font-semibold ${tone}`}>
                        {row.driftBp > 0 ? '+' : ''}
                        {(row.driftBp / 100).toFixed(1)}%
                      </Text>
                    </View>
                    <Text className="text-xs text-muted">
                      {(row.currentBp / 100).toFixed(1)}% now · {(row.targetBp / 100).toFixed(1)}%
                      target · {money(row.currentValueMinor)}
                    </Text>
                    {/* Geometry from the VALUES, never from the rounded
                        percentages — the same rule as the analysis donut. */}
                    <View className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
                      <View
                        className="h-full rounded-full bg-accent"
                        style={{
                          width: `${Math.min(100, (row.currentBp / FULL_ALLOCATION_BP) * 100)}%`,
                        }}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}

        {/* --- Rebalance ------------------------------------------------ */}
        <Label>Next contribution</Label>
        <View className="mb-4 rounded-xl bg-surface p-4">
          <Text className="mb-3 text-sm leading-5 text-muted">
            Enter what you plan to invest and it is split towards whatever is behind. Nothing is
            ever sold.
          </Text>
          <View className="flex-row items-center gap-2">
            <TextInput
              value={contribution}
              onChangeText={setContribution}
              placeholder="Amount"
              placeholderTextColor={palette.muted}
              keyboardType="decimal-pad"
              className="flex-1 rounded-lg border border-line px-3 py-2 text-ink"
              testID="portfolio-contribution"
            />
            <Button label="Work it out" onPress={onPlan} testID="portfolio-plan" primary />
          </View>

          {plan ? (
            <View className="mt-4" testID="portfolio-plan-result">
              {plan.map((row) => (
                <View
                  key={row.assetClassId}
                  className="mb-2 flex-row items-center justify-between"
                  testID={`portfolio-invest-${slug(row.name)}`}>
                  <Text className="text-[15px] text-ink">{row.name}</Text>
                  <Text
                    className={`text-sm font-semibold ${
                      row.investMinor > 0 ? 'text-income' : 'text-muted'
                    }`}>
                    {row.investMinor > 0 ? money(row.investMinor) : 'nothing needed'}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {error ? (
          <Text className="px-1 text-sm text-expense" testID="portfolio-error">
            {error}
          </Text>
        ) : null}

        <Text className="mt-6 px-1 text-xs leading-5 text-muted">
          Kept separate from your ledger on purpose. Buying units records no transaction, and
          portfolio value never moves your accounts or your monthly totals.
        </Text>
      </ScrollView>
    </View>
  );
}

/**
 * A testID a flow can predict.
 *
 * Row ids are UUIDs, so `portfolio-target-<id>` is unaddressable from a Maestro
 * flow — it cannot know the id, and a `.*` pattern matches every row at once.
 * The NAME is what the flow typed in, so the name is what the id is built from.
 */
const slug = (name: string) => testIdSlug(name.toLowerCase());

function Label({ children }: { children: string }) {
  return (
    <Text className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted">
      {children}
    </Text>
  );
}

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`rounded-full px-3.5 py-1.5 active:opacity-80 ${
        selected ? 'bg-accent' : 'border border-line'
      }`}>
      <Text className={`text-sm ${selected ? 'font-semibold text-accent-ink' : 'text-ink'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function Button({
  label,
  onPress,
  testID,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`self-start rounded-lg px-4 py-2.5 active:opacity-80 ${
        primary ? 'bg-accent' : 'border border-line'
      }`}>
      <Text className={`text-sm font-semibold ${primary ? 'text-accent-ink' : 'text-ink'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
