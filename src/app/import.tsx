import { File } from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { StackHeader } from '@/components/screen';
import { db } from '@/db/client';
import { applyImport, ledgerSnapshot, undoImport } from '@/db/repo/imports';
import { parseCsv } from '@/lib/csv';
import { idsInFile, planImport, type ImportPlan, type NewCategory } from '@/lib/import-csv';
import { formatDayLabel } from '@/lib/period';
import { useSetting } from '@/state/settings';
import { useTheme } from '@/state/theme';

/** Bigger than any ledger anyone types by hand; a file this size is something else. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Problems listed on screen. The count above them is always the full one. */
const SHOWN_PROBLEMS = 50;

type State =
  | { step: 'reading' }
  | { step: 'failed'; message: string }
  | { step: 'preview'; plan: ImportPlan }
  | { step: 'importing'; plan: ImportPlan }
  | { step: 'done'; importId: string; records: number }
  | { step: 'undone'; records: number };

/**
 * Import › preview › done.
 *
 * NOTHING IS WRITTEN UNTIL THE BUTTON. The file is read and planned, and this
 * screen says exactly what would happen — how many records, over which dates,
 * which accounts and categories the file names that the ledger does not have
 * (they will be created), what is already here (skipped), and every row that
 * cannot be imported, by line number and reason. A person fixing a file in a
 * spreadsheet needs the line; "12 rows had errors" sends them hunting.
 *
 * The import is undoable as one batch, here and later from Backup & export —
 * an import is the one action that can put a thousand wrong records into a
 * ledger with a single tap.
 */
