import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import palette from '@/constants/palette';
import { formatBytes } from '@/db/backup';
import { checkLatestBackup, listDriveBackups, restoreFromDrive, runBackup } from '@/db/drive';
import { currentCounts, refreshAfterRestore } from '@/db/restore';
import type { DriveFile } from '@/lib/drive-api';
import { CADENCES, describeCadence } from '@/lib/drive-backup';
import { connect, disconnect, reconnectSilently } from '@/lib/google-auth';
import { assertUsablePassphrase, MIN_PASSPHRASE } from '@/lib/seal';
import { getPassphrase, setPassphrase } from '@/lib/secrets';
import { useSetting, useSettingsStore } from '@/state/settings';

type Busy = 'connect' | 'backup' | 'check' | 'passphrase' | 'list' | 'restore' | null;

/**
 * Google Drive backup.
 *
 * Sits under the local export options rather than above them, because a copy
 * the user physically holds is still the better safety net: the Drive copy
 * lives in a hidden app folder that no browser can reach, so it is a
 * convenience, not the last line.
 *
 * The row that matters most is the AGE. Automatic backup runs when the app
 * opens and one is due, plus whatever the OS grants on top — it cannot promise
 * it ran, so it has to make it obvious when it did not. A silent stop that
 * nobody notices for a month is the only truly bad outcome here.
 */
