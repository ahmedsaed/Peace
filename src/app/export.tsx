import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { DriveBackup } from '@/components/drive-backup';
import { Icon } from '@/components/icon';
import { StackHeader } from '@/components/screen';
import { backupDue, describeAge } from '@/lib/drive-backup';
import { useSetting } from '@/state/settings';
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
  const driveAccount = useSetting('driveAccount');
  const lastBackupAt = useSetting('driveLastBackupAt');
  // Captured once rather than read during render — `Date.now()` in a render
  // body is impure, and two renders of the same props would disagree.
  const [now] = useState(() => Date.now());
  const cadence = useSetting('driveCadence');
  const covered = driveAccount.length > 0 && lastBackupAt > 0;
  const overdue = covered && backupDue({ cadence, lastBackupAt }, now);
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
        {/* The answer first.
            Someone opens this screen to find out whether they are covered, not
            to browse four equally-weighted options. Everything below is how to
            change that answer; this is the answer. */}
        <View className="mb-6 px-1">
          <Text className="text-2xl font-semibold text-ink" testID="export-count">
            {count === 1 ? '1 record' : `${count} records`} in the ledger.
          </Text>
          {/* Red means OVERDUE, never merely unconfigured. Alarming someone
              about a feature they have not opted into is how an app teaches its
              user to ignore its warnings. */}
          <Text
            className={`mt-1 text-sm ${overdue ? 'text-expense' : 'text-muted'}`}
            testID="export-freshness">
            {driveAccount
              ? `${describeAge(lastBackupAt > 0 ? lastBackupAt : null, now)} to Drive${
                  overdue ? ' · overdue' : ''
                }`
              : 'No off-device backup yet'}
          </Text>
        </View>

        {/* The live one, and the only one that happens without being asked. */}
        <SectionLabel>Automatic</SectionLabel>
        <DriveBackup />

        {/* One card, two rows. These were two full-sized cards with four lines
            of body each, which gave a spreadsheet export the same weight as the
            thing that actually protects the ledger. */}
        <SectionLabel>A copy you keep</SectionLabel>
        <View className="mb-6 overflow-hidden rounded-xl bg-surface">
          <ExportRow
            icon="shield"
            title="Backup file"
            body="Complete and restorable. Any SQLite tool can open it."
            kind="backup"
            busy={busy}
            onPress={run}
          />
          <View className="h-px bg-line" />
          <ExportRow
            icon="export"
            title="Spreadsheet"
            body="Readable anywhere. Carries no settings and cannot be restored."
            kind="csv"
            busy={busy}
            onPress={run}
          />

          {error ? (
            <Text className="px-4 pb-4 text-sm text-expense" testID="export-error">
              {error}
            </Text>
          ) : done ? (
            <Text className="px-4 pb-4 text-sm text-income" testID="export-done">
              {done}
            </Text>
          ) : null}
        </View>

        {/* Quiet by design. Destructive, rarely wanted, and previously wearing a
            red border that made it compete with the things you came here for. */}
        <SectionLabel>Replace everything</SectionLabel>
        <View className="mb-4 rounded-xl bg-surface p-4">
          <Text className="mb-3 text-sm leading-5 text-muted">
            Restoring replaces the ledger with a backup file. Your current data is saved first, so
            it is undoable.
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

/** A quiet group heading. Hierarchy without another box. */
function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted">
      {children}
    </Text>
  );
}

function ExportRow({
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
    <View className="p-4">
      <View className="mb-1 flex-row items-center gap-2.5">
        <Icon name={icon} size={18} color={palette.accent} />
        <Text className="text-base font-medium text-ink">{title}</Text>
      </View>
      {/* One line, not four. The long explanations were written when this screen
          had two things on it; with five they read as a wall and got skipped —
          which is worse than saying less. */}
      <Text className="mb-3 pl-[30px] text-sm leading-5 text-muted">{body}</Text>

      <View className="flex-row gap-2 pl-[30px]">
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
