import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { StackHeader } from '@/components/screen';
import palette from '@/constants/palette';
import { csvExport, databaseBackup, formatBytes, recordCount } from '@/db/backup';

type Busy = 'csv' | 'backup' | null;

/**
 * Export and backup.
 *
 * Both routes end at the system share sheet rather than writing to a folder.
 * Android scoped storage makes "save to Downloads" a permission dance, while
 * the share sheet already offers Drive, email, Files and everything else — and
 * it puts the copy somewhere off the phone, which is the only place a backup is
 * worth anything.
 */
export default function ExportScreen() {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const count = recordCount();

  const run = useCallback(async (kind: Exclude<Busy, null>) => {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device.');
      }
      const { file, bytes } = kind === 'csv' ? csvExport() : await databaseBackup();
      await Sharing.shareAsync(file.uri, {
        mimeType: kind === 'csv' ? 'text/csv' : 'application/octet-stream',
        dialogTitle: kind === 'csv' ? 'Export records' : 'Back up Peace',
        UTI: kind === 'csv' ? 'public.comma-separated-values-text' : 'public.database',
      });
      // The SIZE, not just the name. An empty file under a correct filename is
      // what a broken backup looks like, and the number is the only thing that
      // tells them apart at a glance.
      setDone(`${file.name} · ${formatBytes(bytes)}`);
    } catch (e) {
      // The share sheet closing without a choice is not an error, but every
      // other failure has to be visible: a backup that silently did nothing is
      // the one failure that only shows up when it is too late to fix.
      setError(e instanceof Error ? e.message : 'Could not create the file.');
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <View className="flex-1 bg-ground" testID="export-screen">
      <StackHeader title="Export & backup" />

      <ScrollView contentContainerClassName="px-4 pb-10 pt-4">
        <Text className="mb-4 px-1 text-sm leading-5 text-muted" testID="export-count">
          {count === 1 ? '1 record' : `${count} records`} in the ledger.
        </Text>

        <Action
          icon="export"
          title="Export CSV"
          body="Every record, both legs of each transfer, ready for a spreadsheet. Readable anywhere — but it is not a backup: it carries no settings and cannot be imported back."
          cta="Export CSV"
          busy={busy === 'csv'}
          disabled={busy !== null}
          onPress={() => run('csv')}
          testID="export-csv"
        />

        <Action
          icon="shield"
          title="Back up everything"
          body="A copy of the database file: every record, account, category and setting. Keep it somewhere off the phone. Any SQLite tool can open it, so your data outlives this app."
          cta="Create backup"
          busy={busy === 'backup'}
          disabled={busy !== null}
          onPress={() => run('backup')}
          testID="export-backup"
        />

        {error ? (
          <Text className="mt-4 px-1 text-sm text-expense" testID="export-error">
            {error}
          </Text>
        ) : done ? (
          <Text className="mt-4 px-1 text-sm text-income" testID="export-done">
            {done} is ready — check wherever you sent it.
          </Text>
        ) : null}

        <Text className="mt-8 px-1 text-xs leading-5 text-muted opacity-70">
          Restoring a backup is not built yet. The file is a standard SQLite database, so nothing is
          locked up in the meantime — but until restore exists, treat a backup as an escape hatch
          rather than a one-tap recovery.
        </Text>
      </ScrollView>
    </View>
  );
}

function Action({
  icon,
  title,
  body,
  cta,
  busy,
  disabled,
  onPress,
  testID,
}: {
  icon: string;
  title: string;
  body: string;
  cta: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <View className="mb-4 rounded-xl bg-surface p-4">
      <View className="mb-2 flex-row items-center gap-2.5">
        <Icon name={icon} size={18} color={palette.accent} />
        <Text className="text-base font-medium text-ink">{title}</Text>
      </View>
      <Text className="mb-4 text-sm leading-5 text-muted">{body}</Text>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={cta}
        className={`self-start rounded-lg px-5 py-2.5 active:opacity-80 ${
          disabled ? 'bg-raised' : 'bg-accent'
        }`}>
        <Text
          className={`text-sm font-semibold ${disabled ? 'text-muted' : 'text-accent-ink'}`}>
          {busy ? 'Working…' : cta}
        </Text>
      </Pressable>
    </View>
  );
}