export function DriveBackup() {
  const account = useSetting('driveAccount');
  const cadence = useSetting('driveCadence');
  const update = useSettingsStore((state) => state.update);

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sealed, setSealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  /** Null while the restore sheet is closed; an array once Drive has answered. */
  const [choices, setChoices] = useState<DriveFile[] | null>(null);

  useEffect(() => {
    getPassphrase().then((value) => setSealed(value !== null));
  }, []);

  /**
   * Re-establish the grant without showing anything.
   *
   * Only when the app already believes it is connected. Calling this on a fresh
   * install would be asking Google about an account the user never chose.
   */
  useEffect(() => {
    if (!account) return;
    reconnectSilently().then((email) => {
      // The account was removed from the device, or access was withdrawn from
      // the Google account page. Say so rather than continuing to claim a
      // connection that will fail at the next backup.
      if (email === null) update('driveAccount', '');
    });
  }, [account, update]);

  const guard = useCallback(async (kind: Busy, work: () => Promise<string>) => {
    setBusy(kind);
    setError(null);
    setNote(null);
    try {
      setNote(await work());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }, []);

  const onConnect = useCallback(
    () =>
      guard('connect', async () => {
        const email = await connect();
        update('driveAccount', email);
        // Weekly rather than daily: this is a ledger someone edits a few times
        // a day, not a chat log, and a week of loss is the most anyone here has
        // ever risked. Daily is available for whoever disagrees.
        if (cadence === 'off') update('driveCadence', 'weekly');
        return `Connected as ${email}.`;
      }),
    [guard, update, cadence]
  );

  const onDisconnect = useCallback(async () => {
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Stop backing up to Drive?',
        'Your existing backups stay in Drive and this device stops adding to them. Your passphrase is kept, so you can reconnect later.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Disconnect', style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      );
    });
    if (!confirmed) return;

    await disconnect();
    update('driveAccount', '');
    update('driveCadence', 'off');
    setNote('Disconnected. Nothing was deleted.');
  }, [update]);

  const onBackupNow = useCallback(
    () =>
      guard('backup', async () => {
        const outcome = await runBackup();
        update('driveLastBackupAt', outcome.at);
        const pruned = outcome.pruned > 0 ? `, ${outcome.pruned} old removed` : '';
        return `${outcome.name} · ${formatBytes(outcome.bytes)}${
          outcome.sealed ? ' sealed' : ''
        }${pruned}`;
      }),
    [guard, update]
  );

  /**
   * The action that turns "I have backups" into "I have backups that work".
   *
   * Every failure mode here is silent — a zero-byte upload, a passphrase
   * changed since the last backup, a file truncated in transit — and every one
   * of them looks exactly like a working setup until the day it matters.
   */
  const onCheck = useCallback(
    () =>
      guard('check', async () => {
        const result = await checkLatestBackup();
        return `${result.name} opens: ${result.records} records, ${result.accounts} accounts, ${result.categories} categories.`;
      }),
    [guard]
  );

  const onBrowse = useCallback(
    () =>
      guard('list', async () => {
        const files = await listDriveBackups();
        setChoices(files);
        return files.length === 1 ? '1 backup in Drive.' : `${files.length} backups in Drive.`;
      }),
    [guard]
  );

  /**
   * Restore, behind a confirmation that says what is about to be lost.
   *
   * The count of what is here NOW is the number that matters — "replaces
   * everything" is abstract, "the 43 records now in the app" is not.
   */
  const onRestore = useCallback(
    async (file: DriveFile) => {
      const before = currentCounts();
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Restore this backup?',
          `The ${before.transactions} records now in the app will be replaced by the contents of ${file.name}. Your current data is saved first, so this can be undone.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Restore', style: 'destructive', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) }
        );
      });
      if (!confirmed) return;

      setChoices(null);
      await guard('restore', async () => {
        const result = await restoreFromDrive(file.id);
        // Repaint every screen from the new database, and re-read settings —
        // without this the app keeps rendering the ledger it just replaced.
        refreshAfterRestore();
        return `Restored ${result.copied.transactions} records from ${file.name}.`;
      });
    },
    [guard]
  );

  const onSavePassphrase = useCallback(
    () =>
      guard('passphrase', async () => {
        if (draft.length === 0) {
          await setPassphrase(null);
          setSealed(false);
          setEditing(false);
          setDraft('');
          return 'New backups will be uploaded unsealed.';
        }
        assertUsablePassphrase(draft);
        await setPassphrase(draft);
        setSealed(true);
        setEditing(false);
        setDraft('');
        return 'Saved. New backups will be sealed with it.';
      }),
    [guard, draft]
  );

  // Freshness and overdue-ness are reported once, by the screen header. This
  // card is where you ACT on it.
  const connected = account.length > 0;

  return (
    <View className="mb-4 rounded-xl bg-surface p-4" testID="drive-section">
      <View className="mb-2 flex-row items-center gap-2.5">
        <Icon name="cloud" size={18} color={palette.accent} />
        <Text className="text-base font-medium text-ink">Back up to Google Drive</Text>
      </View>

      {!connected ? (
        <>
          {/* This said backups were "removed if you disconnect the app", which
              was FALSE — Disconnect signs out and deliberately deletes nothing,
              and the confirmation dialog says so. Two pieces of copy on one
              screen disagreeing about whether your backups survive is worse
              than either being wrong alone. */}
          <Text className="mb-4 text-sm leading-5 text-muted">
            A copy in a private folder only Peace can see, invisible in your Drive. Set a
            passphrase and it is encrypted before it leaves the phone.
          </Text>
          <Button
            label="Connect Google Drive"
            working={busy === 'connect'}
            disabled={busy !== null}
            onPress={onConnect}
            testID="drive-connect"
            primary
          />
        </>
      ) : (
        <>
          {/* Just the account. How fresh the backup is now lives once, at the
              top of the screen — saying it twice on one page made neither
              instance feel authoritative. */}
          <Text className="mb-4 text-sm text-muted" testID="drive-account">
            {account}
          </Text>

          <View className="mb-4 flex-row flex-wrap gap-2">
            {CADENCES.map((option) => (
              <Chip
                key={option}
                label={describeCadence(option)}
                selected={cadence === option}
                onPress={() => update('driveCadence', option)}
                testID={`drive-cadence-${option}`}
              />
            ))}
          </View>

          <View className="mb-4 flex-row flex-wrap gap-2">
            <Button
              label="Back up now"
              working={busy === 'backup'}
              disabled={busy !== null}
              onPress={onBackupNow}
              testID="drive-backup-now"
              primary
            />
            <Button
              label="Check my backup"
              working={busy === 'check'}
              disabled={busy !== null}
              onPress={onCheck}
              testID="drive-check"
            />
          </View>

          <View className="mb-4 border-t border-line pt-4">
            {/* One line instead of a heading plus a paragraph. The warning that
                earns its place is the irreversible one; the rest was reassurance
                nobody reads twice. */}
            <Text className="mb-3 text-sm leading-5 text-muted" testID="drive-seal-state">
              {sealed
                ? 'Encrypted — only your passphrase opens these. Lose it and they are gone for good.'
                : `Not encrypted, so Google can read them. A passphrase of ${MIN_PASSPHRASE}+ characters is all you need to restore on a new phone.`}
            </Text>

            {editing ? (
              <>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Passphrase, or blank to stop encrypting"
                  placeholderTextColor={palette.muted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="mb-2 rounded-lg border border-line px-3 py-2.5 text-ink"
                  testID="drive-passphrase-input"
                />
                {/* Changing it does not re-encrypt what is already in Drive —
                    those still need the passphrase they were made with, and
                    saying so here is cheaper than a support conversation with
                    yourself in eight months. */}
                <Text className="mb-3 text-xs leading-5 text-muted">
                  Backups already in Drive still need the passphrase they were made with.
                </Text>
                <View className="flex-row gap-2">
                  <Button
                    label="Save"
                    working={busy === 'passphrase'}
                    disabled={busy !== null}
                    onPress={onSavePassphrase}
                    testID="drive-passphrase-save"
                    primary
                  />
                  <Button
                    label="Cancel"
                    working={false}
                    disabled={busy !== null}
                    onPress={() => {
                      setEditing(false);
                      setDraft('');
                    }}
                    testID="drive-passphrase-cancel"
                  />
                </View>
              </>
            ) : (
              <Button
                label={sealed ? 'Change passphrase' : 'Set a passphrase'}
                working={false}
                disabled={busy !== null}
                onPress={() => setEditing(true)}
                testID="drive-passphrase-edit"
              />
            )}
          </View>

          {/* The two rare actions share a row rather than each getting a
              divider and a block of their own. Restoring is the reason the rest
              of this exists — `appdata` is reachable by nothing but this app,
              so without a picker here a backup in Drive could be read by no
              software on earth. */}
          <View className="flex-row gap-2 border-t border-line pt-4">
            <Button
              label="Restore from Drive"
              working={busy === 'list'}
              disabled={busy !== null}
              onPress={onBrowse}
              testID="drive-restore-open"
              danger
            />
            <Button
              label="Disconnect"
              working={false}
              disabled={busy !== null}
              onPress={onDisconnect}
              testID="drive-disconnect"
            />
          </View>

          <Modal
            visible={choices !== null}
            transparent
            animationType="slide"
            onRequestClose={() => setChoices(null)}>
            <Pressable
              className="flex-1"
              onPress={() => setChoices(null)}
              accessibilityLabel="Dismiss"
            />
            <View
              className="max-h-[70%] rounded-t-2xl border-t border-line bg-ground pb-8"
              style={{ elevation: 16 }}
              testID="drive-restore-sheet">
              <View className="border-b border-line px-5 py-4">
                <Text className="text-base font-semibold text-ink">Restore from Drive</Text>
                <Text className="text-xs text-muted">
                  Replaces everything in the app. Your current data is saved first, so this is
                  undoable.
                </Text>
              </View>
              <ScrollView>
                {choices?.length === 0 ? (
                  <Text className="px-5 py-4 text-sm text-muted" testID="drive-restore-empty">
                    There are no backups in Drive yet.
                  </Text>
                ) : (
                  choices?.map((file) => (
                    <Pressable
                      key={file.id}
                      onPress={() => onRestore(file)}
                      testID={`drive-restore-${file.id}`}
                      accessibilityRole="button"
                      className="border-b border-line px-5 py-3.5 active:bg-surface">
                      <Text className="text-[15px] text-ink" numberOfLines={1}>
                        {file.name}
                      </Text>
                      <Text className="text-xs text-muted">
                        {file.size === null ? 'size unknown' : formatBytes(file.size)}
                        {file.name.endsWith('.enc') ? ' · sealed' : ''}
                      </Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </View>
          </Modal>
        </>
      )}

      {error ? (
        <Text className="mt-4 text-sm text-expense" testID="drive-error">
          {error}
        </Text>
      ) : note ? (
        <Text className="mt-4 text-sm text-income" testID="drive-note">
          {note}
        </Text>
      ) : null}
    </View>
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
      <Text
        numberOfLines={1}
        className={`text-sm ${selected ? 'font-semibold text-accent-ink' : 'text-ink'}`}>
        {label}
      </Text>
    </Pressable>
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
          disabled
            ? 'text-muted'
            : danger
              ? 'text-expense'
              : primary
                ? 'text-accent-ink'
                : 'text-ink'
        }`}>
        {working ? 'Working…' : label}
      </Text>
    </Pressable>
  );
}
