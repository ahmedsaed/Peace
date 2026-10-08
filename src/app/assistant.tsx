import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { canRetry, sessionIsEmpty, toItems, type Item } from '@/assistant/display';
import { drillRows } from '@/assistant/drill';
import type { Figure } from '@/assistant/figures';
import { streamingVisible } from '@/assistant/gemini-chat';
import type { ChartPoint, ChartSpec, Display } from '@/assistant/tools/types';
import { ProposalCard, RecordsCard, ReportCard } from '@/components/assistant/cards';
import { ChartCard } from '@/components/assistant/chart-card';
import { AttachMenu, MessageFiles, PendingFiles } from '@/components/assistant/files';
import { AttachmentViewer } from '@/components/attachment-viewer';
import { RecordsSheet } from '@/components/assistant/records-sheet';
import { RichText } from '@/components/assistant/rich-text';
import { Coin, TypingIndicator } from '@/components/assistant/typing';
import { Icon } from '@/components/icon';
import { HeaderButton, StackHeader } from '@/components/screen';
import { Snackbar } from '@/components/snackbar';
import palette from '@/constants/palette';
import { attachFromCamera, attachFromFiles, type StagedAttachment } from '@/db/attachments';
import { db } from '@/db/client';
import type { RecordRow } from '@/db/repo/records';
import { searchRecords } from '@/db/repo/search';
import { AttachmentError } from '@/lib/attachment';
import { EMPTY_QUERY } from '@/lib/search-query';
import { useKeyboardOverlap } from '@/lib/layout';
import { getGeminiKey } from '@/lib/secrets';
import { useAssistantStore } from '@/state/assistant';
import { useMoney } from '@/state/money';
import { useSetting } from '@/state/settings';

/**
 * The assistant: one ongoing conversation about the user's own money.
 *
 * THE WHOLE HISTORY IS HERE, newest at the bottom, loaded a page at a time as
 * it scrolls up — a reset adds a divider rather than deleting anything, and
 * only what follows the last divider is sent to the model.
 *
 * Every figure on this screen is either cited from a tool or drawn from the
 * ledger, and goes through `useMoney`; every change is a card that does
 * nothing until it is approved. See `src/assistant/` for why.
 */

const STARTERS = [
  'How much did fuel cost me last month?',
  'Show a breakdown of my income this year',
  'How does my coffee spending compare month to month?',
  "Write a report on this month's spending",
];

type Drill = { title: string; subtitle?: string; rows: RecordRow[] };

