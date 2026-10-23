/**
 * Receipts on the record screen.
 *
 * Two square buttons in the foot of the notes field and a row of square
 * previews beneath them — inside the same rounded surface, so the whole thing
 * reads as one control rather than as a toolbar that happens to sit near a
 * text box.
 *
 * The buttons are laid out as a FOOTER ROW rather than floated over the text.
 * Absolutely positioning them in the corner is what the design asks for
 * literally, and it puts two opaque squares on top of a field whose text
 * scrolls underneath them — fine while the note is short, unreadable the moment
 * it is not, and invisible in every screenshot taken with a short note.
 *
 * SPLIT-SCREEN IS A SUPPORTED LAYOUT, NOT AN EDGE CASE. At `tight` the note is
 * already a single line sharing a row with two picker squares; a preview strip
 * there would cost more height than the note itself has. So the previews are
 * dropped and the two buttons become one, with the count on it — nothing is
 * hidden, because the count is the thing you would look for, and the record
 * screen is the one screen that must survive 340dp of height.
 */

import { Image } from 'expo-image';
import { memo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { useTheme } from '@/state/theme';
import { attachmentExists, attachmentUri, type StagedAttachment } from '@/db/attachments';
import { isImageMime, isReadableMime, shortName } from '@/lib/attachment';

export const PREVIEW_SIZE = 56;
/**
 * How far the corner badges overhang a tile.
 *
 * Both the remove and the read badge sit ON the corners, so the scroll view
 * needs this much padding at top and bottom or it slices them off — which is
 * exactly what happened to the read badge along the bottom edge.
 */
const BADGE_ROOM = 8;

type Props = {
  attachments: StagedAttachment[];
  onCamera: () => void;
  onFiles: () => void;
  onRemove: (fileName: string) => void;
  onOpen: (attachment: StagedAttachment) => void;
  /**
   * Read this receipt and fill in the form.
   *
   * Offered per attachment rather than once for the record, because a record
   * can carry several and only one of them is the receipt worth reading.
   */
  /** Absent when AI is switched off: there is then no reading button at all. */
  onRead?: (attachment: StagedAttachment) => void;
  /** Which attachment is being read, so only its own badge spins. */
  reading: string | null;
  /**
   * Speak the record instead. Absent when voice cannot run (no key, Use AI or
   * Voice off), and then there is no mic button at all — the same rule as the
   * reading badge.
   *
   * It lives with the attach buttons, not in a row of its own: both are ways
   * of putting something INTO this record other than typing, and this band is
   * the one place on the screen with room for them.
   */
  onVoice?: () => void;
  /** Shares the buttons' row, on their left: the record's tags. */
  leading?: ReactNode;
  /** True in split-screen: previews go, the buttons merge, the count stays. */
  compact: boolean;
  busy?: boolean;
};

/**
 * One preview.
 *
 * A row whose FILE is missing is drawn as its own state rather than as a broken
 * image. That happens after restoring a backup made before attachments existed
 * — the rows describe receipts that were never in the file — and a grey box
 * with no explanation reads as a bug in the app rather than as the age of the
 * backup.
 */
const Preview = memo(function Preview({
  attachment,
  onOpen,
  onRemove,
  onRead,
  reading,
}: {
  attachment: StagedAttachment;
  onOpen: () => void;
  onRemove: () => void;
  onRead?: () => void;
  reading: boolean;
}) {
  const palette = useTheme();
  const missing = !attachmentExists(attachment.fileName);
  const image = isImageMime(attachment.mimeType) && !missing;
  const readable = isReadableMime(attachment.mimeType) && !missing;
  const label = attachment.originalName ?? 'Receipt';

  return (
    <View style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}>
      <Pressable
        onPress={onOpen}
        testID={`attachment-${attachment.fileName.slice(0, 8)}`}
        accessibilityRole="button"
        accessibilityLabel={missing ? `${label} — file missing` : label}
        className="h-full w-full overflow-hidden rounded-lg border border-line bg-raised active:opacity-70">
        {image ? (
          <Image
            source={{ uri: attachmentUri(attachment.fileName) }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            // The file never changes under its name — it is named by its hash —
            // so there is nothing to invalidate and caching is free.
            cachePolicy="memory-disk"
          />
        ) : (
          <View className="flex-1 items-center justify-center px-1">
            <Icon
              name="document"
              size={18}
              color={missing ? palette.line : palette.muted}
            />
            <Text
              className={`mt-0.5 text-[9px] ${missing ? 'text-line' : 'text-muted'}`}
              numberOfLines={1}>
              {missing ? 'Missing' : shortName(label, 9)}
            </Text>
          </View>
        )}
      </Pressable>

      {/* Sits ON the corner of the thumbnail rather than beside it: a row of
          56px squares has no room for a second control per item, and a delete
          you have to long-press for is a delete nobody finds. */}
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        testID={`attachment-remove-${attachment.fileName.slice(0, 8)}`}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${label}`}
        className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full border border-line bg-ground active:opacity-70">
        <Icon name="close" size={10} color={palette.muted} />
      </Pressable>

      {/**
       * "Read this one."
       *
       * On a photo, a PDF or a text file that is actually there — the three the
       * model takes (`isReadableMime`). A missing file has nothing to read. An
       * affordance that is present but cannot work is the thing that teaches
       * you to stop trusting the app.
       */}
      {readable && onRead ? (
        <Pressable
          onPress={onRead}
          disabled={reading}
          hitSlop={8}
          testID={`attachment-read-${attachment.fileName.slice(0, 8)}`}
          accessibilityRole="button"
          accessibilityLabel={reading ? `Reading ${label}` : `Read ${label} and fill in the record`}
          className="absolute -bottom-1.5 -right-1.5 h-5 w-5 items-center justify-center rounded-full border border-accent bg-ground active:opacity-70">
          {reading ? (
            <ActivityIndicator size="small" color={palette.accent} />
          ) : (
            <Icon name="sparkle" size={11} color={palette.accent} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
});

function SquareButton({
  icon,
  label,
  onPress,
  disabled,
  testID,
  badge,
  solid,
}: {
  icon: 'camera' | 'folder' | 'mic';
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
  badge?: number;
  /** Filled rather than outlined, for a bar that floats over the note's text. */
  solid?: boolean;
}) {
  const palette = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`h-10 w-10 items-center justify-center rounded-lg border border-line active:opacity-70 ${
        solid ? 'bg-surface' : ''
      } ${disabled ? 'opacity-40' : ''}`}>
      <Icon name={icon} size={18} color={palette.muted} />
      {badge ? (
        <View className="absolute -right-1 -top-1 h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1">
          <Text className="text-[10px] font-semibold text-accent-ink">{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function AttachmentBar({
  attachments,
  onCamera,
  onFiles,
  onRemove,
  onOpen,
  onRead,
  reading,
  onVoice,
  leading,
  compact,
  busy,
}: Props) {
  const mic = onVoice ? (
    <SquareButton
      icon="mic"
      label="Speak the record"
      onPress={onVoice}
      disabled={busy}
      testID="record-voice"
      // The full bar floats over the note's text, so its buttons need a fill
      // of their own; the one-line split-screen row sits on nothing.
      solid={!compact}
    />
  ) : null;

  /**
   * One button in split-screen, and it opens the CAMERA.
   *
   * Of the two, the camera is the one that cannot be done later — the receipt
   * is in your hand now. Picking a file that is already on the phone can wait
   * for a full-height window, and the count on the badge still says how many
   * are attached.
   */
  if (compact) {
    return (
      <>
        {mic}
        <SquareButton
          icon="camera"
          label={`Attach a receipt. ${attachments.length} attached`}
          onPress={onCamera}
          disabled={busy}
          testID="attach-camera"
          badge={attachments.length}
        />
      </>
    );
  }

  /**
   * The previews get a strip of their own; the buttons share a ROW with
   * whatever the screen puts on their left — the record's tags.
   *
   * The buttons used to float over the right of the preview strip, which put
   * the tags on a line of their own ABOVE the buttons: two controls for the
   * same record at two heights, and a whole row spent when there were no
   * receipts at all. Tags and buttons side by side cost one 40dp row; the
   * strip appears only once there is something to show in it, and needs no
   * trailing padding because nothing covers its end any more.
   *
   * On the record screen the whole bar floats over the foot of the note, and
   * the note's text scrolls beneath it — see `record.tsx`.
   */
  return (
    <View className="mt-2" testID="attachment-bar">
      {attachments.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 10,
            // Room for the badges, which overhang the corners of every tile and
            // would otherwise be sliced off by the scroll view's own bounds —
            // the read badge was visibly clipped along the bottom edge.
            paddingTop: BADGE_ROOM,
            paddingBottom: BADGE_ROOM,
            paddingRight: BADGE_ROOM,
          }}
          testID="attachment-previews">
          {attachments.map((attachment) => (
            <Preview
              key={attachment.fileName}
              attachment={attachment}
              onOpen={() => onOpen(attachment)}
              onRemove={() => onRemove(attachment.fileName)}
              onRead={onRead ? () => onRead(attachment) : undefined}
              reading={reading === attachment.fileName}
            />
          ))}
        </ScrollView>
      ) : null}

      <View className="flex-row items-center gap-2">
        <View className="flex-1">{leading}</View>
        {mic}
        <SquareButton
          icon="camera"
          label="Photograph a receipt"
          onPress={onCamera}
          disabled={busy}
          testID="attach-camera"
          solid
        />
        <SquareButton
          icon="folder"
          label="Attach a file"
          onPress={onFiles}
          disabled={busy}
          testID="attach-file"
          solid
        />
      </View>
    </View>
  );
}