export default function ImportScreen() {
  const palette = useTheme();
  const router = useRouter();
  const { uri, name } = useLocalSearchParams<{ uri?: string; name?: string }>();
  const homeCurrency = useSetting('homeCurrency');
  const [state, setState] = useState<State>({ step: 'reading' });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!uri) throw new Error('No file was chosen.');
        const file = new File(uri);
        if (file.size > MAX_BYTES) {
          throw new Error('That file is over 5 MB — too big to be a ledger. Is it the right one?');
        }
        const table = parseCsv(await file.text());
        const plan = planImport(table, ledgerSnapshot(db, homeCurrency, idsInFile(table)));
        if (!live) return;
        setState('error' in plan ? { step: 'failed', message: plan.error } : { step: 'preview', plan });
      } catch (e) {
        console.warn('[import] could not read the file', e);
        if (live) {
          setState({
            step: 'failed',
            message: e instanceof Error && e.message ? e.message : 'Could not read that file.',
          });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [uri, homeCurrency]);

  const run = (plan: ImportPlan) => {
    setState({ step: 'importing', plan });
    // A frame for "Importing…" to draw: the write itself is synchronous.
    setTimeout(() => {
      try {
        const importId = applyImport(db, plan, { fileName: name ?? null, homeCurrency });
        setState({ step: 'done', importId, records: plan.rows.length });
      } catch (e) {
        console.warn('[import] failed', e);
        setState({
          step: 'failed',
          message: `Nothing was imported — ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }, 30);
  };

  return (
    <View className="flex-1 bg-ground" testID="import-screen">
      <StackHeader title="Import records" />
      <ScrollView contentContainerClassName="gap-5 px-4 pb-12 pt-4">
        {name ? (
          <View className="flex-row items-center gap-2 px-1">
            <Icon name="document" size={14} color={palette.muted} />
            <Text className="flex-1 text-sm text-muted" numberOfLines={1}>
              {name}
            </Text>
          </View>
        ) : null}

        {state.step === 'reading' ? <Text className="px-1 text-base text-muted">Reading…</Text> : null}

        {state.step === 'failed' ? (
          <View className="gap-4">
            <Text className="px-1 text-base leading-6 text-expense" testID="import-failed">
              {state.message}
            </Text>
            <Action label="Back" onPress={() => router.back()} testID="import-back" />
          </View>
        ) : null}

        {state.step === 'preview' || state.step === 'importing' ? (
          <Preview plan={state.plan} busy={state.step === 'importing'} onImport={() => run(state.plan)} />
        ) : null}

        {state.step === 'done' ? (
          <View className="gap-4">
            <Text className="px-1 text-2xl font-semibold text-ink" testID="import-done-count">
              {state.records === 1 ? '1 record imported.' : `${state.records} records imported.`}
            </Text>
            <Text className="px-1 text-sm leading-5 text-muted">
              Not what you expected? Undo takes back every record this file added, and the accounts and
              categories it created. It stays available in Backup &amp; export until the next import.
            </Text>
            <View className="flex-row gap-2">
              <Action label="Done" primary onPress={() => router.back()} testID="import-finish" />
              <Action
                label="Undo"
                onPress={() => setState({ step: 'undone', records: undoImport(db, state.importId) })}
                testID="import-undo-now"
              />
            </View>
          </View>
        ) : null}

        {state.step === 'undone' ? (
          <View className="gap-4">
            <Text className="px-1 text-base text-ink" testID="import-undone">
              Undone — the import is gone from your ledger.
            </Text>
            <Action label="Done" primary onPress={() => router.back()} testID="import-finish" />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Preview({ plan, busy, onImport }: { plan: ImportPlan; busy: boolean; onImport: () => void }) {
  const n = plan.rows.length;
  const parts = [
    [plan.counts.expense, 'expense', 'expenses'],
    [plan.counts.income, 'income', 'incomes'],
    [plan.counts.transfer, 'transfer', 'transfers'],
    [plan.counts.correction, 'correction', 'corrections'],
  ]
    .filter(([count]) => (count as number) > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  const categoryName = (c: NewCategory) => (c.parentName ? `${c.parentName} › ${c.name}` : c.name);

  return (
    <View className="gap-5">
      <View className="px-1">
        <Text className="text-2xl font-semibold text-ink" testID="import-count">
          {n === 1 ? '1 record to import' : `${n} records to import`}
        </Text>
        {plan.span ? (
          <Text className="mt-1 text-sm text-muted" testID="import-span">
            {formatDayLabel(plan.span.from)} – {formatDayLabel(plan.span.to)}
            {parts.length > 0 ? ` · ${parts.join(', ')}` : ''}
          </Text>
        ) : null}
        {plan.alreadyThere > 0 ? (
          <Text className="mt-1 text-sm text-muted" testID="import-already">
            {plan.alreadyThere === 1
              ? '1 record is already in Peace and will be skipped.'
              : `${plan.alreadyThere} records are already in Peace and will be skipped.`}
          </Text>
        ) : null}
      </View>

      {plan.newAccounts.length > 0 ? (
        <Group title="New accounts" testID="import-new-accounts">
          {plan.newAccounts.map((a) => `${a.name} · ${a.currency}`)}
        </Group>
      ) : null}
      {plan.newCategories.length > 0 ? (
        <Group title="New categories" testID="import-new-categories">
          {plan.newCategories.map((c) => `${categoryName(c)} · ${c.kind}`)}
        </Group>
      ) : null}
      {plan.newTags.length > 0 ? (
        <Group title="New tags" testID="import-new-tags">
          {[plan.newTags.join(', ')]}
        </Group>
      ) : null}

      {plan.problems.length > 0 ? (
        <View testID="import-problems">
          <Text className="mb-2 px-1 text-sm font-semibold text-expense" testID="import-problem-count">
            {plan.problems.length === 1
              ? '1 row can’t be imported — the rest can'
              : `${plan.problems.length} rows can’t be imported — the rest can`}
          </Text>
          <View className="gap-1.5 rounded-xl bg-surface p-4">
            {plan.problems.slice(0, SHOWN_PROBLEMS).map((p) => (
              <Text key={p.line} className="text-sm leading-5 text-muted">
                <Text className="text-ink">Line {p.line}</Text> — {p.message}
              </Text>
            ))}
            {plan.problems.length > SHOWN_PROBLEMS ? (
              <Text className="text-sm text-muted">…and {plan.problems.length - SHOWN_PROBLEMS} more.</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {n > 0 ? (
        <Action
          label={busy ? 'Importing…' : n === 1 ? 'Import 1 record' : `Import ${n} records`}
          primary
          disabled={busy}
          onPress={onImport}
          testID="import-confirm"
        />
      ) : (
        <Text className="px-1 text-base text-muted" testID="import-nothing">
          Nothing in this file can be added.
        </Text>
      )}
    </View>
  );
}

function Group({ title, testID, children }: { title: string; testID: string; children: string[] }) {
  return (
    <View testID={testID}>
      <Text className="mb-2 px-1 text-[10px] uppercase tracking-widest text-muted">{title}</Text>
      <View className="gap-1 rounded-xl bg-surface px-4 py-3">
        {children.map((line) => (
          <Text key={line} className="text-sm leading-5 text-ink">
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Action({
  label,
  onPress,
  testID,
  primary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      className={`items-center rounded-full px-6 py-3 active:opacity-80 ${
        primary ? 'bg-accent' : 'border border-line'
      } ${disabled ? 'opacity-50' : ''}`}>
      <Text className={`text-base font-semibold ${primary ? 'text-accent-ink' : 'text-ink'}`}>{label}</Text>
    </Pressable>
  );
}