export default function AssistantScreen() {
  const insets = useSafeAreaInsets();
  /**
   * LIFTED BY HAND. The manifest says `adjustResize`, and on an edge-to-edge
   * Android it no longer shrinks the window — the keyboard simply draws over
   * the bottom of the screen, which is where a composer lives. The first run on
   * a device typed a question into an input nobody could see. Padded by the
   * keyboard's overlap — see `keyboardOverlap` for why not its height.
   */
  const keyboard = useKeyboardOverlap();
  const enabled = useSetting('assistantEnabled');
  const homeCurrency = useSetting('homeCurrency');
  const money = useMoney();

  const rows = useAssistantStore((s) => s.rows);
  const loaded = useAssistantStore((s) => s.loaded);
  const busy = useAssistantStore((s) => s.busy);
  const activity = useAssistantStore((s) => s.activity);
  const streaming = useAssistantStore((s) => s.streaming);
  const hasOlder = useAssistantStore((s) => s.hasOlder);
  const pendingUndo = useAssistantStore((s) => s.pendingUndo);
  const { load, loadOlder, send, retry, stop, decide, reset, undo, clearUndo } = useAssistantStore.getState();

  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [drill, setDrill] = useState<Drill | null>(null);
  /** Files waiting to go with the next message. Already on disk; only rows wait. */
  const [pending, setPending] = useState<StagedAttachment[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<StagedAttachment | null>(null);
  // Bumped on focus so lists drawn from the ledger re-read it: a record
  // edited from a sheet here should not come back showing its old amount.
  const [focusTick, setFocusTick] = useState(0);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setFocusTick((n) => n + 1);
      void getGeminiKey().then((key) => alive && setHasKey(key !== null));
      return () => {
        alive = false;
      };
    }, [])
  );

  // Inverted: the list's first item sits at the bottom, by the composer.
  const items = useMemo(() => toItems(rows).reverse(), [rows]);
  // What a reply still arriving can cite: every figure a tool has registered in
  // the rows on screen. The finished row stores its own; this is only for the
  // seconds before it exists.
  const known = useMemo(() => {
    const out: Record<string, Figure> = {};
    for (const row of rows) Object.assign(out, (row.meta as { figures?: Record<string, Figure> } | null)?.figures);
    return out;
  }, [rows]);
  const retryable = canRetry(rows);
  const empty = sessionIsEmpty(rows);
  // From the items rather than the rows, so a card expired by a reset does
  // not leave the composer asking for an answer nothing will act on.
  const waiting = items.some(
    (item) => item.type === 'proposal' && item.proposal.status === 'pending' && !item.expired
  );

  const submit = (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && pending.length === 0) || busy) return;
    const files = pending;
    setDraft('');
    setPending([]);
    setAttachError(null);
    void send(trimmed, files);
  };

  /**
   * Bytes are written the moment a file is picked — the camera leaves its
   * photo in a cache Android may reclaim — and the file is only REFERENCED
   * once the message is sent. Removing one before sending leaves a file the
   * launch sweep collects, the same cost the record screen accepts.
   */
  const attach = async (source: 'camera' | 'files') => {
    setAttachOpen(false);
    setAttachError(null);
    try {
      const outcome = source === 'camera' ? await attachFromCamera() : await attachFromFiles();
      if (outcome.cancelled) return;
      setPending((current) =>
        current.some((f) => f.fileName === outcome.attachment.fileName) ? current : [...current, outcome.attachment]
      );
    } catch (error) {
      console.warn('[assistant] attaching failed', error);
      setAttachError(error instanceof AttachmentError ? error.message : 'Could not attach that file.');
    }
  };

  const openChart = (chart: ChartSpec, point: ChartPoint | null) => {
    const rowsFor = drillRows(db, chart, point, homeCurrency);
    setDrill({
      title: point ? point.label : chart.title,
      subtitle: `${chart.title} · ${money(point ? point.valueMinor : chart.totalMinor, chart.currency)}`,
      rows: rowsFor,
    });
  };

  if (!enabled || hasKey === false) {
    return (
      <View className="flex-1 bg-ground" testID="assistant-screen">
        <StackHeader title="Penny" />
        <Gate reason={!enabled ? 'off' : 'no-key'} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-ground" style={{ paddingBottom: keyboard }} testID="assistant-screen">
      <StackHeader
        title="Penny"
        right={
          <HeaderButton
            icon="chat-new"
            label="New conversation"
            testID="assistant-reset"
            onPress={() => {
              if (!busy && !empty) reset();
            }}
          />
        }
      />

      <FlatList
        inverted
        data={items}
        keyExtractor={(item) => item.key}
        contentContainerClassName="px-4 py-3"
        keyboardShouldPersistTaps="handled"
        onEndReached={() => hasOlder && loadOlder()}
        onEndReachedThreshold={0.4}
        testID="assistant-list"
        // In an inverted list the HEADER renders at the bottom — beside the
        // composer, where the state of the running turn belongs.
        ListHeaderComponent={
          <View>
            {streaming ? (
              <View className="my-1.5" testID="assistant-streaming">
                <RichText text={streamingVisible(streaming)} figures={known} trailing={<Coin />} />
              </View>
            ) : null}
            {busy ? (
              // The dots stay while words stream too — `assistant-busy` is what
              // a flow waits on to know the turn is over, and the turn is not
              // over while it is still being written.
              <View className="mt-2" testID="assistant-busy">
                {streaming ? null : <TypingIndicator label={`${activity ?? 'Penny is thinking'}…`} />}
              </View>
            ) : retryable ? (
              <Pressable
                onPress={() => void retry()}
                testID="assistant-retry"
                className="mt-2 self-start rounded-lg border border-line px-4 py-2 active:bg-raised">
                <Text className="text-sm font-semibold text-accent">Try again</Text>
              </Pressable>
            ) : null}
            {empty && !busy ? <Starters onPick={submit} /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <ItemView
            item={item}
            busy={busy}
            focusTick={focusTick}
            homeCurrency={homeCurrency}
            onDecide={(seq, index, approve) => void decide(seq, index, approve)}
            onChart={openChart}
            onRecords={(title, subtitle, list) => setDrill({ title, subtitle, rows: list })}
            onOpenFile={setViewing}
          />
        )}
      />

      <View className="border-t border-line bg-surface">
      <PendingFiles
        files={pending}
        onOpen={setViewing}
        onRemove={(fileName) => setPending((current) => current.filter((f) => f.fileName !== fileName))}
      />
      {attachError ? (
        <Text className="px-4 pt-2 text-xs text-expense" testID="assistant-attach-error">
          {attachError}
        </Text>
      ) : null}
      <View
        className="flex-row items-end gap-2 px-3 pt-2"
        style={{ paddingBottom: keyboard > 0 ? 8 : Math.max(insets.bottom, 8) }}>
        {/* A PLUS — "add something to this message". Not a paperclip, whose
            hole closes into a blob at this size (see the glyph rule in
            AGENTS.md), and not a folder, which read as "browse files". */}
        <Pressable
          onPress={() => setAttachOpen(true)}
          disabled={busy}
          testID="assistant-attach"
          accessibilityRole="button"
          accessibilityLabel="Attach a receipt or a file"
          className={`h-11 w-11 items-center justify-center rounded-full active:bg-raised ${busy ? 'opacity-40' : ''}`}>
          <Icon name="plus" size={22} color={palette.muted} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={
            waiting
              ? 'Answer the card above, or ask something else'
              : pending.length > 0
                ? 'Ask about it, or send to have it read'
                : 'Ask Penny about your money'
          }
          placeholderTextColor={palette.muted}
          multiline
          className="max-h-32 flex-1 rounded-2xl bg-raised px-4 py-2.5 text-base text-ink"
          testID="assistant-input"
          accessibilityLabel="Message"
        />
        {busy ? (
          <Pressable
            onPress={stop}
            testID="assistant-stop"
            accessibilityRole="button"
            accessibilityLabel="Stop"
            className="h-11 w-11 items-center justify-center rounded-full bg-raised active:opacity-80">
            <Icon name="stop" size={16} color={palette.ink} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => submit(draft)}
            disabled={draft.trim() === '' && pending.length === 0}
            testID="assistant-send"
            accessibilityRole="button"
            accessibilityLabel="Send"
            className={`h-11 w-11 items-center justify-center rounded-full bg-accent active:opacity-80 ${
              draft.trim() === '' && pending.length === 0 ? 'opacity-40' : ''
            }`}>
            <Icon name="send" size={18} color={palette['accent-ink']} />
          </Pressable>
        )}
      </View>
      </View>

      <AttachMenu
        visible={attachOpen}
        onCamera={() => void attach('camera')}
        onFiles={() => void attach('files')}
        onClose={() => setAttachOpen(false)}
      />
      <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} />

      {pendingUndo ? (
        // Above the composer AND the keyboard: absolute positioning ignores the
        // padding that lifts everything else, so the offer of the only way
        // back from a deletion would otherwise sit under the keys.
        <View className="absolute left-0 right-0" style={{ bottom: keyboard + 72 }}>
          <Snackbar
            message={pendingUndo.message}
            actionLabel="Undo"
            onAction={undo}
            onDismiss={clearUndo}
            token={pendingUndo.token}
            testID="assistant-undo"
          />
        </View>
      ) : null}

      <RecordsSheet
        visible={drill !== null}
        title={drill?.title ?? ''}
        subtitle={drill?.subtitle}
        rows={drill?.rows ?? []}
        onClose={() => setDrill(null)}
      />
    </View>
  );
}

