import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { StackHeader } from '@/components/screen';
import palette from '@/constants/palette';
import {
  csvExport,
  databaseBackup,
  formatBytes,
  recordCount,
  saveToFolder,
  type Exported,
} from '@/db/backup';

type Kind = 'csv' | 'backup';
type Destination = 'save' | 'share';
type Busy = `${Kind}-${Destination}` | null;

/**
 * Export and backup.
 *
 * TWO destinations, because the share sheet is not enough on its own: it offers
 * whatever apps handle the mime type, and on a phone with no file manager that
 * claims `text/csv` there is no local option at all — only Drive and Gmail.
 * "Save to device" opens the Storage Access Framework instead, which needs no
 * permission and puts the file exactly where the user says.
 *
 * Save is listed first because a backup that never leaves the phone is still
 * better than one that was never made.
 */
export default function ExportScreen() {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const count = recordCount();

  const build = useCallback(
    async (kind: Kind): Promise<Exported> =>
      kind === 'csv' ? csvExport() : await databaseBackup(),
    []
  );

  const run = useCallback(
    async (kind: Kind, destination: Destination) => {
      setBusy(`${kind}-${destination}`);
      setError(null);
      setDone(null);
      try {
        const exported = await build(kind);

        if (destination === 'save') {
          const bytes = await saveToFolder(exported.file);
          setDone(`${exported.file.name} · ${formatBytes(bytes)} saved to your chosen folder`);
          return;
        }

        if (!(await Sharing.isAvailableAsync())) {
          throw new Error('Sharing is not available on this device.');
        }
        await Sharing.shareAsync(exported.file.uri, {
          mimeType: kind === 'csv' ? 'text/csv' : 'application/octet-stream',
          dialogTitle: kind === 'csv' ? 'Export records' : 'Back up Peace',
          UTI: kind === 'csv' ? 'public.comma-separated-values-text' : 'public.database',
        });
        setDone(`${exported.file.name} · ${formatBytes(exported.bytes)} sent`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Backing out of the folder picker is a decision, not a fault. Every
        // other failure has to be loud: an export that silently did nothing is
        // the one failure you only discover when it is too late to fix.
        if (/cancel/i.test(message)) return;
        setError(message || 'Could not create the file.');
      } finally {
        setBusy(null);
      }
    },
    [build]
  );

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
          busy={busy}
          kind="csv"
          onPress={run}
        />

        <Action
          icon="shield"
          title="Back up everything"
          body="A copy of the database file: every record, account, category and setting. Keep a copy somewhere off the phone. Any SQLite tool can open it, so your data outlives this app."
          busy={busy}
          kind="backup"
          onPress={run}
        />

        {error ? (
          <Text className="mt-4 px-1 text-sm text-expense" testID="export-error">
            {error}
          </Text>
        ) : done ? (
          <Text className="mt-4 px-1 text-sm text-income" testID="export-done">
            {done}
          </Text>
        ) : null}

        {/* Learned the hard way on a real device: Android refuses to grant
            folder access to the Download root — the picker shows "Can't use
            this folder" with no explanation of what would work. Documents is
            allowed, and so is any subfolder you create. Saying so here costs
            two lines and saves the same dead end. */}
        <Text className="mt-6 px-1 text-xs leading-5 text-muted opacity-70">
          Android does not allow apps to be granted the Download folder itself. Pick Documents, or
          create a subfolder inside Download — both work.
        </Text>

        <Text className="mt-4 px-1 text-xs leading-5 text-muted opacity-70">
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
  kind,
  busy,
  onPress,
}: {
  icon: string;
  title: string;
  body: string;
  kind: Kind;
  busy: Busy;
  onPress: (kind: Kind, destination: Destination) => void;
}) {
  const anyBusy = busy !== null;

  return (
    <View className="mb-4 rounded-xl bg-surface p-4">
      <View className="mb-2 flex-row items-center gap-2.5">
        <Icon name={icon} size={18} color={palette.accent} />
        <Text className="text-base font-medium text-ink">{title}</Text>
      </View>
      <Text className="mb-4 text-sm leading-5 text-muted">{body}</Text>

      <View className="flex-row gap-2">
        <Button
          label="Save to device"
          working={busy === `${kind}-save`}
          disabled={anyBusy}
          onPress={() => onPress(kind, 'save')}
          testID={`${kind === 'csv' ? 'export-csv' : 'export-backup'}-save`}
          primary
        />
        <Button
          label="Share"
          working={busy === `${kind}-share`}
          disabled={anyBusy}
          onPress={() => onPress(kind, 'share')}
          testID={`${kind === 'csv' ? 'export-csv' : 'export-backup'}-share`}
        />
      </View>
    </View>
  );
}

function Button({
  label,
  working,
  disabled,
  onPress,
  testID,
  primary = false,
}: {
  label: string;
  working: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`rounded-lg px-4 py-2.5 active:opacity-80 ${
        disabled ? 'bg-raised' : primary ? 'bg-accent' : 'border border-line'
      }`}>
      <Text
        className={`text-sm font-semibold ${
          disabled ? 'text-muted' : primary ? 'text-accent-ink' : 'text-ink'
        }`}>
        {working ? 'Working…' : label}
      </Text>
    </Pressable>
  );
}
