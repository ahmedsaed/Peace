import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Proposal } from '@/assistant/engine';
import { shareReport } from '@/assistant/export';
import type { ReportSpec } from '@/assistant/tools/types';
import { Icon } from '@/components/icon';
import { RecordRow } from '@/components/record-row';
import palette from '@/constants/palette';
import type { RecordRow as Row } from '@/db/repo/records';
import { useMoney } from '@/state/money';

/**
 * The approval card: the one thing standing between a model's guess and the
 * ledger.
 *
 * It says what WILL happen in the same words and figures the rest of the app
 * uses, and nothing happens until a tap. A delete asks twice — the first tap
 * arms it and turns the button red, the second does it — because "the
 * assistant deleted forty records" must never be one mis-tap away.
 */
export function ProposalCard({
  proposal,
  disabled,
  expired,
  onDecide,
  testID,
}: {
  proposal: Proposal;
  disabled: boolean;
  /** Left undecided before a reset — see `toItems`. */
  expired: boolean;
  onDecide: (approve: boolean) => void;
  testID: string;
}) {
  const money = useMoney();
  const [armed, setArmed] = useState(false);
  const { preview, status } = proposal;
  const pending = status === 'pending' && !expired;

  const outcome =
    status === 'approved'
      ? { text: 'Done', tone: 'text-income' }
      : status === 'declined'
        ? { text: 'Declined', tone: 'text-muted' }
        : status === 'failed'
          ? { text: proposal.error ?? 'Could not be applied', tone: 'text-expense' }
          : expired
            ? { text: 'Not answered before the conversation was reset — nothing was changed', tone: 'text-muted' }
            : null;

  return (
    <View
      className={`rounded-xl border bg-surface p-4 ${preview.danger && pending ? 'border-expense' : 'border-line'}`}
      testID={testID}>
      <View className="mb-2 flex-row items-center gap-2">
        <Icon name="sparkle" size={14} color={preview.danger ? palette.expense : palette.accent} />
        <Text className="flex-1 text-[15px] font-semibold text-ink" testID={`${testID}-title`}>
          {preview.title}
        </Text>
      </View>

      {preview.lines.map((line, i) => (
        <View key={i} className="flex-row items-baseline gap-3 py-0.5">
          <Text className={`text-sm text-muted ${line.value || line.figure ? '' : 'flex-1'}`} numberOfLines={2}>
            {line.label}
          </Text>
          {line.value !== undefined || line.figure ? (
            <Text className="flex-1 text-right text-sm text-ink" numberOfLines={2}>
              {line.before ? <Text className="text-muted line-through">{line.before} </Text> : null}
              {line.figure ? money(line.figure.minor, line.figure.currency, { showSign: true }) : line.value}
            </Text>
          ) : null}
        </View>
      ))}

      {pending ? (
        <View className="mt-3 flex-row gap-2">
          <Pressable
            onPress={() => {
              if (preview.danger && !armed) {
                setArmed(true);
                return;
              }
              onDecide(true);
            }}
            disabled={disabled}
            testID={`${testID}-approve`}
            accessibilityRole="button"
            className={`flex-1 items-center rounded-lg py-2.5 active:opacity-80 ${
              preview.danger ? 'bg-expense' : 'bg-accent'
            } ${disabled ? 'opacity-40' : ''}`}>
            <Text className="text-sm font-semibold text-accent-ink">
              {preview.danger && armed ? `Tap again to ${preview.confirmLabel.toLowerCase()}` : preview.confirmLabel}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onDecide(false)}
            disabled={disabled}
            testID={`${testID}-decline`}
            accessibilityRole="button"
            className={`items-center rounded-lg border border-line px-5 py-2.5 active:bg-raised ${disabled ? 'opacity-40' : ''}`}>
            <Text className="text-sm font-semibold text-muted">Decline</Text>
          </Pressable>
        </View>
      ) : (
        <Text className={`mt-2 text-xs font-semibold ${outcome?.tone ?? ''}`} testID={`${testID}-status`}>
          {outcome?.text}
        </Text>
      )}
    </View>
  );
}

/** A list the assistant put on screen: the first few rows, and the way to the rest. */
export function RecordsCard({
  title,
  rangeLabel,
  rows,
  matchCount,
  onOpenAll,
  onOpenRow,
  testID,
}: {
  title: string;
  rangeLabel: string;
  rows: Row[];
  matchCount: number;
  onOpenAll: () => void;
  onOpenRow: (id: string) => void;
  testID: string;
}) {
  const shown = rows.slice(0, 4);
  return (
    <View className="overflow-hidden rounded-xl border border-line bg-surface" testID={testID}>
      <View className="px-4 pb-1 pt-3">
        <Text className="text-[15px] font-semibold text-ink">{title}</Text>
        <Text className="text-xs text-muted">
          {rangeLabel} · {matchCount === 1 ? '1 record' : `${matchCount} records`}
        </Text>
      </View>
      {shown.length === 0 ? (
        <Text className="px-4 py-3 text-sm text-muted">These records no longer exist.</Text>
      ) : (
        shown.map((row) => <RecordRow key={row.id} row={row} onPress={() => onOpenRow(row.id)} />)
      )}
      {rows.length > shown.length ? (
        <Pressable onPress={onOpenAll} testID={`${testID}-all`} className="border-t border-line px-4 py-2.5 active:bg-raised">
          <Text className="text-sm font-semibold text-accent">See all {rows.length}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A finished report, and the button that turns it into a PDF to share. */
export function ReportCard({ report, testID }: { report: ReportSpec; testID: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      await shareReport(report);
    } catch (e) {
      // Friendly sentence for the screen, the real failure for the log.
      console.warn('[assistant] report export failed', e);
      setError('Could not make the PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-row items-center gap-3 rounded-xl border border-line bg-surface p-4" testID={testID}>
      <View className="h-11 w-11 items-center justify-center rounded-lg bg-raised">
        <Icon name="document" size={22} color={palette.accent} />
      </View>
      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-ink" numberOfLines={2}>
          {report.title}
        </Text>
        <Text className="text-xs text-muted">
          {report.rangeLabel} · {report.sections.length} section{report.sections.length === 1 ? '' : 's'} · PDF
        </Text>
        {error ? <Text className="mt-1 text-xs text-expense">{error}</Text> : null}
      </View>
      <Pressable
        onPress={open}
        disabled={busy}
        testID={`${testID}-share`}
        accessibilityRole="button"
        className={`rounded-lg bg-accent px-4 py-2.5 active:opacity-80 ${busy ? 'opacity-40' : ''}`}>
        <Text className="text-sm font-semibold text-accent-ink">{busy ? 'Making…' : 'Share'}</Text>
      </Pressable>
    </View>
  );
}
