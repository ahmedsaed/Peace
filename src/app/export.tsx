import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { DriveBackup } from '@/components/drive-backup';
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
import {
  currentCounts,
  hasSafetyCopy,
  pickBackup,
  refreshAfterRestore,
  restoreFrom,
  RestoreError,
  safetyCopy,
} from '@/db/restore';

type Kind = 'csv' | 'backup';
type Destination = 'save' | 'share';
type Busy = `${Kind}-${Destination}` | 'restore' | 'undo' | null;

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
  // Re-read after every action rather than caching: a restore creates this
  // file and an undo replaces it, so a stale value would either hide the way
  // back or offer one that no longer exists.
  const [canUndo, setCanUndo] = useState(hasSafetyCopy);

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

  const apply = useCallback(async (file: Parameters<typeof restoreFrom>[0], mode: 'restore' | 'undo') => {
    setBusy(mode);
    setError(null);
    setDone(null);
    try {
      const result = await restoreFrom(file);
      refreshAfterRestore();
      setCanUndo(hasSafetyCopy());
      setDone(
        `${mode === 'undo' ? 'Undone' : 'Restored'} — ${result.copied.transactions} records and ` +
          `${result.copied.accounts} accounts are now in the app. The previous state was kept, ` +
          `so this can be reversed again.`
      );
    } catch (e) {
      setCanUndo(hasSafetyCopy());
      setError(e instanceof RestoreError || e instanceof Error ? e.message : 'Could not restore that file.');
    } finally {
      setBusy(null);
    }
  }, []);

  /**
   * Two gates before anything is replaced: the file picker, then a confirmation
   * that states what is about to be lost in numbers. "Are you sure?" without a
   * count is a dialog people dismiss by reflex.
   */
  const onRestore = useCallback(async () => {
    setError(null);
    setDone(null);

    const picked = await pickBackup().catch(() => null);
    if (!picked) return;

    const before = currentCounts();
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Replace everything?',
        `Your ${before.transactions} records and ${before.accounts} accounts will be replaced by the contents of ${picked.name}.\n\nA backup of your current data is saved first, so this can be undone.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Replace', style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      );
    });
    if (!confirmed) return;

    await apply(picked, 'restore');
  }, [apply]);

  /**
   * Put back what was there before the last restore.
   *
   * This is the same operation in the other direction — it takes its own safety
   * copy on the way, so undo is itself undoable and the button stays available
   * rather than being a one-shot.
   */
  const onUndo = useCallback(async () => {
    const before = currentCounts();
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Undo the restore?',
        `The ${before.transactions} records now in the app will be replaced by what was here before the last restore.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Undo', style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      );
    });
    if (!confirmed) return;
    await apply(safetyCopy(), 'undo');
  }, [apply]);

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

        {/* Below the local options deliberately. The Drive copy lives in a
            hidden app folder no browser can reach, so it is the convenience,
            and a file the user physically holds is still the safety net. */}
        <DriveBackup />

        <View className="mb-4 rounded-xl border border-expense/30 bg-surface p-4">
          <View className="mb-2 flex-row items-center gap-2.5">
            <Icon name="refresh" size={18} color={palette.expense} />
            <Text className="text-base font-medium text-ink">Restore from a backup</Text>
          </View>
          <Text className="mb-4 text-sm leading-5 text-muted">
            Replaces everything in the app with the contents of a backup file. Your current data is
            backed up first, so this is undoable.
          </Text>
          <View className="flex-row gap-2">
            <Button
              label="Choose a backup"
              working={busy === 'restore'}
              disabled={busy !== null}
              onPress={onRestore}
              testID="restore-pick"
              danger
            />
            {canUndo ? (
              <Button
                label="Undo last restore"
                working={busy === 'undo'}
                disabled={busy !== null}
                onPress={onUndo}
                testID="restore-undo"
              />
            ) : null}
          </View>
        </View>

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
          A backup taken by a newer version of Peace is refused rather than partly restored. An
          older one restores fine — columns added since simply take their defaults.
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
  danger = false,
}: {
  label: string;
  working: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`self-start rounded-lg px-4 py-2.5 active:opacity-80 ${
        disabled
          ? 'bg-raised'
          : danger
            ? 'border border-expense/40'
            : primary
              ? 'bg-accent'
              : 'border border-line'
      }`}>
      <Text
        className={`text-sm font-semibold ${
          disabled ? 'text-muted' : danger ? 'text-expense' : primary ? 'text-accent-ink' : 'text-ink'
        }`}>
        {working ? 'Working…' : label}
      </Text>
    </Pressable>
  );
}