function Gate({ reason }: { reason: 'off' | 'no-key' }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8" testID={`assistant-gate-${reason}`}>
      <Icon name="sparkle" size={32} color={palette.accent} />
      <Text className="text-center text-base font-semibold text-ink">
        {reason === 'off' ? 'Penny is switched off' : 'Add a Gemini key first'}
      </Text>
      <Text className="text-center text-sm leading-5 text-muted">
        {reason === 'off'
          ? 'Turn it on in Settings. To answer, it sends what it reads from your ledger to Google’s Gemini.'
          : 'Penny runs on your own Gemini API key, kept on this device.'}
      </Text>
      <Pressable
        onPress={() => router.push('/settings')}
        testID="assistant-open-settings"
        className="mt-2 rounded-lg bg-accent px-5 py-2.5 active:opacity-80">
        <Text className="text-sm font-semibold text-accent-ink">Open Settings</Text>
      </Pressable>
    </View>
  );
}

function Starters({ onPick }: { onPick: (text: string) => void }) {
  return (
    <View className="mt-4 gap-2" testID="assistant-starters">
      <Text className="mb-1 text-[10px] uppercase tracking-widest text-muted">Try asking</Text>
      {STARTERS.map((text, i) => (
        <Pressable
          key={text}
          onPress={() => onPick(text)}
          testID={`assistant-starter-${i}`}
          className="rounded-xl border border-line bg-surface px-4 py-3 active:bg-raised">
          <Text className="text-sm text-ink">{text}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ItemView({
  item,
  busy,
  focusTick,
  homeCurrency,
  onDecide,
  onChart,
  onRecords,
  onOpenFile,
}: {
  item: Item;
  busy: boolean;
  focusTick: number;
  homeCurrency: string;
  onDecide: (seq: number, index: number, approve: boolean) => void;
  onChart: (chart: ChartSpec, point: ChartPoint | null) => void;
  onRecords: (title: string, subtitle: string, rows: RecordRow[]) => void;
  onOpenFile: (file: StagedAttachment) => void;
}) {
  switch (item.type) {
    case 'user':
      return (
        <View className="my-1.5 max-w-[85%] gap-2 self-end" testID="assistant-user">
          {item.files.length > 0 ? <MessageFiles files={item.files} onOpen={onOpenFile} /> : null}
          {item.text ? (
            <View className="self-end rounded-2xl rounded-br-md bg-raised px-4 py-2.5">
              <Text selectable className="text-[15px] leading-[22px] text-ink">
                {item.text}
              </Text>
            </View>
          ) : null}
        </View>
      );
    case 'reply':
      return (
        <View className="my-1.5" testID="assistant-reply">
          <RichText text={item.text} figures={item.figures} />
        </View>
      );
    case 'activity':
      return (
        <View className="my-1 flex-row items-center gap-1.5">
          <Icon name="sparkle" size={11} color={palette.muted} />
          <Text className="text-[11px] text-muted" numberOfLines={1}>
            {item.labels.join(' · ')}
          </Text>
        </View>
      );
    case 'proposal':
      return (
        <View className="my-2">
          <ProposalCard
            proposal={item.proposal}
            disabled={busy}
            expired={item.expired}
            onDecide={(approve) => onDecide(item.seq, item.proposal.index, approve)}
            testID={`assistant-proposal-${item.proposal.call.name.replace(/_/g, '-')}`}
          />
        </View>
      );
    case 'display':
      return (
        <View className="my-2">
          <DisplayView display={item.display} focusTick={focusTick} homeCurrency={homeCurrency} onChart={onChart} onRecords={onRecords} />
        </View>
      );
    case 'divider':
      return (
        <View className="my-4 flex-row items-center gap-3" testID="assistant-divider">
          <View className="h-px flex-1 bg-line" />
          <Text className="text-[11px] text-muted">New conversation</Text>
          <View className="h-px flex-1 bg-line" />
        </View>
      );
    case 'error':
      return (
        <View className="my-1.5 flex-row gap-2 rounded-lg bg-surface px-3 py-2.5" testID="assistant-error">
          <Icon name="info" size={14} color={palette.expense} />
          <Text className="flex-1 text-sm text-expense">{item.message}</Text>
        </View>
      );
  }
}

function DisplayView({
  display,
  focusTick,
  homeCurrency,
  onChart,
  onRecords,
}: {
  display: Display;
  focusTick: number;
  homeCurrency: string;
  onChart: (chart: ChartSpec, point: ChartPoint | null) => void;
  onRecords: (title: string, subtitle: string, rows: RecordRow[]) => void;
}) {
  // Records are re-read from the ledger rather than kept in the history, so an
  // edited or deleted one shows as it is now.
  const ids = display.kind === 'records' ? display.ids : null;
  const rows = useMemo(
    () => (ids ? searchRecords(db, EMPTY_QUERY, { homeCurrency, ids, limit: 500 }).rows : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids, homeCurrency, focusTick]
  );

  switch (display.kind) {
    case 'chart':
      return <ChartCard chart={display.chart} onDrill={(point) => onChart(display.chart, point)} />;
    case 'records':
      return (
        <RecordsCard
          title={display.title}
          rangeLabel={display.rangeLabel}
          rows={rows}
          matchCount={display.matchCount}
          onOpenAll={() => onRecords(display.title, display.rangeLabel, rows)}
          onOpenRow={(id) => router.push({ pathname: '/record', params: { id } })}
          testID="assistant-records"
        />
      );
    case 'report':
      return <ReportCard report={display.report} testID="assistant-report" />;
  }
}
